import uuid
from datetime import datetime, timezone, date as _date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.agent import generate_patient_summary
from api.auth import get_current_psychologist
from config import settings
from crypto import encrypt_if_set, decrypt_if_set
from database import get_db, Session as SessionModel, ClinicalNote, Patient, PatientSummary

router = APIRouter(tags=["summaries"])
UTC = timezone.utc


# ── Schemas ────────────────────────────────────────────────────────────────

class SummaryOut(BaseModel):
    id: Optional[str] = None
    topics_worked: Optional[str] = None
    homework: Optional[str] = None
    next_session_date: Optional[str] = None
    sent_at: Optional[str] = None

    class Config:
        from_attributes = True


class SummarySaveRequest(BaseModel):
    topics_worked: Optional[str] = None
    homework: Optional[str] = None
    next_session_date: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────

async def _get_owned_session(
    session_id: str,
    psychologist_id: uuid.UUID,
    db: AsyncSession,
) -> SessionModel:
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="session_id inválido.")

    result = await db.execute(select(SessionModel).where(SessionModel.id == sid))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada.")

    patient = await db.get(Patient, session.patient_id)
    if not patient or patient.psychologist_id != psychologist_id:
        raise HTTPException(status_code=403, detail="Acceso no autorizado.")

    return session


def _note_to_dict(note: ClinicalNote) -> dict:
    if note.custom_fields:
        return {"format": "custom", "custom_fields": note.custom_fields}
    return {
        "format": "SOAP",
        "subjective": decrypt_if_set(note.subjective) or "",
        "objective": decrypt_if_set(note.objective) or "",
        "assessment": decrypt_if_set(note.assessment) or "",
        "plan": decrypt_if_set(note.plan) or "",
    }


async def _get_or_create_summary(session: SessionModel, db: AsyncSession) -> PatientSummary:
    result = await db.execute(
        select(PatientSummary).where(PatientSummary.session_id == session.id)
    )
    summary = result.scalar_one_or_none()
    if not summary:
        summary = PatientSummary(session_id=session.id, patient_id=session.patient_id)
        db.add(summary)
        await db.flush()
    return summary


def _summary_out(s: PatientSummary) -> SummaryOut:
    return SummaryOut(
        id=str(s.id),
        topics_worked=decrypt_if_set(s.topics_worked),
        homework=decrypt_if_set(s.homework),
        next_session_date=str(s.next_session_date) if s.next_session_date else None,
        sent_at=s.sent_at.isoformat() if s.sent_at else None,
    )


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/summary", response_model=SummaryOut)
async def get_summary(
    session_id: str,
    psychologist=Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_owned_session(session_id, psychologist.id, db)
    result = await db.execute(
        select(PatientSummary).where(PatientSummary.session_id == session.id)
    )
    summary = result.scalar_one_or_none()
    if not summary:
        return SummaryOut()
    return _summary_out(summary)


@router.post("/sessions/{session_id}/summary/generate", response_model=SummaryOut)
async def generate_summary_endpoint(
    session_id: str,
    psychologist=Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_owned_session(session_id, psychologist.id, db)
    if session.status != "confirmed":
        raise HTTPException(status_code=400, detail="Solo sesiones confirmadas pueden generar resumen.")

    note_result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.session_id == session.id)
    )
    note = note_result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Nota clínica no encontrada para esta sesión.")

    draft = await generate_patient_summary(_note_to_dict(note))

    summary = await _get_or_create_summary(session, db)
    summary.ai_draft = str(draft)
    summary.topics_worked = encrypt_if_set(draft["topics_worked"])
    summary.homework = encrypt_if_set(draft["homework"])
    if draft.get("next_session_date"):
        try:
            summary.next_session_date = _date.fromisoformat(draft["next_session_date"])
        except (ValueError, TypeError):
            summary.next_session_date = None

    await db.commit()
    await db.refresh(summary)
    return _summary_out(summary)


@router.put("/sessions/{session_id}/summary", response_model=SummaryOut)
async def save_summary_endpoint(
    session_id: str,
    body: SummarySaveRequest,
    psychologist=Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_owned_session(session_id, psychologist.id, db)
    summary = await _get_or_create_summary(session, db)

    if body.topics_worked is not None:
        summary.topics_worked = encrypt_if_set(body.topics_worked)
    if body.homework is not None:
        summary.homework = encrypt_if_set(body.homework)
    if body.next_session_date is not None:
        try:
            summary.next_session_date = (
                _date.fromisoformat(body.next_session_date) if body.next_session_date else None
            )
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Formato de fecha inválido. Usa YYYY-MM-DD.")

    await db.commit()
    await db.refresh(summary)
    return _summary_out(summary)


@router.post("/sessions/{session_id}/summary/send", response_model=SummaryOut)
async def send_summary_endpoint(
    session_id: str,
    psychologist=Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_owned_session(session_id, psychologist.id, db)
    patient = await db.get(Patient, session.patient_id)

    if not patient or not patient.email:
        raise HTTPException(
            status_code=400,
            detail="El paciente no tiene email. Agrégalo en su expediente para enviarle resúmenes.",
        )

    summary = await _get_or_create_summary(session, db)

    # Auto-generate if no content yet
    if not summary.topics_worked:
        note_result = await db.execute(
            select(ClinicalNote).where(ClinicalNote.session_id == session.id)
        )
        note = note_result.scalar_one_or_none()
        if note:
            draft = await generate_patient_summary(_note_to_dict(note))
            summary.ai_draft = str(draft)
            summary.topics_worked = encrypt_if_set(draft["topics_worked"])
            summary.homework = encrypt_if_set(draft["homework"])
            if draft.get("next_session_date"):
                try:
                    summary.next_session_date = _date.fromisoformat(draft["next_session_date"])
                except (ValueError, TypeError):
                    pass

    summary.sent_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(summary)

    _try_send_email(patient.name, patient.email, psychologist.name)

    return _summary_out(summary)


def _try_send_email(patient_name: str, patient_email: str, psych_name: str) -> None:
    resend_key = getattr(settings, "RESEND_API_KEY", None)
    from_email = getattr(settings, "RESEND_FROM_EMAIL", None)
    if not resend_key or not from_email:
        return
    try:
        import resend as _resend
        _resend.api_key = resend_key
        portal_url = settings.PATIENT_PORTAL_URL or settings.FRONTEND_URL
        _resend.Emails.send({
            "from": from_email,
            "to": patient_email,
            "subject": "Tienes un nuevo resumen de sesión en SyqueX",
            "html": (
                f"<p>Hola {patient_name},</p>"
                f"<p>Tu psicólogo <strong>{psych_name}</strong> compartió el resumen de tu última sesión.</p>"
                f'<p><a href="{portal_url}">Ver en SyqueX Portal </a></p>'
            ),
        })
    except Exception:
        pass  # Non-fatal — resumen guardado independientemente del email
