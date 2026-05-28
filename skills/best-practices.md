# Best Practices — SyqueX

Guía de principios SOLID, patrones de diseño y clean code aplicados al stack de SyqueX (FastAPI + React).

---

## Principios SOLID

### S — Single Responsibility
Cada módulo hace exactamente una cosa. Si una función necesita más de un párrafo para describirse, tiene demasiadas responsabilidades.

**En FastAPI:**
- Un archivo de rutas no contiene lógica de negocio — esa va en un servicio o en `agent/`.
- Un modelo SQLAlchemy no contiene validaciones de entrada — esas van en schemas Pydantic.
- Helper functions como `_get_owned_patient()` encapsulan una sola responsabilidad (verificación de propiedad + autorización).

**En React:**
- Un componente no mezcla fetching de datos con presentación. Si hace `useEffect` + JSX complejo, separa en hook personalizado + componente puro.

---

### O — Open/Closed
El código está abierto para extensión pero cerrado para modificación. Añade comportamiento nuevo sin tocar código existente.

**Aplicación en SyqueX:**
- Los formatos de nota clínica (SOAP, custom) se extienden añadiendo una nueva rama en `_build_note_output()`, no modificando la lógica existente.
- Los tipos de tool de Claude se añaden en `agent/tools.py` como nuevas entradas en `AGENT_TOOLS`, sin modificar el dispatch del agente.
- Nuevas variantes de email se crean como funciones nuevas en `services/email.py`, no añadiendo parámetros a las existentes.

---

### L — Liskov Substitution
Los subtipos deben poder reemplazar a sus tipos base. Una implementación que cumple una interfaz debe comportarse de forma indistinguible a otra que la cumple.

**Aplicación en SyqueX:**
- `IEmbeddingService` en `agent/interfaces.py`: cualquier implementación (OpenAI, fastembed, mock de tests) debe comportarse igual desde el punto de vista del caller.
- Los overrides de dependencias en tests (`dependency_overrides`) funcionan porque las implementaciones mock y las reales tienen la misma firma y contrato de retorno.

---

### I — Interface Segregation
Prefiere interfaces pequeñas y específicas sobre interfaces grandes. No fuerces a los clientes a depender de métodos que no usan.

**Aplicación en SyqueX:**
- `BaseTool` en `agent/interfaces.py` expone solo `name`, `description`, y `execute()` — no más.
- Los schemas Pydantic de request son distintos de los de response. `SummarySaveRequest` no tiene `sent_at`; `SummaryOut` no tiene los campos encriptados.
- En React, los componentes reciben solo las props que necesitan — no el objeto estado completo de `App.jsx`.

---

### D — Dependency Inversion
Los módulos de alto nivel no deben depender de los de bajo nivel. Ambos deben depender de abstracciones.

**Aplicación en SyqueX:**
- Las rutas dependen de `get_db` (la abstracción de sesión), no de `AsyncSession` ni del driver directamente.
- `agent.py` depende de `IEmbeddingService`, no de la implementación concreta de OpenAI.
- Inyectar dependencias via `Depends()` de FastAPI, no instanciarlas dentro de la función.

---

## Patrones de Diseño

### Repository / DAO (implícito vía SQLAlchemy)
Encapsula el acceso a datos en helpers, no escribas queries SQL dispersas en los endpoints.

```python
# Bien — helper reutilizable con semántica clara
async def _get_owned_patient(patient_id: str, psychologist_id: uuid.UUID, db) -> Patient:
    ...

# Mal — query inline en el endpoint
patient = await db.execute(select(Patient).where(...))
```

---

### Factory / Builder para construcción de respuestas
Usa funciones constructoras puras cuando el objeto de salida requiere lógica de ensamblado.

```python
# Bien — función constructora pura
def _summary_out(s: PatientSummary) -> SummaryOut:
    return SummaryOut(
        id=str(s.id),
        topics_worked=decrypt_if_set(s.topics_worked),
        ...
    )

# Mal — construir el dict/objeto inline en cada endpoint
```

---

### Strategy para formatos de nota clínica
Cuando hay múltiples variantes de un algoritmo (SOAP vs custom vs futuro), extrae la lógica de selección en una función de despacho.

```python
def _note_to_dict(note: ClinicalNote) -> dict:
    if note.custom_fields:
        return _build_custom_note(note)
    return _build_soap_note(note)
```

---

