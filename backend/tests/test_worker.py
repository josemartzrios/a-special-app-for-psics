"""Unit tests for async job worker."""
import pytest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


class TestJobQueueModel:
    def test_job_queue_model_importable(self):
        from database import JobQueue
        assert JobQueue.__tablename__ == "job_queue"

    def test_job_queue_has_required_fields(self):
        from database import JobQueue
        cols = {c.name for c in JobQueue.__table__.columns}
        for field in ["id", "psychologist_id", "patient_id", "status",
                      "raw_dictation", "attempts", "created_at", "updated_at"]:
            assert field in cols, f"Missing column: {field}"

    def test_job_queue_status_constraint_exists(self):
        from database import JobQueue
        constraints = {c.name for c in JobQueue.__table__.constraints}
        assert "chk_job_queue_status" in constraints


import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch, call
from cryptography.fernet import Fernet


@pytest.fixture
def fernet_key():
    return Fernet.generate_key().decode()


@pytest.fixture
def mock_job(fernet_key):
    from cryptography.fernet import Fernet as _F
    f = _F(fernet_key.encode())
    encrypted = f"v1:{f.encrypt(b'Dictado de prueba').decode()}"
    job = MagicMock()
    job.id = uuid.uuid4()
    job.psychologist_id = uuid.uuid4()
    job.patient_id = uuid.uuid4()
    job.format_ = "SOAP"
    job.raw_dictation = encrypted
    job.template_fields = None
    job.attempts = 1
    return job


class TestWorkerProcessSingleJob:
    async def test_successful_job_sets_completed(self, mock_job, fernet_key):
        from cryptography.fernet import Fernet as _F
        import config as _cfg
        _cfg.settings.ENCRYPTION_KEY = fernet_key

        mock_patient = MagicMock()
        mock_patient.name = "Test Patient"

        fake_result = {"text_fallback": "SOAP note content", "session_messages": []}
        mock_session_orm = MagicMock()
        mock_session_orm.id = uuid.uuid4()

        mock_db = AsyncMock()
        mock_db.get = AsyncMock(side_effect=[mock_job, mock_patient])
        mock_db.execute = AsyncMock(return_value=MagicMock(fetchall=MagicMock(return_value=[]), scalar_one_or_none=MagicMock(return_value=None)))
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, 'id', uuid.uuid4()))

        with patch("agent.worker.AsyncSessionLocal") as mock_session_factory, \
             patch("agent.worker.process_session", return_value=fake_result) as mock_ps, \
             patch("agent.worker.process_session_custom") as mock_psc:

            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_db)
            mock_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_session_factory.return_value = mock_ctx

            from agent.worker import _process_single_job
            await _process_single_job(mock_job.id)

        assert mock_ps.called
        assert not mock_psc.called

    async def test_custom_format_calls_process_session_custom(self, mock_job, fernet_key):
        import config as _cfg
        _cfg.settings.ENCRYPTION_KEY = fernet_key
        mock_job.format_ = "custom"
        mock_job.template_fields = [{"id": "estado", "label": "Estado", "type": "text"}]

        mock_patient = MagicMock()
        mock_patient.name = "Test Patient"
        fake_result = {"text_fallback": "Custom note", "custom_fields": {}, "session_messages": []}

        mock_db = AsyncMock()
        mock_db.get = AsyncMock(side_effect=[mock_job, mock_patient])
        mock_db.execute = AsyncMock(return_value=MagicMock(fetchall=MagicMock(return_value=[]), scalar_one_or_none=MagicMock(return_value=None)))
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, 'id', uuid.uuid4()))

        with patch("agent.worker.AsyncSessionLocal") as mock_session_factory, \
             patch("agent.worker.process_session") as mock_ps, \
             patch("agent.worker.process_session_custom", return_value=fake_result) as mock_psc:

            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_db)
            mock_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_session_factory.return_value = mock_ctx

            from agent.worker import _process_single_job
            await _process_single_job(mock_job.id)

        assert mock_psc.called
        assert not mock_ps.called

    async def test_failed_job_after_3_attempts_sets_failed(self, mock_job, fernet_key):
        import config as _cfg
        _cfg.settings.ENCRYPTION_KEY = fernet_key
        mock_job.attempts = 3

        mock_patient = MagicMock()
        mock_patient.name = "Test"

        mock_db = AsyncMock()
        mock_db.get = AsyncMock(side_effect=[mock_job, mock_patient, mock_job])
        mock_db.execute = AsyncMock(return_value=MagicMock())
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()

        with patch("agent.worker.AsyncSessionLocal") as mock_session_factory, \
             patch("agent.worker.process_session", side_effect=Exception("Claude error")):

            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_db)
            mock_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_session_factory.return_value = mock_ctx

            from agent.worker import _process_single_job
            await _process_single_job(mock_job.id)

        # After 3 attempts, status should be set to failed
        # Verify commit was called (status update)
        assert mock_db.commit.called


