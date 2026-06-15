import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from database import init_db
from api.limiter import limiter
from api.routes import router
from api.cron import router as cron_router
from api.privacy import router as privacy_router
from api.auth import router as auth_router
from api.patient_auth import router as patient_auth_router
from api.patient_portal import router as patient_portal_router
from api.calendar_routes import router as calendar_router
from api.summary_routes import router as summary_router
from api.billing import router as billing_router
from config import settings
from exceptions import DomainError
import re

_ALLOWED_ORIGIN_RE = re.compile(
    r"^https://(syquex(-[a-z0-9]+)*\.vercel\.app|app\.syquex\.mx)$"
)

def _cors_headers(request: Request) -> dict:
    origin = request.headers.get("origin", "")
    if origin == "http://localhost:5173" or _ALLOWED_ORIGIN_RE.match(origin):
        return {"Access-Control-Allow-Origin": origin}
    return {}


# Configura el logging raíz para que los loggers de la app (syquex, agent.worker,
# ...) sean visibles en la salida de uvicorn/Railway. Sin esto, los logger.info()
# de la app caen en el handler "last resort" de Python, que solo emite WARNING+ —
# por eso "Job worker started" nunca aparecía. uvicorn conserva sus propios loggers
# (disable_existing_loggers=False), así que esto no pisa los logs de acceso.
_LOG_LEVEL = logging.DEBUG if settings.ENVIRONMENT == "development" else logging.INFO
logging.basicConfig(
    level=_LOG_LEVEL,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

logger = logging.getLogger("syquex")

# Deshabilitar docs automáticos en staging y producción
_hide_docs = settings.ENVIRONMENT in ("production", "staging")
app = FastAPI(
    title="SyqueX API",
    docs_url=None if _hide_docs else "/docs",
    redoc_url=None,
    openapi_url=None if _hide_docs else "/openapi.json",
)

# Security headers añadidos PRIMERO (quedan al interior del stack)
# CORS debe ser el middleware más exterior para que sus headers no sean
# bloqueados por BaseHTTPMiddleware — ver orden de add_middleware abajo.
async def _add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if settings.ENVIRONMENT in ("production", "staging"):
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://cdn.tailwindcss.com https://js.stripe.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "connect-src 'self' https://*.supabase.co https://api.stripe.com; "
            "frame-src https://js.stripe.com; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "upgrade-insecure-requests; "
            "frame-ancestors 'none'"
        )
    for header in ("X-Powered-By", "Server"):
        if header in response.headers:
            del response.headers[header]
    return response

app.add_middleware(BaseHTTPMiddleware, dispatch=_add_security_headers)

# CORS añadido AL FINAL — Starlette invierte el orden, así que este queda
# como el middleware más exterior y sus headers llegan al cliente sin ser
# filtrados por BaseHTTPMiddleware.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins(),
    allow_origin_regex=r"^https://(syquex(-[a-z0-9]+)*\.vercel\.app|app\.syquex\.mx)$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# Rate limit exceeded — respuesta sin revelar detalles internos
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Domain errors — mapeados a su http_status correspondiente
@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    logger.warning(
        "Domain error [%s]: %s — %s %s",
        exc.code, exc.message, request.method, request.url.path,
    )
    return JSONResponse(
        status_code=exc.http_status,
        content={"detail": exc.message, "code": exc.code},
        headers=_cors_headers(request),
    )



# Manejador global — nunca exponer stack traces al cliente
@app.exception_handler(Exception)
async def global_error_handler(request: Request, exc: Exception):
    logger.error("Unhandled error: %s %s — %s", request.method, request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Error interno del servidor"},
        headers=_cors_headers(request),
    )


@app.on_event("startup")
async def startup_event():
    from crypto import validate_key
    validate_key()
    import os
    raw = os.environ.get("ALLOWED_ORIGINS", "NOT_SET")
    parsed = settings.get_allowed_origins()
    if settings.ENVIRONMENT == "development":
        print(f"[CORS_DEBUG] raw env: {repr(raw)}", flush=True)
        print(f"[CORS_DEBUG] parsed origins: {parsed}", flush=True)
    await init_db()
    # Pre-load embedding model so the first confirm request doesn't block
    try:
        from agent.embeddings import get_embedding
        await get_embedding("warmup")
        logger.info("Embedding model loaded and ready.")
    except Exception as e:
        logger.warning("Embedding warmup failed (non-fatal): %s", e)

    # Start Background Job Worker
    import asyncio
    from agent.worker import job_worker
    asyncio.create_task(job_worker())
    logger.info("Background job worker task created.")

app.include_router(auth_router, prefix="/api/v1")
app.include_router(patient_auth_router, prefix="/api/v1/auth/patient", tags=["patient-auth"])
app.include_router(patient_portal_router, prefix="/api/v1/portal", tags=["patient-portal"])
app.include_router(billing_router, prefix="/api/v1/billing", tags=["billing"])
app.include_router(cron_router, prefix="/api/v1/cron", tags=["cron"])
app.include_router(privacy_router, prefix="/api/v1/privacy", tags=["privacy"])
app.include_router(calendar_router, prefix="/api/v1/calendar")
app.include_router(summary_router, prefix="/api/v1")
app.include_router(router, prefix="/api/v1")