### Decorator / Middleware para seguridad transversal
La autenticación, rate limiting y RLS son preocupaciones transversales — aplícalas como decoradores o dependencias, nunca inline.

```python
# Bien
@router.get("/patients/{id}")
async def get_patient(
    psychologist=Depends(get_current_psychologist),  # auth
    db: AsyncSession = Depends(get_db_with_user),    # RLS
):
    ...
```

---

### Observer / Event para jobs asíncronos
El `JobQueue` en SyqueX implementa un patrón de cola de eventos: el producer (endpoint) crea el job, el consumer (worker en background) lo procesa de forma desacoplada.

Nuevas tareas asíncronas deben seguir el mismo patrón en lugar de ejecutarse inline en el request.

---

### Guard Clause (Early Return)
Valida y rechaza al inicio de la función. No anides la lógica principal dentro de `if` apilados.

```python
# Bien
async def send_summary(session_id, psychologist, db):
    session = await _get_owned_session(session_id, psychologist.id, db)
    if not patient.email:
        raise HTTPException(400, "...")
    # lógica principal aquí, sin anidamiento

# Mal
async def send_summary(...):
    if session:
        if patient:
            if patient.email:
                # lógica a 3 niveles de indentación
```

---

## Clean Code

### Nombres que revelan intención
- Variables: `session` no `s`, `patient_id` no `pid`.
- Funciones: `_get_owned_session()` no `_check_session()` — el nombre dice QUÉ devuelve, no QUÉ hace internamente.
- Booleanos: `is_active`, `cancel_at_period_end`, no `active`, `cancel`.

### Funciones pequeñas y con un solo nivel de abstracción
Una función no mezcla lógica de negocio, acceso a datos y construcción de respuesta en el mismo cuerpo. Si hace las tres cosas, extráe helpers.

### No repetir lógica (DRY aplicado con juicio)
Si la misma query, validación o construcción aparece en tres lugares, extráe una función. Si aparece en dos, espera a una tercera repetición antes de abstraer.

**Señales de duplicación en SyqueX:**
- `hash_password` / `verify_password` están en `auth.py` y `patient_auth.py` — deben estar en un módulo compartido `services/password.py`.
- La lógica de "get or create summary" en `summary_routes.py` está extraída correctamente en `_get_or_create_summary()`.

### Constantes con nombre, no magic values
```python
# Mal
if len(attempts) >= 5:
    raise ...

# Bien
_MAX_LOGIN_ATTEMPTS = 5
if len(attempts) >= _MAX_LOGIN_ATTEMPTS:
    raise ...
```

### Manejo de errores en el boundary correcto
- Lanza `HTTPException` solo en la capa de rutas (`api/`), no en `agent/` ni en helpers de base de datos.
- En las capas internas usa excepciones de dominio (`exceptions.py`) que las rutas convierten a HTTP.

### Tests: un assert por concepto, no por línea
Cada test verifica un comportamiento observable. El nombre del test describe la precondición y el resultado esperado.

```python
# Bien
async def test_send_summary_sets_sent_at():
    ...
    assert response.json()["sent_at"] is not None

# Mal
async def test_summary():
    # verifica 7 cosas en 30 líneas
```

### Comentarios solo cuando el WHY no es obvio
No documentes QUÉ hace el código — los nombres ya lo dicen. Documenta el POR QUÉ si hay una restricción no obvia, un workaround, o un contrato implícito.

```python
# Bien: explica una restricción no obvia
# Stripe retorna timestamps Unix; convertimos a UTC aware para evitar comparaciones naive/aware
db_sub.current_period_end = datetime.fromtimestamp(sub.current_period_end, timezone.utc)

# Mal: describe lo que ya es obvio en el código
# Obtenemos la suscripción del psychologist
result = await db.execute(select(Subscription).where(...))
```

---

## Checklist pre-PR

Antes de abrir un PR verifica:

- [ ] Cada función nueva tiene una sola responsabilidad
- [ ] No hay lógica de negocio dentro de los endpoints (solo coordinación)
- [ ] Las queries nuevas usan helpers existentes o crean uno reutilizable
- [ ] No hay magic numbers o strings hardcodeados — usar constantes o `settings`
- [ ] Hay tests para el happy path y al menos un caso de error
- [ ] Los nombres de variables y funciones revelan su intención sin necesitar comentarios
- [ ] No hay código duplicado entre `auth.py` y `patient_auth.py` o entre rutas similares
