# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SyqueX (PsicoAgente) is a clinical AI assistant for psychologists. Clinicians dictate session notes, the system generates structured notes via Claude, stores them with vector embeddings for semantic search, and tracks patient evolution over time.

## Development Commands

### Full Stack (local)
```bash
# Start PostgreSQL
docker-compose up -d postgres


Terminal 1 — Backend:                                                       
.\start-backend.ps1  

Terminal 2 — Frontend:
.\start-frontend.ps1                                                      
                                                                                                                         

El script de backend crea el venv con Python 3.11 automáticamente si no     existe, así no tienes que hacerlo manualmente.                            

  ▎ Si PowerShell bloquea la ejecución de scripts, corre primero:
  ▎ Set-ExecutionPolicy -Scope CurrentUser RemoteSigned


### Database
```bash
docker exec -it syquex-postgres-1 psql -U psicoagente -d psicoagente
```

## Environment Setup

Copy `.env.example` to `.env` in `/backend/`:
```
ANTHROPIC_API_KEY=...
DATABASE_URL=postgresql+asyncpg://psicoagente:psicoagente_dev@localhost/psicoagente
```

## Architecture

### Stack
- **Frontend**: React 18 + Vite, Tailwind CSS (via CDN in index.html), plain JavaScript
- **Backend**: Python 3.11, FastAPI + Uvicorn (async)
- **Database**: PostgreSQL 16 + pgvector extension, SQLAlchemy 2.0 async, asyncpg driver
- **LLMs**: Anthropic Claude for note generation.
- **Deployment**: Vercel (frontend), Railway (backend), Supabase (DB)

### Backend Structure (`/backend/`)

**`agent/`** — capa del agente LLM

| File | Role |
|------|------|
| `agent/agent.py` | Orquestación Claude + `SYSTEM_PROMPT` (SOAP, DAP, BIRP, custom) |
| `agent/tools.py` | 5 tool schemas para Claude tool_use + implementaciones (semantic search, pattern detection, evolution report) |
| `agent/embeddings.py` | FastEmbed wrapper (`intfloat/multilingual-e5-large`, 1024d) — inferencia local, sin egreso de PII |
| `agent/interfaces.py` | ABCs: `IEmbeddingService`, `BaseTool` |
| `agent/template_tool.py` | Tool dinámica para llenado de notas en formato custom definido por el psicólogo |
| `agent/worker.py` | Worker asíncrono en background: consume `job_queue` para procesar dictados largos |

**`api/`** — capa HTTP

| File | Role |
|------|------|
| `api/routes.py` | Endpoints clínicos: patients CRUD, sessions process/confirm/archive, conversations, profiles, semantic search |
| `api/auth.py` | Registro, login, refresh, logout, forgot/reset-password (psicólogos) |
| `api/patient_auth.py` | Autenticación del portal del paciente (login, refresh, reset-password) |
| `api/patient_portal.py` | Endpoints del portal del paciente (disponibilidad, reserva, resúmenes) |
| `api/calendar_routes.py` | Gestión de slots de disponibilidad del psicólogo |
| `api/calendar_ai.py` | Lógica AI del calendario |
| `api/summary_routes.py` | Resúmenes de sesión para enviar al paciente |
| `api/billing.py` | Stripe Checkout + webhooks (idempotent) |
| `api/privacy.py` | Exportación de datos LFPDPPP |
| `api/cron.py` | Tareas programadas (emails de trial expirando) |
| `api/audit.py` | Utilidad de inserción en audit_logs |
| `api/limiter.py` | Singleton slowapi rate limiter |

**`services/`** — lógica de negocio reutilizable

| File | Role |
|------|------|
| `services/note_service.py` | Strategy pattern para construcción de notas (SOAP, DAP, BIRP, custom) |
| `services/email.py` | Emails transaccionales vía Resend (bienvenida, reset, trial, ICS de citas) |
| `services/password.py` | Validación de política de contraseñas |

**Raíz** — compartidos

| File | Role |
|------|------|
| `main.py` | Entry point: crea `app`, middleware CORS + security headers, startup `init_db()` + job worker, incluye routers |
| `database.py` | 17 modelos SQLAlchemy + `init_db()` con migraciones idempotentes + RLS + pgvector HNSW |
| `config.py` | Pydantic-settings config (clinical limits, API keys, DB URL, Stripe, Resend) |
| `exceptions.py` | Jerarquía de errores de dominio con HTTP status mapping |
| `crypto.py` | Wrapper Fernet con rotación de llave — cifra campos sensibles (LFPDPPP) |
| `seed_demo.py` | Script de seeding para datos de demostración |

**Data flow for session processing:**
1. `POST /sessions/{patient_id}/process` → `api/routes.py` → `agent/agent.py` llama Claude con el dictado
2. Claude usa tools de `agent/tools.py` (semantic history search, pattern detection)
3. Claude retorna respuesta de texto
4. `POST /sessions/{session_id}/confirm` → guarda `ClinicalNote` con embedding de `agent/embeddings.py` en DB
5. Background task → `update_patient_profile_summary()` actualiza `patient_profiles` vía Claude

**Data flow para notas asíncronas (job queue):**
1. `POST /sessions/{patient_id}/process-soap|custom` → inserta `JobQueue` record (estado `pending`)
2. `agent/worker.py` detecta jobs pendientes y los procesa en background
3. El frontend consulta el estado del job y recupera el resultado cuando está `completed`

### Frontend Structure (`/frontend/src/`)

- **`App.jsx`** (~1276 lines): Single orchestrator — holds all state (messages, patients, sessions), dispatches API calls, renders layout
- **`api.js`**: HTTP client para el psicólogo con auto-refresh de tokens
- **`patientApi.js`**: HTTP client separado para el portal del paciente
- **`auth.js`**: Gestión del ciclo de vida de tokens JWT
- **`components/`**: 50+ componentes presentacionales — `DictationPanel`, `SoapNoteDocument`, `CustomNoteDocument`, `EvolucionPanel`, `CalendarScreen`, `BillingScreen`, `TemplateWizard`, etc.
- **`pages/`**: Páginas del portal del paciente — `PatientLogin`, `PatientPortal`, `PatientResetPassword`, `PatientInviteAccept`
- **`hooks/`**: `useDraft.js` (persistencia de borrador), `usePWAInstall.js`
- **`utils/`**: `age.js` — cálculo de edad

Tailwind is loaded via CDN in `index.html` (not npm), so no `tailwind.config.js` exists.

### Database Schema (17 tablas)

**Usuarios y autenticación:**
- `psychologists` → cuentas de psicólogos (tenants)
- `refresh_tokens` → rotación de JWT refresh tokens
- `password_reset_tokens` → tokens one-time de reset (psicólogos)
- `patient_users` → cuentas del portal del paciente
- `patient_password_reset_tokens` → tokens reset para pacientes

**Clínico:**
- `patients` → expedientes (campos de intake cifrados con Fernet + soft-delete LFPDPPP)
- `sessions` → dictado crudo + respuesta AI (campo `messages` cifrado)
- `clinical_notes` → nota estructurada SOAP/DAP/BIRP/custom + embedding pgvector (1024d, HNSW)
- `patient_profiles` → resumen longitudinal: temas recurrentes, factores de riesgo/protección
- `patient_summaries` → resúmenes por sesión enviados al portal del paciente
- `note_templates` → plantillas de nota custom por psicólogo (campos JSONB)

**SaaS y billing:**
- `subscriptions` → ciclo de vida de suscripción Stripe
- `processed_stripe_events` → idempotencia de webhooks Stripe

**Calendario:**
- `availability_slots` → slots de disponibilidad del psicólogo + reservas

**Compliance y background:**
- `audit_logs` → trazabilidad inmutable (INSERT-only, sin PII clínica)
- `job_queue` → cola de jobs asíncronos para procesamiento de notas largas

### Clinical Configuration (in `config.py`)
- `MAX_DICTATION_LENGTH`: 5000 chars
- `MAX_SESSIONS_CONTEXT`: 6 sessions passed as context to Claude
- `EMBEDDING_DIMENSIONS`: 1024 (FastEmbed `intfloat/multilingual-e5-large`, local, sin egreso de PII)

## Roadmap

> **Pivote de producto — 2026-03-26:** La app pasó de chat-first a documentation-first.
> Split-document view implementado. Ver diseño aprobado más abajo.

---

### Estado actual

```
Feature completa: custom note templates (Tasks 6–16) implementada y commiteada en feature/note-personalized. Próximo paso: abrir PR hacia dev para revisión.
```

---

---

### Siguientes features




---

## Diseño visual aprobado

- **Paleta:** base `#ffffff` · sidebar `#f4f4f2` · sage `#5a9e8a` · amber `#c4935a` · ink `#18181b`
  - La calidez viene de los acentos (sage/amber), no de los fondos — evita el efecto beige
