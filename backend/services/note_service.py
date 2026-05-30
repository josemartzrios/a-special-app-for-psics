"""
Note building services — Strategy pattern for clinical note format dispatch.

Each builder receives (sess, note_data, *, psychologist_id, db, session_id) and
returns (ClinicalNote, summary_data). New formats are registered in _NOTE_BUILDERS
without modifying existing builders or the dispatch function.
"""
import logging
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import ClinicalNote, NoteTemplate
from agent.embeddings import get_embedding, ZERO_VECTOR
from crypto import encrypt_if_set, decrypt_if_set

logger = logging.getLogger(__name__)


async def build_custom_note(
    sess,
    note_data: dict,
    *,
    psychologist_id: uuid.UUID,
    db: AsyncSession,
    session_id: str = "",
) -> tuple:
    """Builds a custom-format ClinicalNote. Returns (note, summary_data)."""
    custom_fields_data = note_data.get("custom_fields") or {}
    text_for_embedding = note_data.get("text_fallback", "")
    try:
        embedding = await get_embedding(text_for_embedding) if text_for_embedding else ZERO_VECTOR
    except Exception:
        embedding = ZERO_VECTOR

    tmpl_snapshot = None
    try:
        tmpl_res = await db.execute(
            select(NoteTemplate).where(NoteTemplate.psychologist_id == psychologist_id)
        )
        tmpl = tmpl_res.scalar_one_or_none()
        if tmpl and tmpl.fields:
            tmpl_snapshot = tmpl.fields
    except Exception:
        pass

    # Read before commit — attribute expires after commit
    ai_response_text = decrypt_if_set(sess.ai_response) or ""

    note = ClinicalNote(
        session_id=sess.id,
        format="custom",
        custom_fields=custom_fields_data,
        template_snapshot=tmpl_snapshot,
        detected_patterns=note_data.get("detected_patterns", []),
        alerts=note_data.get("alerts", []),
        suggested_next_steps=note_data.get("suggested_next_steps", []),
        evolution_delta=note_data.get("evolution_delta"),
        embedding=embedding,
    )
    summary_data = {
        "text_fallback": ai_response_text,
        "detected_patterns": note_data.get("detected_patterns", []),
        "alerts": note_data.get("alerts", []),
        "suggested_next_steps": note_data.get("suggested_next_steps", []),
    }
    return note, summary_data


async def build_soap_note(
    sess,
    note_data: dict,
    *,
    psychologist_id: uuid.UUID = None,
    db: AsyncSession = None,
    session_id: str = "",
) -> tuple:
    """Builds a SOAP-format ClinicalNote. Returns (note, summary_data)."""
    structured = note_data.get("structured_note", {})

    # Read before commit — attribute expires after commit
    ai_response_text = decrypt_if_set(sess.ai_response) or ""

    text_to_embed = " ".join([str(v) for v in structured.values() if v])
    try:
        embedding = await get_embedding(text_to_embed)
    except Exception as e:
        logger.warning("Embedding failed for session %s, using zero vector fallback: %s", session_id, e)
        embedding = ZERO_VECTOR

    note = ClinicalNote(
        session_id=sess.id,
        format=note_data.get("format", "SOAP"),
        subjective=encrypt_if_set(structured.get("subjective")),
        objective=encrypt_if_set(structured.get("objective")),
        assessment=encrypt_if_set(structured.get("assessment")),
        plan=encrypt_if_set(structured.get("plan")),
        data_field=encrypt_if_set(structured.get("data_field")),
        detected_patterns=note_data.get("detected_patterns", []),
        alerts=note_data.get("alerts", []),
        suggested_next_steps=note_data.get("suggested_next_steps", []),
        evolution_delta=note_data.get("evolution_delta", {}),
        embedding=embedding,
    )
    summary_data = {
        "text_fallback": ai_response_text,
        "detected_patterns": note_data.get("detected_patterns", []),
        "alerts": note_data.get("alerts", []),
        "suggested_next_steps": note_data.get("suggested_next_steps", []),
    }
    return note, summary_data


_NOTE_BUILDERS = {
    "custom": build_custom_note,
    "soap": build_soap_note,
}


async def build_note(
    sess,
    note_data: dict,
    *,
    psychologist_id: uuid.UUID,
    db: AsyncSession,
    session_id: str = "",
) -> tuple:
    """Dispatches to the appropriate builder by format. Returns (note, summary_data)."""
    note_format = note_data.get("format", "SOAP").lower()
    builder = _NOTE_BUILDERS.get(note_format, build_soap_note)
    return await builder(
        sess, note_data,
        psychologist_id=psychologist_id,
        db=db,
        session_id=session_id,
    )
