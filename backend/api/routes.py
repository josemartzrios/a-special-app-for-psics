import asyncio
from collections import defaultdict
import uuid
import logging
import base64
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, BackgroundTasks, UploadFile, File
from anthropic import AsyncAnthropic
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from sqlalchemy.exc import IntegrityError
from typing import Optional, List, Dict, Any, Literal
from datetime import date, datetime, timezone

from database import get_db, Patient, Session, ClinicalNote, PatientProfile, Psychologist, AsyncSessionLocal, NoteTemplate, PatientUser, PatientSummary, JobQueue
from config import settings
import json as _json
from crypto import encrypt_if_set, decrypt_if_set
from agent import process_session, update_patient_profile_summary, process_session_custom, sanitize_dictation
from services.note_service import build_note
from agent.tools import generate_evolution_report, search_patient_history
from agent.embeddings import get_embedding, ZERO_VECTOR
from api.limiter import limiter
from exceptions import InvalidUUIDError, SessionNotFoundError, PatientNotFoundError, UnauthorizedAccessError, PromptInjectionError
from api.auth import get_current_psychologist, get_current_psychologist_sse
from api.audit import log_audit


def _parse_uuid(value: str, label: str = "ID") -> uuid.UUID:
    """Parse a UUID string, raising a domain error on invalid format."""
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        raise InvalidUUIDError(
            f"{label} no es un UUID válido.",
            code="INVALID_UUID",
            details={"value": value},
        )

logger = logging.getLogger(__name__)


async def get_db_with_user(
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db),
):
    """DB session con RLS: inyecta psychologist_id como session variable de PostgreSQL."""
    from sqlalchemy import text as _text
    await db.execute(
        _text("SELECT set_config('app.psychologist_id', :pid, false)"),
        {"pid": str(psychologist.id)},
    )
    yield db


router = APIRouter(tags=["clinical"])


def _encrypt_patient_fields(patient_orm, payload_sensitive: dict) -> None:
    """Cifra in-place los campos sensibles en el ORM patient antes de commit."""
    for field in ["medical_history", "psychological_history", "reason_for_consultation", "address"]:
        if field in payload_sensitive:
            setattr(patient_orm, field, encrypt_if_set(payload_sensitive[field]))
    if "emergency_contact" in payload_sensitive:
        ec = payload_sensitive["emergency_contact"]
        if ec is not None:
            if isinstance(ec, dict):
                ec = _json.dumps(ec)
            elif hasattr(ec, "model_dump"):
                ec = _json.dumps(ec.model_dump())
            setattr(patient_orm, "emergency_contact", encrypt_if_set(ec))
        else:
            setattr(patient_orm, "emergency_contact", None)


def _decrypt_patient_orm(patient) -> None:
    """Descifra in-place los campos sensibles de un ORM Patient antes de serializar."""
    for field in ["medical_history", "psychological_history", "reason_for_consultation", "address", "gender_identity", "phone"]:
        setattr(patient, field, decrypt_if_set(getattr(patient, field, None)))
    ec = getattr(patient, "emergency_contact", None)
    if ec is not None:
        decrypted = decrypt_if_set(ec)
        if decrypted and isinstance(decrypted, str):
            try:
                decrypted = _json.loads(decrypted)
            except (_json.JSONDecodeError, TypeError):
                pass
        setattr(patient, "emergency_contact", decrypted)


# ---------------------------------------------------------------------------
# Ownership verification — OWASP A01 Broken Access Control
# ---------------------------------------------------------------------------

async def _get_owned_patient(
    db: AsyncSession, psychologist_id: uuid.UUID, patient_id: str
) -> Patient:
    """Verifica que el paciente exista y pertenezca al psicólogo autenticado."""
    puuid = _parse_uuid(patient_id, "patient_id")
    patient = await db.get(Patient, puuid)
    if not patient or patient.deleted_at is not None:
        raise PatientNotFoundError("Paciente no encontrado.", code="PATIENT_NOT_FOUND")
    if patient.psychologist_id != psychologist_id:
        raise UnauthorizedAccessError("Acceso no autorizado a este paciente.", code="FORBIDDEN")
    return patient


@router.get("/health", tags=["ops"])
async def health():
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

MaritalStatus = Literal[
    "soltero", "casado", "divorciado", "viudo", "union_libre", "otro"
]

GenderIdentity = Literal["hombre", "mujer", "no_binario", "otro"]

_PHONE_RE = re.compile(r'^[0-9\s\+\-\(\)\.]+$')


