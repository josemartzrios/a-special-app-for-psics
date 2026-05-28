# Patient Diary — Design Spec

**Date:** 2026-05-25  
**Status:** Approved — ready for implementation planning  
**Feature branch:** `feature/patient-diary`

---

## 1. Problema

Todo paciente llega a sesión y dice "se me olvidó qué te quería contar." El psicólogo pierde los primeros 10–15 minutos de cada sesión reconstruyendo la semana. El diario resuelve esto: el paciente registra momentos entre sesiones y el psicólogo recibe un resumen generado por IA antes de cada cita.

---

## 2. Alcance del MVP

**Incluido:**
- Portal del paciente: escribir entradas de diario (chats) entre sesiones
- Control de privacidad por entrada (Solo yo / Mi psicólogo)
- Envío explícito de una entrada al psicólogo (con confirmación)
- Generación de resumen IA 24h antes de la sesión
- Vista del psicólogo: resumen actual + historial de resúmenes anteriores
- Cambio de navegación del psicólogo: 3 tabs (Sesiones · Agenda · Pacientes)

**Fuera de alcance:**
- Notificaciones push/email al paciente
- Respuestas del psicólogo al diario
- Análisis de tendencias emocionales
- Exportar entradas del diario

---

## 3. Portal del Paciente — Diario

### 3.1 Navegación

El portal del paciente agrega un segundo tab a la barra inferior existente:

| Tab | Ícono | Contenido |
|-----|-------|-----------|
| **Diario** | Book (outline) | Lista de chats + vista de chat activo |
| **Mis sesiones** | Calendar (outline) | Lista de citas + botón "Agendar cita" (solo visible si el psicólogo tiene slots disponibles) |

### 3.2 Lista de chats (drawer lateral)

