# Spec: Perfil del Psicólogo + Actualización de Tarjeta

**Fecha:** 2026-05-29  
**Estado:** Aprobado
**Branch:** feature/psic-profile

---

## Resumen

Añadir una sección "Mi Perfil" a la app del psicólogo, accesible desde un nuevo tab en la navegación (BottomNav móvil + botón en sidebar desktop). Muestra datos personales de solo lectura, excepto la contraseña, y el estado de suscripción, con un modal embebido de Stripe para cambiar el método de pago sin salir de la app. El campo Contraseña es editable inline (expansión en Card 1) mediante un nuevo endpoint `POST /auth/change-password` que requiere la contraseña actual. Los usuarios de cortesía (acceso activo sin suscripción Stripe) ven un estado diferenciado en Card 2 sin opciones de pago.

---

## Navegación

### Mobile (`BottomNav.jsx`)
- Añadir tercer tab `id: 'profile'`, label "Perfil", ícono de persona (`M16 7a4 4 0 11-8 0...`)
- `activeSection === 'profile'` renderiza `<ProfileScreen />` en el área principal

### Desktop (`App.jsx` — sidebar izquierda)
- Añadir botón "Mi Perfil" en el bloque inferior del sidebar, entre "Mi Agenda" y "Cerrar sesión"
- Mismo comportamiento: `setActiveSection('profile')`
- Estado activo: `bg-[#5a9e8a]/10 text-[#5a9e8a]` (igual que Agenda)

---

## Pantalla `ProfileScreen.jsx`

Ruta lógica: `activeSection === 'profile'`

### Layout
- Header con título "Mi Perfil" y subtítulo "Información de tu cuenta y suscripción"
- Dos cards en grid `grid-cols-2` (desktop) / stack vertical (mobile `grid-cols-1`)
- Fondo: `#fefcfb` (igual que otras secciones)

### Card 1 — Datos personales
Nombre, email y cédula son solo lectura. Contraseña es editable inline.
Todos los valores de solo lectura llegan de `GET /auth/me`.

| Label | Campo |
|-------|-------|
| Nombre | `name` |
| Correo electrónico | `email` |
| Contraseña | `••••••••` + ícono lápiz (expandible) |
| Cédula profesional | `cedula_profesional` (si null → "No registrada" en gris) |

Ícono de la card: persona, color sage.

### Campo Contraseña — edición inline (S: responsabilidad única)

El campo Contraseña se implementa como sub-componente `ProfilePasswordField` para no mezclar lógica de edición con la presentación de Card 1 (SRP). Recibe solo las props que necesita — no el objeto perfil completo (ISP).

**Interacción:** Click en el lápiz → el campo se expande inline dentro de Card 1 con tres inputs:
1. Contraseña actual
2. Nueva contraseña + componente `PasswordStrength` ya existente
3. Confirmar nueva contraseña
4. Botones "Guardar" (sage) + "Cancelar"

**Estados:**

| Estado | UI |
|--------|----|
| `idle` | `••••••••` + ícono lápiz |
| `editing` | Tres inputs expandidos, botones Guardar / Cancelar |
| `saving` | "Guardando…" deshabilitado, spinner inline |
| `success` | Checkmark sage + "Contraseña actualizada" — vuelve a `idle` tras 2 s |
| `error` | Mensaje rojo inline (contraseña actual incorrecta / no cumple política), campos siguen visibles |

**Cierre sin guardar:** Click en "Cancelar" o tecla `Escape` mientras `editing` → vuelve a `idle` limpiando los campos.

### Card 2 — Suscripción y pago
Datos de `GET /billing/status` (ya existente) + campo nuevo `payment_method` que devuelve `{ brand, last4 }` cuando hay tarjeta registrada.