class TestClaimPendingJobs:
    """The polling claim runs on an injected long-lived connection (egress fix)."""

    async def test_no_pending_jobs_rolls_back_and_returns_empty(self):
        conn = AsyncMock()
        conn.execute = AsyncMock(
            return_value=MagicMock(fetchall=MagicMock(return_value=[]))
        )
        conn.rollback = AsyncMock()
        conn.commit = AsyncMock()

        from agent.worker import _claim_pending_jobs
        result = await _claim_pending_jobs(conn)

        assert result == []
        assert conn.rollback.called
        assert not conn.commit.called

    async def test_pending_jobs_marked_processing_and_committed(self):
        jid = uuid.uuid4()
        conn = AsyncMock()
        conn.execute = AsyncMock(
            return_value=MagicMock(fetchall=MagicMock(return_value=[(jid,)]))
        )
        conn.rollback = AsyncMock()
        conn.commit = AsyncMock()

        from agent.worker import _claim_pending_jobs
        result = await _claim_pending_jobs(conn)

        assert result == [jid]
        assert conn.commit.called
        # SELECT ... FOR UPDATE + UPDATE = two statements on the same connection
        assert conn.execute.await_count == 2


class TestWorkerPersistentConnection:
    """Egress fix: the poll loop must reuse ONE connection, not open one per poll."""

    async def test_polling_reuses_single_connection(self):
        mock_conn = AsyncMock()
        mock_conn.closed = False
        mock_conn.execute = AsyncMock(
            return_value=MagicMock(fetchall=MagicMock(return_value=[]))
        )
        mock_conn.rollback = AsyncMock()
        mock_conn.commit = AsyncMock()

        connect_calls = 0

        async def fake_connect():
            nonlocal connect_calls
            connect_calls += 1
            return mock_conn

        mock_engine = MagicMock()
        mock_engine.connect = fake_connect

        sleep_count = 0

        async def fake_sleep(_):
            nonlocal sleep_count
            sleep_count += 1
            if sleep_count >= 3:
                raise asyncio.CancelledError()

        with patch("agent.worker.engine", mock_engine), \
             patch("agent.worker.asyncio.sleep", side_effect=fake_sleep):
            from agent.worker import job_worker
            with pytest.raises(asyncio.CancelledError):
                await job_worker()

        # One TLS connection for all polls — this is the egress fix
        assert connect_calls == 1
        assert mock_conn.execute.await_count >= 3

    async def test_connection_recycled_after_max_age(self):
        # A connection older than _CONN_MAX_AGE must be closed and replaced,
        # even with no error — pre-empts Supabase's server-side connection reaping.
        import agent.worker as worker_mod

        old_conn = AsyncMock()
        old_conn.closed = False
        old_conn.execute = AsyncMock(
            return_value=MagicMock(fetchall=MagicMock(return_value=[]))
        )
        old_conn.rollback = AsyncMock()
        old_conn.close = AsyncMock()

        new_conn = AsyncMock()
        new_conn.closed = False
        new_conn.execute = AsyncMock(
            return_value=MagicMock(fetchall=MagicMock(return_value=[]))
        )
        new_conn.rollback = AsyncMock()

        conns = [old_conn, new_conn]

        async def fake_connect():
            return conns.pop(0)

        mock_engine = MagicMock()
        mock_engine.connect = fake_connect

        # monotonic() is only called on connect (set conn_opened_at) and on the
        # age check (skipped while conn is None). Sequence:
        #   iter1 connect -> 0.0 ; iter2 age check -> aged-out ; iter2 reconnect.
        times = iter([0.0, worker_mod._CONN_MAX_AGE + 1, worker_mod._CONN_MAX_AGE + 1])

        def fake_monotonic():
            try:
                return next(times)
            except StopIteration:
                return worker_mod._CONN_MAX_AGE + 100

        sleep_count = 0

        async def fake_sleep(_):
            nonlocal sleep_count
            sleep_count += 1
            if sleep_count >= 2:
                raise asyncio.CancelledError()

        with patch("agent.worker.engine", mock_engine), \
             patch("agent.worker.time.monotonic", side_effect=fake_monotonic), \
             patch("agent.worker.asyncio.sleep", side_effect=fake_sleep):
            from agent.worker import job_worker
            with pytest.raises(asyncio.CancelledError):
                await job_worker()

        old_conn.close.assert_awaited()       # aged-out connection recycled
        new_conn.execute.assert_awaited()     # replacement polled

    async def test_error_drops_connection_and_reconnects(self):
        bad_conn = AsyncMock()
        bad_conn.closed = False
        bad_conn.execute = AsyncMock(side_effect=Exception("connection lost"))
        bad_conn.close = AsyncMock()

        good_conn = AsyncMock()
        good_conn.closed = False
        good_conn.execute = AsyncMock(
            return_value=MagicMock(fetchall=MagicMock(return_value=[]))
        )
        good_conn.rollback = AsyncMock()

        conns = [bad_conn, good_conn]

        async def fake_connect():
            return conns.pop(0)

        mock_engine = MagicMock()
        mock_engine.connect = fake_connect

        sleep_count = 0

        async def fake_sleep(_):
            nonlocal sleep_count
            sleep_count += 1
            if sleep_count >= 2:
                raise asyncio.CancelledError()

        with patch("agent.worker.engine", mock_engine), \
             patch("agent.worker.asyncio.sleep", side_effect=fake_sleep):
            from agent.worker import job_worker
            with pytest.raises(asyncio.CancelledError):
                await job_worker()

        # Broken connection closed, then a fresh one opened and polled
        bad_conn.close.assert_awaited()
        good_conn.execute.assert_awaited()
