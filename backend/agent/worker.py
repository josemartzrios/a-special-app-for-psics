import asyncio
import logging
import json as _json
import time
from datetime import date, datetime, timezone
from typing import Optional
import uuid

from sqlalchemy import text, select

from database import engine, AsyncSessionLocal, JobQueue, Session, Patient
from config import settings
from crypto import encrypt_if_set, decrypt_if_set
from agent import process_session, process_session_custom
from exceptions import LLMServiceError

logger = logging.getLogger(__name__)
UTC = timezone.utc

_MAX_ATTEMPTS = 3
_POLL_INTERVAL = 2.0  # seconds between batch polls
_429_BACKOFF = [30, 60, 120]  # seconds
# Proactively recycle the polling connection so it never outlives Supabase's
# server-side connection lifetime. This is the pool_recycle equivalent for a
# connection held outside the pool — pool_pre_ping/pool_recycle on the engine
# do NOT cover a Connection that is checked out once and held.
_CONN_MAX_AGE = 1500.0  # seconds (25 min)


async def job_worker() -> None:
    """Asyncio background task: polls DB for pending jobs and processes them.

    The polling SELECT runs on a single long-lived ``engine.connect()`` connection
    that is reused across every poll. With ``NullPool`` (required for Supabase's
    pgBouncer pooler) a new ``AsyncSessionLocal()`` per poll would open a brand-new
    TLS connection each time; at ~2 polls/s that meant ~170k handshakes/day, whose
    certificate + startup bytes dominated Supabase egress (~491 MB/day on an idle
    queue). A ``Connection`` keeps its physical DBAPI connection for its whole
    lifetime — ``commit()``/``rollback()`` manage transactions without returning it
    to the pool — so the TLS handshake happens once, not once per poll.

    Resilience for that held connection comes from two mechanisms, not from the
    engine pool: reconnect-on-error (a dead connection raises on next execute and
    is rebuilt next cycle) and proactive age-based recycling (``_CONN_MAX_AGE``).
    """
    logger.info("Job worker started (concurrency=%d)", settings.WORKER_CONCURRENCY)
    conn = None
    conn_opened_at = 0.0
    while True:
        try:
            # Proactive recycle before the connection can be reaped server-side.
            if conn is not None and time.monotonic() - conn_opened_at >= _CONN_MAX_AGE:
                conn = await _close_quietly(conn)
            if conn is None or conn.closed:
                conn = await engine.connect()
                conn_opened_at = time.monotonic()
            job_ids = await _claim_pending_jobs(conn)
            if job_ids:
                await asyncio.gather(*[_process_single_job(jid) for jid in job_ids])
        except Exception as exc:
            logger.error("Worker batch error: %s", exc, exc_info=True)
            # The polling connection may be dead (idle timeout, network blip).
            # Drop it so the next iteration opens a fresh one.
            conn = await _close_quietly(conn)
        await asyncio.sleep(_POLL_INTERVAL)


async def _close_quietly(conn):
    """Close a connection without raising; return None for reassignment."""
    if conn is not None:
        try:
            await conn.close()
        except Exception:
            pass
    return None


async def _claim_pending_jobs(conn) -> list:
    """Atomically pick up to WORKER_CONCURRENCY pending jobs and mark them processing.

    Runs on the long-lived polling connection. The SELECT ... FOR UPDATE SKIP LOCKED
    and the UPDATE share one transaction, committed per cycle so row locks are not
    held between polls.
    """
    res = await conn.execute(
        text("""
            SELECT id FROM job_queue
            WHERE status = 'pending'
            ORDER BY created_at
            LIMIT :limit
            FOR UPDATE SKIP LOCKED
        """),
        {"limit": settings.WORKER_CONCURRENCY},
    )
    job_ids = [row[0] for row in res.fetchall()]
    if not job_ids:
        await conn.rollback()
        return []

    await conn.execute(
        text("""
            UPDATE job_queue
            SET status = 'processing',
                attempts = attempts + 1,
                updated_at = NOW()
            WHERE id = ANY(:ids)
        """),
        {"ids": job_ids},
    )
    await conn.commit()
    return job_ids


