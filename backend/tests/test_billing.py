"""Tests for billing endpoints: GET /status and POST /cancel."""
import uuid
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport


def _result(sub=None):
    r = MagicMock()
    r.scalar_one_or_none.return_value = sub
    return r


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.commit = AsyncMock()
    db.add = MagicMock()  # SQLAlchemy add() es síncrono, no una corutina
    db.execute.return_value = _result()
    return db


@pytest.fixture
def app(mock_db, monkeypatch):
    from cryptography.fernet import Fernet
    import config as _config
    monkeypatch.setattr(_config.settings, "ENCRYPTION_KEY", Fernet.generate_key().decode())
    with patch("database.init_db", new=AsyncMock()):
        from main import app as _app
        from database import get_db
        from api.auth import get_current_psychologist

        fake_psy = MagicMock()
        fake_psy.id = uuid.UUID("99999999-9999-9999-9999-999999999999")
        fake_psy.is_active = True
        fake_psy.trial_ends_at = None
        fake_psy.stripe_customer_id = "cus_test"

        async def override_get_db():
            yield mock_db

        async def override_current_user():
            return fake_psy

        _app.dependency_overrides[get_db] = override_get_db
        _app.dependency_overrides[get_current_psychologist] = override_current_user
        yield _app
        _app.dependency_overrides.clear()


@pytest.fixture
def active_sub():
    sub = MagicMock()
    sub.status = "active"
    sub.stripe_subscription_id = "sub_test123"
    sub.cancel_at_period_end = False
    sub.canceled_at = None
    sub.current_period_end = datetime(2026, 6, 7, tzinfo=timezone.utc)
    return sub


class TestBillingStatusCancelAtPeriodEnd:
    @pytest.mark.asyncio
    async def test_active_status_includes_cancel_at_period_end_false(self, app, mock_db, active_sub):
        mock_db.execute.return_value = _result(sub=active_sub)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get("/api/v1/billing/status")
        assert res.status_code == 200
        assert res.json()["cancel_at_period_end"] is False

    @pytest.mark.asyncio
    async def test_active_status_includes_cancel_at_period_end_true(self, app, mock_db, active_sub):
        active_sub.cancel_at_period_end = True
        mock_db.execute.return_value = _result(sub=active_sub)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get("/api/v1/billing/status")
        assert res.status_code == 200
        assert res.json()["cancel_at_period_end"] is True


class TestCancelSubscription:
    @pytest.mark.asyncio
    async def test_cancel_active_returns_200(self, app, mock_db, active_sub):
        mock_db.execute.return_value = _result(sub=active_sub)
        with patch("api.billing.stripe") as mock_stripe:
            mock_stripe.Subscription.modify.return_value = MagicMock()
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                res = await client.post("/api/v1/billing/cancel")
        assert res.status_code == 200
        assert res.json()["cancel_at_period_end"] is True

    @pytest.mark.asyncio
    async def test_cancel_sets_cancel_at_period_end_in_db(self, app, mock_db, active_sub):
        mock_db.execute.return_value = _result(sub=active_sub)
        with patch("api.billing.stripe") as mock_stripe:
            mock_stripe.Subscription.modify.return_value = MagicMock()
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                await client.post("/api/v1/billing/cancel")
        assert active_sub.cancel_at_period_end is True
        mock_db.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_cancel_calls_stripe_with_correct_args(self, app, mock_db, active_sub):
        mock_db.execute.return_value = _result(sub=active_sub)
        with patch("api.billing.stripe") as mock_stripe:
            mock_stripe.Subscription.modify.return_value = MagicMock()
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                await client.post("/api/v1/billing/cancel")
        mock_stripe.Subscription.modify.assert_called_once_with(
            "sub_test123", cancel_at_period_end=True
        )

    @pytest.mark.asyncio
    async def test_cancel_idempotent_already_marked(self, app, mock_db, active_sub):
        active_sub.cancel_at_period_end = True
        mock_db.execute.return_value = _result(sub=active_sub)
        with patch("api.billing.stripe") as mock_stripe:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                res = await client.post("/api/v1/billing/cancel")
        assert res.status_code == 200
        assert res.json()["cancel_at_period_end"] is True
        mock_stripe.Subscription.modify.assert_not_called()

    @pytest.mark.asyncio
    async def test_cancel_trialing_returns_400(self, app, mock_db):
        sub = MagicMock()
        sub.status = "trialing"
        mock_db.execute.return_value = _result(sub=sub)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post("/api/v1/billing/cancel")
        assert res.status_code == 400

    @pytest.mark.asyncio
    async def test_cancel_no_subscription_returns_400(self, app, mock_db):
        mock_db.execute.return_value = _result(sub=None)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post("/api/v1/billing/cancel")
        assert res.status_code == 400

    @pytest.mark.asyncio
    async def test_cancel_already_canceled_status_returns_400(self, app, mock_db):
        sub = MagicMock()
        sub.status = "canceled"
        mock_db.execute.return_value = _result(sub=sub)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post("/api/v1/billing/cancel")
        assert res.status_code == 400

    @pytest.mark.asyncio
    async def test_cancel_stripe_error_returns_502(self, app, mock_db, active_sub):
        mock_db.execute.return_value = _result(sub=active_sub)
        with patch("api.billing.stripe") as mock_stripe:
            mock_stripe.Subscription.modify.side_effect = Exception("Stripe down")
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                res = await client.post("/api/v1/billing/cancel")
        assert res.status_code == 502


class TestStripeWebhook:
    @pytest.mark.asyncio
    async def test_webhook_updates_cancel_at_period_end(self, app, mock_db, active_sub, monkeypatch):
        import config as _config
        monkeypatch.setattr(_config.settings, "STRIPE_WEBHOOK_SECRET", "whsec_test")
        mock_db.execute.return_value = _result(None) # For ProcessedStripeEvent check
        
        # We need to mock the second execute call inside the webhook
        # 1. ProcessedStripeEvent check -> None
        # 2. Subscription select -> active_sub
        mock_db.execute.side_effect = [_result(None), _result(active_sub)]

        payload = b'{"id": "evt_123", "type": "customer.subscription.updated", "data": {"object": {"id": "sub_test123", "status": "active", "current_period_end": 1717718400, "cancel_at_period_end": true}}}'
        
        with patch("api.billing.stripe.Webhook.construct_event") as mock_construct:
            mock_event = MagicMock()
            mock_event.id = "evt_123"
            mock_event.type = "customer.subscription.updated"
            mock_event.data.object = MagicMock(
                id="sub_test123", 
                status="active", 
                current_period_end=1717718400, 
                cancel_at_period_end=True
            )
            mock_construct.return_value = mock_event

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                res = await client.post("/api/v1/billing/webhook", content=payload, headers={"stripe-signature": "sig"})
        
        assert res.status_code == 200
        assert active_sub.cancel_at_period_end is True
        mock_db.commit.assert_called_once()