| Elemento | Lógica |
|----------|--------|
| Badge de plan | `courtesy` → neutro (`bg-ink/5 text-ink-secondary`) "Acceso de Cortesía"; `active` → verde sage; `trialing` → amber; `canceled`/`past_due` → rojo |
| Próximo cobro | Solo visible si `status === 'active'` y `!cancel_at_period_end` |
| Chip de tarjeta | `VISA ···· 4242` — solo visible si `payment_method` existe |
| Botón "Cambiar tarjeta" | Visible solo si `status === 'active'` y `payment_method` existe — abre `UpdateCardModal` |

**Estado cortesía:** cuando `status === 'courtesy'`, Card 2 muestra únicamente el badge "Acceso de Cortesía". Sin próximo cobro, sin chip de tarjeta, sin botón "Cambiar tarjeta".

Ícono de la card: tarjeta de crédito, color amber.

---

## Modal `UpdateCardModal.jsx`

Se monta encima del ProfileScreen con overlay `bg-ink/35 backdrop-blur-[2px]`.

### Estados

**1. Cargando SetupIntent** (`loading`)  
Spinner centrado en el modal. Se dispara al abrir el modal (llamada a `POST /billing/setup-intent`).

**2. Formulario** (`idle`)  
- Subtítulo: "Tu nueva tarjeta se usará en el próximo ciclo de facturación."
- `<Elements stripe={stripePromise} options={{ clientSecret }}>` envuelve el modal
- `<PaymentElement />` ocupa el centro — Stripe maneja el renderizado y validación
- Botón primario "Guardar tarjeta" (sage) → llama `stripe.confirmSetup()`
- Botón ghost "Cancelar" → cierra modal sin cambios
- `stripePromise` se crea una vez con `loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)` a nivel módulo

**3. Guardando** (`submitting`)  
Botón muestra "Guardando…" y está deshabilitado. Spinner inline.

**4. Éxito** (`success`)  
- Ícono check verde en círculo sage-tinted
- Título: "¡Tarjeta actualizada!"
- Subtítulo: "Tu nueva tarjeta se usará a partir del próximo ciclo de facturación."
- Botón "Listo" cierra el modal y re-fetch de `GET /billing/status` para actualizar el chip

**5. Error** (`error`)  
- Banner rojo bajo el `PaymentElement` con el mensaje de error de Stripe
- Botón vuelve a estar activo para reintentar

### Cierre del modal
- Click en "✕" o "Cancelar" → cierra si no está en estado `submitting`
- Click en overlay → cierra (mismo guard)
- Tecla `Escape` → cierra

---

## Backend

### `GET /auth/me`
Nuevo endpoint en `api/auth.py`.

**Response:**
```json
{
  "id": "uuid",
  "name": "Psic. José Martínez",
  "email": "jose@syquex.mx",
  "cedula_profesional": "1234567"
}
```

Requiere `get_current_psychologist` (JWT auth estándar).

---

### `POST /auth/change-password`
Nuevo endpoint en `api/auth.py`. Permite a un psicólogo autenticado cambiar su contraseña verificando la actual.

**Schema Pydantic (separado del response — ISP):**
```python
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator('new_password')
    def password_strength(cls, v):
        return validate_password(v)
```

**Lógica (guard clause — falla rápido):**
```python
@router.post("/change-password", status_code=204)
async def change_password(
    body: ChangePasswordRequest,
    psychologist=Depends(get_current_psychologist),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(body.current_password, psychologist.password_hash):
        raise HTTPException(400, "Contraseña actual incorrecta")
    psychologist.password_hash = hash_password(body.new_password)
    db.add(AuditLog(psychologist_id=psychologist.id, action="password_changed"))
    await db.commit()
```

Devuelve `204 No Content`. Rate limit: el limitador existente de auth se aplica por IP.

---

### `GET /billing/status` — extensión
Dos cambios al endpoint existente:

**1. Detección de usuarios de cortesía (guard clause — antes del bloque `active`):**
```python
# Sub activa sin stripe_subscription_id → acceso de cortesía manual
if sub.status == "active" and not sub.stripe_subscription_id:
    return {"status": "courtesy"}
```

