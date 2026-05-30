import re
import unicodedata
import logging
from anthropic import AsyncAnthropic, APIStatusError, APIConnectionError, APITimeoutError
from sqlalchemy import select
from config import settings, ClinicalNoteConfig
from exceptions import DictationTooLongError, PromptInjectionError, LLMServiceError
from crypto import encrypt_if_set, decrypt_if_set
import json as _json

logger = logging.getLogger(__name__)

# Patrones de prompt injection conocidos (actualizados)
_INJECTION_PATTERNS = [
    r"ignore\s+(previous|all|prior|system|the)\s+(instructions?|rules?|context|prompt)",
    r"(system|assistant|user)\s*:",
    r"system\s+prompt",
    r"jailbreak",
    r"(you\s+)?are\s+(now|acting\s+as)",
    r"forget\s+(your|all|the)",
    r"new\s+instructions",
    r"\[INST\]",
    r"<\|im_start\|>",
    r"<\|im_end\|>",
    r"<\|system\|>",
    r"disregard\s+(all|previous|your)",
    r"override\s+(your|the)\s+(instructions?|rules?|behavior)",
    r"(forget|disregard|ignore|override).{0,30}(instructions?|rules?|system|prompt)",
    r"(pretend|act|behave)\s+(you\s+are|as\s+if|like\s+you)",
    r"do\s+anything\s+now",
    r"DAN\b",
]
_INJECTION_RE = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)

def _sanitizar_dictado(texto: str) -> str:
    """Valida que el dictado no contenga intentos de prompt injection."""
    # Normalizar Unicode para detectar variantes con homoglifos
    texto_normalizado = unicodedata.normalize("NFKD", texto)
    if _INJECTION_RE.search(texto_normalizado):
        logger.warning("Prompt injection attempt detected in dictation input")
        raise PromptInjectionError(
            "El dictado contiene contenido no válido para procesamiento clínico.",
            code="PROMPT_INJECTION",
        )
    return texto[:settings.MAX_DICTATION_LENGTH].strip()


# Public alias — use this at API boundaries to avoid duplicating injection logic
sanitize_dictation = _sanitizar_dictado

_SHARED_RULES = """
REGLAS FUNDAMENTALES Y DE SEGURIDAD (CRÍTICAS):

1. RESPUESTA EN TEXTO PLANO (CRÍTICO): Responde exclusivamente en texto plano.
   ESTÁ TOTALMENTE PROHIBIDO usar formato Markdown. No uses asteriscos (**), almohadillas (#), guiones bajos (_), corchetes ([]) o cualquier otro símbolo de formato.
   Si necesitas resaltar algo o hacer una lista, utiliza saltos de línea simples.

2. PROHIBICIÓN ABSOLUTA DE INVENTAR INFORMACIÓN CLÍNICA (CRÍTICO):
   Jamás debes fabricar, inferir ni asumir síntomas, diagnósticos, medicamentos, fechas, eventos, emociones o cualquier dato clínico que no haya sido mencionado explícitamente.
   Nunca rellenes vacíos con suposiciones clínicas, aunque parezcan razonables.
   Cita las palabras exactas del psicólogo cuando hagas observaciones clínicas relevantes.

3. MANEJO DE INCERTIDUMBRE (CRÍTICO):
   Si algo es ambiguo, señálalo explícitamente en lugar de asumir una interpretación.
   Nunca presentes inferencias propias como hechos clínicos.

4. USO DEL CONTEXTO CLÍNICO (CRÍTICO):
   Si se te proporciona historial de sesiones anteriores del paciente, úsalo exclusivamente para dar continuidad y coherencia clínica.
   Puedes referenciar información previa con frases como "En sesiones anteriores se mencionó..." solo si esa información está en el historial proporcionado.
   Nunca inventes historial que no esté en el contexto.

5. CONTROL DE LÍMITES (CRÍTICO): Si el usuario te hace peticiones fuera del ámbito clínico, psicológico o médico, DEBES NEGARTE rotundamente. Di exactamente: "Disculpa, pero como agente de salud SyqueX, no estoy capacitado para ayudarte con peticiones fuera del ámbito de la práctica de la psicología o psiquiatría."
"""