- **Tipografía nota:** serif (Georgia) — como un expediente real. Dictado: sans.
- **Profundidad:** surface color shifts únicamente, sin sombras
- **SOAP:** labels en small caps, color según estado (sage=done, amber=streaming, muted=pending), separación solo por espacio y peso — sin cards ni bordes
- **Historial de sesiones:** vive en tab "Historial" — NO en la vista de sesión activa
- **Desktop:** split-view — panel dictado (320px izq) + panel nota (flex derecho)
- **Mobile:** tabs Dictar / Nota / Historial


## Branching Strategy

Git Flow simplificado para un solo desarrollador con CI/CD automático.

| Rama | Entorno | Deploy |
|------|---------|--------|
| `main` | Producción | Auto → Vercel prod + Railway prod |
| `dev` | Staging | Auto → Vercel preview + Railway staging |
| `feature/*` | Preview | Vercel preview URL por branch |
| `hotfix/*` | — | Merge directo a `main`, luego backport a `dev` |

Sigue el archivo @git-sync.ps1 para mantener todo sincronizado con las ramas principales en local y remoto despues de cada feature/hotfix merge en dev/main.

**Flujo normal:**
```
feature/nombre → dev → main
```

**Flujo hotfix:**
```
hotfix/nombre → main (fix urgente) → dev (backport)
```

