import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

# Prevent DB connection on startup
with patch("database.init_db", new=AsyncMock()):
    from main import app

from fastapi.testclient import TestClient
from api.auth import get_current_psychologist
from database import get_db


def _mock_psych(**kwargs):
    defaults = dict(
        id=uuid.UUID("12345678-1234-5678-1234-567812345678"),
        name="Dr. Test",
        email="test@example.com",
        cedula_profesional="9876543",
        stripe_customer_id="cus_test123",
        is_active=True,
        trial_ends_at=None,
    )
    defaults.update(kwargs)
    m = MagicMock()
    for k, v in defaults.items():
        setattr(m, k, v)
    return m


def test_get_me_returns_profile_fields():
    psych = _mock_psych()
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    with TestClient(app) as client:
        resp = client.get("/api/v1/auth/me")

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Dr. Test"
    assert data["email"] == "test@example.com"
    assert data["cedula_profesional"] == "9876543"
    assert data["id"] == "12345678-1234-5678-1234-567812345678"


def test_get_me_null_cedula():
    psych = _mock_psych(cedula_profesional=None)
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    with TestClient(app) as client:
        resp = client.get("/api/v1/auth/me")

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["cedula_profesional"] is None


def test_get_me_requires_auth():
    with TestClient(app) as client:
        resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


def test_change_password_success():
    psych = _mock_psych()
    psych.password_hash = "hashed_old"
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    async def override_get_db():
        db = AsyncMock()
        db.commit = AsyncMock()
        db.add = MagicMock()
        yield db

    app.dependency_overrides[get_db] = override_get_db

    with patch("api.auth.verify_password", return_value=True), \
         patch("api.auth.hash_password", return_value="hashed_new"):
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/auth/change-password",
                json={"current_password": "OldPass123!", "new_password": "NewPass456!"},
            )

    app.dependency_overrides.clear()

    assert resp.status_code == 204
    assert psych.password_hash == "hashed_new"


def test_change_password_audit_log_has_required_entity():
    """Regresión: el AuditLog de cambio de contraseña debe poblar `entity`
    (NOT NULL en la tabla). El mock de db.add no valida la constraint, así que
    inspeccionamos el objeto construido para atrapar el INSERT inválido que
    causaba un 500 en producción."""
    from database import AuditLog

    psych = _mock_psych()
    psych.password_hash = "hashed_old"
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    added = []

    async def override_get_db():
        db = AsyncMock()
        db.commit = AsyncMock()
        db.add = MagicMock(side_effect=added.append)
        yield db

    app.dependency_overrides[get_db] = override_get_db

    with patch("api.auth.verify_password", return_value=True), \
         patch("api.auth.hash_password", return_value="hashed_new"):
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/auth/change-password",
                json={"current_password": "OldPass123!", "new_password": "NewPass456!"},
            )

    app.dependency_overrides.clear()

    assert resp.status_code == 204
    audit_entries = [a for a in added if isinstance(a, AuditLog)]
    assert len(audit_entries) == 1
    entry = audit_entries[0]
    assert entry.entity is not None  # NOT NULL — el bug dejaba esto en None → 500
    assert entry.action == "password_changed"


def test_change_password_rejects_reuse_of_current():
    """No se permite 'cambiar' la contraseña por la misma que ya se tenía."""
    psych = _mock_psych()
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    # La contraseña actual es correcta (verify_password=True), pero la nueva
    # es idéntica a la actual → debe rechazarse antes de tocar el hash.
    same = "SamePass123!"
    with patch("api.auth.verify_password", return_value=True):
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/auth/change-password",
                json={"current_password": same, "new_password": same},
            )

    app.dependency_overrides.clear()

    assert resp.status_code == 400
    assert "actual" in resp.json()["detail"].lower()


def test_change_password_wrong_current():
    psych = _mock_psych()
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    with patch("api.auth.verify_password", return_value=False):
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/auth/change-password",
                json={"current_password": "WrongPass!", "new_password": "NewPass456!"},
            )

    app.dependency_overrides.clear()

    assert resp.status_code == 400
    assert "incorrecta" in resp.json()["detail"].lower()


def test_change_password_policy_violation():
    psych = _mock_psych()
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    with patch("api.auth.verify_password", return_value=True):
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/auth/change-password",
                json={"current_password": "OldPass123!", "new_password": "weak"},
            )

    app.dependency_overrides.clear()

    assert resp.status_code == 422