SYSTEM_PROMPT = f"""Eres SyqueX, asistente clínico de salud mental.
MODO CHAT: responde breve y directo, máximo 3 oraciones. Sin introducciones ni cierres.
Si el psicólogo comparte datos de un paciente, haz UNA pregunta clínica clave o una observación concisa.
NO generes notas SOAP ni formato estructurado.
Si en el historial aparecen bloques etiquetados como [NOTA CLÍNICA PREVIA — Sesión #N], son notas de sesiones anteriores ya confirmadas. Úsalas para responder preguntas sobre la evolución del paciente.
{_SHARED_RULES}"""

SOAP_SYSTEM_PROMPT = f"""Eres SyqueX, asistente clínico de salud mental.
MODO NOTA SOAP: distribuye TODA la información del dictado en los 4 campos de la nota clínica.

Subjetivo: Lo que el paciente refiere, reporta, siente o experimenta. Incluye datos biográficos, antecedentes, motivo de consulta, contexto familiar o social mencionados.
Objetivo: Datos observables y verificables: diagnósticos, edad, duración del tratamiento, síntomas clínicos identificados, hallazgos del clínico.
Análisis: Interpretación clínica, evolución del caso, hipótesis diagnóstica o impresión del terapeuta.
Plan: Intervenciones, tareas, próximos pasos, continuidad del tratamiento o acuerdos terapéuticos.

Reglas:
- Clasifica TODO el contenido del dictado en el campo más apropiado. No dejes información sin clasificar.
- Solo escribe "No mencionado." si ese campo realmente no tiene ninguna información en el dictado.
- 1-3 oraciones por campo.
- Cero texto fuera de los 4 campos: sin comentarios, sin introducciones, sin notas de calidad.
{_SHARED_RULES}"""


CUSTOM_NOTE_SYSTEM_PROMPT = (
    "Eres un asistente clínico especializado. El psicólogo ha definido una estructura de nota personalizada. "
    "Tu tarea es extraer información del dictado de sesión y colocarla en los campos correspondientes. "
    "MANEJO DE CAMPOS SIN INFORMACIÓN (CRÍTICO): "
    "Si un campo no está mencionado en el dictado, omite ese campo en la respuesta (no lo incluyas). "
    "NUNCA escribas 'UNKNOWN', 'N/A', 'Sin dato', 'No mencionado' ni ningún texto de relleno. "
    "Un campo ausente es mejor que un campo con texto falso. "
    "Responde ÚNICAMENTE usando la herramienta fill_custom_note — no generes texto libre.\n\n"
    + _SHARED_RULES
)


