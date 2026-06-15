"""
Shared fixtures for SyqueX backend tests.
"""
import sys
import os
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Make backend root importable from any test file
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Mock fastembed and related that fail on CP314
from unittest.mock import MagicMock
sys.modules["fastembed"] = MagicMock()
sys.modules["py_rust_stemmers"] = MagicMock()

# init_db() abre una conexión real a Postgres en el startup de la app. Lo
# neutralizamos globalmente para que cualquier test que dispare el lifespan
# (with TestClient(app) as ...) nunca toque la DB, sin importar el orden de
# import del singleton `app`. conftest se carga antes que cualquier test, así
# que `from database import init_db` dentro de main ya recibe este mock.
import database as _database
_database.init_db = AsyncMock()


# ---------------------------------------------------------------------------
# Common data fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_patient_id():
    return str(uuid.uuid4())


@pytest.fixture
def sample_session_id():
    return str(uuid.uuid4())


@pytest.fixture
def sample_dictation():
    return (
        "El paciente llega puntual. Refiere que la semana pasada tuvo episodios de "
        "ansiedad en el trabajo relacionados con la carga de tareas. Mencionó dificultad "
        "para conciliar el sueño. No hay ideación suicida. Plan: continuar TCC."
    )


@pytest.fixture
def valid_uuid():
    return str(uuid.UUID("12345678-1234-5678-1234-567812345678"))


# ---------------------------------------------------------------------------
# Mock DB session fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_db():
    """AsyncSession mock with sane defaults for all common operations."""
    db = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()
    db.begin_nested = MagicMock()
    db.begin_nested.return_value.__aenter__ = AsyncMock()
    db.begin_nested.return_value.__aexit__ = AsyncMock(return_value=False)  # False = don't suppress exceptions
    db.flush = AsyncMock()

    # Default execute result — returns empty scalars
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []
    mock_result.scalar_one_or_none.return_value = None
    mock_result.scalar_one.return_value = 0
    mock_result.all.return_value = []
    db.execute.return_value = mock_result

    return db


def _make_execute_result(scalars_all=None, scalar_one_or_none=None, scalar_one=0, all_rows=None):
    """Helper to build a mock execute() result."""
    r = MagicMock()
    r.scalars.return_value.all.return_value = scalars_all or []
    r.scalar_one_or_none.return_value = scalar_one_or_none
    r.scalar_one.return_value = scalar_one
    r.all.return_value = all_rows or []
    return r

from unittest.mock import patch as _patch
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def fake_psychologist():
    psy = MagicMock()
    psy.id = uuid.UUID("99999999-9999-9999-9999-999999999999")
    psy.is_active = True
    return psy


@pytest.fixture
def authed_app(mock_db, fake_psychologist, monkeypatch):
    """FastAPI app with DB + auth mocked for integration tests."""
    from cryptography.fernet import Fernet
    import config as _config
    monkeypatch.setattr(_config.settings, "ENCRYPTION_KEY", Fernet.generate_key().decode())
    with _patch("database.init_db", new=AsyncMock()):
        from main import app as _app
        from database import get_db
        from api.auth import get_current_psychologist

        async def override_get_db():
            yield mock_db

        async def override_current_user():
            return fake_psychologist

        _app.dependency_overrides[get_db] = override_get_db
        _app.dependency_overrides[get_current_psychologist] = override_current_user
        yield _app
        _app.dependency_overrides.clear()
