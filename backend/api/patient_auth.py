from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone

from database import get_db, PatientUser, PatientPasswordResetToken, Patient
from services.email import send_patient_reset_email
from config import settings
from api.limiter import limiter
from fastapi import Request
import jwt
import secrets
import asyncio
import random
from collections import defaultdict
from services.password import validate_password, hash_token, hash_password, verify_password
from api.auth import get_current_psychologist

router = APIRouter()


def create_patient_access_token(patient_user: PatientUser) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(patient_user.id),
        "patient_id": str(patient_user.patient_id),
        "role": "patient",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


_forgot_pw_email_attempts: dict = defaultdict(list)
_failed_login_attempts: dict = defaultdict(list)
_MAX_LOGIN_ATTEMPTS = 5
_LOGIN_WINDOW_MINUTES = 15
_LOGIN_LOCKOUT_MINUTES = 30

def _check_patient_brute_force(email: str) -> None:
    now = datetime.now(timezone.utc)
    window = now - timedelta(minutes=_LOGIN_WINDOW_MINUTES)
    _failed_login_attempts[email] = [t for t in _failed_login_attempts[email] if t > window]

    if len(_failed_login_attempts[email]) >= _MAX_LOGIN_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Cuenta bloqueada temporalmente por seguridad. Intenta en {_LOGIN_LOCKOUT_MINUTES} minutos.",
            headers={"Retry-After": str(_LOGIN_LOCKOUT_MINUTES * 60)},
        )

def _record_failed_login(email: str) -> None:
    _failed_login_attempts[email].append(datetime.now(timezone.utc))

def _reset_login_attempts(email: str) -> None:
    _failed_login_attempts[email] = []




def _check_patient_forgot_email_rate(email: str) -> None:
    now = datetime.now(timezone.utc)
    window = now - timedelta(minutes=10)
    _forgot_pw_email_attempts[email] = [
        t for t in _forgot_pw_email_attempts[email] if t > window
    ]
    if len(_forgot_pw_email_attempts[email]) >= 1:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas solicitudes. Intenta en 10 minutos.",
            headers={"Retry-After": "600"},
        )
    _forgot_pw_email_attempts[email].append(now)


class AcceptInviteRequest(BaseModel):
    token: str
    password: str


class PatientLoginRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/accept-invite")
async def accept_invite(req: AcceptInviteRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PatientUser).where(PatientUser.invite_token == hash_token(req.token)))
    patient_user = result.scalar_one_or_none()

    if not patient_user:
        raise HTTPException(status_code=400, detail="Token inválido o expirado.")

    now = datetime.now(timezone.utc)
    if patient_user.invite_token_expires_at and now > patient_user.invite_token_expires_at:
        raise HTTPException(status_code=400, detail="El token ha expirado.")

    try:
        validate_password(req.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    patient_user.password_hash = hash_password(req.password)
    patient_user.invite_token = None
    patient_user.invite_token_expires_at = None
    patient_user.accepted_at = now
    patient_user.is_active = True

    await db.commit()

    # Create JWT
    access_token = create_patient_access_token(patient_user)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": "patient",
        "patient_id": str(patient_user.patient_id)
    }


_FORGOT_GENERIC_MSG = (
    "Si esa dirección tiene una cuenta activa, recibirás un link en los próximos minutos."
)


@router.post("/forgot-password")
@limiter.limit("3/hour")
async def patient_forgot_password(
    request: Request,
    req: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    _check_patient_forgot_email_rate(req.email)
    await asyncio.sleep(random.uniform(0.1, 0.3))

    result = await db.execute(
        select(PatientUser).where(
            PatientUser.email == req.email,
            PatientUser.is_active == True,
        )
    )
    patient_user = result.scalar_one_or_none()

    if patient_user:
        raw_token = secrets.token_urlsafe(32)
        reset_record = PatientPasswordResetToken(
            patient_user_id=patient_user.id,
            token_hash=hash_token(raw_token),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=60),
            ip_address=request.client.host if request.client else None,
        )
        db.add(reset_record)
        await db.commit()

        patient_result = await db.execute(
            select(Patient).where(Patient.id == patient_user.patient_id)
        )
        patient = patient_result.scalar_one_or_none()
        patient_name = patient.name if patient else "Paciente"

        try:
            await send_patient_reset_email(patient_user.email, patient_name, raw_token)
        except Exception:
            pass

    return {"message": _FORGOT_GENERIC_MSG}


_INVALID_TOKEN_MSG = "El link de recuperación no es válido o ha expirado."


@router.post("/reset-password")
@limiter.limit("5/hour")
async def patient_reset_password(
    request: Request,
    req: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        validate_password(req.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    token_hash = hash_token(req.token)
    result = await db.execute(
        select(PatientPasswordResetToken).where(
            PatientPasswordResetToken.token_hash == token_hash
        )
    )
    reset_record = result.scalar_one_or_none()

    if not reset_record:
        raise HTTPException(status_code=400, detail=_INVALID_TOKEN_MSG)

    if reset_record.failed_attempts >= 3:
        raise HTTPException(status_code=400, detail=_INVALID_TOKEN_MSG)

    now = datetime.now(timezone.utc)

    if reset_record.used_at is not None or reset_record.expires_at < now:
        reset_record.failed_attempts += 1
        await db.commit()
        raise HTTPException(status_code=400, detail=_INVALID_TOKEN_MSG)

    user_result = await db.execute(
        select(PatientUser).where(PatientUser.id == reset_record.patient_user_id)
    )
    patient_user = user_result.scalar_one_or_none()

    if not patient_user:
        raise HTTPException(status_code=400, detail=_INVALID_TOKEN_MSG)

    patient_user.password_hash = hash_password(req.new_password)
    reset_record.used_at = now
    await db.commit()
    await db.refresh(patient_user)

    access_token = create_patient_access_token(patient_user)
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/login")
@limiter.limit("5/minute")
async def patient_login(request: Request, req: PatientLoginRequest, db: AsyncSession = Depends(get_db)):
    _check_patient_brute_force(req.email)
    await asyncio.sleep(random.uniform(0.1, 0.3)) # Prevent timing attacks

    result = await db.execute(select(PatientUser).where(PatientUser.email == req.email))
    patient_user = result.scalar_one_or_none()

    if not patient_user or not patient_user.password_hash or not verify_password(req.password, patient_user.password_hash):
        _record_failed_login(req.email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email o contraseña incorrectos.")

    if not patient_user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Cuenta inactiva.")

    _reset_login_attempts(req.email)

    # Create JWT
    access_token = create_patient_access_token(patient_user)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": "patient",
        "patient_id": str(patient_user.patient_id)
    }