**2. Añadir campo `payment_method` para suscripciones Stripe activas:**
```python
# Dentro del bloque status == 'active' (solo llega aquí si stripe_subscription_id existe)
pm = stripe.Customer.retrieve(
    psychologist.stripe_customer_id,
    expand=["invoice_settings.default_payment_method"]
)
default_pm = pm.invoice_settings.default_payment_method
if default_pm:
    return {
        ...,
        "payment_method": {
            "brand": default_pm.card.brand,
            "last4": default_pm.card.last4,
        }
    }
```

Si no hay método de pago registrado en Stripe, `payment_method` se omite del response.

---

### `POST /billing/setup-intent`
Nuevo endpoint en `api/billing.py`.

**Lógica (guard clause — falla rápido si es usuario de cortesía):**
```python
@router.post("/setup-intent")
async def create_setup_intent(
    psychologist=Depends(get_current_psychologist),
):
    if not psychologist.stripe_customer_id:
        raise HTTPException(400, "Sin suscripción activa")
    setup_intent = stripe.SetupIntent.create(
        customer=psychologist.stripe_customer_id,
        payment_method_types=["card"],
        usage="off_session",
    )
    return {"client_secret": setup_intent.client_secret}
```

Requiere `get_current_psychologist`. Rechaza usuarios de cortesía con 400.

---

### Webhook — `setup_intent.succeeded`
Añadir handler en el webhook existente (`POST /billing/webhook`):

```python
elif event.type == "setup_intent.succeeded":
    si = event.data.object
    pm_id = si.payment_method
    customer_id = si.customer
    if pm_id and customer_id:
        stripe.PaymentMethod.attach(pm_id, customer=customer_id)
        stripe.Customer.modify(
            customer_id,
            invoice_settings={"default_payment_method": pm_id},
        )
```

Esto garantiza que la nueva tarjeta quede como método default para futuros cobros.

---

## Frontend — nuevas funciones en `api.js`

```js
export async function getMyProfile() {
  return _authFetch(`${API_BASE}/auth/me`);
}

export async function changePassword(currentPassword, newPassword) {
  return _authFetch(`${API_BASE}/auth/change-password`, {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export async function createSetupIntent() {
  return _authFetch(`${API_BASE}/billing/setup-intent`, { method: 'POST' });
}
```

El endpoint `getBillingStatus()` ya existe y se reutiliza tal cual; el campo `payment_method` aparece solo en el response cuando aplica.

---

## Variables de entorno

| Variable | Dónde | Descripción |
|----------|-------|-------------|
| `VITE_STRIPE_PUBLISHABLE_KEY` | `.env` frontend | Clave pública de Stripe (safe para cliente) |

---

## Paquetes a instalar

```bash
cd frontend
npm install @stripe/react-stripe-js @stripe/stripe-js
```

---

## Tests

### Backend (`backend/tests/test_profile_endpoints.py`)
- `test_get_me_returns_profile_fields` — `/auth/me` devuelve name, email, cedula_profesional
- `test_get_me_requires_auth` — 401 sin token
- `test_change_password_success` — contraseña actual correcta + nueva válida → 204, hash actualizado
- `test_change_password_wrong_current` — contraseña actual incorrecta → 400
- `test_change_password_policy_violation` — nueva contraseña débil → 422
- `test_change_password_requires_auth` — 401 sin token
- `test_billing_status_courtesy` — sub activa sin `stripe_subscription_id` devuelve `{"status": "courtesy"}`
- `test_create_setup_intent_returns_client_secret` — mock de Stripe, devuelve `client_secret`
- `test_create_setup_intent_rejects_courtesy_user` — usuario sin `stripe_customer_id` → 400
- `test_webhook_setup_intent_succeeded_sets_default_pm` — mock de Stripe, webhook actualiza default PM

