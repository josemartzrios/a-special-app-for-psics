# Sent Summary Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir al psicólogo ver el contenido del resumen enviado al paciente expandiéndolo desde el banner de confirmación.

**Architecture:** Agregar un booleano local `showContent` al componente `PatientSummarySection`. Cuando `phase === 'sent'`, el banner muestra un botón toggle ("Ver resumen" / "Ocultar ↑") que controla la visibilidad de los campos en modo solo-lectura. Sin cambios al backend, sin archivos nuevos, sin nuevas props.

**Tech Stack:** React 18, Vitest, @testing-library/react, @testing-library/user-event

---

## File Map

| Acción | Archivo |
|--------|---------|
| Crear  | `frontend/src/components/PatientSummarySection.test.jsx` |
| Modificar | `frontend/src/components/PatientSummarySection.jsx` |

---

### Task 1: Tests para la vista de resumen enviado

**Files:**
- Create: `frontend/src/components/PatientSummarySection.test.jsx`

- [ ] **Step 1: Crear el archivo de test con mock de la API**

```jsx
// frontend/src/components/PatientSummarySection.test.jsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PatientSummarySection from './PatientSummarySection'

const SENT_SUMMARY = {
  id: 'sum-1',
  topics_worked: 'Hoy hablamos sobre el estrés laboral.',
  homework: 'Llevar un diario de emociones esta semana.',
  sent_at: '2026-05-21T14:32:00Z',
}

vi.mock('../api', () => ({
  getSummary: vi.fn(() => Promise.resolve(SENT_SUMMARY)),
  generateSummary: vi.fn(),
  saveSummary: vi.fn(),
  sendSummaryToPortal: vi.fn(),
}))

describe('PatientSummarySection — fase sent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el banner de confirmación cuando el resumen ya fue enviado', async () => {
    render(<PatientSummarySection sessionId="s1" patientName="Ana López" />)
    await screen.findByText(/Seguimiento enviado a Ana/i)
  })

  it('no muestra el contenido del resumen por defecto', async () => {
    render(<PatientSummarySection sessionId="s1" patientName="Ana López" />)
    await screen.findByText(/Seguimiento enviado a Ana/i)
    expect(screen.queryByText('Hoy hablamos sobre el estrés laboral.')).not.toBeInTheDocument()
    expect(screen.queryByText('Llevar un diario de emociones esta semana.')).not.toBeInTheDocument()
  })

  it('muestra el contenido tras hacer click en "Ver resumen"', async () => {
    const user = userEvent.setup()
    render(<PatientSummarySection sessionId="s1" patientName="Ana López" />)
    await screen.findByText(/Seguimiento enviado a Ana/i)
    await user.click(screen.getByRole('button', { name: /Ver resumen/i }))
    expect(screen.getByText('Hoy hablamos sobre el estrés laboral.')).toBeInTheDocument()
    expect(screen.getByText('Llevar un diario de emociones esta semana.')).toBeInTheDocument()
  })

  it('colapsa el contenido al hacer click en "Ocultar"', async () => {
    const user = userEvent.setup()
    render(<PatientSummarySection sessionId="s1" patientName="Ana López" />)
    await screen.findByText(/Seguimiento enviado a Ana/i)
    await user.click(screen.getByRole('button', { name: /Ver resumen/i }))
    await screen.findByText('Hoy hablamos sobre el estrés laboral.')
    await user.click(screen.getByRole('button', { name: /Ocultar/i }))
    await waitFor(() => {
      expect(screen.queryByText('Hoy hablamos sobre el estrés laboral.')).not.toBeInTheDocument()
    })
  })

  it('los campos expandidos no tienen cursor:text', async () => {
    const user = userEvent.setup()
    render(<PatientSummarySection sessionId="s1" patientName="Ana López" />)
    await screen.findByText(/Seguimiento enviado a Ana/i)
    await user.click(screen.getByRole('button', { name: /Ver resumen/i }))
    const field = await screen.findByText('Hoy hablamos sobre el estrés laboral.')
    expect(field).not.toHaveStyle('cursor: text')
  })
})
```

- [ ] **Step 2: Ejecutar tests para verificar que fallan**

