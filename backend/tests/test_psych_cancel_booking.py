import pytest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import date, time, datetime, timezone
from httpx import AsyncClient, ASGITransport


@pytest.fixture
async def async_client(authed_app):
    async with AsyncClient(transport=ASGITransport(app=authed_app), base_url="http://test") as client:
        yield client


@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer fake-token"}


class TestSoftCancelSlot:
    @pytest.mark.asyncio
    async def test_delete_booked_slot_soft_cancels(self, async_client, auth_headers, mock_db):
        slot_id = uuid.uuid4()
        patient_id = uuid.uuid4()

        mock_slot = MagicMock()
        mock_slot.id = slot_id
        mock_slot.status = "booked"
        mock_slot.booked_by_patient_id = patient_id
        mock_slot.psychologist_id = uuid.UUID("99999999-9999-9999-9999-999999999999")
        mock_slot.slot_date = date(2026, 6, 1)
        mock_slot.start_time = time(10, 0)

        mock_patient = MagicMock()
        mock_patient.email = "paciente@test.com"
        mock_patient.name = "Ana García"

        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = mock_slot
        mock_db.execute.return_value = mock_result
        mock_db.get.return_value = mock_patient

        with patch("api.calendar_routes.send_booking_cancellation", new=AsyncMock()):
            response = await async_client.delete(
                f"/api/v1/calendar/slots/{slot_id}",
                headers=auth_headers,
            )

        assert response.status_code == 204
        mock_db.delete.assert_not_called()
        assert mock_slot.status == "cancelled"
        assert mock_slot.cancelled_by == "psychologist"
        mock_db.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_available_slot_still_hard_deletes(self, async_client, auth_headers, mock_db):
        slot_id = uuid.uuid4()

        mock_slot = MagicMock()
        mock_slot.id = slot_id
        mock_slot.status = "available"
        mock_slot.booked_by_patient_id = None
        mock_slot.psychologist_id = uuid.UUID("99999999-9999-9999-9999-999999999999")

        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = mock_slot
        mock_db.execute.return_value = mock_result

        response = await async_client.delete(
            f"/api/v1/calendar/slots/{slot_id}",
            headers=auth_headers,
        )

        assert response.status_code == 204
        mock_db.delete.assert_called_once_with(mock_slot)


class TestAvailabilityCancelledBooking:
    @pytest.mark.asyncio
    async def test_get_availability_returns_cancelled_booking(self):
        patient_id = str(uuid.uuid4())
        slot_id = uuid.uuid4()
        psych_id = uuid.uuid4()

        mock_patient = MagicMock()
        mock_patient.psychologist_id = psych_id

        mock_cancelled_slot = MagicMock()
        mock_cancelled_slot.id = slot_id
        mock_cancelled_slot.slot_date = date(2026, 6, 1)
        mock_cancelled_slot.start_time = time(10, 0)
        mock_cancelled_slot.duration_minutes = 60

        mock_db = AsyncMock()
        mock_db.get.return_value = mock_patient

        available_result = MagicMock()
        available_result.scalars.return_value.all.return_value = []

        upcoming_result = MagicMock()
        upcoming_result.scalar_one_or_none.return_value = None

        cancelled_result = MagicMock()
        cancelled_result.scalar_one_or_none.return_value = mock_cancelled_slot

        future_result = MagicMock()
        future_result.scalar_one_or_none.return_value = None

        mock_db.execute.side_effect = [available_result, upcoming_result, cancelled_result, future_result]

        from main import app
        from api.patient_portal import get_current_patient
        from database import get_db

        async def override_patient():
            return patient_id

        async def override_db():
            yield mock_db

        app.dependency_overrides[get_current_patient] = override_patient
        app.dependency_overrides[get_db] = override_db

        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                response = await ac.get("/api/v1/portal/availability?month=2026-06")

            assert response.status_code == 200
            data = response.json()
            assert "cancelled_booking" in data
            assert data["cancelled_booking"]["id"] == str(slot_id)
            assert data["upcoming_booking"] is None
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_availability_cancelled_booking_null_when_acknowledged(self):
        patient_id = str(uuid.uuid4())
        psych_id = uuid.uuid4()

        mock_patient = MagicMock()
        mock_patient.psychologist_id = psych_id

        mock_db = AsyncMock()
        mock_db.get.return_value = mock_patient

        available_result = MagicMock()
        available_result.scalars.return_value.all.return_value = []

        upcoming_result = MagicMock()
        upcoming_result.scalar_one_or_none.return_value = None

        cancelled_result = MagicMock()
        cancelled_result.scalar_one_or_none.return_value = None

        future_result = MagicMock()
        future_result.scalar_one_or_none.return_value = None

        mock_db.execute.side_effect = [available_result, upcoming_result, cancelled_result, future_result]

        from main import app
        from api.patient_portal import get_current_patient
        from database import get_db

        async def override_patient():
            return patient_id

        async def override_db():
            yield mock_db

        app.dependency_overrides[get_current_patient] = override_patient
        app.dependency_overrides[get_db] = override_db

        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                response = await ac.get("/api/v1/portal/availability?month=2026-06")

            assert response.status_code == 200
            data = response.json()
            assert data["cancelled_booking"] is None
        finally:
            app.dependency_overrides.clear()


class TestAcknowledgeCancellation:
    @pytest.mark.asyncio
    async def test_acknowledge_sets_acknowledged_true(self):
        patient_id = str(uuid.uuid4())
        slot_id = uuid.uuid4()

        mock_slot = MagicMock()
        mock_slot.id = slot_id
        mock_slot.status = "cancelled"
        mock_slot.booked_by_patient_id = uuid.UUID(patient_id)
        mock_slot.acknowledged = False

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_slot
        mock_db.execute.return_value = mock_result

        from main import app
        from api.patient_portal import get_current_patient
        from database import get_db

        async def override_patient():
            return patient_id

        async def override_db():
            yield mock_db

        app.dependency_overrides[get_current_patient] = override_patient
        app.dependency_overrides[get_db] = override_db

        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                response = await ac.post(f"/api/v1/portal/booking/{slot_id}/acknowledge")

            assert response.status_code == 200
            assert mock_slot.acknowledged == True
            mock_db.commit.assert_called_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_acknowledge_returns_404_for_wrong_patient(self):
        patient_id = str(uuid.uuid4())
        slot_id = uuid.uuid4()

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        from main import app
        from api.patient_portal import get_current_patient
        from database import get_db

        async def override_patient():
            return patient_id

        async def override_db():
            yield mock_db

        app.dependency_overrides[get_current_patient] = override_patient
        app.dependency_overrides[get_db] = override_db

        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                response = await ac.post(f"/api/v1/portal/booking/{slot_id}/acknowledge")

            assert response.status_code == 404
        finally:
            app.dependency_overrides.clear()