### Frontend
- `ProfilePasswordField.test.jsx`: muestra `••••••••` + lápiz en estado idle
- `ProfilePasswordField.test.jsx`: click en lápiz expande los tres inputs
- `ProfilePasswordField.test.jsx`: Guardar llama `changePassword` con los valores correctos y pasa a `success`
- `ProfilePasswordField.test.jsx`: contraseña actual incorrecta (400) muestra error inline, campos visibles
- `ProfilePasswordField.test.jsx`: Cancelar vuelve a idle limpiando campos
- `ProfileScreen.test.jsx`: renderiza los dos cards con datos del mock de `/auth/me` y `/billing/status`
- `ProfileScreen.test.jsx`: estado `courtesy` muestra solo badge "Acceso de Cortesía", sin chip ni botón "Cambiar tarjeta"
- `UpdateCardModal.test.jsx`: loading → idle; cierra con Escape; Cancelar cierra; muestra success
- `BottomNav.test.jsx`: tab "Perfil" presente y activo cuando `activeSection === 'profile'`

---

## Documentación de arquitectura a actualizar

Al mergear esta feature, actualizar los siguientes archivos en `docs/architecture/`:

### `API_REFERENCE.md`

**Sección Auth (`/auth`)** — añadir después de `POST /reset-password`:

```
#### `GET /auth/me`
Devuelve los datos personales del psicólogo autenticado.
Auth: Bearer JWT.
Response: `{ id, name, email, cedula_profesional }`

#### `POST /auth/change-password`
Cambia la contraseña de un psicólogo autenticado verificando la actual.
Auth: Bearer JWT. Body: `{ current_password, new_password }`.
Returns 204. Errors: 400 (contraseña actual incorrecta), 422 (política).
```

**Sección Billing (`/billing`)** — actualizar descripción de `GET /billing/status`:
- Añadir valor `"courtesy"` al campo `status` (usuarios con acceso activo sin suscripción Stripe).
- Añadir campo `payment_method: { brand, last4 }` al response (presente solo cuando `status === 'active'` con Stripe y existe PM default).
- Añadir `POST /billing/setup-intent`: crea un Stripe SetupIntent, devuelve `{ client_secret }`. Requiere JWT. Retorna 400 si el usuario no tiene `stripe_customer_id`.
- Añadir en la sección de webhook: evento `setup_intent.succeeded` → adjunta PM al customer y lo establece como default.

---

### `FRONTEND_GUIDE.md`

**Árbol de componentes** — añadir bajo la sección de componentes de app:
```
├── ProfileScreen.jsx           # Perfil: datos personales + suscripción
│   ├── ProfilePasswordField.jsx # Sub-componente: edición inline de contraseña
│   └── UpdateCardModal.jsx     # Modal: actualización de tarjeta vía Stripe PaymentElement
```

**Sección BottomNav / navegación mobile** — actualizar para reflejar que ahora hay 3 tabs: Inicio, Agenda, Perfil. `activeSection` acepta `'patients' | 'agenda' | 'profile'`.

**Estado de auth flow** — `ProfileScreen` vive dentro del estado `Authenticated`, no es una pantalla de auth. No modifica el diagrama de auth screens.

---

### `ARCHITECTURE.md`

**Tabla de módulos backend** — actualizar `api/auth.py` para incluir `GET /me` y `POST /change-password`. Actualizar `api/billing.py` para incluir `POST /setup-intent` y webhook `setup_intent.succeeded`.

**Diagrama de componentes frontend** — añadir `ProfileScreen`, `ProfilePasswordField` y `UpdateCardModal` como nodos bajo `App`. Actualizar la nota de `activeSection` para incluir el valor `'profile'`.

**Navegación mobile** — actualizar descripción de BottomNav: 3 tabs (Inicio, Agenda, Perfil).

---

### `SECURITY_COMPLIANCE.md`

**Tabla de audit log** — añadir evento `password_changed` (acción disparada por `POST /auth/change-password` desde el perfil autenticado). Distinto de `password_reset_requested` / `password_reset_completed` que pertenecen al flujo unauthenticated de forgot-password.

---

## Fuera de scope

- Edición de datos personales (nombre, cédula) — solo lectura en esta iteración
- Cambio de email — requiere flujo de verificación separado
- Historial de facturas — disponible en Stripe Customer Portal si se necesita en el futuro
