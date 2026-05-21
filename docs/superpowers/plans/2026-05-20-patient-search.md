# Patient Search Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side patient name search input to the desktop sidebar (`PatientSidebar.jsx`) and the mobile slide-over (`Sidebar.jsx`), filtering the in-memory patient list instantly by name.

**Architecture:** Local `searchQuery` state lives inside each component independently. A derived `filteredConversations` array is computed inline via `.filter()` with `.includes()`. `App.jsx` is not modified.

**Tech Stack:** React 18, Vitest + Testing Library, Tailwind CSS via CDN.

**Spec:** `docs/superpowers/specs/2026-05-20-patient-search-design.md`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `frontend/src/components/PatientSidebar.jsx` | Modify | Add `searchQuery` state, `searchInputRef`, `filteredConversations`, search input JSX, "Sin resultados" empty state |
| `frontend/src/components/PatientSidebar.test.jsx` | Modify | Add `describe('PatientSidebar — patient search', ...)` block with 7 cases |
| `frontend/src/components/Sidebar.jsx` | Modify | Add `useEffect`+`useRef` imports, `searchQuery` state, `searchInputRef`, reset effect on close, `filteredConversations`, replace "N sesiones" row with search input, "Sin resultados" empty state |
| `frontend/src/components/Sidebar.test.jsx` | Modify | Remove broken "conteo correcto" test; add `describe('Sidebar — patient search', ...)` block with 7 cases |

---

## Task 1 — PatientSidebar search

**Files:**
- Modify: `frontend/src/components/PatientSidebar.jsx`
- Modify: `frontend/src/components/PatientSidebar.test.jsx`

---

- [ ] **Step 1: Write the failing tests**

Open `frontend/src/components/PatientSidebar.test.jsx` and add this `describe` block at the end of the file (after the last closing `}`):

```jsx
describe('PatientSidebar — patient search', () => {
  const CONVS = [
    { patient_id: 'p1', patient_name: 'María García', session_number: 1, status: 'confirmed', dictation_preview: null },
    { patient_id: 'p2', patient_name: 'Carlos Ruiz',  session_number: 2, status: 'confirmed', dictation_preview: null },
    { patient_id: 'p3', patient_name: 'Ana López',    session_number: 1, status: 'confirmed', dictation_preview: null },
  ]

  it('renders search input', () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    expect(screen.getByPlaceholderText(/buscar paciente/i)).toBeInTheDocument()
  })

  it('filters patients by name case-insensitively', async () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'garcia')
    expect(screen.getByText('María García')).toBeInTheDocument()
    expect(screen.queryByText('Carlos Ruiz')).not.toBeInTheDocument()
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument()
  })

  it('shows "Sin resultados" when no patients match the query', async () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'xyz')
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument()
  })

  it('clear button is hidden when query is empty', () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    expect(screen.queryByRole('button', { name: /limpiar búsqueda/i })).not.toBeInTheDocument()
  })

  it('clear button appears when query is non-empty', async () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'g')
    expect(screen.getByRole('button', { name: /limpiar búsqueda/i })).toBeInTheDocument()
  })

  it('clear button click resets query and returns focus to input', async () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    const input = screen.getByPlaceholderText(/buscar paciente/i)
    await userEvent.type(input, 'garcia')
    await userEvent.click(screen.getByRole('button', { name: /limpiar búsqueda/i }))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('Escape clears the query when non-empty', async () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    const input = screen.getByPlaceholderText(/buscar paciente/i)
    await userEvent.type(input, 'garcia')
    await userEvent.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/components/PatientSidebar.test.jsx
```

Expected: 7 new tests fail. All pre-existing tests still pass.

- [ ] **Step 3: Implement the search in PatientSidebar.jsx**

Replace the full content of `frontend/src/components/PatientSidebar.jsx` with:

