# Perfil del Psicólogo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir pantalla "Mi Perfil" al psicólogo con datos personales de solo lectura y modal embebido de Stripe para cambiar método de pago, accesible desde un nuevo tab "Perfil" en la navegación.

**Architecture:** Backend añade `GET /auth/me`, extiende `GET /billing/status` con `payment_method`, añade `POST /billing/setup-intent` y un handler en el webhook existente. Frontend añade `ProfileScreen` + `UpdateCardModal` (con Stripe Elements), cable en `App.jsx` con nuevo tab en `BottomNav` (mobile) y botón en el sidebar desktop.

**Tech Stack:** FastAPI + SQLAlchemy (backend), React 18 + `@stripe/react-stripe-js` + `@stripe/stripe-js` (frontend), Stripe PaymentElement + SetupIntent para captura de tarjeta PCI-compliant.

---

## Mapa de archivos

**Creados:**
- `frontend/src/components/ProfileScreen.jsx`
- `frontend/src/components/ProfileScreen.test.jsx`
- `frontend/src/components/UpdateCardModal.jsx`
- `frontend/src/components/UpdateCardModal.test.jsx`
- `backend/tests/test_profile_endpoints.py`

**Modificados:**
- `frontend/src/components/BottomNav.jsx` — tercer tab "Perfil"
- `frontend/src/components/BottomNav.test.jsx` — test del tab nuevo
- `frontend/src/App.jsx` — import ProfileScreen, render sección 'profile', botón sidebar desktop
- `frontend/src/api.js` — añadir `getMyProfile`, `createSetupIntent`
- `frontend/package.json` — añadir paquetes Stripe
- `backend/api/auth.py` — añadir `GET /auth/me`
- `backend/api/billing.py` — extender `/status`, añadir `/setup-intent`, handler webhook

---

## Task 0: Feature branch + instalar paquetes Stripe

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Crear branch**

```bash
git checkout dev
git pull
git checkout -b feature/psic-profile
```

- [ ] **Step 2: Instalar paquetes**

```bash
cd frontend
npm install @stripe/react-stripe-js @stripe/stripe-js
```

- [ ] **Step 3: Verificar que aparecen en package.json**

```bash
grep stripe package.json
```

Esperado: líneas con `@stripe/react-stripe-js` y `@stripe/stripe-js` bajo `dependencies`.

- [ ] **Step 4: Añadir variable al .env de frontend**

Abrir (o crear) `frontend/.env` y añadir al final:

```
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_REEMPLAZA_CON_TU_CLAVE_PUBLICA
```

La clave pública (empieza con `pk_test_`) se encuentra en el Stripe Dashboard → Developers → API keys.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/.env
git commit -m "chore: install stripe frontend packages and add VITE_STRIPE_PUBLISHABLE_KEY"
```

---

## Task 1: Backend — GET /auth/me

**Files:**
- Modify: `backend/api/auth.py`
- Create: `backend/tests/test_profile_endpoints.py`

- [ ] **Step 1: Escribir el test (fallará)**

Crear `backend/tests/test_profile_endpoints.py`:

```python
import uuid
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from main import app
from api.auth import get_current_psychologist


def _mock_psych(**kwargs):
    defaults = dict(
        id=uuid.UUID("12345678-1234-5678-1234-567812345678"),
        name="Dr. Test",
        email="test@example.com",
        cedula_profesional="9876543",
        stripe_customer_id="cus_test123",
        is_active=True,
        trial_ends_at=None,
    )
    defaults.update(kwargs)
    m = MagicMock()
    for k, v in defaults.items():
        setattr(m, k, v)
    return m


def test_get_me_returns_profile_fields():
    psych = _mock_psych()
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    with TestClient(app) as client:
        resp = client.get("/api/v1/auth/me")

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Dr. Test"
    assert data["email"] == "test@example.com"
    assert data["cedula_profesional"] == "9876543"
    assert data["id"] == "12345678-1234-5678-1234-567812345678"


def test_get_me_null_cedula():
    psych = _mock_psych(cedula_profesional=None)
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    with TestClient(app) as client:
        resp = client.get("/api/v1/auth/me")

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["cedula_profesional"] is None


def test_get_me_requires_auth():
    with TestClient(app) as client:
        resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401
```

- [ ] **Step 2: Ejecutar el test — debe fallar**

```bash
cd backend
python -m pytest tests/test_profile_endpoints.py::test_get_me_returns_profile_fields -v
```

Esperado: `FAILED` — `404 Not Found` (endpoint no existe aún).

- [ ] **Step 3: Implementar el endpoint**

En `backend/api/auth.py`, añadir al final del archivo (antes de las funciones auxiliares de paciente si las hay, después del último `@router` de psicólogo):

```python
@router.get("/me")
async def get_me(
    psychologist=Depends(get_current_psychologist),
):
    return {
        "id": str(psychologist.id),
        "name": psychologist.name,
        "email": psychologist.email,
        "cedula_profesional": psychologist.cedula_profesional,
    }
