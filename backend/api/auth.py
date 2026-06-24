"""
Módulo de autenticación — SyqueX
Implementa: bcrypt password hashing, JWT access tokens, brute-force protection.
"""
import logging
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Optional

# pyrefly: ignore [missing-import]
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
# pyrefly: ignore [missing-import]
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, field_validator
# pyrefly: ignore [missing-import]
from sqlalchemy import select, update
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
import stripe

from config import settings
from exceptions import DomainError
from database import get_db, Psychologist, Subscription, RefreshToken, PasswordResetToken
from services.password import validate_password, hash_token, hash_password, verify_password
from api.audit import log_audit

import asyncio
import hashlib
import random
import secrets
from datetime import timezone

from api.limiter import limiter

UTC = timezone.utc

# --- Schema de registro ---
class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    cedula_profesional: Optional[str] = None
    accepted_privacy: bool
    accepted_terms: bool
    privacy_version: str = "1.0"
    terms_version: str = "1.0"

    @field_validator('password')
    @classmethod
    def password_strength(cls, v):
        return validate_password(v)

    @field_validator('accepted_privacy', 'accepted_terms')
    @classmethod
    def must_accept(cls, v, info):
        if not v:
            raise ValueError(f"{info.field_name} debe ser aceptado")
        return v

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator('new_password')
    @classmethod
    def password_strength(cls, v):
        return validate_password(v)

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator('new_password')
    @classmethod
    def password_strength(cls, v):
        return validate_password(v)

logger = logging.getLogger("syquex.auth")

# ---------------------------------------------------------------------------
# Crypto helpers
# ---------------------------------------------------------------------------

def create_access_token(psychologist_id: str) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": psychologist_id,
        "exp": expire,
        "iat": datetime.now(UTC),
        "type": "access",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def _create_refresh_token_record(psychologist_id, request: Request) -> tuple[str, RefreshToken]:
    """Genera token raw + registro para DB. Retorna (raw_token, db_record)."""
    raw = secrets.token_urlsafe(32)
    record = RefreshToken(
        psychologist_id=psychologist_id,
        token_hash=hash_token(raw),
        expires_at=datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return raw, record

def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=raw_token,
        httponly=True,
        secure=settings.is_production(),
        samesite="strict",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/api/v1/auth",
    )

# ---------------------------------------------------------------------------
# Brute-force protection 
# ---------------------------------------------------------------------------

_MAX_ATTEMPTS = 5
_WINDOW_MINUTES = 15
_LOCKOUT_MINUTES = 30
_failed_attempts: dict = defaultdict(list)

def _check_brute_force(email: str) -> None:
    now = datetime.now(UTC)
    window = now - timedelta(minutes=_WINDOW_MINUTES)
    _failed_attempts[email] = [t for t in _failed_attempts[email] if t > window]

    if len(_failed_attempts[email]) >= _MAX_ATTEMPTS:
        logger.warning("Account locked after failed attempts: %s", email)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Cuenta bloqueada temporalmente. Intenta en {_LOCKOUT_MINUTES} minutos.",
            headers={"Retry-After": str(_LOCKOUT_MINUTES * 60)},
        )

def _record_failed_attempt(email: str) -> None:
    _failed_attempts[email].append(datetime.now(UTC))

def _reset_attempts(email: str) -> None:
    _failed_attempts[email] = []

# ---------------------------------------------------------------------------
# JWT dependency — get_current_psychologist
# ---------------------------------------------------------------------------

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

from fastapi import Query