def _validate_phone_value(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    if not _PHONE_RE.match(v):
        raise ValueError('Número inválido: solo se permiten dígitos, espacios y los símbolos + - ( )')
    digits = re.sub(r'[^\d]', '', v)
    if len(digits) < 10:
        raise ValueError('Número inválido: mínimo 10 dígitos')
    return v


class EmergencyContact(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    relationship: str = Field(..., min_length=1, max_length=60)
    phone: str = Field(..., min_length=7, max_length=20)


class PatientCreate(BaseModel):
    # Obligatorios (flujo híbrido)
    name: str = Field(..., min_length=1, max_length=255)
    date_of_birth: date
    reason_for_consultation: str = Field(..., min_length=1, max_length=2000)

    # Obligatorios adicionales
    phone: str = Field(..., max_length=20)

    # Obligatorio (requerido para portal del paciente)
    email: str = Field(..., max_length=255)

    # Opcionales
    marital_status: Optional[MaritalStatus] = None
    gender_identity: Optional[GenderIdentity] = None
    occupation: Optional[str] = Field(None, max_length=120)
    address: Optional[str] = Field(None, max_length=500)
    emergency_contact: Optional[EmergencyContact] = None
    medical_history: Optional[str] = Field(None, max_length=5000)
    psychological_history: Optional[str] = Field(None, max_length=5000)

    # Pre-existentes
    diagnosis_tags: Optional[List[str]] = []
    risk_level: str = "low"

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return _validate_phone_value(v)

    @field_validator("date_of_birth")
    @classmethod
    def dob_must_be_past_and_reasonable(cls, v: date) -> date:
        today = date.today()
        if v >= today:
            raise ValueError("Fecha de nacimiento debe ser pasada")
        if v < today.replace(year=today.year - 120):
            raise ValueError("Fecha de nacimiento no razonable")
        return v


class TemplateFieldSchema(BaseModel):
    id: str
    label: str
    type: str  # text | scale | checkbox | list | date
    options: list[str] = []
    guiding_question: str = ""
    order: int = 0

class SaveTemplateRequest(BaseModel):
    fields: list[TemplateFieldSchema]

class NoteTemplateOut(BaseModel):
    id: str
    fields: list[TemplateFieldSchema]
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# PDF analysis helper
# ---------------------------------------------------------------------------

_PDF_EXTRACTION_PROMPT = """
You are analyzing a clinical psychologist's note template.
Extract the sections and fields from this PDF note.
For each section, return a JSON object with:
- id: a unique short slug (e.g. "estado_afectivo")
- label: the section name in Spanish
- type: one of "text", "scale", "checkbox", "list", "date"
  - Use "scale" if the field is numeric 1-10
  - Use "checkbox" if the field has multiple yes/no options
  - Use "list" if the field has a fixed set of single-choice options
  - Use "date" if the field captures a date
  - Default to "text"
- options: list of strings (required for checkbox and list types, empty otherwise)
- guiding_question: a question that helps the AI know what to extract from a dictation
- order: sequential integer starting at 1

Return ONLY a valid JSON array. No explanation, no markdown fences.
""".strip()

MAX_PDF_BYTES = 5 * 1024 * 1024  # 5 MB


async def analyze_pdf_with_claude(pdf_base64: str) -> list[dict]:
    import json as _json2
    _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = await _client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": pdf_base64,
                    },
                },
                {"type": "text", "text": _PDF_EXTRACTION_PROMPT},
            ],
        }],
    )
    text = response.content[0].text.strip()
    try:
        fields = _json2.loads(text)
    except _json2.JSONDecodeError:
        raise HTTPException(status_code=422, detail="No pudimos detectar secciones — revisa que el PDF tenga texto seleccionable.")
    if not fields:
        raise HTTPException(status_code=422, detail="No pudimos detectar secciones — revisa que el PDF tenga texto seleccionable.")
    return fields


# ---------------------------------------------------------------------------
# Note Templates
# ---------------------------------------------------------------------------