```
cd frontend && npx vitest run src/components/PatientSummarySection.test.jsx
```

Resultado esperado: 5 tests en FAIL — `PatientSummarySection` no renderiza el botón "Ver resumen" todavía.

- [ ] **Step 3: Commit del test**

```bash
git add frontend/src/components/PatientSummarySection.test.jsx
git commit -m "test(summary): add failing tests for sent-summary review toggle"
```

---

### Task 2: Implementar el toggle en PatientSummarySection

**Files:**
- Modify: `frontend/src/components/PatientSummarySection.jsx`

- [ ] **Step 1: Agregar estado `showContent`**

En `PatientSummarySection.jsx`, dentro de la función del componente, añadir la línea después de `const [sending, setSending] = useState(false)`:

```jsx
const [showContent, setShowContent] = useState(false)
```

El bloque de estados queda así:

```jsx
const [phase, setPhase] = useState('idle')
const [fields, setFields] = useState({ topics_worked: '', homework: '' })
const [activeField, setActiveField] = useState(null)
const [sentAt, setSentAt] = useState(null)
const [error, setError] = useState(null)
const [sending, setSending] = useState(false)
const [showContent, setShowContent] = useState(false)
```

- [ ] **Step 2: Reemplazar el bloque `phase === 'sent'`**

Reemplazar todo el bloque:

```jsx
// ── Sent ──
if (phase === 'sent') {
  const hourStr = sentAt
    ? new Date(sentAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <div className="border-t border-[#5a9e8a]/20 mt-2 px-6 pt-4 pb-5">
      <div className="flex items-center gap-3 bg-[#f4faf8] border border-[#5a9e8a] rounded-xl px-4 py-3">
        <svg className="w-4 h-4 text-[#5a9e8a] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
        </svg>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#5a9e8a]">Seguimiento enviado a {firstName}</p>
          {hourStr && <p className="text-[11px] text-[#9ca3af]">Hoy · {hourStr}</p>}
        </div>
      </div>
    </div>
  )
}
```

Por:

```jsx
// ── Sent ──
if (phase === 'sent') {
  const hourStr = sentAt
    ? new Date(sentAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <div className="border-t border-[#5a9e8a]/20 mt-2 px-6 pt-4 pb-5">
      <div className="bg-[#f4faf8] border border-[#5a9e8a] rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <svg className="w-4 h-4 text-[#5a9e8a] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[#5a9e8a]">Seguimiento enviado a {firstName}</p>
            {hourStr && <p className="text-[11px] text-[#9ca3af]">Hoy · {hourStr}</p>}
          </div>
          <button
            onClick={() => setShowContent(v => !v)}
            className="text-[12px] font-medium text-[#5a9e8a] hover:underline flex-shrink-0"
          >
            {showContent ? 'Ocultar ↑' : 'Ver resumen'}
          </button>
        </div>

        {showContent && (
          <div className="mt-4 pt-4 border-t border-[#5a9e8a]/20">
            {SECTIONS.map(({ key, label, color }, idx) => {
              const content = fields[key]
              return (
                <div key={key} className={idx > 0 ? 'mt-6' : ''}>
                  <p
                    className="font-sans text-[10px] font-bold tracking-[0.12em] uppercase"
                    style={{ fontVariant: 'small-caps', color: MUTED }}
                  >
                    {label}
                  </p>
                  <hr
                    className="border-0 border-t border-current mt-1 mb-3"
                    style={{ color: `${MUTED}33` }}
                  />
                  <p
                    className="font-sans text-[14px] leading-relaxed px-1"
                    style={{ color: MUTED }}
                  >
                    {content || '—'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Ejecutar los tests**

```
cd frontend && npx vitest run src/components/PatientSummarySection.test.jsx
```

Resultado esperado: 5 tests en PASS.

- [ ] **Step 4: Ejecutar toda la suite para detectar regresiones**

```
cd frontend && npx vitest run
```

Resultado esperado: todos los tests existentes en PASS.

- [ ] **Step 5: Commit de la implementación**

```bash
git add frontend/src/components/PatientSummarySection.jsx
git commit -m "feat(summary): add toggle to review sent patient summary"
```
