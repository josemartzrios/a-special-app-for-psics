"""Unit tests for services/note_service.py — note builder Strategy dispatch."""
import pytest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


class TestBuildSoapNote:
    @pytest.mark.asyncio
    async def test_returns_note_and_summary_data(self):
        from services.note_service import build_soap_note

        sess = MagicMock()
        sess.id = uuid.uuid4()
        sess.ai_response = None

        note_data = {
            "format": "SOAP",
            "structured_note": {
                "subjective": "Paciente refiere ansiedad",
                "objective": "Afecto aplanado",
                "assessment": "TAG",
                "plan": "Continuar TCC",
            },
        }

        with patch("services.note_service.get_embedding", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [0.1] * 1536
            note, summary_data = await build_soap_note(sess, note_data, session_id="test-id")

        assert note is not None
        assert note.format == "SOAP"
        assert "text_fallback" in summary_data
        assert "detected_patterns" in summary_data

    @pytest.mark.asyncio
    async def test_uses_zero_vector_on_embedding_failure(self):
        from services.note_service import build_soap_note
        from agent.embeddings import ZERO_VECTOR

        sess = MagicMock()
        sess.id = uuid.uuid4()
        sess.ai_response = None

        note_data = {"format": "SOAP", "structured_note": {"subjective": "test"}}

        with patch("services.note_service.get_embedding", side_effect=Exception("API down")):
            note, _ = await build_soap_note(sess, note_data)

        assert note.embedding == ZERO_VECTOR

    @pytest.mark.asyncio
    async def test_soap_fields_are_encrypted(self):
        from services.note_service import build_soap_note

        sess = MagicMock()
        sess.id = uuid.uuid4()
        sess.ai_response = None

        note_data = {
            "format": "SOAP",
            "structured_note": {"subjective": "texto plano"},
        }

        with patch("services.note_service.get_embedding", new_callable=AsyncMock) as mock_embed, \
             patch("services.note_service.encrypt_if_set", return_value="encrypted") as mock_enc:
            mock_embed.return_value = [0.0] * 1536
            note, _ = await build_soap_note(sess, note_data)

        mock_enc.assert_called()
        assert note.subjective == "encrypted"


class TestBuildCustomNote:
    @pytest.mark.asyncio
    async def test_returns_note_and_summary_data(self):
        from services.note_service import build_custom_note

        sess = MagicMock()
        sess.id = uuid.uuid4()
        sess.ai_response = None

        note_data = {
            "format": "custom",
            "text_fallback": "Motivo: ansiedad",
            "custom_fields": {"motivo": "ansiedad"},
        }

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        with patch("services.note_service.get_embedding", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [0.2] * 1536
            note, summary_data = await build_custom_note(
                sess, note_data,
                psychologist_id=uuid.uuid4(),
                db=mock_db,
            )

        assert note.format == "custom"
        assert note.custom_fields == {"motivo": "ansiedad"}
        assert "text_fallback" in summary_data

    @pytest.mark.asyncio
    async def test_uses_zero_vector_when_text_fallback_empty(self):
        from services.note_service import build_custom_note
        from agent.embeddings import ZERO_VECTOR

        sess = MagicMock()
        sess.id = uuid.uuid4()
        sess.ai_response = None

        note_data = {"format": "custom", "text_fallback": "", "custom_fields": {}}

        mock_db = AsyncMock()
        mock_db.execute.return_value = MagicMock(scalar_one_or_none=MagicMock(return_value=None))

        note, _ = await build_custom_note(
            sess, note_data,
            psychologist_id=uuid.uuid4(),
            db=mock_db,
        )

        assert note.embedding == ZERO_VECTOR

    @pytest.mark.asyncio
    async def test_snapshots_template_when_present(self):
        from services.note_service import build_custom_note

        sess = MagicMock()
        sess.id = uuid.uuid4()
        sess.ai_response = None

        note_data = {"format": "custom", "text_fallback": "texto", "custom_fields": {}}

        tmpl = MagicMock()
        tmpl.fields = [{"id": "motivo", "label": "Motivo"}]

        mock_db = AsyncMock()
        mock_db.execute.return_value = MagicMock(scalar_one_or_none=MagicMock(return_value=tmpl))

        with patch("services.note_service.get_embedding", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [0.0] * 1536
            note, _ = await build_custom_note(
                sess, note_data,
                psychologist_id=uuid.uuid4(),
                db=mock_db,
            )

        assert note.template_snapshot == tmpl.fields


class TestBuildNoteDispatch:
    @pytest.mark.asyncio
    async def test_dispatches_to_custom_builder_for_custom_format(self):
        from services.note_service import build_note

        sess = MagicMock()
        sess.id = uuid.uuid4()
        sess.ai_response = None

        note_data = {"format": "custom", "text_fallback": "", "custom_fields": {}}

        mock_db = AsyncMock()
        mock_db.execute.return_value = MagicMock(scalar_one_or_none=MagicMock(return_value=None))

        note, _ = await build_note(
            sess, note_data,
            psychologist_id=uuid.uuid4(),
            db=mock_db,
        )

        assert note.format == "custom"

    @pytest.mark.asyncio
    async def test_dispatches_to_soap_builder_for_soap_format(self):
        from services.note_service import build_note

        sess = MagicMock()
        sess.id = uuid.uuid4()
        sess.ai_response = None

        note_data = {"format": "SOAP", "structured_note": {}}

        with patch("services.note_service.get_embedding", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [0.0] * 1536
            note, _ = await build_note(
                sess, note_data,
                psychologist_id=uuid.uuid4(),
                db=AsyncMock(),
            )

        assert note.format == "SOAP"

    @pytest.mark.asyncio
    async def test_falls_back_to_soap_for_unknown_format(self):
        from services.note_service import build_note

        sess = MagicMock()
        sess.id = uuid.uuid4()
        sess.ai_response = None

        note_data = {"format": "DAP", "structured_note": {}}

        with patch("services.note_service.get_embedding", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [0.0] * 1536
            note, _ = await build_note(
                sess, note_data,
                psychologist_id=uuid.uuid4(),
                db=AsyncMock(),
            )

        # Falls back to SOAP builder — format field preserved from note_data
        assert note is not None