```

- [ ] **Step 4: Ejecutar todos los tests del archivo — deben pasar**

```bash
python -m pytest tests/test_profile_endpoints.py -v
```

Esperado: 3 tests `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add backend/api/auth.py backend/tests/test_profile_endpoints.py
git commit -m "feat(backend): add GET /auth/me endpoint"
```

---

## Task 2: Backend — POST /billing/setup-intent

**Files:**
- Modify: `backend/api/billing.py`
- Modify: `backend/tests/test_profile_endpoints.py`

- [ ] **Step 1: Añadir test**

En `backend/tests/test_profile_endpoints.py`, añadir al final:

```python
from unittest.mock import patch


def test_create_setup_intent_returns_client_secret():
    psych = _mock_psych()
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    mock_si = MagicMock()
    mock_si.client_secret = "seti_test_secret_xyz"

    with patch("api.billing.stripe.SetupIntent.create", return_value=mock_si):
        with TestClient(app) as client:
            resp = client.post("/api/v1/billing/setup-intent")

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["client_secret"] == "seti_test_secret_xyz"


def test_create_setup_intent_no_stripe_customer():
    psych = _mock_psych(stripe_customer_id=None)
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    with TestClient(app) as client:
        resp = client.post("/api/v1/billing/setup-intent")

    app.dependency_overrides.clear()

    assert resp.status_code == 400
