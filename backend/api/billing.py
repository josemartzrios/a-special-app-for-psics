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

@router.get("/status")
async def get_billing_status(
    psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Subscription).where(Subscription.psychologist_id == psychologist.id)
    )
    sub = result.scalar_one_or_none()
    
    if not sub:
        # Esto no debería pasar porque se crea en register
        return {"status": "trialing", "days_remaining": 0}
        
    if sub.status == 'trialing':
        trial_end = psychologist.trial_ends_at
        if not trial_end:
            trial_end = datetime.now(timezone.utc)
        trial_end = trial_end.replace(tzinfo=timezone.utc) if trial_end.tzinfo is None else trial_end
        days = (trial_end - datetime.now(timezone.utc)).days
        return {"status": "trialing", "days_remaining": max(0, days)}
        
    if sub.status == "active":
        return {
            "status": "active",
            "current_period_end": sub.current_period_end,
            "cancel_at_period_end": sub.cancel_at_period_end,
        }
    return {
        "status": sub.status,
        "current_period_end": sub.current_period_end,
    }

@router.post("/create-checkout")
async def create_checkout_session(
    psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Subscription).where(Subscription.psychologist_id == psychologist.id)
    )
    sub = result.scalar_one_or_none()
    
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

@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    sig_header = request.headers.get('stripe-signature')
    webhook_secret = settings.STRIPE_WEBHOOK_SECRET

    if not webhook_secret:
        logger.error("STRIPE_WEBHOOK_SECRET not configured")
        raise HTTPException(status_code=500, detail="Error interno del servidor")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Firma inválida")
    except ValueError:
        raise HTTPException(status_code=400, detail="Payload inválido")

    # Idempotencia
    result = await db.execute(
        select(ProcessedStripeEvent).where(ProcessedStripeEvent.id == event.id)
    )
    if result.scalar_one_or_none():
        return {"status": "already_processed"}
        
    # Guardar evento
    db.add(ProcessedStripeEvent(id=event.id))

    # Manejar pago exitoso
    if event.type == 'checkout.session.completed':
        session = event.data.object
        if session.mode == 'subscription':
            psychologist_id = session.metadata.get('psychologist_id')
            if psychologist_id:
                sub_result = await db.execute(
                    select(Subscription).where(Subscription.psychologist_id == psychologist_id)
                )
                sub = sub_result.scalar_one_or_none()
                if sub:
                    sub.stripe_subscription_id = session.subscription
                    sub.status = 'active'
    
    elif event.type == 'invoice.payment_succeeded':
        # Actualizar fecha de fin de periodo
        invoice = event.data.object
        if invoice.subscription:
            sub = stripe.Subscription.retrieve(invoice.subscription)
            db_sub_res = await db.execute(
                select(Subscription).where(Subscription.stripe_subscription_id == invoice.subscription)
            )
            db_sub = db_sub_res.scalar_one_or_none()
            if db_sub:
                db_sub.status = sub.status
                db_sub.current_period_end = datetime.fromtimestamp(sub.current_period_end, timezone.utc)

    elif event.type == 'invoice.payment_failed':
        invoice = event.data.object
        if invoice.subscription:
            db_sub_res = await db.execute(
                select(Subscription).where(
                    Subscription.stripe_subscription_id == invoice.subscription
                )
            )
            db_sub = db_sub_res.scalar_one_or_none()
            if db_sub:
                db_sub.status = 'past_due'

    elif event.type in ['customer.subscription.deleted', 'customer.subscription.updated']:
        stripe_sub = event.data.object
        db_sub_res = await db.execute(
            select(Subscription).where(Subscription.stripe_subscription_id == stripe_sub.id)
        )
        db_sub = db_sub_res.scalar_one_or_none()
        if db_sub:
            db_sub.status = stripe_sub.status
            db_sub.current_period_end = datetime.fromtimestamp(stripe_sub.current_period_end, timezone.utc)
            db_sub.cancel_at_period_end = stripe_sub.cancel_at_period_end

    await db.commit()
    return {"status": "success"}

@router.post("/cancel")
async def cancel_subscription(
    psychologist=Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subscription).where(Subscription.psychologist_id == psychologist.id)
    )
    sub = result.scalar_one_or_none()

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