async def _get_patient_context(db, patient_id: str, patient_name: str = "", chat_mode: bool = False) -> list:
    """
    Builds the full context message list for a patient.

    chat_mode=False (note generation): injects verbatim session turns so the LLM
        continues the conversation in the same format.
    chat_mode=True (Evolution tab): injects labeled clinical note summaries so the
        LLM recognises them as PREVIOUS sessions, not as the current chat thread.
        Filters out chat-format and draft sessions to keep context clean.
    """
    from database import Session as SessionModel, PatientProfile

    # --- 1. Load clinical profile ---
    profile_result = await db.execute(
        select(PatientProfile).where(PatientProfile.patient_id == patient_id)
    )
    profile = profile_result.scalar_one_or_none()

    profile_block_parts = [f"Nombre del paciente: {patient_name}."] if patient_name else []
    if profile:
        summary = decrypt_if_set(profile.patient_summary)
        if summary:
            profile_block_parts.append(f"Resumen clínico del paciente:\n{summary}")
        if profile.recurring_themes:
            profile_block_parts.append(f"Temas recurrentes: {', '.join(profile.recurring_themes)}")
        if profile.risk_factors:
            profile_block_parts.append(f"Factores de riesgo: {', '.join(profile.risk_factors)}")
        if profile.protective_factors:
            profile_block_parts.append(f"Factores protectores: {', '.join(profile.protective_factors)}")

    context = []
    if profile_block_parts:
        profile_text = "\n".join(profile_block_parts)
        context.append({
            "role": "user",
            "content": f"[CONTEXTO CLÍNICO DEL PACIENTE — solo para referencia, no es un dictado nuevo]\n{profile_text}"
        })
        context.append({
            "role": "assistant",
            "content": "Entendido. Tengo en cuenta el historial clínico del paciente para esta sesión."
        })

    # --- 2. Load session history ---
    base_query = (
        select(SessionModel)
        .where(
            SessionModel.patient_id == patient_id,
            SessionModel.is_archived == False,
        )
        .order_by(SessionModel.created_at.desc())
        .limit(ClinicalNoteConfig.MAX_SESSIONS_CONTEXT)
    )

    if chat_mode:
        # For Evolution chat: only confirmed clinical sessions with a note text.
        # Excludes chat-format sessions to prevent the agent from recycling its own
        # previous Evolution responses as "clinical history".
        base_query = base_query.where(
            SessionModel.format != "chat",
            SessionModel.status == "confirmed",
            SessionModel.ai_response != None,
        )
    else:
        base_query = base_query.where(SessionModel.messages != None)

    result = await db.execute(base_query)
    sessions = result.scalars().all()

    if chat_mode:
        # Inject each clinical session as a labeled summary block so the LLM
        # knows these are PRIOR sessions, not the current conversation.
        for session in reversed(sessions):
            # Belt-and-suspenders: also filter at application level so tests can
            # verify the exclusion logic without a real database.
            if getattr(session, "format", None) == "chat":
                continue
            if getattr(session, "status", None) != "confirmed":
                continue
            note_text = decrypt_if_set(session.ai_response)
            if not note_text:
                continue
            date_str = str(session.session_date) if session.session_date else "fecha desconocida"
            num_str = str(session.session_number) if session.session_number else "?"
            context.append({
                "role": "user",
                "content": f"[NOTA CLÍNICA PREVIA — Sesión #{num_str} del {date_str}]\n{note_text}",
            })
            context.append({
                "role": "assistant",
                "content": "Entendido. He registrado esta nota clínica en el historial del paciente.",
            })
    else:
        # For note generation: inject verbatim turns for format continuity.
        for session in reversed(sessions):
            decrypted_msg = decrypt_if_set(session.messages)
            if decrypted_msg:
                try:
                    msgs = _json.loads(decrypted_msg) if isinstance(decrypted_msg, str) else decrypted_msg
                    context.extend(msgs)
                except (_json.JSONDecodeError, TypeError):
                    pass

    return context


async def update_patient_profile_summary(db, patient_id: str, session_note: dict) -> None:
    """
    After a session is confirmed, asks Claude to generate/update a compact clinical
    summary of the patient (max ~300 words). Also extracts risk_factors,
    protective_factors, and progress_indicators from the new note and persists them.
    """
    from database import PatientProfile, Session as SessionModel

    profile_result = await db.execute(
        select(PatientProfile).where(PatientProfile.patient_id == patient_id)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        return

    # Build context for Claude: existing summary + new session data
    existing_summary = decrypt_if_set(profile.patient_summary) or "Sin resumen previo."
    new_note_text = session_note.get("text_fallback", "")
    detected_patterns = session_note.get("detected_patterns", [])
    alerts = session_note.get("alerts", [])

    summary_prompt = (
        f"Resumen clínico previo del paciente:\n{existing_summary}\n\n"
        f"Nueva sesión registrada:\n{new_note_text}\n\n"
        f"Patrones detectados: {', '.join(detected_patterns) if detected_patterns else 'Ninguno'}\n"
        f"Alertas: {', '.join(alerts) if alerts else 'Ninguna'}\n\n"
        "Con base en todo lo anterior, genera un resumen clínico actualizado del paciente "
        "en texto plano, sin Markdown, de máximo 300 palabras. "
        "El resumen debe incluir: motivo de consulta principal, evolución observada, "
        "temas recurrentes, factores de riesgo activos y factores protectores. "
        "Escribe solo el resumen, sin encabezados ni etiquetas."
    )

    try:
        anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = await anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            temperature=0,
            system="Eres un asistente clínico especializado. Responde exclusivamente en texto plano sin Markdown.",
            messages=[{"role": "user", "content": summary_prompt}],
        )
        new_summary = "\n".join([b.text for b in response.content if b.type == "text"]).strip()
        profile.patient_summary = encrypt_if_set(new_summary)
    except Exception as e:
        logger.error(f"Error generating patient summary: {e}")

    # Update structured profile fields from the new session
    if detected_patterns:
        profile.recurring_themes = list(set((profile.recurring_themes or []) + detected_patterns))
    if alerts:
        profile.risk_factors = list(set((profile.risk_factors or []) + alerts))

    suggested_next = session_note.get("suggested_next_steps", [])
    if suggested_next:
        indicators = profile.progress_indicators or {}
        indicators["last_suggested_steps"] = suggested_next
        profile.progress_indicators = indicators

    await db.commit()