```

- [ ] **Step 2: Ejecutar — deben fallar**

```bash
python -m pytest tests/test_profile_endpoints.py::test_create_setup_intent_returns_client_secret -v
```

Esperado: `FAILED` — 404.

- [ ] **Step 3: Implementar el endpoint**

En `backend/api/billing.py`, añadir después del endpoint `/cancel`:

```python
@router.post("/setup-intent")
async def create_setup_intent(
    psychologist=Depends(get_current_psychologist),
):
    if not psychologist.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No hay cuenta de facturación configurada")
    try:
        setup_intent = stripe.SetupIntent.create(
            customer=psychologist.stripe_customer_id,
            payment_method_types=["card"],
            usage="off_session",
        )
        return {"client_secret": setup_intent.client_secret}
    except Exception as e:
        logger.error("Stripe setup intent error: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="Error al comunicarse con Stripe")
```

- [ ] **Step 4: Ejecutar los dos tests nuevos — deben pasar**

```bash
python -m pytest tests/test_profile_endpoints.py::test_create_setup_intent_returns_client_secret tests/test_profile_endpoints.py::test_create_setup_intent_no_stripe_customer -v
```

Esperado: 2 tests `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add backend/api/billing.py backend/tests/test_profile_endpoints.py
git commit -m "feat(backend): add POST /billing/setup-intent endpoint"
```

---

## Task 3: Backend — Extender GET /billing/status con payment_method

**Files:**
- Modify: `backend/api/billing.py`
- Modify: `backend/tests/test_profile_endpoints.py`

- [ ] **Step 1: Añadir test**

En `backend/tests/test_profile_endpoints.py`, añadir al final:

```python
def test_billing_status_active_includes_payment_method():
    from database import get_db
    psych = _mock_psych()
    app.dependency_overrides[get_current_psychologist] = lambda: psych

    mock_sub = MagicMock()
    mock_sub.status = "active"
    mock_sub.current_period_end = None
    mock_sub.cancel_at_period_end = False

    mock_pm = MagicMock()
    mock_pm.card.brand = "visa"
    mock_pm.card.last4 = "4242"

    mock_customer = MagicMock()
    mock_customer.invoice_settings.default_payment_method = mock_pm

    from database import get_db, Subscription
    from sqlalchemy.ext.asyncio import AsyncSession

    async def mock_get_db():
        mock_db = MagicMock(spec=AsyncSession)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_sub
        mock_db.execute = MagicMock(return_value=mock_result)
        # Make execute awaitable
        import asyncio
        async def _exec(*a, **kw): return mock_result
        mock_db.execute = _exec
        yield mock_db

    app.dependency_overrides[get_current_psychologist] = lambda: psych
    app.dependency_overrides[get_db] = mock_get_db

    with patch("api.billing.stripe.Customer.retrieve", return_value=mock_customer):
        with TestClient(app) as client:
            resp = client.get("/api/v1/billing/status")

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "active"
    assert data["payment_method"]["brand"] == "visa"
    assert data["payment_method"]["last4"] == "4242"
```

- [ ] **Step 2: Ejecutar — debe fallar**

```bash
python -m pytest tests/test_profile_endpoints.py::test_billing_status_active_includes_payment_method -v
```

Esperado: `FAILED` — no hay campo `payment_method` en el response actual.

- [ ] **Step 3: Modificar el bloque `active` en GET /billing/status**

En `backend/api/billing.py`, localizar el bloque:

```python
if sub.status == "active":
    return {
        "status": "active",
        "current_period_end": sub.current_period_end,
        "cancel_at_period_end": sub.cancel_at_period_end,
    }
```

Reemplazar con:

```python
if sub.status == "active":
    payment_method = None
    if psychologist.stripe_customer_id:
        try:
            customer = stripe.Customer.retrieve(
                psychologist.stripe_customer_id,
                expand=["invoice_settings.default_payment_method"],
            )
            pm = customer.invoice_settings.default_payment_method
            if pm and hasattr(pm, "card") and pm.card:
                payment_method = {"brand": pm.card.brand, "last4": pm.card.last4}
        except Exception as e:
            logger.warning("Could not fetch payment method from Stripe: %s", e)
    return {
        "status": "active",
        "current_period_end": sub.current_period_end,
        "cancel_at_period_end": sub.cancel_at_period_end,
        "payment_method": payment_method,
    }
```

Nota: la firma del endpoint `get_billing_status` ya tiene `psychologist = Depends(get_current_psychologist)`. Verificar que esté presente; si no, añadirlo junto a `db`.

- [ ] **Step 4: Ejecutar el test — debe pasar**

```bash
python -m pytest tests/test_profile_endpoints.py::test_billing_status_active_includes_payment_method -v
```

Esperado: `PASSED`.

- [ ] **Step 5: Ejecutar todos los tests del archivo para verificar no hay regresiones**

```bash
python -m pytest tests/test_profile_endpoints.py -v
```

Esperado: todos `PASSED`.

- [ ] **Step 6: Commit**

```bash
git add backend/api/billing.py backend/tests/test_profile_endpoints.py
git commit -m "feat(backend): extend billing/status with payment_method field"
```

---

## Task 4: Backend — Webhook setup_intent.succeeded

**Files:**
- Modify: `backend/api/billing.py`
- Modify: `backend/tests/test_profile_endpoints.py`

- [ ] **Step 1: Añadir test**

En `backend/tests/test_profile_endpoints.py`, añadir al final:

```python
import json


def test_webhook_setup_intent_succeeded_sets_default_pm():
    event_payload = {
        "id": "evt_test_setup_intent_001",
        "type": "setup_intent.succeeded",
        "data": {
            "object": {
                "id": "seti_test",
                "payment_method": "pm_test_4242",
                "customer": "cus_test123",
            }
        },
    }

    mock_event = MagicMock()
    mock_event.id = "evt_test_setup_intent_001"
    mock_event.type = "setup_intent.succeeded"
    mock_event.data.object.payment_method = "pm_test_4242"
    mock_event.data.object.customer = "cus_test123"

    from database import get_db, ProcessedStripeEvent

    async def mock_get_db():
        mock_db = MagicMock()
        # ProcessedStripeEvent lookup — not found (new event)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        async def _exec(*a, **kw): return mock_result
        mock_db.execute = _exec
        mock_db.add = MagicMock()
        mock_db.commit = MagicMock(return_value=None)
        async def _commit(): pass
        mock_db.commit = _commit
        yield mock_db

    app.dependency_overrides[get_db] = mock_get_db

    with patch("api.billing.stripe.Webhook.construct_event", return_value=mock_event), \
         patch("api.billing.stripe.PaymentMethod.attach") as mock_attach, \
         patch("api.billing.stripe.Customer.modify") as mock_modify:

        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/billing/webhook",
                content=json.dumps(event_payload),
                headers={"stripe-signature": "test_sig"},
            )

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    mock_attach.assert_called_once_with("pm_test_4242", customer="cus_test123")
    mock_modify.assert_called_once_with(
        "cus_test123",
        invoice_settings={"default_payment_method": "pm_test_4242"},
    )
```

- [ ] **Step 2: Ejecutar — debe fallar**

```bash
python -m pytest tests/test_profile_endpoints.py::test_webhook_setup_intent_succeeded_sets_default_pm -v
```

Esperado: `FAILED`.

- [ ] **Step 3: Añadir handler en el webhook existente**

En `backend/api/billing.py`, en la función `stripe_webhook`, localizar el último `elif event.type in [...]` y añadir después:

```python
elif event.type == "setup_intent.succeeded":
    si = event.data.object
    pm_id = si.payment_method
    customer_id = si.customer
    if pm_id and customer_id:
        try:
            stripe.PaymentMethod.attach(pm_id, customer=customer_id)
            stripe.Customer.modify(
                customer_id,
                invoice_settings={"default_payment_method": pm_id},
            )
        except Exception as e:
            logger.error("Failed to set default payment method: %s", e, exc_info=True)
