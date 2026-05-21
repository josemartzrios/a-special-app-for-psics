# Historial Session Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side search bar to the Historial tab (desktop Review panel + mobile tab) that filters confirmed sessions in real time by session number, date, or raw dictation keyword.

**Architecture:** Local `historialSearchQuery` state in `App.jsx`. A pure exported `filterHistorialSessions` function is extracted for testability — it performs the simultaneous three-field match. `filteredHistorialSessions` replaces `confirmedSessions` in both render blocks. Two refs (`historialSearchDesktopRef`, `historialSearchMobileRef`) keep focus-on-clear working independently per context.

**Tech Stack:** React 18, Vitest, Tailwind CSS via CDN.

**Spec:** `docs/superpowers/specs/2026-05-21-historial-session-search-design.md`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `frontend/src/App.jsx` | Modify | Export `filterHistorialSessions`; add state + refs + reset effect + `filteredHistorialSessions`; search input JSX in desktop panel and mobile tab |
| `frontend/src/App.test.jsx` | Modify | Import `filterHistorialSessions`; add `describe('filterHistorialSessions', ...)` with 8 test cases |

No new files. No backend changes.

---

## Task 1 — Extract and test `filterHistorialSessions`

**Files:**
- Modify: `frontend/src/App.jsx` (~line 157, after `toggleExpandedSession`)
- Modify: `frontend/src/App.test.jsx` (import line + new describe block at end)

---

- [ ] **Step 1: Write the failing tests**

First, update the import at the top of `frontend/src/App.test.jsx`. Find:

```js
import { markPendingNotesReadOnly } from './App'
```

Replace with:

```js
import { markPendingNotesReadOnly, filterHistorialSessions } from './App'
```

Then append this block at the very end of `frontend/src/App.test.jsx` (after the last closing `}`):

```js
describe('filterHistorialSessions', () => {
  const DISPLAY_MAP = new Map([
    ['s1', 1],
    ['s2', 2],
    ['s3', 3],
  ])

  const SESSIONS = [
    { id: 's1', session_date: '2026-01-15T12:00:00', raw_dictation: 'Paciente con ansiedad elevada.' },
    { id: 's2', session_date: '2026-01-08T12:00:00', raw_dictation: 'Llegó tarde, menciona conflicto familiar.' },
    { id: 's3', session_date: '2026-02-05T12:00:00', raw_dictation: null },
  ]

  it('empty query returns all sessions', () => {
    expect(filterHistorialSessions(SESSIONS, '', DISPLAY_MAP)).toHaveLength(3)
  })

  it('whitespace-only query returns all sessions', () => {
    expect(filterHistorialSessions(SESSIONS, '   ', DISPLAY_MAP)).toHaveLength(3)
  })

  it('filters by session display number', () => {
    const result = filterHistorialSessions(SESSIONS, '3', DISPLAY_MAP)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('s3')
  })

  it('filters by partial date string (case-insensitive)', () => {
    const result = filterHistorialSessions(SESSIONS, 'ene', DISPLAY_MAP)
    expect(result).toHaveLength(2)
    expect(result.map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('filters by keyword in raw_dictation (case-insensitive)', () => {
    const result = filterHistorialSessions(SESSIONS, 'ANSIEDAD', DISPLAY_MAP)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('s1')
  })

  it('returns empty array when nothing matches', () => {
    expect(filterHistorialSessions(SESSIONS, 'xyz_no_match', DISPLAY_MAP)).toHaveLength(0)
  })

  it('does not throw when raw_dictation is null', () => {
    expect(() => filterHistorialSessions(SESSIONS, 'algo', DISPLAY_MAP)).not.toThrow()
  })

  it('session with null raw_dictation is still matched by number', () => {
    const result = filterHistorialSessions(SESSIONS, '3', DISPLAY_MAP)
    expect(result[0].id).toBe('s3')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/App.test.jsx
```

