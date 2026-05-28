# Patient Diary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the patient diary feature — a between-sessions journal for patients with privacy controls, explicit sharing with their psychologist, and AI-generated summaries 24 h before scheduled sessions.

**Architecture:** Three-layer implementation: (1) DB models + migrations for DiaryChat / DiaryMessage / DiarySummary; (2) FastAPI endpoints split between patient JWT (`diary_portal.py` new file) and psychologist JWT (`routes.py` + `cron.py`); (3) React components wired into the patient portal (new Diary tab) and the psychologist app (new Pacientes tab with diary view). All text fields encrypted with the existing `crypto.py` Fernet module.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy async / Fernet encryption (`crypto.py`) / Anthropic Claude Haiku (cron AI summary) / React 18 + Vite / Tailwind CSS via CDN / Vitest + @testing-library/react

---

## File Map

### New files
| Path | Responsibility |
|------|---------------|
| `backend/api/diary_portal.py` | 6 patient diary endpoints (`/portal/diary/...`) |
| `backend/tests/test_diary_portal.py` | Unit tests for patient diary endpoints |
| `backend/tests/test_diary_cron.py` | Unit tests for AI summary cron helper |
| `frontend/src/components/DiaryShareModal.jsx` | Send-confirmation bottom sheet |
| `frontend/src/components/DiaryShareModal.test.jsx` | |
| `frontend/src/components/DiaryChatList.jsx` | Drawer: list of all patient chats |
| `frontend/src/components/DiaryChatList.test.jsx` | |
| `frontend/src/components/DiaryChat.jsx` | Full chat view: header, bubbles, emotion chips, composer |
| `frontend/src/components/DiaryChat.test.jsx` | |
| `frontend/src/components/PatientDetailDiary.jsx` | Psychologist view: upcoming summary card + history list |
| `frontend/src/components/PatientDetailDiary.test.jsx` | |

### Modified files
| Path | Change |
|------|--------|
| `backend/database.py` | Add `DiaryChat`, `DiaryMessage`, `DiarySummary` models + `init_db()` migrations |
| `backend/main.py` | Register `diary_portal` router |
| `backend/api/routes.py` | Add 2 psychologist endpoints for diary summaries |
| `backend/api/cron.py` | Add daily AI summary generation task |
| `frontend/src/patientApi.js` | Add diary API call functions |
| `frontend/src/api.js` | Add psychologist diary summary call functions |
| `frontend/src/pages/PatientPortal.jsx` | Add bottom tab nav + Diary tab (chat list + chat view) |
| `frontend/src/App.jsx` | Add 3rd "Pacientes" tab with `PatientDetailDiary` |
| `frontend/src/components/BottomNav.jsx` | 2 → 3 tabs: Sesiones · Agenda · Pacientes |
| `frontend/src/components/BottomNav.test.jsx` | Update tests for 3-tab structure |

---

## Task 1: Database Models — DiaryChat, DiaryMessage, DiarySummary

**Files:**
- Modify: `backend/database.py`
- Test: `backend/tests/test_diary_models.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_diary_models.py`:

```python
"""Tests for DiaryChat, DiaryMessage, DiarySummary model instantiation."""
import uuid
import pytest
from datetime import datetime, timezone

# conftest.py adds backend/ to sys.path
from database import DiaryChat, DiaryMessage, DiarySummary


class TestDiaryChat:
    def test_default_status_is_draft(self):
        chat = DiaryChat(
            patient_id=uuid.uuid4(),
            title="v1:encrypted",
            privacy="private",
        )
        assert chat.status == "draft"

    def test_default_privacy_is_private(self):
        chat = DiaryChat(patient_id=uuid.uuid4(), title="v1:enc")
        assert chat.privacy == "private"

    def test_sent_at_defaults_to_none(self):
        chat = DiaryChat(patient_id=uuid.uuid4(), title="v1:enc")
        assert chat.sent_at is None

    def test_emotion_defaults_to_none(self):
        chat = DiaryChat(patient_id=uuid.uuid4(), title="v1:enc")
        assert chat.emotion is None


class TestDiaryMessage:
    def test_instantiation(self):
        msg = DiaryMessage(chat_id=uuid.uuid4(), body="v1:encrypted_body")
        assert msg.body == "v1:encrypted_body"
        assert msg.chat_id is not None


class TestDiarySummary:
    def test_instantiation(self):
        s = DiarySummary(
            patient_id=uuid.uuid4(),
            slot_id=uuid.uuid4(),
            summary_text="v1:encrypted_summary",
            source_chat_ids=[uuid.uuid4()],
        )
        assert s.summary_text == "v1:encrypted_summary"
        assert len(s.source_chat_ids) == 1
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
python -m pytest tests/test_diary_models.py -v
```
Expected: `ImportError: cannot import name 'DiaryChat' from 'database'`

- [ ] **Step 3: Add the three models to `database.py`**

After the `PatientSummary` class (before the `JobQueue` class) add:

```python
class DiaryChat(Base):
    __tablename__ = 'diary_chats'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('patients.id', ondelete='CASCADE'), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    privacy: Mapped[str] = mapped_column(String(20), nullable=False, default='private')
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='draft')
    emotion: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False)

    messages = relationship("DiaryMessage", back_populates="chat", order_by="DiaryMessage.created_at", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("privacy IN ('private', 'shared')", name='chk_diary_chats_privacy'),
        CheckConstraint("status IN ('draft', 'sent')", name='chk_diary_chats_status'),
        Index('idx_diary_chats_patient', 'patient_id', 'created_at'),
    )


class DiaryMessage(Base):
    __tablename__ = 'diary_messages'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('diary_chats.id', ondelete='CASCADE'), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    chat = relationship("DiaryChat", back_populates="messages")

    __table_args__ = (
        Index('idx_diary_messages_chat', 'chat_id', 'created_at'),
    )


class DiarySummary(Base):
    __tablename__ = 'diary_summaries'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('patients.id', ondelete='CASCADE'), nullable=False)
    slot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('availability_slots.id', ondelete='CASCADE'), unique=True, nullable=False)
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_chat_ids: Mapped[List[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    __table_args__ = (
        Index('idx_diary_summaries_slot', 'slot_id'),
        Index('idx_diary_summaries_patient', 'patient_id', 'generated_at'),
    )
```

- [ ] **Step 4: Add migrations to `init_db()` in `database.py`**

At the end of `init_db()`, after all existing migration blocks, add:

