# Spec: Perfil del Psicólogo + Actualización de Tarjeta

**Fecha:** 2026-05-29  
**Estado:** Aprobado
**Branch:** feature/psic-profile

---

## Resumen

Añadir una sección "Mi Perfil" a la app del psicólogo, accesible desde un nuevo tab en la navegación (BottomNav móvil + botón en sidebar desktop). Muestra datos personales de solo lectura y el estado de suscripción, con un modal embebido de Stripe para cambiar el método de pago sin salir de la app.

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
Campos de solo lectura. Todos los valores llegan de `GET /auth/me`.

| Label | Campo |
|-------|-------|
| Nombre | `name` |
| Correo electrónico | `email` |
| Cédula profesional | `cedula_profesional` (si null → "No registrada" en gris) |

Ícono de la card: persona, color sage.

### Card 2 — Suscripción y pago
Datos de `GET /billing/status` (ya existente) + campo nuevo `payment_method` que devuelve `{ brand, last4 }` cuando hay tarjeta registrada.

| Elemento | Lógica |
|----------|--------|
| Badge de plan | `active` → verde sage; `trialing` → amber; `canceled`/`past_due` → rojo |
| Próximo cobro | Solo visible si `status === 'active'` y `!cancel_at_period_end` |
| Chip de tarjeta | `VISA ···· 4242` — solo visible si `payment_method` existe |
| Botón "Cambiar tarjeta" | Visible solo si `status === 'active'` — abre `UpdateCardModal` |

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

### `GET /billing/status` — extensión
Añadir campo `payment_method` al response existente cuando el psicólogo tiene `stripe_customer_id` y una suscripción activa.

**Lógica:**
```python
# Dentro del bloque status == 'active'
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

Si no hay método de pago o el status no es `active`, `payment_method` se omite / es `null`.

---

### `POST /billing/setup-intent`
Nuevo endpoint en `api/billing.py`.

**Lógica:**
```python
setup_intent = stripe.SetupIntent.create(
    customer=psychologist.stripe_customer_id,
    payment_method_types=["card"],
    usage="off_session",
)
return {"client_secret": setup_intent.client_secret}
```

Requiere `get_current_psychologist`. Solo disponible si `stripe_customer_id` existe.

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

### Backend
- `test_get_me_returns_profile_fields` — verifica que `/auth/me` devuelve name, email, cedula_profesional
- `test_get_me_requires_auth` — 401 sin token
- `test_create_setup_intent_returns_client_secret` — mock de Stripe, verifica que el endpoint devuelve `client_secret`
- `test_webhook_setup_intent_succeeded_sets_default_pm` — mock de Stripe, verifica que el webhook actualiza el default payment method

### Frontend
- `ProfileScreen.test.jsx`: renderiza los dos cards, muestra datos del mock de `/auth/me` y `/billing/status`
- `UpdateCardModal.test.jsx`: renderiza en estado loading → idle; cierra con Escape; botón "Cancelar" cierra; muestra estado success
- `BottomNav.test.jsx`: tab "Perfil" presente y activo cuando `activeSection === 'profile'`

---

## Fuera de scope

- Edición de datos personales (nombre, cédula) — solo lectura en esta iteración
- Cambio de email — requiere flujo de verificación separado
- Cambio de contraseña — pantalla separada futura
- Historial de facturas — disponible en Stripe Customer Portal si se necesita en el futuro