- Accessible desde el ícono ☰ en el header del chat activo
- Muestra todas las entradas del paciente ordenadas por fecha descendente
- Cada fila: título del chat, fecha, badge de estado (Solo yo / Mi psicólogo / Enviado)
- Color de fondo de la fila: gris (#f4f4f2) = privada, sage suave (#f0faf7) = compartida/enviada
- Botón "Nuevo chat" con ícono `+` en la parte superior del drawer

### 3.3 Vista de chat

**Header (52px, flex-shrink: 0):**
- Ícono hamburger → abre drawer
- Título del chat (editable al crear, no editable después de enviado)
- Badge de privacidad alineado a la derecha (toggleable hasta que se envíe):
  - 🔒 `Solo yo` — fondo amber (#fef3e2), borde #f0cc8a, texto #9a6630
  - 👁 `Mi psicólogo` — fondo sage (#f0faf7), borde #b3d9ce, texto #3d7a65
  - ✓ `Enviado` — sage apagado, no clickeable

**Área de mensajes (flex: 1, overflow-y: auto):**
- Padding-left: 32px para empujar burbujas hacia la derecha
- Burbujas alineadas a la derecha (`justify-content: flex-end`), `max-width: 88%`
- Color de burbuja según privacidad: gris (#f4f4f2) = Solo yo, sage rgba(90,158,138,0.12) = Mi psicólogo
- Separadores de día: label centrado en pequeñas caps (e.g. "Lunes 19 may")
- Timestamp debajo de cada burbuja, alineado a la derecha, 10px muted

**Chips de emoción (flex-shrink: 0, antes del composer):**
- Selección de emoción actual: Alegría · Calma · Tristeza · Angustia · Miedo · Enojo
- Chips alternando estilos sage/amber
- Una emoción seleccionada a la vez (resaltada en sage sólido)

**Composer (flex-shrink: 0):**
- Textarea con placeholder "Escribe un momento…"
- Botón (avión, SVG outline) a la derecha: **comparte la conversación completa** con el psicólogo
  - Activo solo cuando badge = "Mi psicólogo" y hay al menos un mensaje
  - Deshabilitado (sage apagado) cuando badge = "Solo yo"
- Enter o submit implícito agrega el mensaje al chat

**Estado enviado (bloqueado):**
- Header: badge `✓ Enviado` (no clickeable)
- Franja informativa bajo el header: "Enviado a tu psicólogo · [fecha]" (sage claro)
- Mensajes visibles en modo lectura (opacidad 0.7)
- Sin chips, sin composer
- El paciente puede ver la entrada pero no puede agregarle nada

### 3.4 Modal de confirmación (al pulsar)

Sheet desde abajo con:
- Ícono avión de papel (SVG, sage)
- Título: "¿Compartir con tu psicólogo?"
- Aviso amber: "Una vez enviado no podrás agregar más mensajes a este chat."
- Botón primario: "Enviar a mi psicólogo"
- Botón secundario: "Cancelar"

---

## 4. Modelo de datos

### 4.1 Nueva tabla: `diary_chats`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | UUID PK | |
| `patient_id` | UUID FK → patients | |
| `title` | VARCHAR(100) | Nombre del chat, editable antes de enviar |
| `privacy` | ENUM('private', 'shared') | Valor al momento del envío |
| `status` | ENUM('draft', 'sent') | `draft` = en progreso, `sent` = enviado/bloqueado |
| `emotion` | VARCHAR(30) NULLABLE | Emoción seleccionada al último mensaje |
| `sent_at` | TIMESTAMPTZ NULLABLE | Momento del envío |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### 4.2 Nueva tabla: `diary_messages`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | UUID PK | |
| `chat_id` | UUID FK → diary_chats | |
| `body` | TEXT NOT NULL | Contenido del mensaje |
| `created_at` | TIMESTAMPTZ | Usado para ordenar y agrupar por día |

### 4.3 Nueva tabla: `diary_summaries`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | UUID PK | |
| `patient_id` | UUID FK → patients | |
| `slot_id` | UUID FK → availability_slots | Sesión para la que fue generado |
| `summary_text` | TEXT | Párrafo generado por Claude |
| `source_chat_ids` | UUID[] | IDs de los chats incluidos en el resumen |
| `generated_at` | TIMESTAMPTZ | |

**Índices:**
- `idx_diary_chats_patient` → (`patient_id`, `created_at DESC`)
- `idx_diary_messages_chat` → (`chat_id`, `created_at ASC`)
- `idx_diary_summaries_slot` → (`slot_id`) UNIQUE
- `idx_diary_summaries_patient` → (`patient_id`, `generated_at DESC`)

---

## 5. Backend — Endpoints

### 5.1 Router del paciente — `backend/api/diary_portal.py` (nuevo archivo)

> **SRP**: se crea un router separado en lugar de extender `patient_portal.py`. Sigue el patrón de módulos por dominio del proyecto.

Todos bajo `/portal/diary` con autenticación JWT de paciente (`get_current_patient()`).

| Método | Ruta | Acción |
|--------|------|--------|
| GET | `/portal/diary/chats` | Listar chats del paciente (paginado, 20 por página) |
| POST | `/portal/diary/chats` | Crear nuevo chat (`title` max 100 chars, `privacy`) |
| GET | `/portal/diary/chats/{chat_id}` | Obtener chat con sus mensajes |
| POST | `/portal/diary/chats/{chat_id}/messages` | Agregar mensaje (solo si `status=draft`) |
| PATCH | `/portal/diary/chats/{chat_id}` | Actualizar `title` o `privacy` (solo si `status=draft`) |
| POST | `/portal/diary/chats/{chat_id}/send` | Enviar chat al psicólogo |

**OWASP A01 — Verificación de ownership en todos los endpoints con `{chat_id}`:**

Antes de cualquier operación sobre un chat, el backend verifica que el chat pertenece al paciente autenticado:

```python
chat = await db.get(DiaryChat, chat_uuid)
if not chat or chat.patient_id != current_patient_uuid:
    raise HTTPException(status_code=404, detail="Chat no encontrado")
```

Usar 404 (no 403) para no revelar existencia de recursos ajenos.

**OWASP A04 — Envío atómico para evitar race condition:**

`POST /send` usa `UPDATE ... WHERE status='draft'` y verifica `rowcount == 1`:

```python
result = await db.execute(
    update(DiaryChat)
    .where(DiaryChat.id == chat_uuid, DiaryChat.status == "draft")
    .values(status="sent", sent_at=datetime.now(UTC))
)
if result.rowcount == 0:
    raise HTTPException(status_code=409, detail="Este chat ya fue enviado")
```

**Input validation:**

| Campo | Límite |
|-------|--------|
| `diary_chats.title` | max 100 caracteres |
| `diary_messages.body` | max 2000 caracteres |
| Mensajes por chat | max 50 mensajes |
| Chats activos (`status=draft`) por paciente | max 20 |

### 5.2 Endpoints del psicólogo — `backend/api/routes.py`

Autenticación JWT de psicólogo (`get_current_user()`).

| Método | Ruta | Acción |
|--------|------|--------|
| GET | `/patients/{patient_id}/diary-summaries` | Listar resúmenes del paciente |
| GET | `/patients/{patient_id}/diary-summaries/upcoming` | Resumen de la próxima sesión (si existe) |

**OWASP A01 — Ownership del paciente:**

Antes de devolver cualquier dato, verificar que el paciente pertenece al psicólogo autenticado:

```python
patient = await db.get(Patient, patient_uuid)
if not patient or patient.psychologist_id != current_psychologist_uuid:
    raise HTTPException(status_code=404, detail="Paciente no encontrado")
```

---

## 6. Generación de resumen IA (cron)

### 6.1 Trigger

El cron job existente (`backend/api/cron.py`) agrega una nueva tarea diaria que:

1. Busca todos los `availability_slots` con `status = 'booked'` y `slot_date + start_time` entre `now + 20h` y `now + 28h` (ventana de 24h con margen)
2. Para cada slot, verifica que no exista ya un `diary_summaries` con ese `slot_id`
3. Obtiene todos los `diary_chats` del paciente con `status = 'sent'` y `privacy = 'shared'` creados desde la sesión anterior hasta ahora
4. Si hay al menos 1 chat enviado y compartido → genera resumen
5. Si no hay chats → no genera nada (no se muestra resumen al psicólogo)

### 6.2 Prompt del agente (determinista, anti-alucinación)

```
Eres un asistente clínico. A continuación se presentan las entradas de diario que un paciente compartió con su psicólogo esta semana.

Tu tarea: escribe UN párrafo conciso (máximo 5 oraciones) que resuma los temas, emociones y eventos que el paciente MENCIONÓ EXPLÍCITAMENTE. 

Reglas estrictas:
- Usa SOLO la información presente en las entradas. No interpretes, no inferas, no agregues contexto clínico propio.
- Si el paciente mencionó algo específico (una persona, un evento, una técnica), inclúyelo con sus palabras.
- No uses lenguaje clínico que el paciente no usó.
- No hagas recomendaciones ni juicios.

Entradas del paciente:
{entries}
```

El parámetro `{entries}` se construye como lista numerada: `1. [fecha] [emoción]: [mensajes concatenados]`.

### 6.3 Almacenamiento

El resultado se guarda en `diary_summaries` con `source_chat_ids` apuntando exactamente a los chats usados. Si el LLM falla, el error se loguea y no se guarda nada (no hay resumen parcial).

---

## 7. Vista del psicólogo

### 7.1 Cambio de navegación

La app del psicólogo (`App.jsx`) cambia de 2 tabs a 3:

| Tab (nuevo) | Equivale a | Descripción |
|-------------|------------|-------------|
| **Sesiones** | Tab anterior "Pacientes" | Flujo principal de dictado y notas |
| **Agenda** | Tab anterior "Agenda" | Sin cambios |
| **Pacientes** | Nuevo | Lista de pacientes + vista de diario |

### 7.2 Tab Pacientes — lista

- Sección superior "Sesión próxima (24h)": pacientes con slot booked en las próximas 24h
  - Si tienen `diary_summaries` generado → badge verde "Resumen listo" (book SVG + texto)
  - Si no tienen resumen → fila normal sin badge
- Sección inferior "Otros pacientes": el resto, sin orden especial

### 7.3 Detalle del paciente — vista de diario

Al abrir un paciente desde el tab Pacientes:

**Tarjeta "Resumen de diario" (solo visible si existe `diary_summaries` para la próxima sesión):**
- Header sage: ícono book + label "Resumen de diario" + "Sesión hoy HH:MM"
- Cuerpo: párrafo de texto generado por la IA
- Footer: "N entradas · [rango de fechas]" + link "Ver entradas" (opcional, fase 2)
- Border: `rgba(90,158,138,0.3)`, background: `#f0faf7`

**Sección "Resúmenes anteriores":**
- Lista de `diary_summaries` anteriores ordenados por `generated_at DESC`
- Cada fila: número de sesión (inferido), fecha, primera oración del resumen como preview
- Si una sesión no tuvo resumen (paciente no compartió nada): fila con texto "Sin entradas compartidas" en muted, chevron deshabilitado

---

## 8. Cifrado de campos sensibles

Reutiliza el módulo `backend/crypto.py` ya implementado (Fernet AES-128-CBC + HMAC-SHA256, prefijo de versión `v1:`). Ver spec completo en `docs/superpowers/specs/2026-04-19-encryption-design.md`.

### Campos cifrados en las nuevas tablas

| Tabla | Campo | Acción |
|-------|-------|--------|
| `diary_messages` | `body` | `encrypt()` al escribir, `decrypt()` al leer |
| `diary_summaries` | `summary_text` | `encrypt()` al escribir, `decrypt()` al leer |
| `diary_chats` | `title` | `encrypt()` al escribir, `decrypt()` al leer |

### Rutas de escritura

| Endpoint / función | Campos cifrados |
|--------------------|-----------------|
| `POST /portal/diary/chats` | `title` |
| `PATCH /portal/diary/chats/{chat_id}` | `title` (si presente) |
| `POST /portal/diary/chats/{chat_id}/messages` | `body` |
| Cron `generate_diary_summary()` | `summary_text` |

### Rutas de lectura

| Endpoint / función | Campos descifrados |
|--------------------|--------------------|
| `GET /portal/diary/chats` | `title` de cada chat |
| `GET /portal/diary/chats/{chat_id}` | `title` + `body` de todos los mensajes |
| `GET /patients/{id}/diary-summary` (psicólogo) | `summary_text` |
| Cron (al leer mensajes para generar resumen) | `body` de cada `diary_message` |

### Nota de consistencia

El embedding no aplica para el diario — no hay búsqueda semántica sobre entradas. Por tanto no existe el conflicto "cifrar antes o después del embedding" que sí ocurre en `clinical_notes`.

---

## 9. Privacidad y acceso (control de acceso)

- El psicólogo **nunca ve los mensajes individuales** de las entradas — solo el resumen generado por IA
- Los chats con `privacy = 'private'` nunca son incluidos en el resumen, independientemente de su `status`
- Solo los chats con `privacy = 'shared'` AND `status = 'sent'` son elegibles para el resumen
- El campo `source_chat_ids` en `diary_summaries` solo apunta a chats shared+sent

---

## 9. Archivos afectados

### Frontend
| Archivo | Cambio |
|---------|--------|
| `frontend/src/pages/PatientPortal.jsx` | Agregar tab Diario con drawer + vista de chat |
| `frontend/src/components/DiaryChat.jsx` | **Nuevo** — chat component (burbujas, chips, composer) |
| `frontend/src/components/DiaryChatList.jsx` | **Nuevo** — drawer con lista de chats |
| `frontend/src/components/DiaryShareModal.jsx` | **Nuevo** — modal de confirmación |
| `frontend/src/App.jsx` | Cambiar 2 tabs → 3 tabs (Sesiones · Agenda · Pacientes) |
| `frontend/src/components/PatientDetailDiary.jsx` | **Nuevo** — vista del psicólogo: resumen + historial |
| `frontend/src/api.js` | Agregar llamadas a los nuevos endpoints |

### Backend
| Archivo | Cambio |
|---------|--------|
| `backend/database.py` | Agregar modelos `DiaryChat`, `DiaryMessage`, `DiarySummary` |
| `backend/api/patient_portal.py` | Agregar 6 nuevos endpoints de diario |
| `backend/api/cron.py` | Agregar tarea de generación de resumen 24h antes |
| `backend/api/routes.py` | Agregar endpoints para que el psicólogo consulte resúmenes |

### Base de datos
- Migración: crear tablas `diary_chats`, `diary_messages`, `diary_summaries`

---

## 10. Decisiones de diseño

| Decisión | Alternativa descartada | Razón |
|----------|----------------------|-------|
| Privacidad a nivel de chat (no mensaje) | Privacidad por mensaje | Más simple cognitivamente para el paciente; un chat tiene una intención |
| Envío explícito (botón ) | Compartir automático cuando badge = "Mi psicólogo" | El paciente necesita control claro del momento en que comparte |
| Psicólogo ve solo el resumen, no los mensajes | Psicólogo ve mensajes completos | Preserva el espacio privado del paciente; el resumen es suficiente contexto clínico |
| Resumen generado 24h antes del slot | Generado al enviar la entrada | El psicólogo lo recibe justo cuando lo necesita, con todas las entradas de la semana |
| Prompt extractivo estricto | Prompt interpretativo clínico | Evita alucinaciones y respeta que la interpretación es tarea del psicólogo |
| Resúmenes anteriores en lugar de entradas individuales | Mostrar entradas directamente al psicólogo | Consistencia con la regla de privacidad: el psicólogo solo accede a resúmenes |