```python
        # ── Diary feature tables ─────────────────────────────────────────────
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS diary_chats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                privacy VARCHAR(20) NOT NULL DEFAULT 'private',
                status VARCHAR(20) NOT NULL DEFAULT 'draft',
                emotion VARCHAR(30),
                sent_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT chk_diary_chats_privacy CHECK (privacy IN ('private', 'shared')),
                CONSTRAINT chk_diary_chats_status CHECK (status IN ('draft', 'sent'))
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS diary_messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                chat_id UUID NOT NULL REFERENCES diary_chats(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS diary_summaries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                slot_id UUID NOT NULL REFERENCES availability_slots(id) ON DELETE CASCADE,
                summary_text TEXT NOT NULL,
                source_chat_ids UUID[] NOT NULL DEFAULT '{}',
                generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (slot_id)
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_diary_chats_patient ON diary_chats(patient_id, created_at DESC)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_diary_messages_chat ON diary_messages(chat_id, created_at ASC)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_diary_summaries_slot ON diary_summaries(slot_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_diary_summaries_patient ON diary_summaries(patient_id, generated_at DESC)"))
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd backend
python -m pytest tests/test_diary_models.py -v
```
Expected: all 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/database.py backend/tests/test_diary_models.py
git commit -m "feat(diary): add DiaryChat, DiaryMessage, DiarySummary models and migrations"
```

---

## Task 2: Patient Diary Endpoints

**Files:**
- Create: `backend/api/diary_portal.py`
- Create: `backend/tests/test_diary_portal.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_diary_portal.py`:

```python
"""Unit tests for patient diary endpoints."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

UTC = timezone.utc


def _make_chat(patient_id=None, status='draft', privacy='private'):
    chat = MagicMock()
    chat.id = uuid.uuid4()
    chat.patient_id = patient_id or uuid.uuid4()
    chat.title = "v1:encrypted_title"
    chat.privacy = privacy
    chat.status = status
    chat.emotion = None
    chat.sent_at = None
    chat.created_at = datetime.now(UTC)
    chat.updated_at = datetime.now(UTC)
    return chat


class TestGetOwnedChat:
    @pytest.mark.asyncio
    async def test_returns_chat_when_owned(self, mock_db):
        patient_uuid = uuid.uuid4()
        chat = _make_chat(patient_id=patient_uuid)
        mock_db.get = AsyncMock(return_value=chat)

        from api.diary_portal import _get_owned_chat
        result = await _get_owned_chat(str(chat.id), patient_uuid, mock_db)
        assert result.id == chat.id

    @pytest.mark.asyncio
    async def test_raises_404_when_not_owned(self, mock_db):
        patient_uuid = uuid.uuid4()
        chat = _make_chat(patient_id=uuid.uuid4())  # different patient
        mock_db.get = AsyncMock(return_value=chat)

        from fastapi import HTTPException
        from api.diary_portal import _get_owned_chat
        with pytest.raises(HTTPException) as exc:
            await _get_owned_chat(str(chat.id), patient_uuid, mock_db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_raises_404_when_chat_missing(self, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        from fastapi import HTTPException
        from api.diary_portal import _get_owned_chat
        with pytest.raises(HTTPException) as exc:
            await _get_owned_chat(str(uuid.uuid4()), uuid.uuid4(), mock_db)
        assert exc.value.status_code == 404


class TestChatOut:
    def test_decrypts_title(self):
        chat = _make_chat()
        chat.title = "v1:encrypted"

        with patch("api.diary_portal.decrypt_if_set", return_value="Título real"):
            from api.diary_portal import _chat_out
            result = _chat_out(chat)
        assert result["title"] == "Título real"

    def test_includes_required_fields(self):
        chat = _make_chat()
        with patch("api.diary_portal.decrypt_if_set", return_value="T"):
            from api.diary_portal import _chat_out
            result = _chat_out(chat)
        assert all(k in result for k in ["id", "title", "privacy", "status", "emotion", "sent_at"])


class TestCreateChatValidation:
    @pytest.mark.asyncio
    async def test_rejects_when_draft_limit_reached(self, mock_db):
        count_result = MagicMock()
        count_result.scalar_one.return_value = 20
        mock_db.execute = AsyncMock(return_value=count_result)

        from fastapi import HTTPException
        from api.diary_portal import create_chat, CreateChatRequest
        patient_uuid = uuid.uuid4()

        with pytest.raises(HTTPException) as exc:
            await create_chat(
                body=CreateChatRequest(title="Test"),
                patient_uuid=patient_uuid,
                db=mock_db,
            )
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_adding_message_to_sent_chat(self, mock_db):
        patient_uuid = uuid.uuid4()
        chat = _make_chat(patient_id=patient_uuid, status='sent')
        mock_db.get = AsyncMock(return_value=chat)

        from fastapi import HTTPException
        from api.diary_portal import add_message, AddMessageRequest
        with pytest.raises(HTTPException) as exc:
            await add_message(
                chat_id=str(chat.id),
                body=AddMessageRequest(body="Hola"),
                patient_uuid=patient_uuid,
                db=mock_db,
            )
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_send_returns_409_if_already_sent(self, mock_db):
        patient_uuid = uuid.uuid4()
        chat = _make_chat(patient_id=patient_uuid, status='sent')
        mock_db.get = AsyncMock(return_value=chat)

        result = MagicMock()
        result.rowcount = 0
        mock_db.execute = AsyncMock(return_value=result)

        from fastapi import HTTPException
        from api.diary_portal import send_chat
        with pytest.raises(HTTPException) as exc:
            await send_chat(
                chat_id=str(chat.id),
                patient_uuid=patient_uuid,
                db=mock_db,
            )
        assert exc.value.status_code == 409
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
python -m pytest tests/test_diary_portal.py -v
```
Expected: `ImportError: No module named 'api.diary_portal'`

- [ ] **Step 3: Create `backend/api/diary_portal.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update, func
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field, field_validator
import jwt
import uuid
from typing import Optional
from datetime import datetime, timezone

from database import get_db, DiaryChat, DiaryMessage
from config import settings
from crypto import encrypt, decrypt_if_set

router = APIRouter(tags=["diary"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/patient/login")

UTC = timezone.utc
_MAX_TITLE_LEN = 100
_MAX_BODY_LEN = 2000
_MAX_MESSAGES_PER_CHAT = 50
_MAX_DRAFT_CHATS = 20


async def get_current_patient(token: str = Depends(oauth2_scheme)) -> uuid.UUID:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o sesión expirada",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("role") != "patient" or not payload.get("patient_id"):
            raise exc
        return uuid.UUID(payload["patient_id"])
    except Exception:
        raise exc


async def _get_owned_chat(chat_id: str, patient_uuid: uuid.UUID, db: AsyncSession) -> DiaryChat:
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Chat no encontrado")
    chat = await db.get(DiaryChat, chat_uuid)
    if not chat or chat.patient_id != patient_uuid:
        raise HTTPException(status_code=404, detail="Chat no encontrado")
    return chat


def _chat_out(chat: DiaryChat) -> dict:
    return {
        "id": str(chat.id),
        "title": decrypt_if_set(chat.title),
        "privacy": chat.privacy,
        "status": chat.status,
        "emotion": chat.emotion,
        "sent_at": chat.sent_at.isoformat() if chat.sent_at else None,
        "created_at": chat.created_at.isoformat(),
        "updated_at": chat.updated_at.isoformat(),
    }


def _message_out(msg: DiaryMessage) -> dict:
    return {
        "id": str(msg.id),
        "body": decrypt_if_set(msg.body),
        "created_at": msg.created_at.isoformat(),
    }


class CreateChatRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=_MAX_TITLE_LEN)
    privacy: str = Field(default='private')

    @field_validator('privacy')
    @classmethod
    def validate_privacy(cls, v):
        if v not in ('private', 'shared'):
            raise ValueError("privacy debe ser 'private' o 'shared'")
        return v


class AddMessageRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=_MAX_BODY_LEN)
    emotion: Optional[str] = Field(default=None, max_length=30)


class UpdateChatRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=_MAX_TITLE_LEN)
    privacy: Optional[str] = None

    @field_validator('privacy')
    @classmethod
    def validate_privacy(cls, v):
        if v is not None and v not in ('private', 'shared'):
            raise ValueError("privacy debe ser 'private' o 'shared'")
        return v


@router.get("/chats")
async def list_chats(
    page: int = 1,
    patient_uuid: uuid.UUID = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db),
):
    offset = (page - 1) * 20
    result = await db.execute(
        select(DiaryChat)
        .where(DiaryChat.patient_id == patient_uuid)
        .order_by(DiaryChat.created_at.desc())
        .offset(offset)
        .limit(20)
    )
    return [_chat_out(c) for c in result.scalars().all()]


@router.post("/chats", status_code=201)
async def create_chat(
    body: CreateChatRequest,
    patient_uuid: uuid.UUID = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db),
):
    count_result = await db.execute(
        select(func.count(DiaryChat.id))
        .where(DiaryChat.patient_id == patient_uuid, DiaryChat.status == 'draft')
    )
    if count_result.scalar_one() >= _MAX_DRAFT_CHATS:
        raise HTTPException(status_code=422, detail="Límite de 20 chats activos alcanzado")

    chat = DiaryChat(patient_id=patient_uuid, title=encrypt(body.title), privacy=body.privacy)
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return _chat_out(chat)


@router.get("/chats/{chat_id}")
async def get_chat(
    chat_id: str,
    patient_uuid: uuid.UUID = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db),
):
    chat = await _get_owned_chat(chat_id, patient_uuid, db)
    result = await db.execute(
        select(DiaryMessage)
        .where(DiaryMessage.chat_id == chat.id)
        .order_by(DiaryMessage.created_at.asc())
    )
    messages = result.scalars().all()
    return {**_chat_out(chat), "messages": [_message_out(m) for m in messages]}


@router.post("/chats/{chat_id}/messages", status_code=201)
async def add_message(
    chat_id: str,
    body: AddMessageRequest,
    patient_uuid: uuid.UUID = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db),
):
    chat = await _get_owned_chat(chat_id, patient_uuid, db)
    if chat.status == 'sent':
        raise HTTPException(status_code=422, detail="Este chat ya fue enviado")

    count_result = await db.execute(
        select(func.count(DiaryMessage.id)).where(DiaryMessage.chat_id == chat.id)
    )
    if count_result.scalar_one() >= _MAX_MESSAGES_PER_CHAT:
        raise HTTPException(status_code=422, detail="Límite de 50 mensajes por chat alcanzado")

    msg = DiaryMessage(chat_id=chat.id, body=encrypt(body.body))
    db.add(msg)
    if body.emotion:
        chat.emotion = body.emotion
    await db.commit()
    await db.refresh(msg)
    return _message_out(msg)


@router.patch("/chats/{chat_id}")
async def update_chat(
    chat_id: str,
    body: UpdateChatRequest,
    patient_uuid: uuid.UUID = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db),
):
    chat = await _get_owned_chat(chat_id, patient_uuid, db)
    if chat.status == 'sent':
        raise HTTPException(status_code=422, detail="Este chat ya fue enviado")

    if body.title is not None:
        chat.title = encrypt(body.title)
    if body.privacy is not None:
        chat.privacy = body.privacy
    await db.commit()
    await db.refresh(chat)
    return _chat_out(chat)


@router.post("/chats/{chat_id}/send")
async def send_chat(
    chat_id: str,
    patient_uuid: uuid.UUID = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db),
):
    chat = await _get_owned_chat(chat_id, patient_uuid, db)
    result = await db.execute(
        update(DiaryChat)
        .where(DiaryChat.id == chat.id, DiaryChat.status == 'draft')
        .values(status='sent', sent_at=datetime.now(UTC))
        .returning(DiaryChat.id)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=409, detail="Este chat ya fue enviado")
    await db.commit()
    await db.refresh(chat)
    return _chat_out(chat)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend
python -m pytest tests/test_diary_portal.py -v
```
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/api/diary_portal.py backend/tests/test_diary_portal.py
git commit -m "feat(diary): patient diary endpoints (6 routes with ownership + encryption)"
```

---

## Task 3: Register Diary Router in main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add import and router registration**

In `backend/main.py`, add after the `from api.patient_portal import router as patient_portal_router` import line:

```python
from api.diary_portal import router as diary_portal_router
```

Then add after the `app.include_router(patient_portal_router, ...)` line:

```python
app.include_router(diary_portal_router, prefix="/api/v1/portal/diary", tags=["diary"])
```

- [ ] **Step 2: Verify the app starts without errors**

```bash
cd backend
python -c "from main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(diary): register diary_portal router at /api/v1/portal/diary"
```

---

## Task 4: Psychologist Diary Summary Endpoints

**Files:**
- Modify: `backend/api/routes.py`
- Test: `backend/tests/test_diary_routes.py` (new)

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_diary_routes.py`:

```python
"""Tests for psychologist diary summary endpoints."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone

UTC = timezone.utc


def _make_patient(psychologist_id):
    p = MagicMock()
    p.id = uuid.uuid4()
    p.psychologist_id = psychologist_id
    p.deleted_at = None
    return p


def _make_summary(patient_id):
    s = MagicMock()
    s.id = uuid.uuid4()
    s.patient_id = patient_id
    s.slot_id = uuid.uuid4()
    s.summary_text = "v1:encrypted_summary"
    s.source_chat_ids = [uuid.uuid4(), uuid.uuid4()]
    s.generated_at = datetime.now(UTC)
    return s


class TestListDiarySummaries:
    @pytest.mark.asyncio
    async def test_returns_summaries_for_owned_patient(self, mock_db, fake_psychologist):
        patient = _make_patient(fake_psychologist.id)
        summary = _make_summary(patient.id)

        mock_db.get = AsyncMock(return_value=patient)
        scalars_mock = MagicMock()
        scalars_mock.all.return_value = [summary]
        exec_result = MagicMock()
        exec_result.scalars.return_value = scalars_mock
        mock_db.execute = AsyncMock(return_value=exec_result)

        from api.routes import list_diary_summaries
        with __import__('unittest.mock', fromlist=['patch']).patch(
            'api.routes.decrypt_if_set', return_value='texto claro'
        ):
            result = await list_diary_summaries(
                patient_id=str(patient.id),
                psychologist=fake_psychologist,
                db=mock_db,
            )
        assert len(result) == 1
        assert result[0]["summary_text"] == "texto claro"

    @pytest.mark.asyncio
    async def test_raises_404_for_unowned_patient(self, mock_db, fake_psychologist):
        patient = _make_patient(uuid.uuid4())  # different psychologist
        mock_db.get = AsyncMock(return_value=patient)

        from api.routes import list_diary_summaries
        from exceptions import UnauthorizedAccessError
        with pytest.raises((UnauthorizedAccessError, Exception)):
            await list_diary_summaries(
                patient_id=str(patient.id),
                psychologist=fake_psychologist,
                db=mock_db,
            )
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
python -m pytest tests/test_diary_routes.py -v
```
Expected: `ImportError: cannot import name 'list_diary_summaries' from 'api.routes'`

- [ ] **Step 3: Add imports and endpoints to `backend/api/routes.py`**

At the top of `routes.py`, the import from `database` already covers most models. Add `DiarySummary` and `AvailabilitySlot` imports if not present:

```python
from database import (
    get_db, Patient, Session, ClinicalNote, PatientProfile, Psychologist,
    AsyncSessionLocal, NoteTemplate, PatientUser, PatientSummary, JobQueue,
    DiarySummary, AvailabilitySlot,
)
```

Also add `timedelta` to the `datetime` import:

```python
from datetime import date, datetime, timezone, timedelta
```

Then add the two endpoints after the existing patient endpoints (search for a suitable location, e.g., after `/patients/{patient_id}/summaries` routes):

```python
@router.get("/patients/{patient_id}/diary-summaries")
async def list_diary_summaries(
    patient_id: str,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    patient = await _get_owned_patient(db, psychologist.id, patient_id)
    result = await db.execute(
        select(DiarySummary)
        .where(DiarySummary.patient_id == patient.id)
        .order_by(DiarySummary.generated_at.desc())
    )
    summaries = result.scalars().all()
    return [
        {
            "id": str(s.id),
            "slot_id": str(s.slot_id),
            "summary_text": decrypt_if_set(s.summary_text),
            "source_chat_count": len(s.source_chat_ids),
            "generated_at": s.generated_at.isoformat(),
        }
        for s in summaries
    ]


@router.get("/patients/{patient_id}/diary-summaries/upcoming")
async def get_upcoming_diary_summary(
    patient_id: str,
    psychologist: Psychologist = Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db_with_user),
):
    patient = await _get_owned_patient(db, psychologist.id, patient_id)

    slot_result = await db.execute(
        select(AvailabilitySlot)
        .where(
            AvailabilitySlot.booked_by_patient_id == patient.id,
            AvailabilitySlot.status == 'booked',
        )
        .order_by(AvailabilitySlot.slot_date.asc(), AvailabilitySlot.start_time.asc())
        .limit(1)
    )
    slot = slot_result.scalar_one_or_none()
    if not slot:
        return None

    summary_result = await db.execute(
        select(DiarySummary).where(DiarySummary.slot_id == slot.id)
    )
    summary = summary_result.scalar_one_or_none()
    if not summary:
        return None

    return {
        "id": str(summary.id),
        "slot_id": str(summary.slot_id),
        "summary_text": decrypt_if_set(summary.summary_text),
        "source_chat_count": len(summary.source_chat_ids),
        "generated_at": summary.generated_at.isoformat(),
        "session_date": slot.slot_date.isoformat(),
        "session_time": slot.start_time.strftime("%H:%M"),
    }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend
python -m pytest tests/test_diary_routes.py -v
```
Expected: all 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/api/routes.py backend/tests/test_diary_routes.py
git commit -m "feat(diary): psychologist endpoints for diary summaries (list + upcoming)"
```

---

## Task 5: Cron — AI Summary Generation

**Files:**
- Modify: `backend/api/cron.py`
- Create: `backend/tests/test_diary_cron.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_diary_cron.py`:

```python
"""Tests for diary summary cron generation helper."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta

UTC = timezone.utc


def _make_slot(patient_id, hours_from_now=24):
    from datetime import date, time, timedelta
    now = datetime.now(UTC)
    target = now + timedelta(hours=hours_from_now)
    slot = MagicMock()
    slot.id = uuid.uuid4()
    slot.booked_by_patient_id = patient_id
    slot.status = 'booked'
    slot.slot_date = target.date()
    slot.start_time = target.time()
    return slot


def _make_chat(patient_id, privacy='shared', status='sent'):
    chat = MagicMock()
    chat.id = uuid.uuid4()
    chat.patient_id = patient_id
    chat.privacy = privacy
    chat.status = status
    chat.emotion = 'Calma'
    chat.sent_at = datetime.now(UTC)
    return chat


def _make_message(chat_id, body_encrypted="v1:enc_body"):
    msg = MagicMock()
    msg.id = uuid.uuid4()
    msg.chat_id = chat_id
    msg.body = body_encrypted
    msg.created_at = datetime.now(UTC)
    return msg


def _make_patient():
    p = MagicMock()
    p.id = uuid.uuid4()
    return p


class TestGenerateDiarySummaries:
    @pytest.mark.asyncio
    async def test_skips_slot_with_existing_summary(self, mock_db):
        patient = _make_patient()
        slot = _make_slot(patient.id)
        now = datetime.now(UTC)

        # Simulate: existing summary found
        existing_summary = MagicMock()
        slots_result = MagicMock()
        slots_result.all.return_value = [(slot, patient)]
        summary_result = MagicMock()
        summary_result.scalar_one_or_none.return_value = existing_summary  # already exists

        mock_db.execute = AsyncMock(side_effect=[slots_result, summary_result])

        from api.cron import _generate_diary_summaries
        count = await _generate_diary_summaries(mock_db, now)
        assert count == 0  # nothing generated

    @pytest.mark.asyncio
    async def test_skips_slot_with_no_shared_chats(self, mock_db):
        patient = _make_patient()
        slot = _make_slot(patient.id)
        now = datetime.now(UTC)

        slots_result = MagicMock()
        slots_result.all.return_value = [(slot, patient)]
        no_summary = MagicMock()
        no_summary.scalar_one_or_none.return_value = None
        no_chats = MagicMock()
        no_chats.scalars.return_value.all.return_value = []

        mock_db.execute = AsyncMock(side_effect=[slots_result, no_summary, no_chats])

        from api.cron import _generate_diary_summaries
        count = await _generate_diary_summaries(mock_db, now)
        assert count == 0

    @pytest.mark.asyncio
    async def test_generates_and_saves_summary(self, mock_db, monkeypatch):
        from cryptography.fernet import Fernet
        import config as _config
        monkeypatch.setattr(_config.settings, "ENCRYPTION_KEY", Fernet.generate_key().decode())

        patient = _make_patient()
        slot = _make_slot(patient.id)
        chat = _make_chat(patient.id)
        msg = _make_message(chat.id)
        now = datetime.now(UTC)

        slots_result = MagicMock()
        slots_result.all.return_value = [(slot, patient)]
        no_summary = MagicMock()
        no_summary.scalar_one_or_none.return_value = None
        chats_result = MagicMock()
        chats_result.scalars.return_value.all.return_value = [chat]
        msgs_result = MagicMock()
        msgs_result.scalars.return_value.all.return_value = [msg]

        mock_db.execute = AsyncMock(side_effect=[slots_result, no_summary, chats_result, msgs_result])
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()

        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="El paciente mencionó sentirse tranquilo esta semana.")]

        with patch("api.cron.AsyncAnthropic") as mock_client_cls, \
             patch("api.cron.decrypt_if_set", return_value="texto del mensaje"):
            mock_client = MagicMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            from api.cron import _generate_diary_summaries
            count = await _generate_diary_summaries(mock_db, now)

        assert count == 1
        mock_db.add.assert_called_once()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
python -m pytest tests/test_diary_cron.py -v
```
Expected: `ImportError: cannot import name '_generate_diary_summaries' from 'api.cron'`