```

- [ ] **Step 4: Ejecutar todos los tests — deben pasar**

```bash
python -m pytest tests/test_profile_endpoints.py -v
```

Esperado: todos `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add backend/api/billing.py backend/tests/test_profile_endpoints.py
git commit -m "feat(backend): handle setup_intent.succeeded webhook to update default payment method"
```

---

## Task 5: Frontend — api.js: getMyProfile + createSetupIntent

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Añadir las dos funciones a api.js**

Localizar el bloque `// --- Billing ---` en `frontend/src/api.js` (donde están `getBillingStatus`, `createCheckout`, `cancelSubscription`) y añadir al final de ese bloque:

```js
export async function getMyProfile() {
  return _authFetch(`${API_BASE}/auth/me`);
}

export async function createSetupIntent() {
  return _authFetch(`${API_BASE}/billing/setup-intent`, { method: 'POST' });
}
```

- [ ] **Step 2: Verificar que las funciones se exportan correctamente**

```bash
cd frontend
grep -n "getMyProfile\|createSetupIntent" src/api.js
```

Esperado: dos líneas con `export async function`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat(frontend): add getMyProfile and createSetupIntent to api.js"
```

---

## Task 6: Frontend — BottomNav: añadir tab "Perfil"

**Files:**
- Modify: `frontend/src/components/BottomNav.jsx`
- Modify: `frontend/src/components/BottomNav.test.jsx`

- [ ] **Step 1: Añadir test del tab nuevo**

En `frontend/src/components/BottomNav.test.jsx`, añadir dos tests al `describe('BottomNav')`:

```js
it('renders Perfil tab', () => {
  render(<BottomNav activeSection="patients" onSectionChange={() => {}} />);
  expect(screen.getByText('Perfil')).toBeInTheDocument();
});

