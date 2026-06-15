import os
import logging
import stripe
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from database import get_db, Subscription, ProcessedStripeEvent
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from .auth import get_current_psychologist

from config import settings

logger = logging.getLogger("syquex.billing")

router = APIRouter()
stripe.api_key = settings.STRIPE_SECRET_KEY


# ---------------------------------------------------------------------------
# Data access (Repository) — query reutilizable por todos los endpoints
# ---------------------------------------------------------------------------

async def _get_subscription(psychologist_id, db: AsyncSession) -> Subscription | None:
    result = await db.execute(
        select(Subscription).where(Subscription.psychologist_id == psychologist_id)
    )
    return result.scalar_one_or_none()


async def _get_subscription_by_stripe_id(stripe_subscription_id: str, db: AsyncSession) -> Subscription | None:
    result = await db.execute(
        select(Subscription).where(Subscription.stripe_subscription_id == stripe_subscription_id)
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Lógica de negocio (pura, testeable sin DB ni HTTP)
# ---------------------------------------------------------------------------

def _trial_days_remaining(trial_ends_at: datetime | None) -> int:
    """Días restantes de trial, nunca negativo."""
    if not trial_ends_at:
        return 0
    # trial_ends_at puede venir naive desde la DB; normalizamos a UTC aware
    end = trial_ends_at.replace(tzinfo=timezone.utc) if trial_ends_at.tzinfo is None else trial_ends_at
    return max(0, (end - datetime.now(timezone.utc)).days)


def _fetch_payment_method(stripe_customer_id: str | None) -> dict | None:
    """Tarjeta default del customer en Stripe, o None si no hay o si la llamada falla."""
    if not stripe_customer_id:
        return None
    try:
        customer = stripe.Customer.retrieve(
            stripe_customer_id,
            expand=["invoice_settings.default_payment_method"],
        )
        pm = customer.invoice_settings.default_payment_method
        if pm and getattr(pm, "card", None):
            return {"brand": pm.card.brand, "last4": pm.card.last4}
    except Exception as e:
        logger.warning("Could not fetch payment method from Stripe: %s", e)
    return None


def _build_billing_status(sub: Subscription | None, psychologist) -> dict:
    """Despacha la respuesta de /status según el estado de la suscripción."""
    if not sub:
        # No debería pasar: la suscripción se crea en register
        return {"status": "trialing", "days_remaining": 0}

    match sub.status:
        case "trialing":
            return {
                "status": "trialing",
                "days_remaining": _trial_days_remaining(psychologist.trial_ends_at),
            }
        # Sub activa sin stripe_subscription_id → acceso de cortesía manual
        case "active" if not sub.stripe_subscription_id:
            return {"status": "courtesy"}
        case "active":
            return {
                "status": "active",
                "current_period_end": sub.current_period_end,
                "cancel_at_period_end": sub.cancel_at_period_end,
                "payment_method": _fetch_payment_method(psychologist.stripe_customer_id),
            }
        case _:
            return {"status": sub.status, "current_period_end": sub.current_period_end}


@router.get("/status")
async def get_billing_status(
    psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db)
):
    sub = await _get_subscription(psychologist.id, db)
    return _build_billing_status(sub, psychologist)

@router.post("/create-checkout")
async def create_checkout_session(
    psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db)
):
    sub = await _get_subscription(psychologist.id, db)

    if not sub:
        raise HTTPException(status_code=404, detail="Suscripción no encontrada")
        
    try:
        session = stripe.checkout.Session.create(
            customer=psychologist.stripe_customer_id,
            line_items=[{
                'price': settings.STRIPE_PRICE_ID,
                'quantity': 1,
            }],
            mode='subscription',
            success_url=f"{settings.FRONTEND_URL}/?success=true",
            cancel_url=f"{settings.FRONTEND_URL}/",
            metadata={'psychologist_id': psychologist.id}
        )
        return {"checkout_url": session.url}
    except Exception as e:
        logger.error("Stripe checkout error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Error al crear sesión de pago")

# ---------------------------------------------------------------------------
# Webhook — transporte + idempotencia (preocupaciones transversales)
# ---------------------------------------------------------------------------

async def _verify_stripe_event(request: Request):
    """Lee el body, verifica la firma y devuelve el evento Stripe ya validado."""
    webhook_secret = settings.STRIPE_WEBHOOK_SECRET
    if not webhook_secret:
        logger.error("STRIPE_WEBHOOK_SECRET not configured")
        raise HTTPException(status_code=500, detail="Error interno del servidor")

    payload = await request.body()
    sig_header = request.headers.get('stripe-signature')
    try:
        return stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Firma inválida")
    except ValueError:
        raise HTTPException(status_code=400, detail="Payload inválido")