```jsx
import { useState, useRef, useEffect } from 'react';

/**
 * PatientSidebar
 *
 * Desktop sidebar showing:
 * 1. Brand header "SyqueX v2"
 * 2. Patient list (conversations)
 * 3. "+ Nuevo paciente" button (pinned to bottom)
 *
 * Design tokens:
 * - Sidebar bg: #f4f4f2
 * - Active item: white bg
 * - Sage (accent): #5a9e8a
 * - Ink (text): #18181b
 */

function PatientConversationItem({ conv, active, onClick, onDelete, hasDraft }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleDelete = (e) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete();
    } else {
      setConfirmDelete(true);
      timeoutRef.current = setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      onClick={onClick}
      className={`group px-3 py-2.5 mx-2 mb-0.5 rounded-lg cursor-pointer transition-colors relative
        ${active ? 'bg-white' : 'hover:bg-white/60'}`}
    >
      <div className="pr-6">
        <p
          className={`text-[14px] font-medium truncate leading-snug ${active ? 'text-[#18181b]' : 'text-ink-secondary'
            }`}
        >
          {conv.patient_name}
        </p>
        {conv.session_number != null ? (
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[11px] text-ink-tertiary">Sesión #{conv.session_number}</p>
            {hasDraft ? (
              <span className="text-[10px] font-semibold text-[#c4935a] bg-[#fef3e2] rounded px-1 leading-4">
                Borrador
              </span>
            ) : (
              <span className="text-[10px] font-semibold text-[#5a9e8a] bg-[#f0faf7] rounded px-1 leading-4">
                Confirmada
              </span>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-ink-tertiary mt-0.5">Sin sesiones</p>
        )}
        {conv.dictation_preview && (
          <p className="text-[11px] text-ink-tertiary mt-0.5 line-clamp-1">
            {conv.dictation_preview}
          </p>
        )}
      </div>
      <button
        onClick={handleDelete}
        title={confirmDelete ? 'Confirmar' : 'Archivar'}
        className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md transition-all opacity-0 group-hover:opacity-100
          ${confirmDelete
            ? 'bg-red-50 text-red-400 !opacity-100'
            : 'text-ink-muted hover:text-red-400 hover:bg-red-50'
          }`}
      >
        {confirmDelete ? (
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              d="M5 13l4 4L19 7"
            />
          </svg>
        ) : (
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        )}
      </button>
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
}