Expected: 8 new tests fail with `filterHistorialSessions is not a function`. All pre-existing tests still pass.

- [ ] **Step 3: Add `filterHistorialSessions` export to App.jsx**

Open `frontend/src/App.jsx`. Find the `toggleExpandedSession` export (~line 155):

```js
export function toggleExpandedSession(currentId, clickedId) {
```

After the closing `}` of that function, insert:

```js
// Pure filter for the Historial session list. Exported for unit testing.
// Searches simultaneously: session display number, formatted date, raw_dictation.
// Security: uses .includes() (no RegExp), guards null dictation with ?? '',
// bypasses filter on whitespace-only query via .trim().
export function filterHistorialSessions(sessions, query, displayNumMap) {
  if (query.trim() === '') return sessions;
  const q = query.toLowerCase();
  return sessions.filter(s => {
    const num = String(displayNumMap.get(String(s.id)) ?? '');
    const date = formatDate(s.session_date).toLowerCase();
    const dictation = (s.raw_dictation ?? '').toLowerCase();
    return num.includes(q) || date.includes(q) || dictation.includes(q);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/App.test.jsx
```

Expected: all 8 new tests pass. All pre-existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/App.test.jsx
git commit -m "feat(historial): extract filterHistorialSessions with tests"
```

---

## Task 2 — Wire state, refs, reset effect, and derived variable

**Files:**
- Modify: `frontend/src/App.jsx` (state block ~line 188; effect at line 600; derived vars ~line 724)

---

- [ ] **Step 1: Add state and refs**

In `frontend/src/App.jsx`, find the desktop two-mode layout state block (~line 186):

```js
  // Desktop two-mode layout state
  const [desktopMode, setDesktopMode] = useState('session'); // 'session' | 'review'
  const [reviewExpandedSessionId, setReviewExpandedSessionId] = useState(null);
```

Add immediately after:

```js
  // Historial session search
  const [historialSearchQuery, setHistorialSearchQuery] = useState('');
  const historialSearchDesktopRef = useRef(null);
  const historialSearchMobileRef  = useRef(null);
```

- [ ] **Step 2: Add reset effect on patient change**

Find line 600:

```js
  useEffect(() => { setNewlyConfirmedSessionId(null); setDismissedOrphanIds(new Set()); }, [selectedPatientId]);
```

Add immediately after:

```js
  useEffect(() => { setHistorialSearchQuery(''); }, [selectedPatientId]);
```

- [ ] **Step 3: Add `filteredHistorialSessions` derived variable**

Find the `confirmedDisplayNum` block (~line 722):

```js
  const confirmedDisplayNum = new Map(
    confirmedSessions.map((s, i) => [String(s.id), i + 1])
  );
```

Add immediately after:

```js
  const filteredHistorialSessions = filterHistorialSessions(
    confirmedSessions,
    historialSearchQuery,
    confirmedDisplayNum
  );
```

- [ ] **Step 4: Run full test suite — no regressions**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(historial): add historialSearchQuery state and filteredHistorialSessions"
```

---

## Task 3 — Search input in desktop historial panel

**Files:**
- Modify: `frontend/src/App.jsx` (~lines 1104–1115, desktop Review mode left panel)

---

- [ ] **Step 1: Add search input and update render array**

In `frontend/src/App.jsx`, find the desktop historial left panel. Locate this exact block (~line 1104):

```jsx
                    <div className="w-[380px] flex-shrink-0 flex flex-col border-r border-black/[0.07] bg-[#f4f4f2] overflow-y-auto px-5 py-6">
                      <p className="text-[10px] font-bold uppercase tracking-[0.10em] text-ink-muted mb-4 px-2">Historial de Notas</p>
                      <div className="space-y-3">
                        {sessionsLoading ? (
                          <div className="flex flex-col items-center gap-2 py-8">
                            {LOADING_DOTS}
                            <p className="text-ink-tertiary text-[11px] uppercase tracking-wider">Cargando historial...</p>
                          </div>
                        ) : confirmedSessions.length === 0 ? (
                          <p className="text-ink-tertiary text-xs px-2 italic">Sin notas SOAP confirmadas.</p>
                        ) : (
                          confirmedSessions.map((s, i) => {
```

