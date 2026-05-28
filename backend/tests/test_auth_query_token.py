"""Security tests: JWT token must arrive via Authorization header, not ?token= query param."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport


@pytest.mark.asyncio
async def test_main_dependency_rejects_query_param_token():
    """get_current_psychologist must return 401 when token is in ?token= (not header)."""
    with patch("database.init_db", new=AsyncMock()):
        from main import app
        from database import get_db

        mock_db = AsyncMock()
        mock_db.get.return_value = None

        async def override_db():
            yield mock_db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                # Pass token as query param only — no Authorization header
                res = await c.get("/api/v1/patients", params={"token": "some.jwt.token"})
            assert res.status_code == 401, (
                "get_current_psychologist should reject tokens passed via ?token= query param"
            )
        finally:
            app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_main_dependency_accepts_bearer_header():
    """get_current_psychologist returns 401 for invalid JWT in header (not 422/500)."""
    with patch("database.init_db", new=AsyncMock()):
        from main import app
        from database import get_db

        mock_db = AsyncMock()

        async def override_db():
            yield mock_db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                res = await c.get(
                    "/api/v1/patients",
                    headers={"Authorization": "Bearer invalid.jwt.token"},
                )
            # Should be 401 (invalid JWT), not 422 or 500
            assert res.status_code == 401
        finally:
            app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_sse_dependency_accepts_query_param_token():
    """get_current_psychologist_sse must accept token via ?token= (EventSource constraint)."""
    from api.auth import get_current_psychologist_sse, _decode_psychologist_token
    from fastapi import HTTPException

    # A missing token should raise 401
    with pytest.raises(HTTPException) as exc_info:
        _decode_psychologist_token(None)
    assert exc_info.value.status_code == 401

    # An invalid token should also raise 401
    with pytest.raises(HTTPException) as exc_info:
        _decode_psychologist_token("bad.token.value")
    assert exc_info.value.status_code == 401