async def _process_single_job(job_id: uuid.UUID) -> None:
    """Process one job: call Claude, save Session, update job status."""
    async with AsyncSessionLocal() as db:
        # Fetch job (no RLS needed — worker owns all jobs)
        job = await db.get(JobQueue, job_id)
        if job is None:
            logger.warning("Job %s disappeared before processing", job_id)
            return

        # Set RLS context for this psychologist so process_session can read history
        await db.execute(
            text("SELECT set_config('app.psychologist_id', :pid, false)"),
            {"pid": str(job.psychologist_id)},
        )

        try:
            raw_dictation = decrypt_if_set(job.raw_dictation) or ""
            patient = await db.get(Patient, job.patient_id)
            patient_name = patient.name if patient else ""
            patient_id_str = str(job.patient_id)
            format_ = job.format_

            # Call appropriate process function (unchanged functions)
            if format_ == "custom":
                response = await process_session_custom(
                    db=db,
                    patient_id=patient_id_str,
                    raw_dictation=raw_dictation,
                    session_id=None,
                    template_fields=job.template_fields or [],
                    patient_name=patient_name,
                )
            else:
                response = await process_session(
                    db, patient_id_str, raw_dictation, None, format_,
                    patient_name=patient_name,
                )

            # Determine session format and status (mirrors original route logic)
            _fmt_lower = format_.lower()
            session_format = (
                "chat" if _fmt_lower == "chat"
                else ("custom" if _fmt_lower == "custom" else format_.upper())
            )
            session_status = "confirmed" if session_format.lower() == "chat" else "draft"

            # Compute session_number for non-chat sessions
            if session_format.lower() != "chat":
                res_last = await db.execute(
                    select(Session)
                    .where(Session.patient_id == job.patient_id, Session.format != "chat")
                    .order_by(Session.session_number.desc())
                    .limit(1)
                )
                last_session = res_last.scalar_one_or_none()
                session_number = (last_session.session_number + 1) if last_session else 1
            else:
                session_number = None

            session_messages = response.get("session_messages", [])
            new_session = Session(
                patient_id=job.patient_id,
                session_number=session_number,
                session_date=date.today(),
                raw_dictation=encrypt_if_set(raw_dictation),
                format=session_format,
                ai_response=encrypt_if_set(response.get("text_fallback")),
                messages=encrypt_if_set(_json.dumps(session_messages)),
                status=session_status,
            )
            db.add(new_session)
            await db.flush()  # get new_session.id

            result_data = {
                "session_id": str(new_session.id),
                "text_fallback": response.get("text_fallback"),
                "format": session_format,
                "custom_fields": response.get("custom_fields"),
                "template_fields": job.template_fields,
            }
            job.result = encrypt_if_set(_json.dumps(result_data))
            job.status = "completed"
            job.updated_at = datetime.now(UTC)
            await db.commit()
            logger.info("Job %s completed (session=%s)", job_id, new_session.id)

        except LLMServiceError as exc:
            # 429 from Anthropic — put back to pending WITHOUT counting as attempt
            await db.rollback()
            async with AsyncSessionLocal() as db2:
                j = await db2.get(JobQueue, job_id)
                if j:
                    j.status = "pending"
                    j.attempts = max(0, j.attempts - 1)  # undo the increment
                    j.updated_at = datetime.now(UTC)
                    await db2.commit()
            backoff_idx = min(job.attempts - 1, len(_429_BACKOFF) - 1)
            wait = _429_BACKOFF[backoff_idx]
            logger.warning("Job %s got 429, backing off %ds", job_id, wait)
            await asyncio.sleep(wait)

        except Exception as exc:
            await db.rollback()
            async with AsyncSessionLocal() as db2:
                j = await db2.get(JobQueue, job_id)
                if j:
                    if j.attempts >= _MAX_ATTEMPTS:
                        j.status = "failed"
                        j.error_message = "No se pudo generar la nota. Intenta de nuevo."
                    else:
                        j.status = "pending"  # will be retried
                    j.updated_at = datetime.now(UTC)
                    await db2.commit()
            logger.error("Job %s failed (attempt %d): %s", job_id, job.attempts, exc, exc_info=True)