Replace with:

```jsx
                    <div className="w-[380px] flex-shrink-0 flex flex-col border-r border-black/[0.07] bg-[#f4f4f2] overflow-y-auto px-5 py-6">
                      <p className="text-[10px] font-bold uppercase tracking-[0.10em] text-ink-muted mb-4 px-2">Historial de Notas</p>

                      {/* Session search input */}
                      <div className="px-2 mb-3">
                        <div className="relative flex items-center">
                          <input
                            ref={historialSearchDesktopRef}
                            type="text"
                            placeholder="Buscar por sesión, fecha o palabra..."
                            maxLength={80}
                            value={historialSearchQuery}
                            onChange={e => setHistorialSearchQuery(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Escape') {
                                if (historialSearchQuery) {
                                  setHistorialSearchQuery('');
                                } else {
                                  e.currentTarget.blur();
                                }
                              }
                            }}
                            className="w-full bg-white border border-black/[0.1] rounded-lg px-3 py-1.5 text-sm text-[#18181b] placeholder:text-ink-tertiary focus:outline-none focus:border-[#5a9e8a]/60 transition-colors pr-7"
                          />
                          {historialSearchQuery && (
                            <button
                              onClick={() => { setHistorialSearchQuery(''); historialSearchDesktopRef.current?.focus(); }}
                              aria-label="Limpiar búsqueda"
                              className="absolute right-2 text-ink-tertiary hover:text-ink p-0.5 rounded transition-colors"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {sessionsLoading ? (
                          <div className="flex flex-col items-center gap-2 py-8">
                            {LOADING_DOTS}
                            <p className="text-ink-tertiary text-[11px] uppercase tracking-wider">Cargando historial...</p>
                          </div>
                        ) : confirmedSessions.length === 0 ? (
                          <p className="text-ink-tertiary text-xs px-2 italic">Sin notas SOAP confirmadas.</p>
                        ) : filteredHistorialSessions.length === 0 ? (
                          <p className="text-ink-tertiary text-[13px] text-center py-6">Sin resultados</p>
                        ) : (
                          filteredHistorialSessions.map((s, i) => {
```

The rest of the session card JSX (from `const isExpanded = ...` through the closing `})` of the map) stays **identical** — only the array name changes from `confirmedSessions` to `filteredHistorialSessions`.