- [ ] **Step 3: Update `backend/api/cron.py`**

Replace the full file content with:

```python
import logging
import os
from datetime import datetime, timedelta, timezone, date
from fastapi import APIRouter, Depends, HTTPException, Request
from anthropic import AsyncAnthropic
from database import get_db, Subscription, Psychologist, AvailabilitySlot, Patient, DiaryChat, DiaryMessage, DiarySummary
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import and_, text
from config import settings
from crypto import encrypt, decrypt_if_set

router = APIRouter()
UTC = timezone.utc
logger = logging.getLogger(__name__)

_SUMMARY_PROMPT_TEMPLATE = """Eres un asistente clínico. A continuación se presentan las entradas de diario que un paciente compartió con su psicólogo esta semana.

Tu tarea: escribe UN párrafo conciso (máximo 5 oraciones) que resuma los temas, emociones y eventos que el paciente MENCIONÓ EXPLÍCITAMENTE.

Reglas estrictas:
- Usa SOLO la información presente en las entradas. No interpretes, no inferas, no agregues contexto clínico propio.
- Si el paciente mencionó algo específico (una persona, un evento, una técnica), inclúyelo con sus palabras.
- No uses lenguaje clínico que el paciente no usó.
- No hagas recomendaciones ni juicios.

Entradas del paciente:
{entries}"""


async def _generate_diary_summaries(db: AsyncSession, now: datetime) -> int:
    """Generate AI diary summaries for sessions in the 20-28 h window. Returns count generated."""
    window_start = now + timedelta(hours=20)
    window_end = now + timedelta(hours=28)

    slots_result = await db.execute(
        select(AvailabilitySlot, Patient)
        .join(Patient, AvailabilitySlot.booked_by_patient_id == Patient.id)
        .where(
            AvailabilitySlot.status == 'booked',
            AvailabilitySlot.slot_date.in_([window_start.date(), window_end.date()]),
        )
    )
    slots_and_patients = slots_result.all()

    generated = 0
    for slot, patient in slots_and_patients:
        slot_dt = datetime.combine(slot.slot_date, slot.start_time).replace(tzinfo=UTC)
        if not (window_start <= slot_dt <= window_end):
            continue

        existing = await db.execute(
            select(DiarySummary).where(DiarySummary.slot_id == slot.id)
        )
        if existing.scalar_one_or_none():
            continue

        chats_result = await db.execute(
            select(DiaryChat)
            .where(
                DiaryChat.patient_id == patient.id,
                DiaryChat.status == 'sent',
                DiaryChat.privacy == 'shared',
            )
            .order_by(DiaryChat.sent_at.asc())
        )
        chats = chats_result.scalars().all()
        if not chats:
            continue

        entries_lines = []
        for i, chat in enumerate(chats, 1):
            msgs_result = await db.execute(
                select(DiaryMessage)
                .where(DiaryMessage.chat_id == chat.id)
                .order_by(DiaryMessage.created_at.asc())
            )
            messages = msgs_result.scalars().all()
            if not messages:
                continue
            date_str = chat.sent_at.strftime("%d/%m/%Y") if chat.sent_at else "?"
            emotion_str = chat.emotion or ""
            bodies = " ".join(decrypt_if_set(m.body) or "" for m in messages)
            entries_lines.append(f"{i}. [{date_str}] [{emotion_str}]: {bodies}")

        if not entries_lines:
            continue

        prompt = _SUMMARY_PROMPT_TEMPLATE.format(entries="\n".join(entries_lines))
        try:
            client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
            response = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            summary_text = response.content[0].text.strip()
        except Exception as e:
            logger.warning("Failed to generate diary summary for slot %s: %s", slot.id, e)
            continue

        db.add(DiarySummary(
            patient_id=patient.id,
            slot_id=slot.id,
            summary_text=encrypt(summary_text),
            source_chat_ids=[chat.id for chat in chats],
        ))
        await db.commit()
        generated += 1

    return generated


@router.get("/daily")
async def daily_cron(request: Request, db: AsyncSession = Depends(get_db)):
    auth_header = request.headers.get("Authorization")
    cron_secret = settings.INTERNAL_API_KEY

    if not cron_secret or auth_header != f"Bearer {cron_secret}":
        raise HTTPException(status_code=401, detail="No autorizado")

    now = datetime.now(UTC)
    warning_date = now + timedelta(days=2)

    query = select(Subscription, Psychologist).join(
        Psychologist, Subscription.psychologist_id == Psychologist.id
    ).where(
        and_(
            Subscription.status == 'trialing',
            Subscription.trial_end != None,
            Subscription.trial_end > now,
            Subscription.trial_end <= warning_date,
        )
    )
    result = await db.execute(query)
    records = result.all()

    emails_sent = 0
    from services.email import send_trial_ending_email
    for sub, psy in records:
        if await send_trial_ending_email(psy.email):
            emails_sent += 1

    from database import JobQueue
    from sqlalchemy import delete
    seven_days_ago = now - timedelta(days=7)
    await db.execute(
        delete(JobQueue).where(
            JobQueue.status.in_(["completed", "failed"]),
            JobQueue.updated_at < seven_days_ago,
        )
    )

    diary_summaries_generated = await _generate_diary_summaries(db, now)
    await db.commit()

    return {
        "status": "ok",
        "emails_sent": emails_sent,
        "jobs_cleaned": True,
        "diary_summaries_generated": diary_summaries_generated,
    }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend
python -m pytest tests/test_diary_cron.py -v
```
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/api/cron.py backend/tests/test_diary_cron.py
git commit -m "feat(diary): daily cron generates AI summaries 24h before sessions"
```

---

## Task 6: Frontend API Call Functions

**Files:**
- Modify: `frontend/src/patientApi.js`
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Add diary functions to `patientApi.js`**

Append to the end of `frontend/src/patientApi.js`:

```js
// --- Diary ---

export async function getDiaryChats(page = 1) {
  return patientFetch(`/portal/diary/chats?page=${page}`)
}

export async function createDiaryChat(title, privacy = 'private') {
  return patientFetch('/portal/diary/chats', {
    method: 'POST',
    body: JSON.stringify({ title, privacy }),
  })
}

export async function getDiaryChat(chatId) {
  return patientFetch(`/portal/diary/chats/${chatId}`)
}

export async function addDiaryMessage(chatId, body, emotion = null) {
  return patientFetch(`/portal/diary/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body, emotion }),
  })
}

export async function updateDiaryChat(chatId, fields) {
  return patientFetch(`/portal/diary/chats/${chatId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export async function sendDiaryChat(chatId) {
  return patientFetch(`/portal/diary/chats/${chatId}/send`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
```

- [ ] **Step 2: Add diary summary functions to `api.js`**

Append to the end of `frontend/src/api.js`:

```js
// --- Diary (psychologist) ---

export async function getPatientDiarySummaries(patientId) {
  return _authFetch(`${API_BASE}/patients/${patientId}/diary-summaries`)
}

export async function getPatientUpcomingDiarySummary(patientId) {
  return _authFetch(`${API_BASE}/patients/${patientId}/diary-summaries/upcoming`)
}
```

- [ ] **Step 3: Write tests for patientApi diary functions**

In `frontend/src/patientApi.test.js`, append:

```js
import {
  getDiaryChats,
  createDiaryChat,
  addDiaryMessage,
  sendDiaryChat,
} from './patientApi'

describe('diary API functions', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch')
    localStorage.setItem('patient_token', 'test-token')
  })
  afterEach(() => vi.restoreAllMocks())

  it('getDiaryChats calls correct URL', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] })
    await getDiaryChats()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/portal/diary/chats?page=1'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
    )
  })

  it('createDiaryChat sends title and privacy', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: '1' }) })
    await createDiaryChat('Mi diario', 'private')
    const call = fetch.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.title).toBe('Mi diario')
    expect(body.privacy).toBe('private')
  })

  it('sendDiaryChat sends POST to /send', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'sent' }) })
    await sendDiaryChat('chat-id-123')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/portal/diary/chats/chat-id-123/send'),
      expect.objectContaining({ method: 'POST' })
    )
  })
})
```

- [ ] **Step 4: Run frontend tests**

```bash
cd frontend
npm test -- --reporter=verbose patientApi
```
Expected: new diary tests PASS (alongside existing tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/patientApi.js frontend/src/api.js frontend/src/patientApi.test.js
git commit -m "feat(diary): add diary API call functions (patient + psychologist)"
```

---

## Task 7: DiaryShareModal Component

**Files:**
- Create: `frontend/src/components/DiaryShareModal.jsx`
- Create: `frontend/src/components/DiaryShareModal.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/DiaryShareModal.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DiaryShareModal from './DiaryShareModal'

describe('DiaryShareModal', () => {
  it('renders the confirmation title', () => {
    render(<DiaryShareModal onConfirm={() => {}} onCancel={() => {}} loading={false} />)
    expect(screen.getByText('¿Compartir con tu psicólogo?')).toBeInTheDocument()
  })

  it('renders the amber warning', () => {
    render(<DiaryShareModal onConfirm={() => {}} onCancel={() => {}} loading={false} />)
    expect(screen.getByText(/Una vez enviado/)).toBeInTheDocument()
  })

  it('calls onConfirm when primary button is clicked', () => {
    const onConfirm = vi.fn()
    render(<DiaryShareModal onConfirm={onConfirm} onCancel={() => {}} loading={false} />)
    fireEvent.click(screen.getByText('Enviar a mi psicólogo'))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<DiaryShareModal onConfirm={() => {}} onCancel={onCancel} loading={false} />)
    fireEvent.click(screen.getByText('Cancelar'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('disables confirm button while loading', () => {
    render(<DiaryShareModal onConfirm={() => {}} onCancel={() => {}} loading={true} />)
    expect(screen.getByText('Enviando...')).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend
npm test -- DiaryShareModal
```
Expected: `Cannot find module './DiaryShareModal'`