export default function PatientSidebar({
  conversations,
  selectedPatientId,
  onSelectConversation,
  onDeleteConversation,
  onNewPatient,
  isCreatingPatient,
  newPatientName,
  onNewPatientNameChange,
  onSavePatient,
  onCancelNewPatient,
  draftPatientIds = new Set(),
  canCancelSubscription = false,
  onCancelSubscription,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

  const filteredConversations = conversations.filter(c =>
    c.patient_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col border-r border-black/[0.07] bg-white">
      {/* Brand Header */}
      <div className="px-5 py-4 border-b border-black/[0.07] flex items-center justify-between flex-shrink-0">
        <span className="font-semibold text-[#18181b] text-[15px] tracking-tight">
          SyqueX
        </span>
      </div>

      {/* Section Label: Pacientes + New button */}
      <div className="px-3 pt-3 pb-1 flex-shrink-0 flex items-center justify-between px-5">
        <span className="text-[10px] uppercase tracking-[0.12em] text-ink-tertiary font-bold px-2">
          Pacientes
        </span>
        {!isCreatingPatient && (
          <button
            onClick={onNewPatient}
            title="Nuevo paciente"
            className="p-1 rounded-md text-ink-tertiary hover:text-[#5a9e8a] hover:bg-black/[0.04] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      {/* Search input */}
      <div className="px-3 pb-2 flex-shrink-0">
        <div className="relative flex items-center">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Buscar paciente..."
            maxLength={100}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                if (searchQuery) {
                  setSearchQuery('');
                } else {
                  e.currentTarget.blur();
                }
              }
            }}
            className="w-full bg-white border border-black/[0.1] rounded-lg px-3 py-1.5 text-sm text-[#18181b] placeholder:text-ink-tertiary focus:outline-none focus:border-[#5a9e8a]/60 transition-colors pr-7"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 text-ink-tertiary hover:text-ink p-0.5 rounded transition-colors"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Inline creation form — shown directly below label when isCreatingPatient */}
      {isCreatingPatient && (
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              type="text"
              placeholder="Nombre del paciente..."
              className="w-full bg-white border border-black/[0.1] rounded-lg px-3 py-2 text-sm text-[#18181b] placeholder-gray-400 focus:outline-none focus:border-[#5a9e8a]/60 transition-all"
              value={newPatientName}
              onChange={onNewPatientNameChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSavePatient();
                if (e.key === 'Escape') onCancelNewPatient();
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={onSavePatient}
                className="flex-1 bg-[#5a9e8a] hover:bg-[#4d8a78] text-white text-[13px] font-medium rounded-lg py-1.5 transition-colors"
              >
                Guardar
              </button>
              <button
                onClick={onCancelNewPatient}
                className="px-3 text-ink-secondary hover:text-ink text-[13px] rounded-lg py-1.5 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Patient List — Scrollable */}
      <div className="flex-1 overflow-y-auto pb-2">
        {conversations.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-ink-secondary text-[13px]">Sin pacientes aún.</p>
            <p className="text-ink-tertiary text-xs mt-1">Crea uno para comenzar.</p>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-ink-tertiary text-[13px]">Sin resultados</p>
          </div>
        ) : (
          filteredConversations.map(conv => (
            <PatientConversationItem
              key={conv.patient_id}
              conv={conv}
              active={conv.patient_id === selectedPatientId}
              onClick={() => onSelectConversation(conv)}
              onDelete={() => onDeleteConversation(conv.id, conv.patient_id)}
              hasDraft={draftPatientIds.has(String(conv.patient_id))}
            />
          ))
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/components/PatientSidebar.test.jsx
```

Expected: all tests pass (pre-existing + 7 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PatientSidebar.jsx frontend/src/components/PatientSidebar.test.jsx
git commit -m "feat(sidebar): add patient search to desktop PatientSidebar"
```

---

## Task 2 — Sidebar (mobile) search

**Files:**
- Modify: `frontend/src/components/Sidebar.jsx`
- Modify: `frontend/src/components/Sidebar.test.jsx`

---

- [ ] **Step 1: Remove the broken count test and write new failing tests**

Open `frontend/src/components/Sidebar.test.jsx`.

**Remove** this test (it tests the "N sesiones" row that will be replaced):

```jsx
it('muestra conteo correcto: "3 sesiones" y "1 sesión"', () => {
  const { rerender } = render(<Sidebar open={true} onClose={noop} conversations={THREE_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
  expect(screen.getByText('3 sesiones')).toBeInTheDocument()
  rerender(<Sidebar open={true} onClose={noop} conversations={ONE_CONV} onSelectConversation={noop} onDeleteConversation={noop} />)
  expect(screen.getByText('1 sesión')).toBeInTheDocument()
})
```

**Add** this `describe` block at the end of the file (after the last closing `}`):

```jsx
describe('Sidebar — patient search', () => {
  const SEARCH_CONVS = [
    { id: 'sess-1', patient_id: 'p1', patient_name: 'María López',  session_date: '2026-01-15', session_number: 1, status: 'confirmed', dictation_preview: 'A' },
    { id: 'sess-2', patient_id: 'p2', patient_name: 'Carlos Ruiz',  session_date: '2026-01-22', session_number: 2, status: 'draft',     dictation_preview: 'B' },
    { id: 'sess-3', patient_id: 'p3', patient_name: 'Ana Gómez',    session_date: '2026-01-29', session_number: 3, status: 'confirmed', dictation_preview: 'C' },
  ]

  it('renders search input', () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    expect(screen.getByPlaceholderText(/buscar paciente/i)).toBeInTheDocument()
  })

  it('filters patients by name case-insensitively', async () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'lopez')
    expect(screen.getByText('MARÍA LÓPEZ')).toBeInTheDocument()
    expect(screen.queryByText('CARLOS RUIZ')).not.toBeInTheDocument()
    expect(screen.queryByText('ANA GÓMEZ')).not.toBeInTheDocument()
  })

  it('shows "Sin resultados" when no patients match the query', async () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'xyz')
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument()
  })

  it('clear button is hidden when query is empty', () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    expect(screen.queryByRole('button', { name: /limpiar búsqueda/i })).not.toBeInTheDocument()
  })

  it('clear button appears when query is non-empty', async () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'l')
    expect(screen.getByRole('button', { name: /limpiar búsqueda/i })).toBeInTheDocument()
  })

  it('clear button click resets query and returns focus to input', async () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    const input = screen.getByPlaceholderText(/buscar paciente/i)
    await userEvent.type(input, 'lopez')
    await userEvent.click(screen.getByRole('button', { name: /limpiar búsqueda/i }))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('Escape clears the query when non-empty', async () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    const input = screen.getByPlaceholderText(/buscar paciente/i)
    await userEvent.type(input, 'lopez')
    await userEvent.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('query resets to empty when slide-over closes (open goes false)', async () => {
    const { rerender } = render(
      <Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />
    )
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'lopez')
    rerender(
      <Sidebar open={false} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />
    )
    rerender(
      <Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />
    )
    expect(screen.getByPlaceholderText(/buscar paciente/i)).toHaveValue('')
  })
})
```

- [ ] **Step 2: Run tests to verify new tests fail (and old test is gone)**

```bash
cd frontend && npx vitest run src/components/Sidebar.test.jsx
```

Expected: 8 new search tests fail. The "conteo correcto" test is gone. All other pre-existing tests still pass.

- [ ] **Step 3: Implement the search in Sidebar.jsx**

Replace the full content of `frontend/src/components/Sidebar.jsx` with:

```jsx
import { useState, useRef, useEffect } from 'react';

export default function Sidebar({ open, onClose, conversations, onSelectConversation, onDeleteConversation, onLogout, draftPatientIds = new Set(), canCancelSubscription = false, onCancelSubscription }) {
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef(null);

  // Reset query whenever the slide-over closes
  useEffect(() => {
    if (!open) setSearchQuery('');
  }, [open]);

  const filteredConversations = conversations.filter(c =>
    c.patient_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      {open && (
        <div
          data-testid="sidebar-backdrop"
          className="fixed inset-0 bg-ink/20 backdrop-blur-[2px] z-30"
          onClick={onClose}
        />
      )}

      <div data-testid="sidebar-panel" className={`fixed left-0 top-0 h-full w-[85vw] max-w-sm bg-white z-40 flex flex-col transform transition-transform duration-300 ease-out border-r border-ink/[0.07] shadow-xl ${open ? 'translate-x-0' : '-translate-x-full'}`}>

        <div className="px-5 py-4 border-b border-ink/[0.07] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-5 bg-sage rounded-full"></div>
            <h2 className="font-semibold text-ink text-[14px] tracking-tight">Sesiones clínicas</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-ink-tertiary hover:text-ink-secondary hover:bg-parchment transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search input — replaces the previous "N sesiones" count row */}
        <div className="px-5 py-2 border-b border-ink/[0.05] flex-shrink-0">
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              placeholder="Buscar paciente..."
              maxLength={100}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  if (searchQuery) {
                    setSearchQuery('');
                  } else {
                    e.currentTarget.blur();
                  }
                }
              }}
              className="w-full bg-white border border-black/[0.1] rounded-lg px-3 py-1.5 text-sm text-[#18181b] placeholder:text-ink-tertiary focus:outline-none focus:border-[#5a9e8a]/60 transition-colors pr-7"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); inputRef.current?.focus(); }}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 text-ink-tertiary hover:text-ink p-0.5 rounded transition-colors"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 px-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-parchment border border-ink/[0.07] flex items-center justify-center">
                <svg className="w-5 h-5 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-ink-tertiary text-sm">Sin sesiones registradas</p>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-ink-tertiary text-[13px]">Sin resultados</p>
            </div>
          ) : (
            filteredConversations.map(conv => (
              <ConversationItem
                key={conv.patient_id}
                conv={conv}
                onClick={() => { onSelectConversation(conv); onClose(); }}
                onDelete={() => onDeleteConversation(conv.id, conv.patient_id)}
                hasDraft={draftPatientIds.has(String(conv.patient_id))}
              />
            ))
          )}
        </div>
        
        {/* Logout — pinned to bottom of drawer */}
        <div className="border-t border-ink/[0.07] flex-shrink-0">
          {canCancelSubscription && (
            <button
              onClick={onCancelSubscription}
              className="w-full text-left px-5 py-[10px] text-[12px] text-ink-tertiary hover:text-ink-secondary hover:bg-parchment transition-colors border-b border-ink/[0.04]"
            >
              Cancelar suscripción
            </button>
          )}
          <button
            onClick={onLogout}
            className="w-full text-left px-5 py-3 text-[13px] text-ink-secondary hover:text-ink transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </>
  );
}

function ConversationItem({ conv, onClick, onDelete, hasDraft }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = (e) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete();
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      className="group px-4 py-3.5 border-b border-ink/[0.05] cursor-pointer hover:bg-parchment transition-colors relative"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1 pr-8">
        <span className="text-sage text-[11px] font-bold uppercase tracking-wider truncate">
          {conv.patient_name}
        </span>
        <span className="text-ink-tertiary text-[11px] flex-shrink-0 ml-2">{formatDate(conv.session_date)}</span>
      </div>

      <p className="text-ink-secondary text-[13px] leading-snug line-clamp-2 pr-2">
        {conv.dictation_preview || <span className="italic text-ink-muted">Sesión sin contenido</span>}
      </p>

      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <span className="text-[10px] text-ink-tertiary">Sesión #{conv.session_number}</span>
        {hasDraft ? (
          <span className="text-[10px] font-semibold text-[#c4935a] bg-[#fef3e2] rounded px-1 leading-4">
            Borrador
          </span>
        ) : conv.status === 'confirmed' ? (
          <span className="text-[10px] font-semibold text-[#5a9e8a] bg-[#f0faf7] rounded px-1 leading-4">
            Confirmada
          </span>
        ) : null}
      </div>

      <button
        onClick={handleDelete}
        title={confirmDelete ? 'Confirmar' : 'Archivar sesión'}
        className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all sm:opacity-0 sm:group-hover:opacity-100
          ${confirmDelete
            ? 'bg-red-50 text-red-500 !opacity-100'
            : 'text-ink-muted hover:bg-red-50 hover:text-red-400'
          }`}
      >
        {confirmDelete ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        )}
      </button>
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
}
```

- [ ] **Step 4: Run all tests to verify everything passes**

```bash
cd frontend && npx vitest run src/components/Sidebar.test.jsx
```

Expected: all tests pass (pre-existing — minus the removed count test + 8 new search tests).

Run the full suite to catch regressions:

```bash
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.jsx frontend/src/components/Sidebar.test.jsx
git commit -m "feat(sidebar): add patient search to mobile Sidebar slide-over"
```

---

## Self-Review Checklist

- [x] Search input renders in PatientSidebar ✓ Task 1
- [x] Search input renders in Sidebar ✓ Task 2
- [x] Filters by name case-insensitively ✓ Both tasks
- [x] "Sin resultados" empty state ✓ Both tasks
- [x] Clear button (×) hidden when empty ✓ Both tasks
- [x] Clear button visible when non-empty ✓ Both tasks
- [x] Clear button resets query + returns focus ✓ Both tasks
- [x] Escape clears when non-empty ✓ Both tasks
- [x] Mobile query resets on close ✓ Task 2 (useEffect on `open`)
- [x] No autofocus ✓ No `autoFocus` on search inputs
- [x] `maxLength={100}` ✓ Both tasks
- [x] `.includes()` not RegExp ✓ Both tasks
- [x] No dangerouslySetInnerHTML ✓ Both tasks
- [x] App.jsx not modified ✓ Not in file map
- [x] Broken "conteo correcto" test removed ✓ Task 2 Step 1