async def process_session(db, patient_id: str, raw_dictation: str, session_id: str, format_: str = "SOAP", patient_name: str = "") -> dict:
    if len(raw_dictation) > ClinicalNoteConfig.MAX_DICTATION_LENGTH:
        raise DictationTooLongError(
            f"El dictado excede el límite de {ClinicalNoteConfig.MAX_DICTATION_LENGTH} caracteres.",
            code="DICTATION_TOO_LONG",
            details={"max_length": ClinicalNoteConfig.MAX_DICTATION_LENGTH, "received": len(raw_dictation)},
        )

    # Sanitizar contra prompt injection antes de enviar al LLM
    dictado_seguro = _sanitizar_dictado(raw_dictation)

    is_chat = format_.lower() == "chat"
    context_messages = await _get_patient_context(db, patient_id, patient_name, chat_mode=is_chat)

    # Append the current user message to the full conversation history
    messages = context_messages + [{"role": "user", "content": dictado_seguro}]

    try:
        active_prompt = SOAP_SYSTEM_PROMPT if format_.upper() == "SOAP" else SYSTEM_PROMPT
        anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = await anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            temperature=0,
            system=active_prompt,
            messages=messages,
        )

        reply_text = "\n".join([b.text for b in response.content if b.type == "text"])

        # Store only this session's turn — previous context comes from their own sessions
        session_messages = [
            {"role": "user", "content": dictado_seguro},
            {"role": "assistant", "content": reply_text},
        ]

        return {"text_fallback": reply_text, "session_messages": session_messages}

    except (DictationTooLongError, PromptInjectionError):
        raise
    except APIStatusError as e:
        if e.status_code in (401, 403):
            logger.error("Anthropic auth error (status %s): %s", e.status_code, e.message)
            raise LLMServiceError(
                "Error de autenticación con el servicio de IA. Contacta al administrador.",
                code="LLM_AUTH_ERROR",
            ) from e
        if e.status_code == 429:
            logger.warning("Anthropic rate limit reached: %s", e.message)
            return {
                "text_fallback": "El servicio de IA está temporalmente ocupado. Intenta en unos momentos.",
                "session_messages": [{"role": "user", "content": dictado_seguro}],
            }
        logger.error("Anthropic API error (status %s): %s", e.status_code, e.message, exc_info=True)
        return {
            "text_fallback": "Error al procesar el dictado. Por favor intenta nuevamente.",
            "session_messages": [{"role": "user", "content": dictado_seguro}],
        }
    except (APIConnectionError, APITimeoutError) as e:
        logger.warning("Anthropic connectivity issue: %s", e)
        return {
            "text_fallback": "No se pudo conectar al servicio de IA. Por favor intenta nuevamente.",
            "session_messages": [{"role": "user", "content": dictado_seguro}],
        }
    except Exception as e:
        logger.error("Unexpected error calling Anthropic API: %s", e, exc_info=True)
        return {
            "text_fallback": "Error al procesar el dictado. Por favor intenta nuevamente.",
            "session_messages": [{"role": "user", "content": dictado_seguro}],
        }