- [ ] **Step 2: Run full test suite — no regressions**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(historial): add session search input to desktop Review panel"
```

---

## Task 4 — Search input in mobile historial tab

**Files:**
- Modify: `frontend/src/App.jsx` (~lines 1392–1474, mobile `mobileTab === 'historial'` block)

---

- [ ] **Step 1: Restructure container and add sticky search input**

Find the mobile historial block (~line 1393). Locate this exact opening:

```jsx
              {mobileTab === 'historial' && (
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {confirmedSessions.length === 0 ? (
                    <p className="text-ink-tertiary text-[14px] text-center mt-10">Sin sesiones registradas aún.</p>
                  ) : (
                    <div className="space-y-2">
                      {confirmedSessions.map((s, i) => {
```

Replace with:

```jsx
              {mobileTab === 'historial' && (
                <div className="flex-1 flex flex-col min-h-0">

                  {/* Sticky search bar */}
                  <div className="px-4 py-2 border-b border-ink/[0.05] flex-shrink-0 bg-white">
                    <div className="relative flex items-center">
                      <input
                        ref={historialSearchMobileRef}
                        type="text"
                        placeholder="Buscar por sesión, fecha o palabra..."
                        maxLength={80}
                        value={historialSearchQuery}
                        onChange={e => setHistorialSearchQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') {
                            if (historialSearchQuery) {
                              setHistorialSearchQuery('');
                            } else {
                              e.currentTarget.blur();
                            }
                          }
                        }}
                        className="w-full bg-white border border-black/[0.1] rounded-lg px-3 py-1.5 text-sm text-[#18181b] placeholder:text-ink-tertiary focus:outline-none focus:border-[#5a9e8a]/60 transition-colors pr-7"
                      />
                      {historialSearchQuery && (
                        <button
                          onClick={() => { setHistorialSearchQuery(''); historialSearchMobileRef.current?.focus(); }}
                          aria-label="Limpiar búsqueda"
                          className="absolute right-2 text-ink-tertiary hover:text-ink p-0.5 rounded transition-colors"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Scrollable session list */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {confirmedSessions.length === 0 ? (
                      <p className="text-ink-tertiary text-[14px] text-center mt-10">Sin sesiones registradas aún.</p>
                    ) : filteredHistorialSessions.length === 0 ? (
                      <p className="text-ink-tertiary text-[13px] text-center py-6">Sin resultados</p>
                    ) : (
                      <div className="space-y-2">
                        {filteredHistorialSessions.map((s, i) => {
```

- [ ] **Step 2: Add the extra closing `</div>` for the outer flex container**

The new structure adds one extra wrapping `<div>`. Find the mobile historial closing tags (~line 1471). The current structure ends:

```jsx
                    </div>
                  )}
                </div>
              )}
```

It must now end with one extra `</div>` to close the new outer flex container:

```jsx
                    </div>
                  )}
                  </div>
                </div>
              )}
```

That is: after the closing `)}` of the ternary, close the scrollable div (`</div>`), then close the outer flex container (`</div>`).

Verify the final structure counts:

```
<div className="flex-1 flex flex-col min-h-0">         ← outer
  <div ... flex-shrink-0>                              ← sticky search
    ...
  </div>
  <div className="flex-1 overflow-y-auto px-4 py-4">  ← scrollable
    {confirmedSessions.length === 0 ? (...)
     : filteredHistorialSessions.length === 0 ? (...)
     : (<div className="space-y-2">{...}</div>)}
  </div>                                               ← close scrollable
</div>                                                 ← close outer
```

- [ ] **Step 3: Run full test suite — no regressions**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(historial): add sticky session search input to mobile Historial tab"
```

---

## Self-Review Checklist

- [x] Unified search bar, no emoji in placeholder — Task 3, 4
- [x] Searches session number + date + raw_dictation simultaneously — Task 1 (`filterHistorialSessions`)
- [x] `.includes()` not RegExp — Task 1 (no ReDoS)
- [x] `maxLength={80}` on both inputs — Task 3, 4
- [x] `raw_dictation ?? ''` null guard — Task 1
- [x] `.trim() === ''` whitespace bypass — Task 1
- [x] `dangerouslySetInnerHTML` not used — Task 3, 4 (not present)
- [x] Clear button `aria-label="Limpiar búsqueda"` — Task 3, 4
- [x] Clear button visible only when query non-empty — Task 3, 4
- [x] Clear button returns focus to correct ref — Task 3 (desktop ref), Task 4 (mobile ref)
- [x] Escape clears when non-empty, blurs when empty — Task 3, 4
- [x] No `autoFocus` on either input — Task 3, 4
- [x] Desktop: input below label, above list — Task 3
- [x] Mobile: sticky below tab nav, list scrolls independently — Task 4
- [x] `confirmedSessions.length === 0` preserved for "no sessions" state — Task 3, 4
- [x] `filteredHistorialSessions.length === 0` added for "no results" state — Task 3, 4
- [x] Reset on patient change via `useEffect` at line 600 — Task 2
- [x] Two separate refs (desktop + mobile) — Task 2
- [x] `filterHistorialSessions` exported and 8 tests covering all security rules — Task 1
- [x] No new components, no backend changes — File map
- [x] Closing div balance verified for mobile container restructure — Task 4