- [ ] **Step 3: Create `frontend/src/components/DiaryShareModal.jsx`**

```jsx
export default function DiaryShareModal({ onConfirm, onCancel, loading }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-2xl p-6 pb-8 flex flex-col items-center gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-10 rounded-full bg-[#f0faf7] flex items-center justify-center">
          <svg className="w-5 h-5 text-[#5a9e8a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </div>

        <h2 className="text-[15px] font-semibold text-[#18181b]">¿Compartir con tu psicólogo?</h2>

        <div className="w-full bg-[#fef3e2] border border-[#f0cc8a] rounded-xl px-4 py-3 text-[13px] text-[#9a6630]">
          Una vez enviado no podrás agregar más mensajes a este chat.
        </div>

        <button
          onClick={onConfirm}
          disabled={loading}
          className="w-full bg-[#5a9e8a] hover:bg-[#4a8271] disabled:opacity-60 text-white font-medium text-[14px] py-3 rounded-xl transition-colors"
        >
          {loading ? 'Enviando...' : 'Enviar a mi psicólogo'}
        </button>

        <button
          onClick={onCancel}
          className="w-full border border-[#18181b]/[0.12] text-[#18181b] font-medium text-[14px] py-3 rounded-xl transition-colors hover:bg-[#18181b]/[0.04]"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend
npm test -- DiaryShareModal
```
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DiaryShareModal.jsx frontend/src/components/DiaryShareModal.test.jsx
git commit -m "feat(diary): DiaryShareModal confirmation bottom sheet"
```

---

## Task 8: DiaryChatList Component (Drawer)

**Files:**
- Create: `frontend/src/components/DiaryChatList.jsx`
- Create: `frontend/src/components/DiaryChatList.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/DiaryChatList.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DiaryChatList from './DiaryChatList'

const CHATS = [
  { id: '1', title: 'Semana tranquila', privacy: 'private', status: 'draft', created_at: '2026-05-20T10:00:00Z' },
  { id: '2', title: 'Día difícil', privacy: 'shared', status: 'sent', created_at: '2026-05-22T14:00:00Z' },
]

