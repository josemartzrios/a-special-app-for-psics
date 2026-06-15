"""
Unit tests for billing status logic (api/billing.py).

Cubren las funciones puras de despacho de /status — sin DB ni HTTP — y el
aislamiento de la llamada a Stripe en _fetch_payment_method.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from unittest.mock import AsyncMock

from api.billing import (
    _build_billing_status,
    _trial_days_remaining,
    _fetch_payment_method,
    _handle_checkout_completed,
    _handle_invoice_payment_succeeded,
    _handle_invoice_payment_failed,
    _handle_subscription_changed,
    _WEBHOOK_HANDLERS,
)

UTC = timezone.utc


def _sub(status, stripe_subscription_id=None, current_period_end=None, cancel_at_period_end=False):
    return SimpleNamespace(
        status=status,
        stripe_subscription_id=stripe_subscription_id,
        current_period_end=current_period_end,
        cancel_at_period_end=cancel_at_period_end,
    )


def _psy(trial_ends_at=None, stripe_customer_id=None):
    return SimpleNamespace(trial_ends_at=trial_ends_at, stripe_customer_id=stripe_customer_id)


class TestTrialDaysRemaining:
    def test_none_returns_zero(self):
        assert _trial_days_remaining(None) == 0

    def test_future_trial_returns_positive_days(self):
        # +12h de buffer mantiene el truncamiento de .days estable pese al tiempo transcurrido
        future = datetime.now(UTC) + timedelta(days=10, hours=12)
        assert _trial_days_remaining(future) == 10

    def test_past_trial_clamped_to_zero(self):
        past = datetime.now(UTC) - timedelta(days=5)
        assert _trial_days_remaining(past) == 0

    def test_naive_datetime_is_treated_as_utc(self):
        naive_future = (datetime.now(UTC) + timedelta(days=3, hours=12)).replace(tzinfo=None)
        assert _trial_days_remaining(naive_future) == 3


class TestBuildBillingStatus:
    def test_no_subscription_defaults_to_trialing_zero(self):
        result = _build_billing_status(None, _psy())
        assert result == {"status": "trialing", "days_remaining": 0}

    def test_trialing_reports_remaining_days(self):
        psy = _psy(trial_ends_at=datetime.now(UTC) + timedelta(days=7, hours=12))
        result = _build_billing_status(_sub("trialing"), psy)
        assert result["status"] == "trialing"
        assert result["days_remaining"] == 7

    def test_active_without_stripe_id_is_courtesy(self):
        result = _build_billing_status(_sub("active", stripe_subscription_id=None), _psy())
        assert result == {"status": "courtesy"}

    def test_active_with_stripe_id_returns_full_payload(self):
        period_end = datetime.now(UTC) + timedelta(days=20)
        sub = _sub("active", stripe_subscription_id="sub_123", current_period_end=period_end, cancel_at_period_end=True)
        psy = _psy(stripe_customer_id=None)  # sin customer → payment_method None, sin llamar a Stripe
        result = _build_billing_status(sub, psy)
        assert result["status"] == "active"
        assert result["current_period_end"] == period_end
        assert result["cancel_at_period_end"] is True
        assert result["payment_method"] is None

    def test_unknown_status_falls_through_to_default(self):
        period_end = datetime.now(UTC)
        result = _build_billing_status(_sub("past_due", current_period_end=period_end), _psy())
        assert result == {"status": "past_due", "current_period_end": period_end}


class TestFetchPaymentMethod:
    def test_no_customer_id_returns_none_without_calling_stripe(self):
        with patch("api.billing.stripe.Customer.retrieve") as retrieve:
            assert _fetch_payment_method(None) is None
            retrieve.assert_not_called()

    def test_returns_card_brand_and_last4(self):
        card = SimpleNamespace(brand="visa", last4="4242")
        pm = SimpleNamespace(card=card)
        customer = MagicMock()
        customer.invoice_settings.default_payment_method = pm
        with patch("api.billing.stripe.Customer.retrieve", return_value=customer):
            assert _fetch_payment_method("cus_123") == {"brand": "visa", "last4": "4242"}

    def test_no_default_payment_method_returns_none(self):
        customer = MagicMock()
        customer.invoice_settings.default_payment_method = None
        with patch("api.billing.stripe.Customer.retrieve", return_value=customer):
            assert _fetch_payment_method("cus_123") is None

    def test_stripe_failure_is_swallowed_and_returns_none(self):
        with patch("api.billing.stripe.Customer.retrieve", side_effect=Exception("stripe down")):
            assert _fetch_payment_method("cus_123") is None


class TestWebhookDispatch:
    def test_known_event_types_map_to_a_handler(self):
        for event_type in [
            "checkout.session.completed",
            "invoice.payment_succeeded",
            "invoice.payment_failed",
            "customer.subscription.deleted",
            "customer.subscription.updated",
        ]:
            assert event_type in _WEBHOOK_HANDLERS

    def test_subscription_deleted_and_updated_share_one_handler(self):
        assert (
            _WEBHOOK_HANDLERS["customer.subscription.deleted"]
            is _WEBHOOK_HANDLERS["customer.subscription.updated"]
        )

    def test_unknown_event_type_has_no_handler(self):
        assert _WEBHOOK_HANDLERS.get("customer.subscription.trial_will_end") is None


@pytest.mark.asyncio
class TestCheckoutCompletedHandler:
    async def test_links_stripe_subscription_and_activates(self):
        session = SimpleNamespace(
            mode="subscription",
            subscription="sub_123",
            metadata={"psychologist_id": "psy_1"},
        )
        sub = _sub("trialing")
        with patch("api.billing._get_subscription", AsyncMock(return_value=sub)):
            await _handle_checkout_completed(session, db=AsyncMock())
        assert sub.stripe_subscription_id == "sub_123"
        assert sub.status == "active"

    async def test_non_subscription_mode_is_ignored(self):
        session = SimpleNamespace(mode="payment", subscription="sub_x", metadata={})
        get_sub = AsyncMock()
        with patch("api.billing._get_subscription", get_sub):
            await _handle_checkout_completed(session, db=AsyncMock())
        get_sub.assert_not_called()

    async def test_missing_psychologist_id_is_ignored(self):
        session = SimpleNamespace(mode="subscription", subscription="sub_x", metadata={})
        get_sub = AsyncMock()
        with patch("api.billing._get_subscription", get_sub):
            await _handle_checkout_completed(session, db=AsyncMock())
        get_sub.assert_not_called()


@pytest.mark.asyncio
class TestInvoicePaymentSucceededHandler:
    async def test_syncs_status_and_period_end_from_stripe(self):
        period_end_unix = 1_900_000_000
        invoice = SimpleNamespace(subscription="sub_123")
        db_sub = _sub("past_due", stripe_subscription_id="sub_123")
        stripe_sub = SimpleNamespace(status="active", current_period_end=period_end_unix)
        with patch("api.billing._get_subscription_by_stripe_id", AsyncMock(return_value=db_sub)), \
             patch("api.billing.stripe.Subscription.retrieve", return_value=stripe_sub):
            await _handle_invoice_payment_succeeded(invoice, db=AsyncMock())
        assert db_sub.status == "active"
        assert db_sub.current_period_end == datetime.fromtimestamp(period_end_unix, UTC)

    async def test_invoice_without_subscription_skips_stripe_call(self):
        invoice = SimpleNamespace(subscription=None)
        with patch("api.billing.stripe.Subscription.retrieve") as retrieve:
            await _handle_invoice_payment_succeeded(invoice, db=AsyncMock())
        retrieve.assert_not_called()


@pytest.mark.asyncio
class TestInvoicePaymentFailedHandler:
    async def test_sets_status_past_due(self):
        invoice = SimpleNamespace(subscription="sub_123")
        db_sub = _sub("active", stripe_subscription_id="sub_123")
        with patch("api.billing._get_subscription_by_stripe_id", AsyncMock(return_value=db_sub)):
            await _handle_invoice_payment_failed(invoice, db=AsyncMock())
        assert db_sub.status == "past_due"


@pytest.mark.asyncio
class TestSubscriptionChangedHandler:
    async def test_syncs_status_period_and_cancel_flag(self):
        period_end_unix = 1_900_000_000
        stripe_sub = SimpleNamespace(
            id="sub_123",
            status="canceled",
            current_period_end=period_end_unix,
            cancel_at_period_end=True,
        )
        db_sub = _sub("active", stripe_subscription_id="sub_123")
        with patch("api.billing._get_subscription_by_stripe_id", AsyncMock(return_value=db_sub)):
            await _handle_subscription_changed(stripe_sub, db=AsyncMock())
        assert db_sub.status == "canceled"
        assert db_sub.current_period_end == datetime.fromtimestamp(period_end_unix, UTC)
        assert db_sub.cancel_at_period_end is True

    async def test_untracked_subscription_is_ignored(self):
        stripe_sub = SimpleNamespace(id="sub_unknown", status="active",
                                     current_period_end=1, cancel_at_period_end=False)
        with patch("api.billing._get_subscription_by_stripe_id", AsyncMock(return_value=None)):
            # No debe lanzar al no encontrar la suscripción
            await _handle_subscription_changed(stripe_sub, db=AsyncMock())