def test_change_password_requires_auth():
    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "OldPass123!", "new_password": "NewPass456!"},
        )
    assert resp.status_code == 401


def test_create_setup_intent_returns_client_secret():
    psych = _mock_psych()
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    mock_si = MagicMock()
    mock_si.client_secret = "seti_test_secret_xyz"

    with patch("api.billing.stripe.SetupIntent.create", return_value=mock_si):
        with TestClient(app) as client:
            resp = client.post("/api/v1/billing/setup-intent")

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["client_secret"] == "seti_test_secret_xyz"


def test_create_setup_intent_no_stripe_customer():
    psych = _mock_psych(stripe_customer_id=None)
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    with TestClient(app) as client:
        resp = client.post("/api/v1/billing/setup-intent")

    app.dependency_overrides.clear()

    assert resp.status_code == 400


def test_billing_status_courtesy():
    """Sub activa sin stripe_subscription_id → acceso de cortesía manual."""
    from database import get_db

    psych = _mock_psych(stripe_customer_id=None)
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    mock_sub = MagicMock()
    mock_sub.status = "active"
    mock_sub.stripe_subscription_id = None

    async def mock_get_db():
        mock_db = MagicMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_sub
        async def _exec(*a, **kw): return mock_result
        mock_db.execute = _exec
        yield mock_db

    app.dependency_overrides[get_db] = mock_get_db

    with TestClient(app) as client:
        resp = client.get("/api/v1/billing/status")

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["status"] == "courtesy"


def test_billing_status_active_includes_payment_method():
    from database import get_db

    psych = _mock_psych()
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    mock_sub = MagicMock()
    mock_sub.status = "active"
    mock_sub.stripe_subscription_id = "sub_test123"
    mock_sub.current_period_end = None
    mock_sub.cancel_at_period_end = False

    mock_pm = MagicMock()
    mock_pm.card.brand = "visa"
    mock_pm.card.last4 = "4242"

    mock_customer = MagicMock()
    mock_customer.invoice_settings.default_payment_method = mock_pm

    async def mock_get_db():
        mock_db = MagicMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_sub
        async def _exec(*a, **kw): return mock_result
        mock_db.execute = _exec
        yield mock_db

    app.dependency_overrides[get_db] = mock_get_db

    with patch("api.billing.stripe.Customer.retrieve", return_value=mock_customer):
        with TestClient(app) as client:
            resp = client.get("/api/v1/billing/status")

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "active"
    assert data["payment_method"]["brand"] == "visa"
    assert data["payment_method"]["last4"] == "4242"


def test_webhook_setup_intent_succeeded_sets_default_pm():
    event_payload = {
        "id": "evt_test_setup_intent_001",
        "type": "setup_intent.succeeded",
        "data": {
            "object": {
                "id": "seti_test",
                "payment_method": "pm_test_4242",
                "customer": "cus_test123",
            }
        },
    }

    mock_event = MagicMock()
    mock_event.id = "evt_test_setup_intent_001"
    mock_event.type = "setup_intent.succeeded"
    mock_event.data.object.payment_method = "pm_test_4242"
    mock_event.data.object.customer = "cus_test123"

    from database import get_db

    async def mock_get_db():
        mock_db = MagicMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        async def _exec(*a, **kw): return mock_result
        mock_db.execute = _exec
        mock_db.add = MagicMock()
        async def _commit(): pass
        mock_db.commit = _commit
        yield mock_db

    app.dependency_overrides[get_db] = mock_get_db

    with patch("api.billing.settings.STRIPE_WEBHOOK_SECRET", "whsec_test"), \
         patch("api.billing.stripe.Webhook.construct_event", return_value=mock_event), \
         patch("api.billing.stripe.PaymentMethod.attach") as mock_attach, \
         patch("api.billing.stripe.Customer.modify") as mock_modify:

        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/billing/webhook",
                content=json.dumps(event_payload),
                headers={"stripe-signature": "test_sig"},
            )

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    mock_attach.assert_called_once_with("pm_test_4242", customer="cus_test123")
    mock_modify.assert_called_once_with(
        "cus_test123",
        invoice_settings={"default_payment_method": "pm_test_4242"},
    )