**Reglas:**
- Nunca commitear directo a `main`
- `dev` es la rama base para todo trabajo nuevo
- Los `feature/*` salen de `dev` y vuelven a `dev` via PR
- Los `hotfix/*` salen de `main` y se mergean a `main` + `dev`


- Utiliza patrones SOLID para que el código sea más mantenible
- Mantén el código limpio y organizado
- Utiliza comentarios para explicar el código

## Actualización de documentación (OBLIGATORIO)

Al completar cualquier feature antes del merge a `dev`, actualiza la documentación afectada:

| Cambio | Archivos a actualizar |
|--------|----------------------|
| Nuevo modelo / tabla / columna | `CLAUDE.md` § Database Schema · `docs/architecture/DATABASE_SCHEMA.md` |
| Nuevo endpoint o router | `CLAUDE.md` § Backend Structure · `docs/architecture/API_REFERENCE.md` · `docs/architecture/ARCHITECTURE.md` (Appendix B) |
| Nuevo archivo Python en backend | `CLAUDE.md` § Backend Structure · `docs/architecture/ARCHITECTURE.md` §3.2 File Inventory |
| Nuevo componente / página en frontend | `CLAUDE.md` § Frontend Structure · `docs/architecture/ARCHITECTURE.md` §4.1 Component Tree |
| Nuevo flujo de datos o integración externa | `docs/architecture/ARCHITECTURE.md` §5 Core Data Flows |
| Variable de entorno nueva | `docs/architecture/ARCHITECTURE.md` §6.3 Environment Variables |

Para diagramas usa Mermaid. Actualiza siempre el campo `Last Updated` del documento afectado.

Haz pruebas unitarias de cada cambio que realices en el backend y frontend y asegúrate de que todo funcione correctamente.

Sigue los skills del proyecto @skills/security.md y @skills/clinic/agent-clinic.md y @skills/best-practices.md

---