@router.get("/template", response_model=NoteTemplateOut | None, tags=["clinical"])
async def get_template(
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    result = await db.execute(
        select(NoteTemplate).where(NoteTemplate.psychologist_id == psychologist.id)
    )
    tmpl = result.scalar_one_or_none()
    if tmpl is None:
        return None
    return NoteTemplateOut(
        id=str(tmpl.id),
        fields=[TemplateFieldSchema(**f) for f in (tmpl.fields or [])],
        created_at=tmpl.created_at,
        updated_at=tmpl.updated_at,
    )

@router.post("/template", response_model=NoteTemplateOut, tags=["clinical"])
async def save_template(
    body: SaveTemplateRequest,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    result = await db.execute(
        select(NoteTemplate).where(NoteTemplate.psychologist_id == psychologist.id)
    )
    tmpl = result.scalar_one_or_none()
    fields_data = [f.model_dump() for f in body.fields]
    if tmpl is None:
        tmpl = NoteTemplate(psychologist_id=psychologist.id, fields=fields_data)
        db.add(tmpl)
    else:
        tmpl.fields = fields_data
        tmpl.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(tmpl)
    return NoteTemplateOut(
        id=str(tmpl.id),
        fields=[TemplateFieldSchema(**f) for f in tmpl.fields],
        created_at=tmpl.created_at,
        updated_at=tmpl.updated_at,
    )


@router.post("/template/analyze-pdf", tags=["clinical"])
async def analyze_pdf_endpoint(
    file: UploadFile = File(...),
    psychologist: Psychologist = Depends(get_current_psychologist),
):
    content = await file.read()
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(status_code=422, detail="El PDF no puede superar 5 MB.")
    pdf_b64 = base64.b64encode(content).decode("utf-8")
    fields = await analyze_pdf_with_claude(pdf_b64)
    result = []
    for i, f in enumerate(fields):
        result.append(TemplateFieldSchema(
            id=f.get("id", f"field_{i+1}"),
            label=f.get("label", f"Campo {i+1}"),
            type=f.get("type", "text"),
            options=f.get("options", []),
            guiding_question=f.get("guiding_question", ""),
            order=f.get("order", i + 1),
        ))
    return result


class PatientUpdate(BaseModel):
    # Todos opcionales — PATCH parcial. Los 3 campos mínimos validan min_length=1
    # cuando se envían (no se pueden limpiar con "").
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    date_of_birth: Optional[date] = None
    reason_for_consultation: Optional[str] = Field(None, min_length=1, max_length=2000)
    marital_status: Optional[MaritalStatus] = None
    gender_identity: Optional[GenderIdentity] = None
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=255)
    occupation: Optional[str] = Field(None, max_length=120)
    address: Optional[str] = Field(None, max_length=500)
    emergency_contact: Optional[EmergencyContact] = None
    medical_history: Optional[str] = Field(None, max_length=5000)
    psychological_history: Optional[str] = Field(None, max_length=5000)
    diagnosis_tags: Optional[List[str]] = None
    risk_level: Optional[str] = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        return _validate_phone_value(v)

    @field_validator("date_of_birth")
    @classmethod
    def dob_must_be_past_and_reasonable(cls, v: Optional[date]) -> Optional[date]:
        if v is None:
            return v
        today = date.today()
        if v >= today:
            raise ValueError("Fecha de nacimiento debe ser pasada")
        if v < today.replace(year=today.year - 120):
            raise ValueError("Fecha de nacimiento no razonable")
        return v

class ProcessSessionRequest(BaseModel):
    raw_dictation: str
    format: Optional[str] = "SOAP"

class ConfirmNoteRequest(BaseModel):
    edited_note: Optional[Dict[str, Any]] = None

# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class PatientOut(BaseModel):
    id: uuid.UUID
    name: str
    risk_level: Optional[str] = None
    date_of_birth: Optional[date] = None
    diagnosis_tags: Optional[List[str]] = []

    # Intake
    marital_status: Optional[str] = None
    gender_identity: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    occupation: Optional[str] = None
    address: Optional[str] = None
    emergency_contact: Optional[Dict[str, Any]] = None
    reason_for_consultation: Optional[str] = None
    medical_history: Optional[str] = None
    psychological_history: Optional[str] = None

    class Config:
        from_attributes = True

class SessionOut(BaseModel):
    id: uuid.UUID
    session_number: Optional[int] = None
    session_date: Optional[date]
    raw_dictation: Optional[str]
    ai_response: Optional[str]
    status: str
    format: str = "SOAP"
    structured_note: Optional[Dict[str, Any]] = None
    detected_patterns: Optional[List[str]] = None
    alerts: Optional[List[str]] = None
    suggested_next_steps: Optional[List[str]] = None
    clinical_note_id: Optional[uuid.UUID] = None
    custom_fields: Optional[dict] = None
    template_fields: Optional[list] = None

    class Config:
        from_attributes = True

class PaginatedSessions(BaseModel):
    items: List[SessionOut]
    total: int
    page: int
    page_size: int
    pages: int

class ConversationOut(BaseModel):
    id: Optional[str]             # session id — None if patient has no sessions
    patient_id: str
    patient_name: str
    session_number: Optional[int]
    session_date: Optional[date]
    dictation_preview: Optional[str]
    status: Optional[str]
    message_count: Optional[int]
    portal_status: Optional[str] = None  # None | "invited" | "active"

    class Config:
        from_attributes = True

class PaginatedConversations(BaseModel):
    items: List[ConversationOut]
    total: int
    page: int
    page_size: int
    pages: int

class ProcessSessionOut(BaseModel):
    text_fallback: Optional[str]
    session_id: Optional[str] = None
    format: str = "SOAP"
    custom_fields: Optional[dict] = None
    template_fields: Optional[list] = None

class JobAcceptedOut(BaseModel):
    job_id: str
    status: str = "pending"

class JobStatusOut(BaseModel):
    id: str
    status: str
    result: Optional[dict] = None
    error_message: Optional[str] = None


class ConfirmNoteOut(BaseModel):
    id: uuid.UUID
    status: str = "confirmed"

class ArchiveOut(BaseModel):
    id: str
    archived: bool = True

class ProfileOut(BaseModel):
    profile: Dict[str, Any]
    recent_sessions: List[Dict[str, Any]]

# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------

@router.get("/patients", response_model=List[PatientOut], tags=["patients"])
@limiter.limit("120/hour")
async def list_patients(
    request: Request,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    query = select(Patient).where(
        Patient.psychologist_id == psychologist.id,
        Patient.deleted_at.is_(None),
    ).order_by(Patient.name)
    res = await db.execute(query)
    patients = res.scalars().all()

    return [PatientOut(id=p.id, name=p.name, risk_level=p.risk_level) for p in patients]


@router.post("/patients", response_model=PatientOut, status_code=status.HTTP_201_CREATED, tags=["patients"])
@limiter.limit("30/hour")
async def create_patient(
    payload: PatientCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_user),
    current_user: Psychologist = Depends(get_current_psychologist),
):
    patient = Patient(
        psychologist_id=current_user.id,
        name=payload.name,
        date_of_birth=payload.date_of_birth,
        diagnosis_tags=payload.diagnosis_tags or [],
        risk_level=payload.risk_level,
        marital_status=payload.marital_status,
        occupation=payload.occupation,
        address=encrypt_if_set(payload.address),
        emergency_contact=encrypt_if_set(
            _json.dumps(payload.emergency_contact.model_dump()) if payload.emergency_contact else None
        ),
        reason_for_consultation=encrypt_if_set(payload.reason_for_consultation),
        medical_history=encrypt_if_set(payload.medical_history),
        psychological_history=encrypt_if_set(payload.psychological_history),
        gender_identity=encrypt_if_set(payload.gender_identity),
        phone=encrypt_if_set(payload.phone),
        email=payload.email,
    )
    db.add(patient)
    await db.flush()  # populate patient.id

    db.add(PatientProfile(patient_id=patient.id))

    # Audit: nombres de campos enviados (solo los set explícitamente), sin valores
    fields_set = sorted(payload.model_fields_set)
    await log_audit(
        db=db,
        action="CREATE",
        entity="patient",
        entity_id=str(patient.id),
        psychologist_id=str(current_user.id),
        ip_address=request.client.host if request.client else None,
        metadata={"fields_set": fields_set},
    )

    await db.commit()
    await db.refresh(patient)
    _decrypt_patient_orm(patient)
    return PatientOut.model_validate(patient)


@router.get("/patients/{patient_id}", response_model=PatientOut, tags=["patients"])
async def get_patient(
    patient_id: str,
    db: AsyncSession = Depends(get_db_with_user),
    current_user: Psychologist = Depends(get_current_psychologist),
):
    puuid = _parse_uuid(patient_id, "patient_id")
    res = await db.execute(
        select(Patient).where(
            Patient.id == puuid,
            Patient.deleted_at.is_(None),
        )
    )
    patient = res.scalar_one_or_none()

    # Ownership: no revelar existencia de pacientes ajenos
    if not patient or patient.psychologist_id != current_user.id:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    _decrypt_patient_orm(patient)
    return PatientOut.model_validate(patient)


@router.patch("/patients/{patient_id}", response_model=PatientOut, tags=["patients"])
async def update_patient(
    patient_id: str,
    payload: PatientUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db_with_user),
    current_user: Psychologist = Depends(get_current_psychologist),
):
    puuid = _parse_uuid(patient_id, "patient_id")
    res = await db.execute(
        select(Patient).where(
            Patient.id == puuid,
            Patient.deleted_at.is_(None),
        )
    )
    patient = res.scalar_one_or_none()

    if not patient or patient.psychologist_id != current_user.id:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    # Solo los campos explícitamente enviados — permite setear null en opcionales
    updates = payload.model_dump(exclude_unset=True)

    _PATIENT_SENSITIVE = {"medical_history", "psychological_history", "reason_for_consultation", "address", "gender_identity", "phone"}
    for field, value in updates.items():
        if field == "emergency_contact":
            ec = value.model_dump() if hasattr(value, "model_dump") else value
            setattr(patient, field, encrypt_if_set(_json.dumps(ec)) if ec is not None else None)
        elif field in _PATIENT_SENSITIVE:
            setattr(patient, field, encrypt_if_set(value))
        else:
            setattr(patient, field, value)

    fields_changed = sorted(updates.keys())
    await log_audit(
        db=db,
        action="UPDATE",
        entity="patient",
        entity_id=str(patient.id),
        psychologist_id=str(current_user.id),
        ip_address=request.client.host if request.client else None,
        metadata={"fields_changed": fields_changed},
    )

    await db.commit()
    await db.refresh(patient)
    _decrypt_patient_orm(patient)
    return PatientOut.model_validate(patient)


