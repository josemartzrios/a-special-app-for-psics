"""Tests for summary routes: get, generate, save, send."""
import uuid
import pytest
from datetime import datetime, timezone, timedelta, date
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport
from cryptography.fernet import Fernet


SESSION_ID = str(uuid.uuid4())
PATIENT_ID = uuid.uuid4()
PSY_ID = uuid.UUID("99999999-9999-9999-9999-999999999999")

GET_URL = f"/api/v1/sessions/{SESSION_ID}/summary"
GENERATE_URL = f"/api/v1/sessions/{SESSION_ID}/summary/generate"
SAVE_URL = f"/api/v1/sessions/{SESSION_ID}/summary"
SEND_URL = f"/api/v1/sessions/{SESSION_ID}/summary/send"


@pytest.fixture
def fernet_key():
    return Fernet.generate_key().decode()


@pytest.fixture
def summary_app(mock_db, fake_psychologist, monkeypatch, fernet_key):
    """App with DB + auth mocked and encryption key set."""
    import config as _cfg
    monkeypatch.setattr(_cfg.settings, "ENCRYPTION_KEY", fernet_key)
    with patch("database.init_db", new=AsyncMock()):
        from main import app as _app
        from database import get_db
        from api.auth import get_current_psychologist

        async def override_db():
            yield mock_db

        async def override_user():
            return fake_psychologist

        _app.dependency_overrides[get_db] = override_db
        _app.dependency_overrides[get_current_psychologist] = override_user
        yield _app
        _app.dependency_overrides.clear()


@pytest.fixture
def owned_session():
    s = MagicMock()
    s.id = uuid.UUID(SESSION_ID)
    s.patient_id = PATIENT_ID
    s.status = "confirmed"
    return s


@pytest.fixture
def owned_patient():
    p = MagicMock()
    p.id = PATIENT_ID
    p.psychologist_id = PSY_ID
    p.name = "Ana García"
    p.email = "ana@example.com"
    return p


# ── GET summary ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_summary_no_summary_returns_empty(summary_app, mock_db, owned_session, owned_patient):
    """Session exists, no summary yet → empty SummaryOut (no error)."""
    result_session = MagicMock()
    result_session.scalar_one_or_none.return_value = owned_session
    result_summary = MagicMock()
    result_summary.scalar_one_or_none.return_value = None

    mock_db.execute.side_effect = [result_session, result_summary]
    mock_db.get.return_value = owned_patient

    async with AsyncClient(transport=ASGITransport(app=summary_app), base_url="http://test") as c:
        res = await c.get(GET_URL)

    assert res.status_code == 200
    body = res.json()
    assert body["id"] is None
    assert body["sent_at"] is None


@pytest.mark.asyncio
async def test_get_summary_unauthorized_patient(summary_app, mock_db, owned_session):
    """Patient belongs to another psychologist → 403."""
    other_patient = MagicMock()
    other_patient.id = PATIENT_ID
    other_patient.psychologist_id = uuid.uuid4()  # different psychologist

    result_session = MagicMock()
    result_session.scalar_one_or_none.return_value = owned_session
    mock_db.execute.return_value = result_session
    mock_db.get.return_value = other_patient

    async with AsyncClient(transport=ASGITransport(app=summary_app), base_url="http://test") as c:
        res = await c.get(GET_URL)

    assert res.status_code == 403


# ── GENERATE summary ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_generate_summary_session_not_confirmed(summary_app, mock_db, owned_session, owned_patient):
    """Unconfirmed session → 400."""
    owned_session.status = "pending"
    result_session = MagicMock()
    result_session.scalar_one_or_none.return_value = owned_session
    mock_db.execute.return_value = result_session
    mock_db.get.return_value = owned_patient

    async with AsyncClient(transport=ASGITransport(app=summary_app), base_url="http://test") as c:
        res = await c.post(GENERATE_URL)

    assert res.status_code == 400
    assert "confirmadas" in res.json()["detail"]


@pytest.mark.asyncio
async def test_generate_summary_no_note(summary_app, mock_db, owned_session, owned_patient):
    """Confirmed session but no clinical note → 404."""
    result_session = MagicMock()
    result_session.scalar_one_or_none.return_value = owned_session
    result_note = MagicMock()
    result_note.scalar_one_or_none.return_value = None

    mock_db.execute.side_effect = [result_session, result_note]
    mock_db.get.return_value = owned_patient

    async with AsyncClient(transport=ASGITransport(app=summary_app), base_url="http://test") as c:
        res = await c.post(GENERATE_URL)

    assert res.status_code == 404