async def _is_event_processed(event_id: str, db: AsyncSession) -> bool:
    """True si el evento ya fue procesado (idempotencia de reintentos de Stripe)."""
    result = await db.execute(
        select(ProcessedStripeEvent).where(ProcessedStripeEvent.id == event_id)
    )
    return result.scalar_one_or_none() is not None


# ---------------------------------------------------------------------------
# Handlers por tipo de evento — reglas de negocio puras, una responsabilidad
# c/u. Mutan la suscripción en sesión; el commit lo hace el endpoint.
# ---------------------------------------------------------------------------

async def _handle_checkout_completed(session, db: AsyncSession) -> None:
    if session.mode != 'subscription':
        return
    psychologist_id = session.metadata.get('psychologist_id')
    if not psychologist_id:
        return
    sub = await _get_subscription(psychologist_id, db)
    if not sub:
        return
    sub.stripe_subscription_id = session.subscription
    sub.status = 'active'


async def _handle_invoice_payment_succeeded(invoice, db: AsyncSession) -> None:
    if not invoice.subscription:
        return
    db_sub = await _get_subscription_by_stripe_id(invoice.subscription, db)
    if not db_sub:
        return
    # Stripe trae el periodo actualizado en el objeto Subscription, no en el invoice
    stripe_sub = stripe.Subscription.retrieve(invoice.subscription)
    db_sub.status = stripe_sub.status
    db_sub.current_period_end = datetime.fromtimestamp(stripe_sub.current_period_end, timezone.utc)


async def _handle_invoice_payment_failed(invoice, db: AsyncSession) -> None:
    if not invoice.subscription:
        return
    db_sub = await _get_subscription_by_stripe_id(invoice.subscription, db)
    if db_sub:
        db_sub.status = 'past_due'


async def _handle_subscription_changed(stripe_sub, db: AsyncSession) -> None:
    db_sub = await _get_subscription_by_stripe_id(stripe_sub.id, db)
    if not db_sub:
        return
    db_sub.status = stripe_sub.status
    db_sub.current_period_end = datetime.fromtimestamp(stripe_sub.current_period_end, timezone.utc)
    db_sub.cancel_at_period_end = stripe_sub.cancel_at_period_end


async def _handle_setup_intent_succeeded(si, db: AsyncSession) -> None:
    pm_id = si.payment_method
    customer_id = si.customer
    if pm_id and customer_id:
        try:
            stripe.PaymentMethod.attach(pm_id, customer=customer_id)
            stripe.Customer.modify(
                customer_id,
                invoice_settings={"default_payment_method": pm_id},
            )
        except Exception as e:
            logger.error("Failed to set default payment method: %s", e, exc_info=True)


# Dispatch table — añadir un evento = añadir una entrada, sin tocar el endpoint
# (Open/Closed, mismo patrón que AGENT_TOOLS).
_WEBHOOK_HANDLERS = {
    'checkout.session.completed': _handle_checkout_completed,
    'invoice.payment_succeeded': _handle_invoice_payment_succeeded,
    'invoice.payment_failed': _handle_invoice_payment_failed,
    'customer.subscription.deleted': _handle_subscription_changed,
    'customer.subscription.updated': _handle_subscription_changed,
    'setup_intent.succeeded': _handle_setup_intent_succeeded,
}


@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    event = await _verify_stripe_event(request)

    if await _is_event_processed(event.id, db):
        return {"status": "already_processed"}
    db.add(ProcessedStripeEvent(id=event.id))

    handler = _WEBHOOK_HANDLERS.get(event.type)
    if handler:
        await handler(event.data.object, db)

    await db.commit()
    return {"status": "success"}

@router.post("/cancel")
async def cancel_subscription(
    psychologist=Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db),
):
    sub = await _get_subscription(psychologist.id, db)

    if not sub or sub.status != "active" or not sub.stripe_subscription_id:
        raise HTTPException(status_code=400, detail="No tienes una suscripción activa")

    if sub.cancel_at_period_end:
        return {
            "cancel_at_period_end": True,
            "current_period_end": sub.current_period_end,
        }

    try:
        stripe.Subscription.modify(
            sub.stripe_subscription_id,
            cancel_at_period_end=True,
        )
    except Exception as e:
        logger.error("Stripe cancel error: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="Error al comunicarse con Stripe")

    sub.cancel_at_period_end = True
    sub.canceled_at = datetime.now(timezone.utc)
    await db.commit()

    return {
        "cancel_at_period_end": True,
        "current_period_end": sub.current_period_end,
    }


@router.post("/setup-intent")
async def create_setup_intent(
    psychologist=Depends(get_current_psychologist),
):
    if not psychologist.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No hay cuenta de facturación configurada")
    try:
        setup_intent = stripe.SetupIntent.create(
            customer=psychologist.stripe_customer_id,
            payment_method_types=["card"],
            usage="off_session",
        )
        return {"client_secret": setup_intent.client_secret}
    except Exception as e:
        logger.error("Stripe setup intent error: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="Error al comunicarse con Stripe")