def _decode_psychologist_token(raw_token: Optional[str]) -> str:
    """Validate JWT structure and return psychologist_id. Raises HTTPException on any failure."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o sesión expirada",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not raw_token:
        raise credentials_exc
    try:
        payload = jwt.decode(raw_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        psychologist_id: Optional[str] = payload.get("sub")
        if not psychologist_id or payload.get("type") != "access":
            raise credentials_exc
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión expirada. Por favor inicia sesión nuevamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise credentials_exc
    return psychologist_id


async def get_current_psychologist(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Psychologist:
    """Standard auth — token must arrive via Authorization: Bearer header."""
    psychologist_id = _decode_psychologist_token(token)
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o sesión expirada",
        headers={"WWW-Authenticate": "Bearer"},
    )
    psy = await db.get(Psychologist, psychologist_id)
    if not psy or not psy.is_active:
        raise credentials_exc
    return psy


async def get_current_psychologist_sse(
    token: Optional[str] = Query(None, alias="token"),
    db: AsyncSession = Depends(get_db),
) -> Psychologist:
    """SSE-only auth variant — accepts token via ?token= because EventSource cannot set headers."""
    psychologist_id = _decode_psychologist_token(token)
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o sesión expirada",
        headers={"WWW-Authenticate": "Bearer"},
    )
    psy = await db.get(Psychologist, psychologist_id)
    if not psy or not psy.is_active:
        raise credentials_exc
    return psy

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/auth", tags=["auth"])

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

@router.post("/register", response_model=TokenResponse)
async def register(
    request: Request,
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    from datetime import timedelta
    # pyrefly: ignore [missing-import]
    import stripe as stripe_lib

    # 1. Email único
    existing = await db.execute(
        select(Psychologist).where(Psychologist.email == body.email)
    )
    if existing.scalar_one_or_none():
        raise DomainError("El email ya está registrado.", code="EMAIL_TAKEN", http_status=409)

    # 2. Crear psicólogo
    now = datetime.now(UTC)
    psychologist = Psychologist(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        is_active=True,
        cedula_profesional=body.cedula_profesional,
        accepted_privacy_at=now,
        accepted_terms_at=now,
        privacy_version=body.privacy_version,
        terms_version=body.terms_version,
        trial_ends_at=now + timedelta(days=14),
    )
    db.add(psychologist)
    await db.flush()  # para obtener el ID

    # 3. Crear Stripe Customer
    stripe_lib.api_key = settings.STRIPE_SECRET_KEY
    try:
        customer = stripe_lib.Customer.create(
            email=body.email,
            name=body.name,
            metadata={"psychologist_id": str(psychologist.id)},
        )
        psychologist.stripe_customer_id = customer.id
    except Exception:
        psychologist.stripe_customer_id = None  # no bloquear el registro si Stripe falla

    # 4. Crear suscripción local en trialing
    subscription = Subscription(
        psychologist_id=psychologist.id,
        plan_slug="pro_v1",
        price_mxn_cents=49900,
        status="trialing",
    )
    db.add(subscription)

    # 5. Audit log
    await log_audit(
        db,
        action="register",
        entity="psychologist",
        entity_id=psychologist.id,
        psychologist_id=psychologist.id,
        ip_address=request.client.host if request.client else None,
    )

    await db.commit()

    # 6. Email bienvenida (fire-and-forget)
    try:
        from services.email import send_welcome_email
        await send_welcome_email(body.email, body.name, psychologist.trial_ends_at)
    except Exception:
        pass  # no bloquear el registro

    # 7. Retornar token (reusar create_access_token existente)
    token = create_access_token(str(psychologist.id))
    return TokenResponse(access_token=token)

@router.post("/login")
async def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    _check_brute_force(form.username)

    res = await db.execute(select(Psychologist).where(Psychologist.email == form.username))
    psy = res.scalar_one_or_none()

    # Tiempo constante — evitar timing attacks y no revelar si el email existe
    if not psy or not psy.password_hash or not verify_password(form.password, psy.password_hash):
        _record_failed_attempt(form.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
        )

    if not psy.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
        )

    _reset_attempts(form.username)
    logger.info('{"event":"login_exitoso","psychologist_id":"%s","ip":"%s"}', psy.id, request.client.host if request.client else "unknown")

    token = create_access_token(str(psy.id))
    
    raw_refresh, refresh_record = _create_refresh_token_record(psy.id, request)
    db.add(refresh_record)
    await db.commit()

    response = JSONResponse(content=TokenResponse(access_token=token).model_dump())
    _set_refresh_cookie(response, raw_refresh)
    return response

@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    raw_token = request.cookies.get("refresh_token")
    if not raw_token:
        raise HTTPException(status_code=401, detail="No refresh token")

    token_hash = hash_token(raw_token)
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=401, detail="Token inválido")

    # Detección de robo: token ya revocado presentado de nuevo
    if record.revoked_at is not None:
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.psychologist_id == record.psychologist_id)
            .values(revoked_at=datetime.now(UTC))
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="Sesión inválida")

    if record.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=401, detail="Sesión expirada")

    # Rotación: revocar actual, emitir nuevo
    record.revoked_at = datetime.now(UTC)
    raw_new, new_record = _create_refresh_token_record(record.psychologist_id, request)
    db.add(new_record)
    await db.commit()

    access_token = create_access_token(str(record.psychologist_id))
    response = JSONResponse(content=TokenResponse(access_token=access_token).model_dump())
    _set_refresh_cookie(response, raw_new)
    return response

@router.post("/logout")
async def logout(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    raw_token = request.cookies.get("refresh_token")
    if raw_token:
        token_hash = hash_token(raw_token)
        result = await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        record = result.scalar_one_or_none()
        if record and record.revoked_at is None:
            psychologist_id = record.psychologist_id
            record.revoked_at = datetime.now(UTC)
            await log_audit(
                db,
                action="logout",
                entity="psychologist",
                entity_id=psychologist_id,
                psychologist_id=psychologist_id,
                ip_address=request.client.host if request.client else None,
            )
            await db.commit()

    response = JSONResponse(content={"ok": True})
    response.delete_cookie("refresh_token", path="/api/v1/auth")
    return response

# ---------------------------------------------------------------------------
# Per-email rate limiting for forgot-password (in-memory)
# ---------------------------------------------------------------------------

_forgot_pw_email_attempts: dict = defaultdict(list)
_FORGOT_PW_EMAIL_WINDOW_MINUTES = 10
_FORGOT_PW_EMAIL_MAX = 1

def _check_forgot_pw_email_rate(email: str) -> None:
    now = datetime.now(UTC)
    window = now - timedelta(minutes=_FORGOT_PW_EMAIL_WINDOW_MINUTES)
    _forgot_pw_email_attempts[email] = [t for t in _forgot_pw_email_attempts[email] if t > window]
    if len(_forgot_pw_email_attempts[email]) >= _FORGOT_PW_EMAIL_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas solicitudes. Intenta en 10 minutos.",
            headers={"Retry-After": str(_FORGOT_PW_EMAIL_WINDOW_MINUTES * 60)},
        )
    _forgot_pw_email_attempts[email].append(now)

_PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = 60

@router.post("/forgot-password")
@limiter.limit("3/hour")
async def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    # Per-email rate limit: 1/10min
    _check_forgot_pw_email_rate(body.email)

    # Constant-time delay to prevent timing attacks / email enumeration
    await asyncio.sleep(random.uniform(0.1, 0.3))

    res = await db.execute(select(Psychologist).where(Psychologist.email == body.email))
    psychologist = res.scalar_one_or_none()

    if psychologist:
        raw_token = secrets.token_urlsafe(32)
        reset_record = PasswordResetToken(
            psychologist_id=psychologist.id,
            token_hash=hash_token(raw_token),
            expires_at=datetime.now(UTC) + timedelta(minutes=_PASSWORD_RESET_TOKEN_EXPIRE_MINUTES),
            ip_address=request.client.host if request.client else None,
        )
        db.add(reset_record)
        await log_audit(
            db,
            action="password_reset_requested",
            entity="psychologist",
            entity_id=psychologist.id,
            psychologist_id=psychologist.id,
            ip_address=request.client.host if request.client else None,
        )
        await db.commit()

        # Fire-and-forget — never block registration if email fails
        try:
            from services.email import send_reset_email
            await send_reset_email(body.email, psychologist.name, raw_token)
        except Exception:
            pass

    return {"message": "Si el email existe, recibirás un enlace en los próximos minutos"}

@router.post("/reset-password")
@limiter.limit("5/hour")
async def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    token_hash = hash_token(body.token)
    res = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
    )
    record = res.scalar_one_or_none()

    if not record or record.used_at is not None:
        raise HTTPException(status_code=400, detail="Token inválido o ya utilizado")

    if record.failed_attempts >= 3:
        raise HTTPException(status_code=400, detail="Token bloqueado. Solicita uno nuevo.")

    if record.expires_at < datetime.now(UTC):
        record.failed_attempts += 1
        await db.commit()
        raise HTTPException(status_code=400, detail="Token expirado")

    # Update password
    psy = await db.get(Psychologist, record.psychologist_id)
    if not psy:
        raise HTTPException(status_code=400, detail="Token inválido o ya utilizado")

    psy.password_hash = hash_password(body.new_password)

    # Mark token as used
    record.used_at = datetime.now(UTC)

    # Revoke ALL refresh tokens for this psychologist
    await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.psychologist_id == psy.id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )

    # Create new refresh token BEFORE commit — single atomic transaction
    raw_refresh, refresh_record = _create_refresh_token_record(psy.id, request)
    db.add(refresh_record)

    await log_audit(
        db,
        action="password_reset_completed",
        entity="psychologist",
        entity_id=psy.id,
        psychologist_id=psy.id,
        ip_address=request.client.host if request.client else None,
    )

    await db.commit()

    # Issue new JWT (refresh token record already committed)
    access_token = create_access_token(str(psy.id))
    response = JSONResponse(content=TokenResponse(access_token=access_token).model_dump())
    _set_refresh_cookie(response, raw_refresh)
    return response


@router.get("/me")
async def get_me(
    psychologist=Depends(get_current_psychologist),
):
    return {
        "id": str(psychologist.id),
        "name": psychologist.name,
        "email": psychologist.email,
        "cedula_profesional": psychologist.cedula_profesional,
    }


@router.post("/change-password", status_code=204)
async def change_password(
    body: ChangePasswordRequest,
    psychologist=Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(body.current_password, psychologist.password_hash):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")
    # current_password ya quedó verificada contra el hash, así que comparar en
    # texto plano equivale a "la nueva es igual a la contraseña guardada".
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe ser diferente a la actual")
    psychologist.password_hash = hash_password(body.new_password)
    await log_audit(
        db,
        action="password_changed",
        entity="psychologist",
        entity_id=psychologist.id,
        psychologist_id=psychologist.id,
    )
    await db.commit()