describe('DiaryChatList', () => {
  it('renders all chat titles', () => {
    render(<DiaryChatList chats={CHATS} activeChatId={null} onSelectChat={() => {}} onNewChat={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Semana tranquila')).toBeInTheDocument()
    expect(screen.getByText('Día difícil')).toBeInTheDocument()
  })

  it('shows Solo yo badge for private chat', () => {
    render(<DiaryChatList chats={[CHATS[0]]} activeChatId={null} onSelectChat={() => {}} onNewChat={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/Solo yo/)).toBeInTheDocument()
  })

  it('shows Enviado badge for sent chat', () => {
    render(<DiaryChatList chats={[CHATS[1]]} activeChatId={null} onSelectChat={() => {}} onNewChat={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/Enviado/)).toBeInTheDocument()
  })

  it('calls onSelectChat when a chat row is clicked', () => {
    const onSelect = vi.fn()
    render(<DiaryChatList chats={CHATS} activeChatId={null} onSelectChat={onSelect} onNewChat={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Semana tranquila'))
    expect(onSelect).toHaveBeenCalledWith(CHATS[0])
  })

  it('calls onNewChat when Nuevo chat is clicked', () => {
    const onNew = vi.fn()
    render(<DiaryChatList chats={[]} activeChatId={null} onSelectChat={() => {}} onNewChat={onNew} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Nuevo chat'))
    expect(onNew).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend
npm test -- DiaryChatList
```
Expected: `Cannot find module './DiaryChatList'`

- [ ] **Step 3: Create `frontend/src/components/DiaryChatList.jsx`**

```jsx
export default function DiaryChatList({ chats, activeChatId, onSelectChat, onNewChat, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-72 max-w-[85vw] h-full bg-white flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#18181b]/[0.07]">
          <span className="font-semibold text-[14px] text-[#18181b]">Mis diarios</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#18181b]/[0.06] text-[#9ca3af]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-3 pt-3 pb-2">
          <button
            onClick={onNewChat}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[#5a9e8a] text-white text-[13px] font-medium"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Nuevo chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-1 flex flex-col gap-1">
          {chats.map(chat => {
            const isActive = chat.id === activeChatId
            const isSent = chat.status === 'sent'
            const isShared = chat.privacy === 'shared' || isSent
            return (
              <button
                key={chat.id}
                onClick={() => { onSelectChat(chat); onClose(); }}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                  isActive
                    ? 'bg-[#5a9e8a]/[0.12] border border-[#5a9e8a]/[0.3]'
                    : isShared
                    ? 'bg-[#f0faf7] hover:bg-[#e6f5f1]'
                    : 'bg-[#f4f4f2] hover:bg-[#eeeeec]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-medium text-[#18181b] truncate flex-1">{chat.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md flex-shrink-0 whitespace-nowrap ${
                    isSent
                      ? 'bg-[#e6f5f1] text-[#3d7a65]'
                      : isShared
                      ? 'bg-[#f0faf7] border border-[#b3d9ce] text-[#3d7a65]'
                      : 'bg-[#fef3e2] border border-[#f0cc8a] text-[#9a6630]'
                  }`}>
                    {isSent ? '✓ Enviado' : isShared ? '👁 Mi psicólogo' : '🔒 Solo yo'}
                  </span>
                </div>
                <div className="text-[11px] text-[#9ca3af] mt-0.5">
                  {new Date(chat.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                </div>
              </button>
            )
          })}
          {chats.length === 0 && (
            <div className="text-center py-10 text-[13px] text-[#9ca3af]">
              No tienes diarios aún
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend
npm test -- DiaryChatList
```
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DiaryChatList.jsx frontend/src/components/DiaryChatList.test.jsx
git commit -m "feat(diary): DiaryChatList drawer with privacy badges"
```

---

## Task 9: DiaryChat Component

**Files:**
- Create: `frontend/src/components/DiaryChat.jsx`
- Create: `frontend/src/components/DiaryChat.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/DiaryChat.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DiaryChat from './DiaryChat'

const BASE_CHAT = {
  id: 'chat-1',
  title: 'Mi semana',
  privacy: 'private',
  status: 'draft',
  emotion: null,
  sent_at: null,
}

describe('DiaryChat', () => {
  it('renders the chat title', () => {
    render(
      <DiaryChat
        chat={BASE_CHAT}
        messages={[]}
        onSend={() => {}}
        onAddMessage={() => {}}
        onUpdatePrivacy={() => {}}
        onOpenDrawer={() => {}}
      />
    )
    expect(screen.getByText('Mi semana')).toBeInTheDocument()
  })

  it('shows Solo yo badge by default', () => {
    render(
      <DiaryChat
        chat={BASE_CHAT}
        messages={[]}
        onSend={() => {}}
        onAddMessage={() => {}}
        onUpdatePrivacy={() => {}}
        onOpenDrawer={() => {}}
      />
    )
    expect(screen.getByText(/Solo yo/)).toBeInTheDocument()
  })

  it('send button is disabled when privacy is private', () => {
    render(
      <DiaryChat
        chat={BASE_CHAT}
        messages={[{ id: 'm1', body: 'Hola', created_at: '2026-05-20T10:00:00Z' }]}
        onSend={() => {}}
        onAddMessage={() => {}}
        onUpdatePrivacy={() => {}}
        onOpenDrawer={() => {}}
      />
    )
    const btn = screen.getByTitle(/Cambia la privacidad/)
    expect(btn).toBeDisabled()
  })

  it('send button is active when privacy is shared and has messages', () => {
    render(
      <DiaryChat
        chat={{ ...BASE_CHAT, privacy: 'shared' }}
        messages={[{ id: 'm1', body: 'Hola', created_at: '2026-05-20T10:00:00Z' }]}
        onSend={() => {}}
        onAddMessage={() => {}}
        onUpdatePrivacy={() => {}}
        onOpenDrawer={() => {}}
      />
    )
    const btn = screen.getByTitle('Enviar al psicólogo')
    expect(btn).not.toBeDisabled()
  })

  it('shows emotion chips', () => {
    render(
      <DiaryChat
        chat={BASE_CHAT}
        messages={[]}
        onSend={() => {}}
        onAddMessage={() => {}}
        onUpdatePrivacy={() => {}}
        onOpenDrawer={() => {}}
      />
    )
    expect(screen.getByText('Alegría')).toBeInTheDocument()
    expect(screen.getByText('Tristeza')).toBeInTheDocument()
  })

  it('shows sent banner when status is sent', () => {
    const sentChat = {
      ...BASE_CHAT,
      status: 'sent',
      privacy: 'shared',
      sent_at: '2026-05-20T10:00:00Z',
    }
    render(
      <DiaryChat
        chat={sentChat}
        messages={[]}
        onSend={() => {}}
        onAddMessage={() => {}}
        onUpdatePrivacy={() => {}}
        onOpenDrawer={() => {}}
      />
    )
    expect(screen.getByText(/Enviado a tu psicólogo/)).toBeInTheDocument()
  })

  it('hides composer when status is sent', () => {
    const sentChat = { ...BASE_CHAT, status: 'sent', sent_at: '2026-05-20T10:00:00Z' }
    render(
      <DiaryChat
        chat={sentChat}
        messages={[]}
        onSend={() => {}}
        onAddMessage={() => {}}
        onUpdatePrivacy={() => {}}
        onOpenDrawer={() => {}}
      />
    )
    expect(screen.queryByPlaceholderText('Escribe un momento…')).not.toBeInTheDocument()
  })

  it('calls onOpenDrawer when hamburger is clicked', () => {
    const onDrawer = vi.fn()
    render(
      <DiaryChat
        chat={BASE_CHAT}
        messages={[]}
        onSend={() => {}}
        onAddMessage={() => {}}
        onUpdatePrivacy={() => {}}
        onOpenDrawer={onDrawer}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /abrir lista/i }))
    expect(onDrawer).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend
npm test -- DiaryChat.test
```
Expected: `Cannot find module './DiaryChat'`

- [ ] **Step 3: Create `frontend/src/components/DiaryChat.jsx`**

```jsx
import { useState, useRef, useEffect } from 'react'
import DiaryShareModal from './DiaryShareModal'

const EMOTIONS = ['Alegría', 'Calma', 'Tristeza', 'Angustia', 'Miedo', 'Enojo']

function groupByDay(messages) {
  return messages.reduce((groups, msg) => {
    const day = new Date(msg.created_at).toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'short',
    })
    if (!groups[day]) groups[day] = []
    groups[day].push(msg)
    return groups
  }, {})
}

export default function DiaryChat({ chat, messages: initialMessages, onSend, onAddMessage, onUpdatePrivacy, onOpenDrawer }) {
  const [messages, setMessages] = useState(initialMessages || [])
  const [inputText, setInputText] = useState('')
  const [selectedEmotion, setSelectedEmotion] = useState(chat.emotion || null)
  const [showModal, setShowModal] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [sendingToDoctor, setSendingToDoctor] = useState(false)
  const [localPrivacy, setLocalPrivacy] = useState(chat.privacy)
  const [localStatus, setLocalStatus] = useState(chat.status)
  const [localSentAt, setLocalSentAt] = useState(chat.sent_at)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    setMessages(initialMessages || [])
    setLocalPrivacy(chat.privacy)
    setLocalStatus(chat.status)
    setLocalSentAt(chat.sent_at)
    setSelectedEmotion(chat.emotion || null)
  }, [chat.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const isSent = localStatus === 'sent'
  const canSendToDoctor = localPrivacy === 'shared' && messages.length > 0 && !isSent

  const handleSubmitMessage = async () => {
    const body = inputText.trim()
    if (!body || isSent || sendingMessage) return
    setSendingMessage(true)
    try {
      const newMsg = await onAddMessage(chat.id, body, selectedEmotion)
      setMessages(prev => [...prev, newMsg])
      setInputText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } finally {
      setSendingMessage(false)
    }
  }

  const handleConfirmSend = async () => {
    setSendingToDoctor(true)
    try {
      const updated = await onSend(chat.id)
      setLocalStatus(updated.status)
      setLocalSentAt(updated.sent_at)
      setShowModal(false)
    } finally {
      setSendingToDoctor(false)
    }
  }

  const handleTogglePrivacy = () => {
    if (isSent) return
    const next = localPrivacy === 'private' ? 'shared' : 'private'
    setLocalPrivacy(next)
    onUpdatePrivacy(chat.id, next)
  }

  const privacyBadge = isSent
    ? { label: '✓ Enviado', style: 'bg-[#e6f5f1] text-[#3d7a65] cursor-default' }
    : localPrivacy === 'shared'
    ? { label: '👁 Mi psicólogo', style: 'bg-[#f0faf7] border border-[#b3d9ce] text-[#3d7a65] cursor-pointer hover:bg-[#e6f5f1]' }
    : { label: '🔒 Solo yo', style: 'bg-[#fef3e2] border border-[#f0cc8a] text-[#9a6630] cursor-pointer hover:bg-[#fde9c5]' }

  const bubbleColor = localPrivacy === 'shared'
    ? 'bg-[rgba(90,158,138,0.12)]'
    : 'bg-[#f4f4f2]'

  const grouped = groupByDay(messages)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 h-[52px] flex items-center gap-3 px-4 border-b border-[#18181b]/[0.07] bg-white">
        <button
          onClick={onOpenDrawer}
          aria-label="Abrir lista de diarios"
          className="p-1.5 rounded-lg hover:bg-[#18181b]/[0.06] text-[#9ca3af]"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="flex-1 text-[14px] font-medium text-[#18181b] truncate">{chat.title}</span>
        <button
          onClick={handleTogglePrivacy}
          className={`text-[11px] px-2 py-1 rounded-lg font-medium flex-shrink-0 transition-colors ${privacyBadge.style}`}
        >
          {privacyBadge.label}
        </button>
      </div>

      {/* Sent info banner */}
      {isSent && localSentAt && (
        <div className="flex-shrink-0 bg-[#f0faf7] border-b border-[#b3d9ce]/60 px-4 py-2 text-[12px] text-[#3d7a65]">
          Enviado a tu psicólogo · {new Date(localSentAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto pt-4 pb-2 pl-8 pr-4">
        {Object.entries(grouped).map(([day, dayMsgs]) => (
          <div key={day}>
            <div className="text-center text-[10px] text-[#9ca3af] uppercase tracking-wide my-3">{day}</div>
            {dayMsgs.map(msg => (
              <div key={msg.id} className="flex justify-end mb-2">
                <div className={`max-w-[88%] px-3 py-2 rounded-2xl ${bubbleColor} ${isSent ? 'opacity-70' : ''}`}>
                  <p className="text-[13px] text-[#18181b] whitespace-pre-wrap">{msg.body}</p>
                  <p className="text-[10px] text-[#9ca3af] mt-1 text-right">
                    {new Date(msg.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ))}
        {messages.length === 0 && !isSent && (
          <div className="text-center py-12 text-[13px] text-[#9ca3af]">
            Escribe tu primer momento del día
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Emotion chips + composer (hidden when sent) */}
      {!isSent && (
        <>
          <div className="flex-shrink-0 px-4 pb-2 pt-2 flex gap-1.5 flex-wrap border-t border-[#18181b]/[0.05]">
            {EMOTIONS.map((emotion, i) => (
              <button
                key={emotion}
                onClick={() => setSelectedEmotion(prev => prev === emotion ? null : emotion)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  selectedEmotion === emotion
                    ? 'bg-[#5a9e8a] border-[#5a9e8a] text-white'
                    : i % 2 === 0
                    ? 'bg-[#f0faf7] border-[#b3d9ce] text-[#3d7a65]'
                    : 'bg-[#fef3e2] border-[#f0cc8a] text-[#9a6630]'
                }`}
              >
                {emotion}
              </button>
            ))}
          </div>

          <div className="flex-shrink-0 px-4 pb-4 pt-1 flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={e => {
                setInputText(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px'
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmitMessage()
                }
              }}
              placeholder="Escribe un momento…"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-[#18181b]/[0.12] px-3 py-2.5 text-[13px] text-[#18181b] placeholder-[#9ca3af] focus:outline-none focus:ring-1 focus:ring-[#5a9e8a] overflow-y-auto"
              style={{ minHeight: '42px', maxHeight: '96px' }}
            />
            <button
              onClick={() => setShowModal(true)}
              disabled={!canSendToDoctor}
              title={canSendToDoctor ? 'Enviar al psicólogo' : 'Cambia la privacidad a "Mi psicólogo" para enviar'}
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                canSendToDoctor
                  ? 'bg-[#5a9e8a] hover:bg-[#4a8271] text-white'
                  : 'bg-[#e6f5f1] text-[#b3d9ce] cursor-not-allowed'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </>
      )}

      {showModal && (
        <DiaryShareModal
          onConfirm={handleConfirmSend}
          onCancel={() => setShowModal(false)}
          loading={sendingToDoctor}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend
npm test -- DiaryChat.test
```
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DiaryChat.jsx frontend/src/components/DiaryChat.test.jsx
git commit -m "feat(diary): DiaryChat component (bubbles, emotion chips, send confirmation)"
```

---

## Task 10: PatientPortal.jsx — Add Diary Tab

**Files:**
- Modify: `frontend/src/pages/PatientPortal.jsx`

- [ ] **Step 1: Add diary state and imports**

At the top of `PatientPortal.jsx`, add the new imports after existing ones:

```jsx
import DiaryChat from '../components/DiaryChat'
import DiaryChatList from '../components/DiaryChatList'
import {
  getDiaryChats,
  createDiaryChat,
  getDiaryChat,
  addDiaryMessage,
  updateDiaryChat,
  sendDiaryChat,
} from '../patientApi'
```

Inside the component, add new state variables after the existing ones (after `const detailRef = useRef(null)`):

```jsx
const [activeTab, setActiveTab] = useState('sessions') // 'sessions' | 'diary'
const [diaryChats, setDiaryChats] = useState([])
const [activeChat, setActiveChat] = useState(null)
const [activeChatMessages, setActiveChatMessages] = useState([])
const [drawerOpen, setDrawerOpen] = useState(false)
const [diaryLoading, setDiaryLoading] = useState(false)
```

- [ ] **Step 2: Add diary data loader and action handlers**

After the `loadSummaries` function, add:

```jsx
const loadDiaryChats = async () => {
  setDiaryLoading(true)
  try {
    const data = await getDiaryChats()
    setDiaryChats(data)
    if (!activeChat && data.length > 0) {
      await handleSelectChat(data[0])
    }
  } catch (err) {
    // Non-fatal — diary stays empty
  } finally {
    setDiaryLoading(false)
  }
}

const handleSelectChat = async (chat) => {
  try {
    const detail = await getDiaryChat(chat.id)
    setActiveChat(detail)
    setActiveChatMessages(detail.messages || [])
  } catch {
    setActiveChat(chat)
    setActiveChatMessages([])
  }
}

const handleNewChat = async () => {
  const title = `Diario ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}`
  try {
    const newChat = await createDiaryChat(title, 'private')
    setDiaryChats(prev => [newChat, ...prev])
    setActiveChat(newChat)
    setActiveChatMessages([])
  } catch {
    // silently fail — user stays on current chat
  }
}

const handleAddMessage = async (chatId, body, emotion) => {
  const msg = await addDiaryMessage(chatId, body, emotion)
  if (emotion) {
    setActiveChat(prev => ({ ...prev, emotion }))
  }
  return msg
}

const handleUpdatePrivacy = async (chatId, privacy) => {
  try {
    const updated = await updateDiaryChat(chatId, { privacy })
    setActiveChat(updated)
    setDiaryChats(prev => prev.map(c => c.id === chatId ? { ...c, privacy } : c))
  } catch {
    // revert local state if needed
  }
}

const handleSendChat = async (chatId) => {
  const updated = await sendDiaryChat(chatId)
  setActiveChat(updated)
  setDiaryChats(prev => prev.map(c => c.id === chatId ? { ...c, status: 'sent', privacy: updated.privacy } : c))
  return updated
}
```

- [ ] **Step 3: Load diary chats when Diary tab is opened**

Add a `useEffect` to load diary chats when the tab switches:

```jsx
useEffect(() => {
  if (activeTab === 'diary' && diaryChats.length === 0) {
    loadDiaryChats()
  }
}, [activeTab])
```

- [ ] **Step 4: Add bottom tab nav and conditional content**

In the `return` JSX, wrap the existing `<main>` content with a tab condition:

1. Add the bottom tab bar inside the outer `div` (before the closing tag of the root div), just before the closing `</div>`:

```jsx
{/* Bottom tab navigation */}
<nav className="fixed bottom-0 left-0 right-0 flex border-t border-[#18181b]/[0.07] bg-white z-20">
  {[
    {
      id: 'diary',
      label: 'Diario',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
    },
    {
      id: 'sessions',
      label: 'Mis sesiones',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
  ].map(tab => (
    <button
      key={tab.id}
      onClick={() => setActiveTab(tab.id)}
      className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
        activeTab === tab.id ? 'text-[#5a9e8a]' : 'text-[#9ca3af] hover:text-[#18181b]'
      }`}
    >
      {tab.icon}
      {tab.label}
    </button>
  ))}
</nav>
```

2. Change `<div className="min-h-screen bg-[#fefaf6] font-sans pb-12">` to `<div className="min-h-screen bg-[#fefaf6] font-sans pb-16">` (extra bottom padding for the fixed nav).

3. Wrap the existing `<main>` block with `{activeTab === 'sessions' && (...)}`

4. Add a new Diary tab content block after the sessions block:

```jsx
{activeTab === 'diary' && (
  <div className="fixed inset-0 top-[57px] bottom-[52px] bg-white flex flex-col overflow-hidden">
    {diaryLoading && (
      <div className="flex-1 flex items-center justify-center text-[#5a9e8a] text-sm">
        Cargando diario...
      </div>
    )}
    {!diaryLoading && !activeChat && (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
        <p className="text-[#9ca3af] text-sm">No tienes ningún diario aún.</p>
        <button
          onClick={handleNewChat}
          className="px-5 py-2.5 rounded-xl bg-[#5a9e8a] text-white text-sm font-medium"
        >
          Crear primer diario
        </button>
      </div>
    )}
    {!diaryLoading && activeChat && (
      <DiaryChat
        chat={activeChat}
        messages={activeChatMessages}
        onSend={handleSendChat}
        onAddMessage={handleAddMessage}
        onUpdatePrivacy={handleUpdatePrivacy}
        onOpenDrawer={() => setDrawerOpen(true)}
      />
    )}
    {drawerOpen && (
      <DiaryChatList
        chats={diaryChats}
        activeChatId={activeChat?.id}
        onSelectChat={handleSelectChat}
        onNewChat={async () => { setDrawerOpen(false); await handleNewChat() }}
        onClose={() => setDrawerOpen(false)}
      />
    )}
  </div>
)}
```

- [ ] **Step 5: Verify the portal compiles without errors**

```bash
cd frontend
npm run build 2>&1 | head -30
```
Expected: build succeeds (no TypeScript/JSX parse errors)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/PatientPortal.jsx
git commit -m "feat(diary): add Diary tab to patient portal with chat interface"
```

---

## Task 11: PatientDetailDiary Component (Psychologist View)

**Files:**
- Create: `frontend/src/components/PatientDetailDiary.jsx`
- Create: `frontend/src/components/PatientDetailDiary.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/PatientDetailDiary.test.jsx`:

```jsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PatientDetailDiary from './PatientDetailDiary'

vi.mock('../api', () => ({
  getPatientUpcomingDiarySummary: vi.fn(),
  getPatientDiarySummaries: vi.fn(),
}))

import { getPatientUpcomingDiarySummary, getPatientDiarySummaries } from '../api'

const UPCOMING = {
  id: 's1',
  summary_text: 'El paciente mencionó sentirse tranquilo esta semana.',
  source_chat_count: 3,
  generated_at: '2026-05-27T09:00:00Z',
  session_date: '2026-05-28',
  session_time: '10:00',
}

const HISTORY = [
  {
    id: 's2',
    summary_text: 'El paciente habló sobre trabajo y familia.',
    source_chat_count: 2,
    generated_at: '2026-05-14T09:00:00Z',
    slot_id: 'slot-2',
  },
]

describe('PatientDetailDiary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading state initially', () => {
    getPatientUpcomingDiarySummary.mockResolvedValue(null)
    getPatientDiarySummaries.mockResolvedValue([])
    render(<PatientDetailDiary patientId="p1" />)
    expect(screen.getByText(/Cargando/i)).toBeInTheDocument()
  })

  it('renders upcoming summary card when available', async () => {
    getPatientUpcomingDiarySummary.mockResolvedValue(UPCOMING)
    getPatientDiarySummaries.mockResolvedValue([])
    render(<PatientDetailDiary patientId="p1" />)
    await waitFor(() => {
      expect(screen.getByText('Resumen de diario')).toBeInTheDocument()
      expect(screen.getByText(UPCOMING.summary_text)).toBeInTheDocument()
    })
  })

  it('does not show summary card when no upcoming summary', async () => {
    getPatientUpcomingDiarySummary.mockResolvedValue(null)
    getPatientDiarySummaries.mockResolvedValue([])
    render(<PatientDetailDiary patientId="p1" />)
    await waitFor(() => {
      expect(screen.queryByText('Resumen de diario')).not.toBeInTheDocument()
    })
  })

  it('renders previous summaries list', async () => {
    getPatientUpcomingDiarySummary.mockResolvedValue(null)
    getPatientDiarySummaries.mockResolvedValue(HISTORY)
    render(<PatientDetailDiary patientId="p1" />)
    await waitFor(() => {
      expect(screen.getByText('Resúmenes anteriores')).toBeInTheDocument()
      expect(screen.getByText(/El paciente habló/)).toBeInTheDocument()
    })
  })

  it('shows empty state when no history', async () => {
    getPatientUpcomingDiarySummary.mockResolvedValue(null)
    getPatientDiarySummaries.mockResolvedValue([])
    render(<PatientDetailDiary patientId="p1" />)
    await waitFor(() => {
      expect(screen.getByText(/Sin entradas compartidas/i)).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend
npm test -- PatientDetailDiary
```
Expected: `Cannot find module './PatientDetailDiary'`

- [ ] **Step 3: Create `frontend/src/components/PatientDetailDiary.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { getPatientUpcomingDiarySummary, getPatientDiarySummaries } from '../api'

export default function PatientDetailDiary({ patientId }) {
  const [loading, setLoading] = useState(true)
  const [upcoming, setUpcoming] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (!patientId) return
    setLoading(true)
    Promise.all([
      getPatientUpcomingDiarySummary(patientId).catch(() => null),
      getPatientDiarySummaries(patientId).catch(() => []),
    ]).then(([upcomingData, historyData]) => {
      setUpcoming(upcomingData)
      setHistory(historyData || [])
    }).finally(() => setLoading(false))
  }, [patientId])

  if (loading) {
    return (
      <div className="px-4 py-6 text-[#9ca3af] text-sm">Cargando diario...</div>
    )
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-5">
      {/* Upcoming summary card */}
      {upcoming && (
        <div className="rounded-2xl border" style={{ borderColor: 'rgba(90,158,138,0.3)', background: '#f0faf7' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'rgba(90,158,138,0.2)' }}>
            <svg className="w-4 h-4 text-[#5a9e8a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span className="text-[13px] font-semibold text-[#3d7a65] flex-1">Resumen de diario</span>
            {upcoming.session_time && (
              <span className="text-[11px] text-[#5a9e8a]">
                Sesión hoy {upcoming.session_time}
              </span>
            )}
          </div>
          <div className="px-4 py-3">
            <p className="text-[13px] text-[#18181b] leading-relaxed">{upcoming.summary_text}</p>
          </div>
          <div className="px-4 pb-3 text-[11px] text-[#5a9e8a]">
            {upcoming.source_chat_count} {upcoming.source_chat_count === 1 ? 'entrada' : 'entradas'} · {
              new Date(upcoming.generated_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
            }
          </div>
        </div>
      )}

      {/* Previous summaries */}
      <div>
        <h3 className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">
          Resúmenes anteriores
        </h3>
        {history.length === 0 ? (
          <div className="bg-[#f4f4f2] rounded-xl px-4 py-4 text-[13px] text-[#9ca3af]">
            Sin entradas compartidas en sesiones anteriores.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map(s => (
              <div key={s.id} className="bg-white border border-[#18181b]/[0.07] rounded-xl px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-[#9ca3af]">
                    {new Date(s.generated_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="text-[11px] text-[#9ca3af]">
                    {s.source_chat_count} {s.source_chat_count === 1 ? 'entrada' : 'entradas'}
                  </span>
                </div>
                <p className="text-[13px] text-[#18181b] line-clamp-2">{s.summary_text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend
npm test -- PatientDetailDiary
```
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PatientDetailDiary.jsx frontend/src/components/PatientDetailDiary.test.jsx
git commit -m "feat(diary): PatientDetailDiary component (upcoming summary + history)"
```

---

## Task 12: App.jsx + BottomNav — 3 Tabs and Psychologist Patients View

**Files:**
- Modify: `frontend/src/components/BottomNav.jsx`
- Modify: `frontend/src/components/BottomNav.test.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Update BottomNav to 3 tabs**

Replace the full content of `frontend/src/components/BottomNav.jsx`:

```jsx
export default function BottomNav({ activeSection, onSectionChange }) {
  const tabs = [
    {
      id: 'patients',
      label: 'Sesiones',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      id: 'agenda',
      label: 'Agenda',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      id: 'diary_patients',
      label: 'Pacientes',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
  ]

  return (
    <div className="flex border-t border-ink/[0.07] bg-white flex-shrink-0">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onSectionChange(tab.id)}
          className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
            activeSection === tab.id
              ? 'text-[#5a9e8a]'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Update BottomNav tests**

Replace the full content of `frontend/src/components/BottomNav.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BottomNav from './BottomNav'

describe('BottomNav', () => {
  it('renders Sesiones, Agenda and Pacientes tabs', () => {
    render(<BottomNav activeSection="patients" onSectionChange={() => {}} />)
    expect(screen.getByText('Sesiones')).toBeInTheDocument()
    expect(screen.getByText('Agenda')).toBeInTheDocument()
    expect(screen.getByText('Pacientes')).toBeInTheDocument()
  })

  it('highlights active section', () => {
    render(<BottomNav activeSection="agenda" onSectionChange={() => {}} />)
    const agendaBtn = screen.getByText('Agenda').closest('button')
    expect(agendaBtn.className).toContain('text-[#5a9e8a]')
  })

  it('calls onSectionChange with patients id when Sesiones is clicked', () => {
    const onChange = vi.fn()
    render(<BottomNav activeSection="agenda" onSectionChange={onChange} />)
    fireEvent.click(screen.getByText('Sesiones').closest('button'))
    expect(onChange).toHaveBeenCalledWith('patients')
  })

  it('calls onSectionChange with diary_patients when Pacientes is clicked', () => {
    const onChange = vi.fn()
    render(<BottomNav activeSection="patients" onSectionChange={onChange} />)
    fireEvent.click(screen.getByText('Pacientes').closest('button'))
    expect(onChange).toHaveBeenCalledWith('diary_patients')
  })
})
```

- [ ] **Step 3: Run BottomNav tests to confirm they pass**

```bash
cd frontend
npm test -- BottomNav
```
Expected: all 4 tests PASS

- [ ] **Step 4: Add Pacientes (diary) section to `App.jsx`**

In `App.jsx`, find the `const [activeSection, setActiveSection] = useState('patients')` line — keep it unchanged (existing 'patients' value still works for Sesiones tab).

Find the import section and add:

```jsx
import PatientDetailDiary from './components/PatientDetailDiary'
```

Find the location where `activeSection === 'patients'` content is rendered (around line 1003 and 1311) and after those blocks add the new `diary_patients` block. Search for the render that has `{activeSection === 'agenda' &&` and add just before it:

```jsx
{activeSection === 'diary_patients' && (
  <div className="flex-1 overflow-y-auto p-4">
    {/* Upcoming sessions section */}
    {patients.filter(p => p.upcoming_slot).length > 0 && (
      <div className="mb-6">
        <h2 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2 px-1">
          Sesión próxima (24h)
        </h2>
        <div className="flex flex-col gap-2">
          {patients
            .filter(p => p.upcoming_slot)
            .map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedDiaryPatient(prev => prev?.id === p.id ? null : p)}
                className="w-full text-left bg-white border border-[#18181b]/[0.07] rounded-xl px-4 py-3 hover:border-[#5a9e8a]/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <span className="text-[13px] font-medium text-[#18181b]">{p.name}</span>
                  </div>
                  {p.has_diary_summary && (
                    <span className="flex items-center gap-1 text-[11px] text-[#3d7a65] bg-[#f0faf7] border border-[#b3d9ce] px-2 py-0.5 rounded-full">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Resumen listo
                    </span>
                  )}
                </div>
              </button>
            ))}
        </div>
      </div>
    )}

    {/* All patients section */}
    <div>
      <h2 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2 px-1">
        Todos los pacientes
      </h2>
      <div className="flex flex-col gap-2">
        {patients.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedDiaryPatient(prev => prev?.id === p.id ? null : p)}
            className={`w-full text-left border rounded-xl px-4 py-3 transition-colors ${
              selectedDiaryPatient?.id === p.id
                ? 'bg-[#f0faf7] border-[#5a9e8a]/40'
                : 'bg-white border-[#18181b]/[0.07] hover:border-[#5a9e8a]/30'
            }`}
          >
            <span className="text-[13px] font-medium text-[#18181b]">{p.name}</span>
          </button>
        ))}
        {patients.length === 0 && (
          <div className="text-center py-8 text-[13px] text-[#9ca3af]">
            No hay pacientes registrados aún.
          </div>
        )}
      </div>
    </div>

    {/* Diary detail panel */}
    {selectedDiaryPatient && (
      <div className="mt-6 border-t border-[#18181b]/[0.07] pt-4">
        <h2 className="text-[13px] font-semibold text-[#18181b] mb-3">
          Diario de {selectedDiaryPatient.name}
        </h2>
        <PatientDetailDiary patientId={selectedDiaryPatient.id} />
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Add `selectedDiaryPatient` state**

Near the top of the App component (alongside other `useState` calls), add:

```jsx
const [selectedDiaryPatient, setSelectedDiaryPatient] = useState(null)
```

- [ ] **Step 6: Verify build succeeds**

```bash
cd frontend
npm run build 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 7: Run all frontend tests**

```bash
cd frontend
npm test
```
Expected: all tests PASS (no regressions)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/BottomNav.jsx frontend/src/components/BottomNav.test.jsx frontend/src/App.jsx
git commit -m "feat(diary): add Pacientes tab to psychologist app with diary summary view"
```

---

## Self-Review Checklist

### Spec coverage
| Spec requirement | Covered by |
|---|---|
| Patient portal: Diary tab + Mis sesiones tab | Task 10 |
| Chat drawer (list with badges) | Task 8 |
| Chat view: header, bubbles, emotion chips, composer | Task 9 |
| Privacy badge toggle (Solo yo / Mi psicólogo) | Task 9 |
| Sent state (read-only, info stripe) | Task 9 |
| Modal de confirmación (avión icon, amber warning) | Task 7 |
| DB tables: diary_chats, diary_messages, diary_summaries | Task 1 |
| Patient endpoints: list, create, get, add message, update, send | Task 2 |
| Ownership verification (OWASP A01) | Task 2 |
| Atomic send (race condition prevention) | Task 2 |
| Input validation limits (title 100, body 2000, 50 msg, 20 drafts) | Task 2 |
| Encryption (title, body, summary_text) | Tasks 2, 5 |
| Psychologist endpoints: list summaries, upcoming | Task 4 |
| Cron: 20-28h window, skip if exists, skip if no chats | Task 5 |
| AI prompt (extractive, anti-hallucination) | Task 5 |
| Cron: log error, don't save partial | Task 5 |
| Psychologist nav: 2 → 3 tabs | Task 12 |
| Psychologist Pacientes tab: patient list | Task 12 |
| PatientDetailDiary: upcoming card + history list | Task 11 |
| "Resumen listo" badge on patient row | Task 12 |
| Privacy rule: only shared+sent chats in summary | Task 5 |

### Gaps addressed
- Task 12 patient list does not implement `has_diary_summary` field on patient objects from the API. This requires the psychologist patients list endpoint to annotate each patient with whether a diary summary exists for their next slot. This is an enhancement over the basic spec — add a note to the `GET /patients` endpoint to include this field if needed, or load it lazily in the frontend via `getPatientUpcomingDiarySummary`. **For MVP**: the frontend in Task 12 uses `p.has_diary_summary` which defaults to falsy if not present — the badge simply won't show. A follow-up task can add this annotation to the patients list endpoint.

---

## Execution

Plan saved. Two execution options:

**1. Subagent-Driven (recommended)** — `superpowers:subagent-driven-development` dispatches a fresh subagent per task with review checkpoints between tasks.

**2. Inline Execution** — `superpowers:executing-plans` executes tasks in this session with batch checkpoints.

Which approach would you like?