@router.get("/patients/{patient_id}/profile", response_model=ProfileOut, tags=["patients"])
async def get_patient_profile(
    patient_id: str,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    patient = await _get_owned_patient(db, psychologist.id, patient_id)
    res = await db.execute(select(PatientProfile).where(PatientProfile.patient_id == patient.id))
    profile = res.scalar_one_or_none()

    res_s = await db.execute(
        select(Session, ClinicalNote)
        .join(ClinicalNote, Session.id == ClinicalNote.session_id)
        .where(Session.patient_id == patient.id, Session.status == "confirmed")
        .order_by(Session.session_date.desc())
        .limit(3)
    )
    recent_sessions = [
        {"session_date": s.session_date, "assessment": decrypt_if_set(c.assessment)}
        for s, c in res_s
    ]

    return ProfileOut(
        profile={
            "recurring_themes": profile.recurring_themes if profile else [],
            "protective_factors": profile.protective_factors if profile else [],
            "risk_factors": profile.risk_factors if profile else [],
            "progress_indicators": profile.progress_indicators if profile else {},
        },
        recent_sessions=recent_sessions,
    )


@router.get("/patients/{patient_id}/sessions", response_model=PaginatedSessions, tags=["patients"])
async def get_patient_sessions(
    patient_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    patient = await _get_owned_patient(db, psychologist.id, patient_id)
    puuid = patient.id
    offset = (page - 1) * page_size

    total_res = await db.execute(
        select(func.count()).select_from(Session)
        .where(Session.patient_id == puuid, Session.is_archived == False)
    )
    total = total_res.scalar_one()

    res = await db.execute(
        select(Session, ClinicalNote)
        .outerjoin(ClinicalNote, Session.id == ClinicalNote.session_id)
        .where(Session.patient_id == puuid, Session.is_archived == False)
        .order_by(Session.created_at.asc())
        .limit(page_size)
        .offset(offset)
    )

    items = []
    for s, cn in res.all():
        is_custom = cn and cn.format == "custom"
        items.append(SessionOut(
            id=s.id,
            session_number=s.session_number,
            session_date=s.session_date,
            raw_dictation=decrypt_if_set(s.raw_dictation),
            ai_response=decrypt_if_set(s.ai_response),
            status=s.status,
            format=s.format,
            structured_note=None if is_custom else ({
                "subjective": decrypt_if_set(cn.subjective),
                "objective": decrypt_if_set(cn.objective),
                "assessment": decrypt_if_set(cn.assessment),
                "plan": decrypt_if_set(cn.plan),
            } if cn else None),
            custom_fields=cn.custom_fields if is_custom else None,
            template_fields=cn.template_snapshot if (is_custom and cn) else None,
            detected_patterns=list(cn.detected_patterns) if cn and cn.detected_patterns is not None else None,
            alerts=list(cn.alerts) if cn and cn.alerts is not None else None,
            suggested_next_steps=list(cn.suggested_next_steps) if cn and cn.suggested_next_steps is not None else None,
            clinical_note_id=cn.id if cn else None,
        ))

    pages = max(1, (total + page_size - 1) // page_size)
    return PaginatedSessions(items=items, total=total, page=page, page_size=page_size, pages=pages)


@router.get("/patients/{patient_id}/report", tags=["patients"])
async def patient_report(
    patient_id: str,
    period: str = "quarterly",
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    patient = await _get_owned_patient(db, psychologist.id, patient_id)
    return await generate_evolution_report(db, str(patient.id), period)


@router.get("/patients/{patient_id}/search", tags=["patients"])
async def patient_search(
    patient_id: str,
    q: str = Query(..., min_length=1),
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    patient = await _get_owned_patient(db, psychologist.id, patient_id)
    return await search_patient_history(db, str(patient.id), q)

# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

@router.post("/sessions/{patient_id}/process", response_model=JobAcceptedOut, status_code=status.HTTP_202_ACCEPTED, tags=["sessions"])
@limiter.limit("30/hour")
async def process_session_endpoint(
    request: Request,
    patient_id: str,
    rec: ProcessSessionRequest,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    patient = await _get_owned_patient(db, psychologist.id, patient_id)

    # 1. Prompt injection check — delegates to the agent's comprehensive regex
    try:
        sanitize_dictation(rec.raw_dictation)
    except PromptInjectionError:
        raise HTTPException(status_code=422, detail="Contenido no permitido en el dictado.")

    # 2. Fetch template fields if format is custom
    template_fields = None
    if rec.format.lower() == "custom":
        tmpl_res = await db.execute(
            select(NoteTemplate).where(NoteTemplate.psychologist_id == psychologist.id)
        )
        tmpl = tmpl_res.scalar_one_or_none()
        if not tmpl or not tmpl.fields:
            raise HTTPException(status_code=400, detail="Debes configurar una plantilla personalizada antes de usar este formato.")
        template_fields = tmpl.fields

    # 3. Create Async Job
    job = JobQueue(
        id=uuid.uuid4(),
        psychologist_id=psychologist.id,
        patient_id=patient.id,
        format_=rec.format,
        raw_dictation=encrypt_if_set(rec.raw_dictation),
        template_fields=template_fields,
        status="pending"
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    return JobAcceptedOut(job_id=str(job.id))


@router.get("/jobs/{job_id}", response_model=JobStatusOut, tags=["jobs"])
async def get_job_status(
    job_id: str,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    juuid = _parse_uuid(job_id, "job_id")
    job = await db.get(JobQueue, juuid)
    if not job:
        raise HTTPException(status_code=404, detail="Tarea no encontrada.")
    if job.psychologist_id != psychologist.id:
        raise HTTPException(status_code=403, detail="No tienes acceso a esta tarea.")

    result = None
    if job.result:
        res_json = decrypt_if_set(job.result)
        if res_json:
            result = _json.loads(res_json)

    return JobStatusOut(
        id=str(job.id),
        status=job.status,
        result=result,
        error_message=job.error_message
    )


@router.get("/jobs/{job_id}/stream", tags=["jobs"])
async def stream_job_status(
    job_id: str,
    psychologist: Psychologist = Depends(get_current_psychologist_sse),
):
    """SSE endpoint for job progress. Stops when status is completed or failed."""
    from fastapi.responses import StreamingResponse
    juuid = _parse_uuid(job_id, "job_id")

    async def event_generator():
        # Single session for the entire SSE stream — avoids NullPool+pgBouncer
        # prepared statement conflicts that occur when creating a new session per iteration.
        # db.refresh(job) forces a re-query each iteration, replacing the fresh-session pattern.
        async with AsyncSessionLocal() as db:
            job = await db.get(JobQueue, juuid)
            if not job or job.psychologist_id != psychologist.id:
                yield f"data: {_json.dumps({'error': 'Not found or unauthorized'})}\n\n"
                return

            while True:
                await db.refresh(job)

                data = {
                    "status": job.status,
                    "error_message": job.error_message
                }
                if job.result:
                    res_json = decrypt_if_set(job.result)
                    if res_json:
                        data["result"] = _json.loads(res_json)

                yield f"data: {_json.dumps(data)}\n\n"

                if job.status in ("completed", "failed"):
                    break

                await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


async def _background_update_profile(patient_id: uuid.UUID, session_note: dict) -> None:
    """Runs after the HTTP response is sent. Opens its own DB session."""
    async with AsyncSessionLocal() as db:
        try:
            await update_patient_profile_summary(db, patient_id, session_note)
        except Exception as e:
            logger.error(f"Background profile update failed: {e}")


@router.post("/sessions/{session_id}/confirm", response_model=ConfirmNoteOut, tags=["sessions"])
async def confirm_session(
    session_id: str,
    req: ConfirmNoteRequest,
    background_tasks: BackgroundTasks,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    session_uuid = _parse_uuid(session_id, "session_id")
    res = await db.execute(
        select(Session).join(Patient).where(
            Session.id == session_uuid,
            Patient.psychologist_id == psychologist.id,
        ).with_for_update()
    )
    sess = res.scalar_one_or_none()

    if not sess:
        raise SessionNotFoundError("Sesión no encontrada.", code="SESSION_NOT_FOUND", details={"session_id": session_id})

    if sess.status != "draft":
        from exceptions import DomainError
        raise DomainError(
            "Solo sesiones en borrador pueden confirmarse.",
            code="INVALID_SESSION_STATUS",
            http_status=409,
        )

    note_data = req.edited_note or {}
    # Capture patient_id before commit — attribute expires after commit
    patient_id = sess.patient_id

    note, summary_data = await build_note(
        sess,
        note_data,
        psychologist_id=psychologist.id,
        db=db,
        session_id=session_id,
    )

    db.add(note)
    sess.status = "confirmed"
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        from exceptions import DomainError
        raise DomainError(
            "Esta sesión ya fue confirmada.",
            code="DUPLICATE_NOTE",
            http_status=409,
        )

    background_tasks.add_task(_background_update_profile, patient_id, summary_data)
    return ConfirmNoteOut(id=note.id)


@router.delete("/sessions/{session_id}", status_code=204, tags=["sessions"])
async def delete_draft_session(
    session_id: str,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    session_uuid = _parse_uuid(session_id, "session_id")
    res = await db.execute(
        select(Session).join(Patient).where(
            Session.id == session_uuid,
            Patient.psychologist_id == psychologist.id,
        )
    )
    sess = res.scalar_one_or_none()

    if not sess:
        raise SessionNotFoundError(
            "Sesión no encontrada.",
            code="SESSION_NOT_FOUND",
            details={"session_id": session_id},
        )

    if sess.status == "confirmed":
        from exceptions import DomainError
        raise DomainError(
            "Las sesiones confirmadas no pueden eliminarse.",
            code="INVALID_SESSION_STATUS",
            http_status=409,
        )

    await db.delete(sess)
    await db.commit()


@router.patch("/sessions/{session_id}/archive", response_model=ArchiveOut, tags=["sessions"])
async def archive_session(
    session_id: str,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    session_uuid = _parse_uuid(session_id, "session_id")
    res = await db.execute(
        select(Session).join(Patient).where(
            Session.id == session_uuid,
            Patient.psychologist_id == psychologist.id,
        )
    )
    sess = res.scalar_one_or_none()

    if not sess:
        raise SessionNotFoundError("Sesión no encontrada.", code="SESSION_NOT_FOUND", details={"session_id": session_id})

    sess.is_archived = True
    await db.commit()

    return ArchiveOut(id=session_id)


@router.patch("/patients/{patient_id}/sessions/archive", response_model=ArchiveOut, tags=["sessions"])
async def archive_patient_sessions(
    patient_id: str,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    """Archive all sessions for a patient so they disappear from the conversations list."""
    patient = await _get_owned_patient(db, psychologist.id, patient_id)
    patient_uuid = patient.id
    res = await db.execute(
        select(Session).where(Session.patient_id == patient_uuid, Session.is_archived == False)
    )
    sessions = res.scalars().all()
    for sess in sessions:
        sess.is_archived = True
    await db.commit()
    return ArchiveOut(id=patient_id)

# ---------------------------------------------------------------------------
# Conversations (cross-patient view)
# ---------------------------------------------------------------------------

@router.get("/conversations", response_model=PaginatedConversations, tags=["conversations"])
async def list_conversations(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    # One entry per patient: most recent non-archived session via DISTINCT ON (PostgreSQL).
    # LEFT JOIN so patients without any session still appear in the list.
    sql = text("""
        SELECT DISTINCT ON (p.id)
            p.id            AS patient_id,
            p.name          AS patient_name,
            s.id            AS session_id,
            s.session_number,
            s.session_date,
            s.raw_dictation AS dictation_preview,
            s.status,
            s.messages,
            s.created_at    AS last_activity,
            pu.is_active    AS portal_is_active,
            pu.invited_at   AS portal_invited_at
        FROM patients p
        JOIN sessions s
            ON s.patient_id = p.id
            AND s.is_archived = FALSE
            AND s.raw_dictation IS NOT NULL
            AND (s.format IS NULL OR s.format != 'chat')
        LEFT JOIN patient_users pu ON pu.patient_id = p.id
        WHERE p.deleted_at IS NULL
          AND p.psychologist_id = :psy_id
        ORDER BY p.id, s.created_at DESC NULLS LAST
    """)

    res = await db.execute(sql, {"psy_id": psychologist.id})
    rows = res.mappings().all()

    items = []
    for row in rows:
        raw = decrypt_if_set(row.get("dictation_preview"))
        patient_name = decrypt_if_set(row.get("patient_name"))
        preview = (raw[:120] + "...") if raw and len(raw) > 120 else raw
        messages_raw = decrypt_if_set(row.get("messages"))
        try:
            messages = _json.loads(messages_raw) if messages_raw else []
        except (_json.JSONDecodeError, TypeError):
            messages = []

        portal_is_active = row.get("portal_is_active")
        portal_invited_at = row.get("portal_invited_at")
        if portal_is_active:
            portal_status = "active"
        elif portal_invited_at:
            portal_status = "invited"
        else:
            portal_status = None

        items.append(ConversationOut(
            id=str(row["session_id"]) if row["session_id"] else None,
            patient_id=str(row["patient_id"]),
            patient_name=patient_name,
            session_number=row.get("session_number"),
            session_date=row.get("session_date"),
            dictation_preview=preview,
            status=row.get("status"),
            message_count=len(messages) if isinstance(messages, list) else 0,
            portal_status=portal_status,
        ))

    total = len(items)
    offset = (page - 1) * page_size
    paged = items[offset: offset + page_size]
    pages = max(1, (total + page_size - 1) // page_size)

    return PaginatedConversations(
        items=paged, total=total, page=page, page_size=page_size, pages=pages
    )


# ---------------------------------------------------------------------------
# Patient Portal Endpoints (Psychologist side)
# ---------------------------------------------------------------------------

# --- Resend invite rate limiting (in-memory, per psychologist+patient) ---
_resend_invite_attempts: dict = defaultdict(list)
_RESEND_MAX = 3
_RESEND_WINDOW_MINUTES = 60


def _check_resend_rate(psychologist_id: uuid.UUID, patient_id: uuid.UUID) -> None:
    from datetime import timedelta
    key = (str(psychologist_id), str(patient_id))
    now = datetime.now(timezone.utc)
    window = now - timedelta(minutes=_RESEND_WINDOW_MINUTES)
    _resend_invite_attempts[key] = [t for t in _resend_invite_attempts[key] if t > window]
    if len(_resend_invite_attempts[key]) >= _RESEND_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados reenvíos. Intenta en 60 minutos.",
            headers={"Retry-After": "3600"},
        )
    _resend_invite_attempts[key].append(now)


@router.post("/patients/{patient_id}/portal/invite", tags=["portal"])
async def invite_patient(
    patient_id: str,
    request: Request,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    import secrets
    from api.auth import get_current_psychologist, hash_token
    from services.email import send_patient_invite
    from datetime import timedelta
    patient = await _get_owned_patient(db, psychologist.id, patient_id)
    
    # 1. El paciente debe tener email
    patient_email = patient.email
    if not patient_email:
        raise HTTPException(status_code=400, detail="El paciente debe tener un correo electrónico registrado para invitarlo al portal.")

    # 2. Verificar o crear PatientUser
    res = await db.execute(select(PatientUser).where(PatientUser.patient_id == patient.id))
    patient_user = res.scalar_one_or_none()

    if patient_user:
        if patient_user.is_active:
            raise HTTPException(status_code=409, detail="Este paciente ya activó su cuenta en el portal. No se puede volver a invitar.")
        raise HTTPException(status_code=409, detail="Ya se envió una invitación a este paciente. Solo se permite una invitación por paciente.")

    # Verificar que el email no esté ya en uso por otro PatientUser
    res_email = await db.execute(select(PatientUser).where(PatientUser.email == patient_email))
    if res_email.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="Este correo electrónico ya está asociado a otro paciente del portal. Usa un correo diferente para este paciente.",
        )

    patient_user = PatientUser(
        patient_id=patient.id,
        psychologist_id=psychologist.id,
        email=patient_email,
    )
    db.add(patient_user)

    # 3. Generar token
    token = secrets.token_urlsafe(32)
    patient_user.invite_token = hash_token(token)
    patient_user.invite_token_expires_at = datetime.now(timezone.utc) + timedelta(days=settings.PATIENT_INVITE_EXPIRE_DAYS)
    patient_user.invited_at = datetime.now(timezone.utc)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Este correo electrónico ya está en uso en el portal.",
        )

    # 4. Enviar email
    logger.debug(
        "INVITE TOKEN (dev only): /portal/invite?token=%s  — email: %s",
        token, patient_email
    )
    try:
        await send_patient_invite(patient_email, patient.name, psychologist.name, token)
    except Exception as e:
        logger.error(f"Error enviando invitacion a paciente {patient_email}: {e}")
        logger.info(
            "INVITE URL (sin email): %s/portal/invite?token=%s",
            settings.FRONTEND_URL, token
        )

    return {"message": "Invitación enviada", "expires_in_days": settings.PATIENT_INVITE_EXPIRE_DAYS}


@router.post("/patients/{patient_id}/portal/resend-invite", tags=["portal"])
async def resend_patient_invite(
    patient_id: str,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    import secrets
    from api.auth import hash_token
    from services.email import send_patient_invite
    from datetime import timedelta

    patient = await _get_owned_patient(db, psychologist.id, patient_id)

    _check_resend_rate(psychologist.id, patient.id)

    res = await db.execute(select(PatientUser).where(PatientUser.patient_id == patient.id))
    patient_user = res.scalar_one_or_none()

    if not patient_user:
        raise HTTPException(
            status_code=404,
            detail="Este paciente no tiene invitación previa. Usa el flujo de invitar.",
        )

    if patient_user.is_active:
        raise HTTPException(
            status_code=409,
            detail="El paciente ya activó su cuenta en el portal.",
        )

    token = secrets.token_urlsafe(32)
    patient_user.invite_token = hash_token(token)
    patient_user.invite_token_expires_at = datetime.now(timezone.utc) + timedelta(days=settings.PATIENT_INVITE_EXPIRE_DAYS)
    patient_user.invited_at = datetime.now(timezone.utc)

    await db.commit()

    try:
        await send_patient_invite(patient.email, patient.name, psychologist.name, token)
    except Exception as e:
        logger.error(f"Error reenviando invitacion a {patient.email}: {e}")

    return {"message": "Invitación reenviada", "expires_in_days": settings.PATIENT_INVITE_EXPIRE_DAYS}


@router.post("/sessions/{session_id}/summary/send", tags=["portal"])
async def send_session_summary(
    session_id: str,
    background_tasks: BackgroundTasks,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    from agent.agent import generate_patient_summary
    session_uuid = _parse_uuid(session_id, "session_id")
    res = await db.execute(
        select(Session).join(Patient).where(
            Session.id == session_uuid,
            Patient.psychologist_id == psychologist.id,
        )
    )
    sess = res.scalar_one_or_none()
    
    if not sess:
        raise SessionNotFoundError("Sesión no encontrada.", code="SESSION_NOT_FOUND", details={"session_id": session_id})
    if sess.status != "confirmed":
        raise HTTPException(status_code=400, detail="La sesión debe estar confirmada para enviar el resumen.")

    # Get ClinicalNote
    cn_res = await db.execute(select(ClinicalNote).where(ClinicalNote.session_id == sess.id))
    clinical_note = cn_res.scalar_one_or_none()
    if not clinical_note:
        raise HTTPException(status_code=400, detail="No se encontró nota clínica para esta sesión.")

    # Get or create PatientSummary
    summary_res = await db.execute(select(PatientSummary).where(PatientSummary.session_id == sess.id))
    patient_summary = summary_res.scalar_one_or_none()

    if not patient_summary:
        # Check format
        is_custom = clinical_note.format == "custom"
        note_data = {}
        if is_custom:
            note_data["format"] = "custom"
            note_data["custom_fields"] = clinical_note.custom_fields
        else:
            note_data["format"] = "SOAP"
            note_data["subjective"] = decrypt_if_set(clinical_note.subjective)
            note_data["objective"] = decrypt_if_set(clinical_note.objective)
            note_data["assessment"] = decrypt_if_set(clinical_note.assessment)
            note_data["plan"] = decrypt_if_set(clinical_note.plan)

        # Generate draft
        generated = await generate_patient_summary(note_data)
        
        nxt_date_str = generated.get("next_session_date")
        nxt_date = None
        if nxt_date_str:
            try:
                from datetime import datetime as dt
                nxt_date = dt.strptime(nxt_date_str, "%Y-%m-%d").date()
            except ValueError:
                pass
                
        patient_summary = PatientSummary(
            session_id=sess.id,
            patient_id=sess.patient_id,
            topics_worked=encrypt_if_set(generated.get("topics_worked")),
            homework=encrypt_if_set(generated.get("homework")),
            next_session_date=nxt_date,
        )
        db.add(patient_summary)

    patient_summary.sent_at = datetime.now(timezone.utc)
    await db.commit()
    
    return {"message": "Resumen enviado al portal del paciente."}
