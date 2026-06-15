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