# ── SAVE summary ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_save_summary_invalid_date(summary_app, mock_db, owned_session, owned_patient):
    """Invalid next_session_date format → 400."""
    existing_summary = MagicMock()
    existing_summary.id = uuid.uuid4()
    existing_summary.topics_worked = None
    existing_summary.homework = None
    existing_summary.next_session_date = None
    existing_summary.sent_at = None

    result_session = MagicMock()
    result_session.scalar_one_or_none.return_value = owned_session
    result_summary = MagicMock()
    result_summary.scalar_one_or_none.return_value = existing_summary

    mock_db.execute.side_effect = [result_session, result_summary]
    mock_db.get.return_value = owned_patient

    async with AsyncClient(transport=ASGITransport(app=summary_app), base_url="http://test") as c:
        res = await c.put(SAVE_URL, json={"next_session_date": "not-a-date"})

    assert res.status_code == 400
    assert "fecha" in res.json()["detail"].lower()


# ── SEND summary ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_send_summary_patient_without_email(summary_app, mock_db, owned_session):
    """Patient with no email → 400 with clear message."""
    patient_no_email = MagicMock()
    patient_no_email.id = PATIENT_ID
    patient_no_email.psychologist_id = PSY_ID
    patient_no_email.email = None

    result_session = MagicMock()
    result_session.scalar_one_or_none.return_value = owned_session
    mock_db.execute.return_value = result_session
    # db.get is called twice: once in _get_owned_session (ownership check), once in the endpoint
    mock_db.get.side_effect = [patient_no_email, patient_no_email]

    async with AsyncClient(transport=ASGITransport(app=summary_app), base_url="http://test") as c:
        res = await c.post(SEND_URL)

    assert res.status_code == 400
    assert "email" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_send_summary_sets_sent_at(summary_app, mock_db, owned_session, owned_patient):
    """Successful send → sent_at is populated in the response."""
    existing_summary = MagicMock()
    existing_summary.id = uuid.uuid4()
    existing_summary.topics_worked = b"fake-encrypted"
    existing_summary.homework = b"fake-encrypted"
    existing_summary.next_session_date = date(2025, 6, 1)
    existing_summary.sent_at = None

    result_session = MagicMock()
    result_session.scalar_one_or_none.return_value = owned_session
    result_summary = MagicMock()
    result_summary.scalar_one_or_none.return_value = existing_summary

    mock_db.execute.side_effect = [result_session, result_summary]
    mock_db.get.return_value = owned_patient

    with patch("api.summary_routes._try_send_email") as mock_send, \
         patch("crypto.decrypt_if_set", return_value="decrypted"):
        async with AsyncClient(transport=ASGITransport(app=summary_app), base_url="http://test") as c:
            res = await c.post(SEND_URL)

    assert res.status_code == 200
    body = res.json()
    assert body["sent_at"] is not None
    mock_send.assert_called_once()


@pytest.mark.asyncio
async def test_send_summary_uses_portal_url_from_settings(monkeypatch):
    """_try_send_email must use settings.PATIENT_PORTAL_URL, not a hardcoded string."""
    import config as _cfg
    import api.summary_routes as sr

    monkeypatch.setattr(_cfg.settings, "RESEND_API_KEY", "test-key")
    monkeypatch.setattr(_cfg.settings, "RESEND_FROM_EMAIL", "hola@syquex.mx")
    monkeypatch.setattr(_cfg.settings, "PATIENT_PORTAL_URL", "https://portal.test.com/login")
    monkeypatch.setattr(_cfg.settings, "FRONTEND_URL", "https://app.test.com")

    captured_calls = []

    class FakeEmails:
        @staticmethod
        def send(payload):
            captured_calls.append(payload)

    fake_resend = MagicMock()
    fake_resend.Emails = FakeEmails

    with patch.dict("sys.modules", {"resend": fake_resend}):
        sr._try_send_email("Ana García", "ana@example.com", "Dr. López")

    assert len(captured_calls) == 1
    html = captured_calls[0]["html"]
    assert "https://portal.test.com/login" in html
    assert "app.syquex.mx" not in html


@pytest.mark.asyncio
async def test_send_summary_falls_back_to_frontend_url_when_portal_empty(monkeypatch):
    """When PATIENT_PORTAL_URL is empty, falls back to FRONTEND_URL."""
    import config as _cfg
    import api.summary_routes as sr

    monkeypatch.setattr(_cfg.settings, "RESEND_API_KEY", "test-key")
    monkeypatch.setattr(_cfg.settings, "RESEND_FROM_EMAIL", "hola@syquex.mx")
    monkeypatch.setattr(_cfg.settings, "PATIENT_PORTAL_URL", "")
    monkeypatch.setattr(_cfg.settings, "FRONTEND_URL", "https://app.fallback.com")

    captured_calls = []

    class FakeEmails:
        @staticmethod
        def send(payload):
            captured_calls.append(payload)

    fake_resend = MagicMock()
    fake_resend.Emails = FakeEmails

    with patch.dict("sys.modules", {"resend": fake_resend}):
        sr._try_send_email("Ana García", "ana@example.com", "Dr. López")

    assert len(captured_calls) == 1
    html = captured_calls[0]["html"]
    assert "https://app.fallback.com" in html
