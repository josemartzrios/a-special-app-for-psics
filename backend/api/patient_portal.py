from fastapi import APIRouter, Depends, HTTPException, status
from anthropic import AsyncAnthropic
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import or_, and_
from fastapi.security import OAuth2PasswordBearer
import jwt
import uuid

from database import get_db, PatientSummary, AvailabilitySlot, Patient, Psychologist
from config import settings
from crypto import decrypt_if_set
from datetime import datetime, timezone, date, time
from pydantic import BaseModel
from services.email import send_booking_confirmation, send_booking_cancellation

router = APIRouter(tags=["patient-portal"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/patient/login")


def _summary_list_item(s: PatientSummary) -> dict:
    return {
        "id": str(s.id),
        "session_id": str(s.session_id),
        "sent_at": s.sent_at,
        "viewed_at": s.viewed_at,
        "next_session_date": s.next_session_date,
        "topics_worked": decrypt_if_set(s.topics_worked),
    }


def _summary_detail_out(s: PatientSummary) -> dict:
    return {
        "id": str(s.id),
        "session_id": str(s.session_id),
        "topics_worked": decrypt_if_set(s.topics_worked),
        "homework": decrypt_if_set(s.homework),
        "next_session_date": s.next_session_date,
        "sent_at": s.sent_at,
        "viewed_at": s.viewed_at,
    }

async def get_current_patient(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> str:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o sesión expirada",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        role = payload.get("role")
        patient_user_id = payload.get("sub")
        if role != "patient" or not patient_user_id:
            raise credentials_exc
    except Exception:
        raise credentials_exc

    from database import PatientUser as _PatientUser
    result = await db.execute(
        select(_PatientUser).where(
            _PatientUser.id == uuid.UUID(patient_user_id),
            _PatientUser.is_active == True,
        )
    )
    patient_user = result.scalar_one_or_none()
    if not patient_user:
        raise credentials_exc
    return str(patient_user.patient_id)

@router.get("/summaries")
async def list_summaries(patient_id: str = Depends(get_current_patient), db: AsyncSession = Depends(get_db)):
    puuid = uuid.UUID(patient_id)
    res = await db.execute(
        select(PatientSummary)
        .where(PatientSummary.patient_id == puuid, PatientSummary.sent_at != None)
        .order_by(PatientSummary.sent_at.desc())
    )
    summaries = res.scalars().all()
    
    return [_summary_list_item(s) for s in summaries]

@router.get("/summaries/{summary_id}")
async def get_summary(summary_id: str, patient_id: str = Depends(get_current_patient), db: AsyncSession = Depends(get_db)):
    suuid = uuid.UUID(summary_id)
    puuid = uuid.UUID(patient_id)
    
    res = await db.execute(
        select(PatientSummary)
        .where(PatientSummary.id == suuid, PatientSummary.patient_id == puuid, PatientSummary.sent_at != None)
    )
    summary = res.scalar_one_or_none()
    
    if not summary:
        raise HTTPException(status_code=404, detail="Resumen no encontrado.")
        
    if not summary.viewed_at:
        summary.viewed_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(summary)

    return _summary_detail_out(summary)


@router.get("/availability")
async def get_availability(month: str, patient_id: str = Depends(get_current_patient), db: AsyncSession = Depends(get_db)):
    puuid = uuid.UUID(patient_id)
    patient = await db.get(Patient, puuid)
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")
        
    try:
        y, m = map(int, month.split('-'))
        start_date = date(y, m, 1)
        next_m = m + 1 if m < 12 else 1
        next_y = y if m < 12 else y + 1
        end_date = date(next_y, next_m, 1)
    except ValueError:
        raise HTTPException(status_code=400, detail="Mes inválido")

    res = await db.execute(
        select(AvailabilitySlot)
        .where(
            AvailabilitySlot.psychologist_id == patient.psychologist_id,
            AvailabilitySlot.slot_date >= start_date,
            AvailabilitySlot.slot_date < end_date,
            AvailabilitySlot.status == 'available'
        ).order_by(AvailabilitySlot.slot_date, AvailabilitySlot.start_time)
    )
    slots = res.scalars().all()
    
    # Get upcoming booking — exclude slots whose datetime has already passed
    _today = date.today()
    _now_time = datetime.now().time()
    up_res = await db.execute(
        select(AvailabilitySlot)
        .where(
            AvailabilitySlot.booked_by_patient_id == puuid,
            AvailabilitySlot.status == 'booked',
            or_(
                AvailabilitySlot.slot_date > _today,
                and_(
                    AvailabilitySlot.slot_date == _today,
                    AvailabilitySlot.start_time > _now_time
                )
            )
        ).order_by(AvailabilitySlot.slot_date, AvailabilitySlot.start_time).limit(1)
    )
    upcoming = up_res.scalar_one_or_none()

    # Get cancelled booking (psychologist-cancelled, not yet acknowledged)
    can_res = await db.execute(
        select(AvailabilitySlot)
        .where(
            AvailabilitySlot.booked_by_patient_id == puuid,
            AvailabilitySlot.status == 'cancelled',
            AvailabilitySlot.cancelled_by == 'psychologist',
            AvailabilitySlot.acknowledged == False
        ).order_by(AvailabilitySlot.slot_date.desc()).limit(1)
    )
    cancelled = can_res.scalar_one_or_none()

    # Check if psychologist has any future available slots (any month)
    future_check = await db.execute(
        select(AvailabilitySlot.id)
        .where(
            AvailabilitySlot.psychologist_id == patient.psychologist_id,
            AvailabilitySlot.slot_date >= _today,
            AvailabilitySlot.status == 'available'
        ).limit(1)
    )
    has_future_availability = future_check.scalar_one_or_none() is not None

    return {
        "slots": [{"id": str(s.id), "slot_date": s.slot_date, "start_time": s.start_time, "duration_minutes": s.duration_minutes} for s in slots],
        "upcoming_booking": {"id": str(upcoming.id), "slot_date": upcoming.slot_date, "start_time": upcoming.start_time, "duration_minutes": upcoming.duration_minutes} if upcoming else None,
        "cancelled_booking": {"id": str(cancelled.id), "slot_date": cancelled.slot_date, "start_time": cancelled.start_time, "duration_minutes": cancelled.duration_minutes} if cancelled else None,
        "has_future_availability": has_future_availability,
    }

class BookRequest(BaseModel):
    slot_id: str

@router.post("/book")
async def book_slot(payload: BookRequest, patient_id: str = Depends(get_current_patient), db: AsyncSession = Depends(get_db)):
    puuid = uuid.UUID(patient_id)
    suuid = uuid.UUID(payload.slot_id)

    patient = await db.get(Patient, puuid)
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    # Capturar datos antes del commit — los objetos ORM expiran tras commit()
    # y async sessions no soportan lazy loading implícito (MissingGreenlet)
    patient_email = patient.email
    patient_name = patient.name
    patient_psych_id = patient.psychologist_id

    # SELECT FOR UPDATE to prevent race conditions
    res = await db.execute(
        select(AvailabilitySlot)
        .where(AvailabilitySlot.id == suuid)
        .with_for_update()
    )
    slot = res.scalar_one_or_none()

    if not slot or slot.status != 'available' or slot.psychologist_id != patient_psych_id:
        raise HTTPException(status_code=400, detail="El horario ya no está disponible")

    slot.status = 'booked'
    slot.booked_by_patient_id = puuid
    slot.booked_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(slot)

    # Send emails — wrapped para que un fallo de email nunca rompa el booking
    try:
        psych = await db.get(Psychologist, slot.psychologist_id)
        if psych and patient_email:
            await send_booking_confirmation(
                patient_email, psych.email, patient_name, psych.name,
                slot.slot_date, slot.start_time, slot.duration_minutes
            )
    except Exception as e:
        # Email falla silenciosamente — el booking ya está confirmado en DB
        import logging
        logging.getLogger(__name__).error("Error enviando email de booking: %s", e)

    return {"status": "ok", "message": "Cita confirmada"}

@router.delete("/booking/{slot_id}")
async def cancel_booking(slot_id: str, patient_id: str = Depends(get_current_patient), db: AsyncSession = Depends(get_db)):
    puuid = uuid.UUID(patient_id)
    suuid = uuid.UUID(slot_id)

    res = await db.execute(select(AvailabilitySlot).where(AvailabilitySlot.id == suuid, AvailabilitySlot.booked_by_patient_id == puuid))
    slot = res.scalar_one_or_none()

    if not slot:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    # Capturar antes del commit — mismo patrón que book_slot
    slot_psych_id = slot.psychologist_id
    slot_date = slot.slot_date
    slot_start_time = slot.start_time

    slot.status = 'available'
    slot.booked_by_patient_id = None
    slot.booked_at = None

    await db.commit()

    try:
        patient = await db.get(Patient, puuid)
        psych = await db.get(Psychologist, slot_psych_id)
        if psych and patient and patient.email:
            await send_booking_cancellation(
                patient.email, psych.email, patient.name, psych.name,
                slot_date, slot_start_time, canceled_by="patient"
            )
    except Exception as e:
        import logging
        logging.getLogger(__name__).error("Error enviando email de cancelación: %s", e)

    return {"status": "ok"}


@router.post("/booking/{slot_id}/acknowledge", status_code=status.HTTP_200_OK)
async def acknowledge_cancellation(
    slot_id: str,
    patient_id: str = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db)
):
    """Mark a psychologist-cancelled booking as acknowledged by the patient."""
    puuid = uuid.UUID(patient_id)
    suuid = uuid.UUID(slot_id)

    res = await db.execute(
        select(AvailabilitySlot)
        .where(
            AvailabilitySlot.id == suuid,
            AvailabilitySlot.booked_by_patient_id == puuid,
            AvailabilitySlot.status == 'cancelled'
        )
    )
    slot = res.scalar_one_or_none()

    if not slot:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")

    slot.acknowledged = True
    await db.commit()
    return {"status": "ok"}


class ExplainRequest(BaseModel):
    selected_text: str
    context: str

_MAX_SELECTED_TEXT = 500
_MAX_CONTEXT = 3000

@router.post("/explain")
async def explain_term(payload: ExplainRequest, patient_id: str = Depends(get_current_patient)):
    if len(payload.selected_text) > _MAX_SELECTED_TEXT:
        raise HTTPException(status_code=400, detail="Texto seleccionado demasiado largo")

    context_trimmed = payload.context[:_MAX_CONTEXT]

    client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{
            "role": "user",
            "content": (
                "Eres un asistente que ayuda a pacientes de psicología a entender el lenguaje de sus resúmenes de sesión.\n\n"
                f'El paciente seleccionó: "{payload.selected_text}"\n\n'
                f"Contexto del resumen:\n{context_trimmed}\n\n"
                f'Explica qué significa "{payload.selected_text}" en lenguaje cotidiano, como si le hablaras a alguien sin conocimientos técnicos. '
                "Sé breve (2-3 oraciones máximo), cálido y accesible. No uses jerga clínica. "
                "No incluyas el término como título ni encabezado. Empieza directamente con la explicación. No des recomendaciones ni consejos, solo una explicación clara y sencilla del término o frase seleccionada, basada en el contexto dado."
            )
        }]
    )
    return {"explanation": response.content[0].text}
