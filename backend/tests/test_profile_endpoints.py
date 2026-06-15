import uuid
from unittest.mock import AsyncMock, MagicMock, patch

# Prevent DB connection on startup
with patch("database.init_db", new=AsyncMock()):
    from main import app

from fastapi.testclient import TestClient
from api.auth import get_current_psychologist


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