it('calls onSectionChange with "profile" when Perfil tab is clicked', () => {
  const onChange = vi.fn();
  render(<BottomNav activeSection="patients" onSectionChange={onChange} />);
  fireEvent.click(screen.getByText('Perfil').closest('button'));
  expect(onChange).toHaveBeenCalledWith('profile');
});
```

- [ ] **Step 2: Ejecutar — deben fallar**

```bash
cd frontend
npx vitest run src/components/BottomNav.test.jsx
```

Esperado: 2 tests `FAILED` — "Unable to find an element with the text: Perfil".

- [ ] **Step 3: Añadir el tab en BottomNav.jsx**

En `frontend/src/components/BottomNav.jsx`, localizar el array `tabs` y añadir el tercer elemento:

```js
const tabs = [
  {
    id: 'patients',
    label: 'Inicio',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
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
    id: 'profile',
    label: 'Perfil',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
];
```

- [ ] **Step 4: Ejecutar todos los tests de BottomNav — deben pasar**

```bash
npx vitest run src/components/BottomNav.test.jsx
```

Esperado: 5 tests `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BottomNav.jsx frontend/src/components/BottomNav.test.jsx
git commit -m "feat(frontend): add Perfil tab to BottomNav"
```

---

## Task 7: Frontend — ProfileScreen.jsx

**Files:**
- Create: `frontend/src/components/ProfileScreen.jsx`
- Create: `frontend/src/components/ProfileScreen.test.jsx`

- [ ] **Step 1: Escribir el test**

Crear `frontend/src/components/ProfileScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileScreen from './ProfileScreen';

vi.mock('../api', () => ({
  getMyProfile: vi.fn(),
  getBillingStatus: vi.fn(),
}));

vi.mock('./UpdateCardModal', () => ({
  default: ({ open }) => open ? <div data-testid="update-card-modal" /> : null,
}));

import { getMyProfile, getBillingStatus } from '../api';

const mockProfile = {
  id: 'uuid-1',
  name: 'Dr. Test',
  email: 'test@example.com',
  cedula_profesional: '1234567',
};

const mockBillingActive = {
  status: 'active',
  current_period_end: '2026-06-28T00:00:00Z',
  cancel_at_period_end: false,
  payment_method: { brand: 'visa', last4: '4242' },
};

describe('ProfileScreen', () => {
  beforeEach(() => {
    getMyProfile.mockResolvedValue(mockProfile);
    getBillingStatus.mockResolvedValue(mockBillingActive);
  });

  it('muestra los datos personales del psicólogo', async () => {
    render(<ProfileScreen />);
    await waitFor(() => {
      expect(screen.getByText('Dr. Test')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
      expect(screen.getByText('1234567')).toBeInTheDocument();
    });
  });

  it('muestra badge de plan activo y chip de tarjeta', async () => {
    render(<ProfileScreen />);
    await waitFor(() => {
      expect(screen.getByText(/Plan Pro/i)).toBeInTheDocument();
      expect(screen.getByText(/4242/)).toBeInTheDocument();
    });
  });

  it('muestra "No registrada" cuando cédula es null', async () => {
    getMyProfile.mockResolvedValue({ ...mockProfile, cedula_profesional: null });
    render(<ProfileScreen />);
    await waitFor(() => {
      expect(screen.getByText('No registrada')).toBeInTheDocument();
    });
  });

  it('abre el modal al hacer click en "Cambiar tarjeta"', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen />);
    await waitFor(() => screen.getByText(/Cambiar tarjeta/i));
    await user.click(screen.getByText(/Cambiar tarjeta/i));
    expect(screen.getByTestId('update-card-modal')).toBeInTheDocument();
  });

  it('no muestra botón "Cambiar tarjeta" en trial', async () => {
    getBillingStatus.mockResolvedValue({ status: 'trialing', days_remaining: 10 });
    render(<ProfileScreen />);
    await waitFor(() => screen.getByText('Dr. Test'));
    expect(screen.queryByText(/Cambiar tarjeta/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Ejecutar — deben fallar**

```bash
npx vitest run src/components/ProfileScreen.test.jsx
```

Esperado: `FAILED` — el componente no existe.

- [ ] **Step 3: Crear ProfileScreen.jsx**

Crear `frontend/src/components/ProfileScreen.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { getMyProfile, getBillingStatus } from '../api';
import UpdateCardModal from './UpdateCardModal';

const BRAND_LABELS = { visa: 'VISA', mastercard: 'MC', amex: 'AMEX', discover: 'DISC' };

function FieldRow({ label, value }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-[10px] font-semibold text-ink-tertiary uppercase tracking-widest mb-1">
        {label}
      </div>
      {value ? (
        <div className="text-[13px] text-ink font-medium">{value}</div>
      ) : (
        <div className="text-[13px] text-ink-muted italic">No registrada</div>
      )}
    </div>
  );
}

function PlanBadge({ status }) {
  const variants = {
    active: 'bg-[#f0faf7] text-[#5a9e8a]',
    trialing: 'bg-[#fef9ec] text-[#c4935a]',
    past_due: 'bg-[#fef2f2] text-red-500',
    canceled: 'bg-[#fef2f2] text-red-500',
    unpaid: 'bg-[#fef2f2] text-red-500',
  };
  const labels = {
    active: 'Plan Pro — Activo',
    trialing: 'Período de prueba',
    past_due: 'Pago pendiente',
    canceled: 'Suscripción cancelada',
    unpaid: 'Pago pendiente',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${variants[status] || variants.canceled}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {labels[status] || status}
    </span>
  );
}

function PaymentChip({ brand, last4 }) {
  return (
    <div className="flex items-center gap-2 bg-[#f4f4f2] rounded-lg px-3 py-2 mt-2">
      <span className="text-[9px] font-bold bg-[#18181b] text-white px-1.5 py-0.5 rounded tracking-wider">
        {BRAND_LABELS[brand] || brand?.toUpperCase()}
      </span>
      <span className="text-[12px] text-ink-secondary font-mono">
        <span className="tracking-widest text-ink-muted">•••• </span>{last4}
      </span>
    </div>
  );
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState(null);
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cardModalOpen, setCardModalOpen] = useState(false);

  useEffect(() => {
    Promise.all([getMyProfile(), getBillingStatus()])
      .then(([p, b]) => { setProfile(p); setBilling(b); })
      .finally(() => setLoading(false));
  }, []);

  const handleCardSuccess = () => {
    // No cerrar el modal aquí — UpdateCardModal muestra el estado de éxito
    // y el usuario lo cierra con el botón "Listo" (que llama onClose)
    getBillingStatus().then(setBilling);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#fefcfb]">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#5a9e8a]" />
      </div>
    );
  }

  const canChangeCard = billing?.status === 'active';
  const showNextBilling = billing?.status === 'active' && !billing?.cancel_at_period_end && billing?.current_period_end;

  return (
    <div className="flex-1 overflow-y-auto bg-[#fefcfb]">
      <div className="max-w-3xl mx-auto px-6 md:px-8 py-6 md:py-8">
        {/* Header */}
        <div className="mb-6 pb-4 border-b border-[#18181b]/[0.06]">
          <h2 className="text-xl font-bold text-[#18181b]">Mi Perfil</h2>
          <p className="text-sm text-[#71717a] mt-1">Información de tu cuenta y suscripción</p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1 — Datos personales */}
          <div className="bg-white border border-[#18181b]/[0.08] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[#18181b]/[0.05]">
              <div className="w-7 h-7 rounded-lg bg-[#5a9e8a]/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-[#5a9e8a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <span className="text-[13px] font-semibold text-[#18181b]">Datos personales</span>
            </div>
            <div className="px-4 py-4">
              <FieldRow label="Nombre" value={profile?.name} />
              <FieldRow label="Correo electrónico" value={profile?.email} />
              <FieldRow label="Cédula profesional" value={profile?.cedula_profesional} />
            </div>
          </div>

          {/* Card 2 — Suscripción y pago */}
          <div className="bg-white border border-[#18181b]/[0.08] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[#18181b]/[0.05]">
              <div className="w-7 h-7 rounded-lg bg-[#c4935a]/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-[#c4935a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <span className="text-[13px] font-semibold text-[#18181b]">Suscripción y pago</span>
            </div>
            <div className="px-4 py-4">
              <div className="mb-4">
                <div className="text-[10px] font-semibold text-ink-tertiary uppercase tracking-widest mb-2">Plan actual</div>
                {billing && <PlanBadge status={billing.status} />}
              </div>

              {showNextBilling && (
                <div className="mb-4">
                  <div className="text-[10px] font-semibold text-ink-tertiary uppercase tracking-widest mb-1">Próximo cobro</div>
                  <div className="text-[13px] text-[#18181b] font-medium">
                    {new Date(billing.current_period_end).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })} — $499 MXN
                  </div>
                </div>
              )}

              {billing?.payment_method && (
                <div className="mb-4">
                  <div className="text-[10px] font-semibold text-ink-tertiary uppercase tracking-widest mb-1">Método de pago</div>
                  <PaymentChip brand={billing.payment_method.brand} last4={billing.payment_method.last4} />
                </div>
              )}

              {canChangeCard && (
                <button
                  onClick={() => setCardModalOpen(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#18181b]/[0.12] text-[13px] font-medium text-[#18181b] hover:bg-[#f4f4f2] transition-colors mt-2"
                >
                  <svg className="w-3.5 h-3.5 text-[#18181b]/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  Cambiar tarjeta
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <UpdateCardModal
        open={cardModalOpen}
        onClose={() => setCardModalOpen(false)}
        onSuccess={handleCardSuccess}
      />
    </div>
  );
}
```

- [ ] **Step 4: Ejecutar tests — deben pasar**

```bash
npx vitest run src/components/ProfileScreen.test.jsx
```

Esperado: 5 tests `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ProfileScreen.jsx frontend/src/components/ProfileScreen.test.jsx
git commit -m "feat(frontend): add ProfileScreen component"
```

---

## Task 8: Frontend — UpdateCardModal.jsx

**Files:**
- Create: `frontend/src/components/UpdateCardModal.jsx`
- Create: `frontend/src/components/UpdateCardModal.test.jsx`

- [ ] **Step 1: Escribir el test**

Crear `frontend/src/components/UpdateCardModal.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({
    confirmSetup: vi.fn().mockResolvedValue({ error: null }),
  }),
  useElements: () => ({}),
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue({}),
}));

vi.mock('../api', () => ({
  createSetupIntent: vi.fn(),
}));

import { createSetupIntent } from '../api';
import UpdateCardModal from './UpdateCardModal';

describe('UpdateCardModal', () => {
  beforeEach(() => {
    createSetupIntent.mockResolvedValue({ client_secret: 'seti_test_secret' });
  });

  it('no renderiza nada cuando está cerrado', () => {
    const { container } = render(
      <UpdateCardModal open={false} onClose={vi.fn()} onSuccess={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('muestra spinner mientras carga el SetupIntent', async () => {
    createSetupIntent.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<UpdateCardModal open={true} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('muestra el formulario de Stripe cuando el secret está listo', async () => {
    render(<UpdateCardModal open={true} onClose={vi.fn()} onSuccess={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('payment-element')).toBeInTheDocument();
      expect(screen.getByText('Guardar tarjeta')).toBeInTheDocument();
    });
  });

  it('llama onClose cuando se hace click en Cancelar', async () => {
    const onClose = vi.fn();
    render(<UpdateCardModal open={true} onClose={onClose} onSuccess={vi.fn()} />);
    await waitFor(() => screen.getByText('Cancelar'));
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('cierra con tecla Escape', async () => {
    const onClose = vi.fn();
    render(<UpdateCardModal open={true} onClose={onClose} onSuccess={vi.fn()} />);
    await waitFor(() => screen.getByTestId('payment-element'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('muestra estado de éxito tras confirmSetup exitoso', async () => {
    const { useStripe } = await import('@stripe/react-stripe-js');
    useStripe.mockReturnValue({
      confirmSetup: vi.fn().mockResolvedValue({ error: null }),
    });
    const onSuccess = vi.fn();
    render(<UpdateCardModal open={true} onClose={vi.fn()} onSuccess={onSuccess} />);
    await waitFor(() => screen.getByText('Guardar tarjeta'));
    fireEvent.click(screen.getByText('Guardar tarjeta'));
    await waitFor(() => {
      expect(screen.getByText('¡Tarjeta actualizada!')).toBeInTheDocument();
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it('llama onClose cuando se hace click en el overlay', async () => {
    const onClose = vi.fn();
    render(<UpdateCardModal open={true} onClose={onClose} onSuccess={vi.fn()} />);
    await waitFor(() => screen.getByTestId('payment-element'));
    fireEvent.click(screen.getByTestId('modal-overlay'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ejecutar — deben fallar**

```bash
npx vitest run src/components/UpdateCardModal.test.jsx
```

Esperado: `FAILED` — el componente no existe.

- [ ] **Step 3: Crear UpdateCardModal.jsx**

Crear `frontend/src/components/UpdateCardModal.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { createSetupIntent } from '../api';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

function CardForm({ onSuccess, onClose }) {
  const stripe = useStripe();
  const elements = useElements();
  const [status, setStatus] = useState('idle'); // idle | submitting | error
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements || status === 'submitting') return;

    setStatus('submitting');
    setErrorMsg('');

    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });

    if (error) {
      setErrorMsg(error.message || 'Error al procesar la tarjeta');
      setStatus('error');
    } else {
      onSuccess();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-5">
      <p className="text-[13px] text-[#71717a] mb-4 leading-relaxed">
        Tu nueva tarjeta se usará en el próximo ciclo de facturación.
      </p>

      <div className="border border-[#18181b]/[0.12] rounded-lg overflow-hidden mb-4">
        <div className="px-3 py-2 bg-[#fafafa] border-b border-[#18181b]/[0.07] flex items-center gap-2">
          <svg className="w-3 h-3 text-[#635bff]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 1a5 5 0 00-5 5v3H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2V11a2 2 0 00-2-2h-2V6a5 5 0 00-5-5zm0 2a3 3 0 013 3v3H9V6a3 3 0 013-3zm0 10a2 2 0 110 4 2 2 0 010-4z"/>
          </svg>
          <span className="text-[10px] font-semibold text-[#a1a1aa] uppercase tracking-wider">Pago seguro</span>
        </div>
        <div className="p-3">
          <PaymentElement />
        </div>
      </div>

      {(status === 'error') && errorMsg && (
        <div className="mb-4 px-3 py-2.5 bg-[#fef2f2] border border-red-200 rounded-lg text-[12px] text-red-600">
          {errorMsg}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={status === 'submitting'}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-semibold text-white transition-all ${
            status === 'submitting'
              ? 'bg-[#5a9e8a] opacity-60 cursor-not-allowed'
              : 'bg-[#5a9e8a] hover:bg-[#4a8e7a]'
          }`}
        >
          {status === 'submitting' ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Guardando…
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
              Guardar tarjeta
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={status === 'submitting'}
          className="w-full py-2 text-[12px] text-[#71717a] hover:text-[#18181b] transition-colors disabled:opacity-40"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function SuccessState({ onClose }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-8">
      <div className="w-14 h-14 rounded-full bg-[#f0faf7] flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-[#5a9e8a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-[15px] font-bold text-[#18181b] mb-2">¡Tarjeta actualizada!</h3>
      <p className="text-[13px] text-[#71717a] leading-relaxed mb-6">
        Tu nueva tarjeta se usará a partir del próximo ciclo de facturación.
      </p>
      <button
        onClick={onClose}
        className="px-6 py-2.5 bg-[#5a9e8a] text-white text-[13px] font-semibold rounded-lg hover:bg-[#4a8e7a] transition-colors"
      >
        Listo
      </button>
    </div>
  );
}

export default function UpdateCardModal({ open, onClose, onSuccess }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [loadingSecret, setLoadingSecret] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    if (!open) {
      setClientSecret(null);
      setSucceeded(false);
      return;
    }
    setLoadingSecret(true);
    createSetupIntent()
      .then(data => setClientSecret(data.client_secret))
      .catch(() => {})
      .finally(() => setLoadingSecret(false));
  }, [open]);

  const handleEscape = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, handleEscape]);

  if (!open) return null;

  const handleSuccess = () => {
    setSucceeded(true);
    onSuccess();
  };

  return (
    <div
      data-testid="modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#18181b]/35 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {!succeeded && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#18181b]/[0.06]">
            <h3 className="text-[14px] font-bold text-[#18181b]">Cambiar método de pago</h3>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg bg-[#f4f4f2] flex items-center justify-center text-[#71717a] hover:text-[#18181b] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        {succeeded ? (
          <SuccessState onClose={onClose} />
        ) : loadingSecret || !clientSecret ? (
          <div className="flex items-center justify-center py-16">
            <div
              role="status"
              aria-label="Cargando"
              className="w-6 h-6 border-2 border-[#5a9e8a]/30 border-t-[#5a9e8a] rounded-full animate-spin"
            />
          </div>
        ) : (
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <CardForm onSuccess={handleSuccess} onClose={onClose} />
          </Elements>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Ejecutar los tests — deben pasar**

```bash
npx vitest run src/components/UpdateCardModal.test.jsx
```

Esperado: 6 tests `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/UpdateCardModal.jsx frontend/src/components/UpdateCardModal.test.jsx
git commit -m "feat(frontend): add UpdateCardModal with embedded Stripe PaymentElement"
```

---

## Task 9: Frontend — App.jsx wiring

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Añadir el import de ProfileScreen**

Al inicio del archivo `frontend/src/App.jsx`, añadir con los demás imports de componentes:

```js
import ProfileScreen from './components/ProfileScreen';
```

- [ ] **Step 2: Añadir sección 'profile' en el área desktop**

En `frontend/src/App.jsx`, localizar el bloque (línea ~1001):

```jsx
{activeSection === 'patients' && (<>
```

Añadir **inmediatamente antes** de esa línea:

```jsx
{activeSection === 'profile' && <ProfileScreen />}
```

- [ ] **Step 3: Añadir botón "Mi Perfil" en el sidebar desktop**

Localizar el bloque del sidebar desktop (líneas ~944-976):

```jsx
<div className="border-t border-ink/[0.07] p-3 flex-shrink-0 flex flex-col gap-1">
  <button
    onClick={() => setActiveSection(activeSection === 'agenda' ? 'patients' : 'agenda')}
    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${activeSection === 'agenda'
      ? 'bg-[#5a9e8a]/10 text-[#5a9e8a]'
      : 'text-ink-secondary hover:bg-ink/[0.04] hover:text-ink'
      }`}
  >
    ...Mi Agenda...
  </button>
  <button
    onClick={handleLogout}
    ...
  >Cerrar sesión</button>
```

Añadir el botón "Mi Perfil" **entre "Mi Agenda" y "Cerrar sesión"**:

```jsx
<button
  onClick={() => setActiveSection('profile')}
  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${activeSection === 'profile'
    ? 'bg-[#5a9e8a]/10 text-[#5a9e8a]'
    : 'text-ink-secondary hover:bg-ink/[0.04] hover:text-ink'
    }`}
>
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
  Mi Perfil
</button>
```

- [ ] **Step 4: Añadir sección 'profile' en el layout móvil**

En `frontend/src/App.jsx`, localizar la sección mobile (línea ~1595):

```jsx
{activeSection === 'agenda' && (
  <div className="flex flex-col flex-1 min-h-0">
    ...
  </div>
)}
```

Añadir **inmediatamente después** de ese bloque y **antes** de `<BottomNav ...`:

```jsx
{activeSection === 'profile' && <ProfileScreen />}
```

- [ ] **Step 5: Verificar que el servidor de desarrollo no tiene errores**

```bash
cd frontend
npm run dev
```

Abrir `http://localhost:5173` (o el puerto que use Vite). Navegar a:
- Tab "Perfil" en móvil → debe mostrar la pantalla de perfil
- Botón "Mi Perfil" en desktop → debe activarse en el sidebar

Verificar en consola del navegador que no hay errores JS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): wire ProfileScreen into navigation (mobile tab + desktop sidebar)"
```

---

## Task 10: Suite completa + PR

- [ ] **Step 1: Ejecutar todos los tests del frontend**

```bash
cd frontend
npx vitest run
```

Esperado: todos los tests existentes + los nuevos pasan. Sin regresiones.

- [ ] **Step 2: Ejecutar todos los tests del backend**

```bash
cd backend
python -m pytest tests/ -v
```

Esperado: todos pasan.

- [ ] **Step 3: Probar el flujo completo manualmente**

Con Docker corriendo (`docker-compose up -d postgres`), backend y frontend en marcha, y `stripe listen --forward-to localhost:8000/api/v1/billing/webhook` activo:

1. Login como psicólogo con suscripción activa
2. Click en tab "Perfil" (móvil) o botón "Mi Perfil" (desktop)
3. Verificar que aparecen nombre, email y cédula
4. Verificar que aparece el badge "Plan Pro — Activo" y la tarjeta actual
5. Click en "Cambiar tarjeta"
6. Ingresar `4242 4242 4242 4242`, fecha futura, CVC cualquiera
7. Click "Guardar tarjeta"
8. Verificar que aparece la pantalla de éxito
9. Verificar en terminal del `stripe listen` que llega el evento `setup_intent.succeeded`
10. Verificar que el chip de tarjeta en el perfil refleja la nueva tarjeta (puede requerir recargar el perfil)

- [ ] **Step 4: Push y PR**

```bash
git push -u origin feature/psic-profile
```

Abrir PR hacia `dev` con título: `feat: perfil del psicólogo + actualización de tarjeta con Stripe Elements`.
