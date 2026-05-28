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
| `agent/agent.py` | Orquestación Claude + `SYSTEM_PROMPT` |
| `agent/tools.py` | Schemas `AGENT_TOOLS` para Claude + implementaciones (vector search, pattern detection) |
| `agent/embeddings.py` |  (`text-embedding-3-small`) |
| `agent/interfaces.py` | ABCs: `IEmbeddingService`, `BaseTool` |

**`api/`** — capa HTTP

| File | Role |
|------|------|
| `api/routes.py` | Todos los endpoints FastAPI + schemas Pydantic request/response |

**Raíz** — compartidos

| File | Role |
|------|------|
| `main.py` | Entry point: crea `app`, middleware CORS, startup `init_db()`, incluye router |
| `database.py` | Modelos SQLAlchemy + pgvector HNSW index setup |
| `config.py` | Pydantic-settings config (clinical limits, API keys, DB URL) |
| `exceptions.py` | Domain exceptions |
| `seed.py` | DB seeding script para desarrollo |

**Data flow for session processing:**
1. `POST /sessions/{patient_id}/process` → `api/routes.py` → `agent/agent.py` llama Claude con el dictado
2. Claude usa tools de `agent/tools.py` (semantic history search, pattern detection)
3. Claude retorna respuesta de texto
4. `POST /sessions/{session_id}/confirm` → guarda `ClinicalNote` con embedding de `agent/embeddings.py` en DB

### Frontend Structure (`/frontend/src/`)

- **`App.jsx`** (~1276 lines): Single orchestrator — holds all state (messages, patients, sessions), dispatches API calls, renders layout
- **`api.js`**: Thin HTTP client; all backend endpoints abstracted here
- **`components/`**: `ChatInput`, `NoteReview`, `PatientCard`, `SessionHistory` — presentational components receiving props/callbacks from `App.jsx`

Tailwind is loaded via CDN in `index.html` (not npm), so no `tailwind.config.js` exists.

### Database Schema

- `psychologists` → users/auth
- `patients` → per psychologist
- `sessions` → raw dictation + AI response text
- `clinical_notes` → SOAP structured data + pgvector embedding (1536d, HNSW index)
- `patient_profiles` → recurring themes, protective/risk factors, progress indicators

### Clinical Configuration (in `config.py`)
- `MAX_DICTATION_LENGTH`: 5000 chars
- `MAX_SESSIONS_CONTEXT`: 6 sessions passed as context to Claude
- `EMBEDDING_DIMENSIONS`: 1536

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

| 5 | **Dictado de voz con streaming** | Transcripción en tiempo real + SOAP construyéndose progresivamente (Whisper API) |
| 6 | **Crear nota personalizada para usuario** | Export con membrete profesional |
| 7 | **Descargar nota clínica como PDF** | Export con membrete profesional |
| 8 | **Vincular Google Drive** | Guardar notas automáticamente en carpetas del psicólogo |
| 9 | **Vincular Google Calendar** | Vincular sesiones con eventos del calendario |
| 10 | **Cargar texto desde archivo** | Subir texto para procesarlo como dictado |
| 11 | **Pegar texto largo (referencia parcial)** | Referenciar fragmentos sin pegar el contenido completo |


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

Con cada nuevo feature con merge a dev actualiza los diagramas y documentos del proyecto de CLAUDE.md y dentro de /docs/architecture en caso de ser necesario. Para generar los diagramas puedes utilizar herramientas como mermaid.

Haz pruebas unitarias de cada cambio que realices en el backend y frontend y asegúrate de que todo funcione correctamente.

Sigue los skills del proyecto @skills/security.md y @skills/clinic/agent-clinic.md y @skills/best-practices.md

---



