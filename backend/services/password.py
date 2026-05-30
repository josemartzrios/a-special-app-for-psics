import hashlib
import re

# pyrefly: ignore [missing-import]
from passlib.context import CryptContext

_PASSWORD_MIN_LENGTH = 8
_PASSWORD_UPPERCASE_RE = re.compile(r'[A-Z]')
_PASSWORD_NUMBER_RE = re.compile(r'[0-9]')

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def validate_password(password: str) -> str:
    """Validates password policy. Returns the password if valid, raises ValueError otherwise."""
    errors = []
    if len(password) < _PASSWORD_MIN_LENGTH:
        errors.append(f"Mínimo {_PASSWORD_MIN_LENGTH} caracteres")
    if not _PASSWORD_UPPERCASE_RE.search(password):
        errors.append("Al menos 1 letra mayúscula")
    if not _PASSWORD_NUMBER_RE.search(password):
        errors.append("Al menos 1 número")
    if errors:
        raise ValueError("; ".join(errors))
    return password


def hash_token(token: str) -> str:
    """Returns SHA-256 hash of a token. Never store raw tokens."""
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)