async def process_session_custom(
    db,
    patient_id: str,
    raw_dictation: str,
    session_id: str,
    template_fields: list[dict],
    patient_name: str = "",
) -> dict:
    from agent.template_tool import build_fill_tool

    context_messages = await _get_patient_context(db, patient_id, patient_name)
    messages = context_messages + [{"role": "user", "content": raw_dictation}]
    tool = build_fill_tool(template_fields)

    anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = await anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        temperature=0,
        system=CUSTOM_NOTE_SYSTEM_PROMPT,
        tools=[tool],
        tool_choice={"type": "tool", "name": "fill_custom_note"},
        messages=messages,
    )

    tool_block = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_block is None:
        raise LLMServiceError("El agente no completó la nota. Intenta de nuevo.")

    # Sanitize: remove placeholder strings Claude may emit when data is missing.
    _PLACEHOLDER_VALUES = {"unknown", "n/a", "n/d", "sin dato", "no mencionado", "no aplica"}

    def _sanitize(value):
        if isinstance(value, str) and value.strip().lower() in _PLACEHOLDER_VALUES:
            return None
        return value

    raw_fields = tool_block.input
    custom_fields = {
        fid: _sanitize(val)
        for fid, val in raw_fields.items()
        if _sanitize(val) is not None and val != "" and val != []
    }

    label_map = {f["id"]: f["label"] for f in template_fields}
    lines = []
    for fid, value in custom_fields.items():
        label = label_map.get(fid, fid)
        if isinstance(value, list):
            lines.append(f"{label}: {', '.join(str(v) for v in value) or 'ninguno'}")
        else:
            lines.append(f"{label}: {value}")
    text_fallback = "\n".join(lines)
    session_messages = messages + [{"role": "assistant", "content": text_fallback}]

    return {
        "custom_fields": custom_fields,
        "text_fallback": text_fallback,
        "session_messages": session_messages,
    }


_PATIENT_SUMMARY_PROMPT = """Eres un asistente clínico. A partir de la siguiente nota clínica, genera un resumen para el paciente en lenguaje simple y empático. NO incluyas diagnósticos, formulaciones clínicas, ni información sensible.

Extrae exactamente tres campos:
1. topics_worked: ¿Qué trabajamos hoy? (1-2 oraciones, lenguaje del paciente)
2. homework: ¿Cuál es la tarea para esta semana? (clara y accionable, o cadena vacía si no hay tarea)
3. next_session_date: Fecha de próxima sesión en formato YYYY-MM-DD, o null si no se menciona

Responde ÚNICAMENTE con JSON válido, sin texto adicional:
{"topics_worked": "...", "homework": "...", "next_session_date": "YYYY-MM-DD o null"}"""


def _build_note_content(note_data: dict) -> str:
    """Serializa nota SOAP o custom a texto plano para el prompt."""
    fmt = note_data.get("format", "").upper()
    if fmt == "SOAP":
        parts = []
        for field, label in [("subjective", "Subjetivo"), ("objective", "Objetivo"),
                               ("assessment", "Análisis"), ("plan", "Plan")]:
            val = note_data.get(field) or ""
            if val:
                parts.append(f"{label}: {val}")
        return "\n".join(parts)
    # Custom note
    custom_fields = note_data.get("custom_fields") or {}
    if isinstance(custom_fields, dict):
        return "\n".join(f"{k}: {v}" for k, v in custom_fields.items() if v)
    return str(custom_fields)


async def generate_patient_summary(note_data: dict) -> dict:
    """
    Genera un resumen para el paciente a partir de una nota SOAP o custom.
    Retorna dict con keys: topics_worked, homework, next_session_date.
    Propaga excepciones para que el endpoint devuelva 500 en lugar de campos vacíos silenciosos.
    """
    import json as _json
    import re as _re

    note_content = _build_note_content(note_data)
    user_message = f"Nota clínica:\n{note_content}"

    client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        temperature=0,
        system=_PATIENT_SUMMARY_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )
    raw = "\n".join(b.text for b in response.content if b.type == "text").strip()
    # Strip markdown code fences que Claude agrega a veces pese al prompt
    cleaned = _re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=_re.MULTILINE).strip()
    parsed = _json.loads(cleaned)
    return {
        "topics_worked": parsed.get("topics_worked") or "",
        "homework": parsed.get("homework") or "",
        "next_session_date": parsed.get("next_session_date") or None,
    }
