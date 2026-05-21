# Historial Session Search — Design Spec

**Date:** 2026-05-21
**Status:** Approved
**Scope:** Client-side session search in the Historial tab (desktop Review panel + mobile tab)

---

## Problem

Psychologists with many sessions per patient must scroll the full Historial list to find a specific session. No filtering mechanism exists inside the Historial tab.

---

## Solution

Add a client-side search input that filters the confirmed session list in real time. The unified bar searches simultaneously across three fields: session number, formatted date, and raw dictation text. Pure in-memory filter — no network calls, no new API endpoints.

---

## Affected Files

| File | Change |
|---|---|
| `frontend/src/App.jsx` | Add `historialSearchQuery` state, reset effect on patient change, `filteredHistorialSessions` derived array, search input JSX in desktop panel and mobile tab |
| `frontend/src/App.test.jsx` | Add `describe('Historial session search', ...)` block with 12 test cases |

No new components. No backend changes.

---

## State Architecture

Local state in `App.jsx`, consistent with the existing patient search pattern in `PatientSidebar.jsx` and `Sidebar.jsx`.

```jsx
const [historialSearchQuery, setHistorialSearchQuery] = useState('');
const historialSearchRef = useRef(null);

// Reset when patient changes to avoid ghost filters
useEffect(() => {
  setHistorialSearchQuery('');
}, [selectedPatientId]);

const filteredHistorialSessions = historialSearchQuery.trim() === ''
  ? confirmedSessions
  : confirmedSessions.filter(s => {
      const q = historialSearchQuery.toLowerCase();
      const num = String(confirmedDisplayNum.get(String(s.id)) ?? '');
      const date = formatDate(s.session_date).toLowerCase();
      const dictation = (s.raw_dictation ?? '').toLowerCase();
      return num.includes(q) || date.includes(q) || dictation.includes(q);
    });
```

`filteredHistorialSessions` replaces `confirmedSessions` in both render blocks (desktop and mobile historial).

---

## Layout

### Desktop — Review mode left panel (380px)

Search input appears between the `HISTORIAL DE NOTAS` label and the session list.

```
┌──────────────────────────────────────────┐
│  HISTORIAL DE NOTAS                      │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ Buscar por sesión, fecha o palabra...│×│
│ └──────────────────────────────────────┘ │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ ▌ Sesión #3  ·  15 ene        Nueva  │ │
│ │   "paciente reporta ansiedad al..."  │ │
│ │   Confirmada                         │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ ▌ Sesión #2  ·  08 ene               │ │
│ │   "llegó tarde, menciona conflicto"  │ │
│ └──────────────────────────────────────┘ │
│                                          │
│   Sin resultados                         │  ← empty state
└──────────────────────────────────────────┘
```

### Mobile — tab Historial (sticky input)

Search input is sticky below the tab nav. The session list scrolls independently beneath it.

```
┌──────────────────────────────────┐
│  Dictar  │  Nota  │  Historial   │  ← tab nav (existing)
├──────────────────────────────────┤
│ Buscar por sesión, fecha...    × │  ← flex-shrink-0, no scrollea
├──────────────────────────────────┤
│                                  │  ← overflow-y-auto from here
│ ●  Sesión #3 · 15 ene            │
│    "paciente reporta ansiedad"   │
│    Confirmada                    │
│                                  │
│ ●  Sesión #2 · 08 ene            │
│    "llegó tarde, menciona..."    │
│                                  │
│    Sin resultados                │  ← empty state
└──────────────────────────────────┘
```

---

## Behavior

### Filtering

The search bar performs a simultaneous match across three fields:

| Field | Source | Example query |
|---|---|---|
| Session number | `confirmedDisplayNum.get(String(s.id))` | `"3"` → Sesión #3 |
| Formatted date | `formatDate(s.session_date).toLowerCase()` | `"ene"` → enero sessions |
| Raw dictation | `(s.raw_dictation ?? '').toLowerCase()` | `"ansiedad"` → keyword match |

- Case-insensitive via `.toLowerCase()`
- Uses `String.prototype.includes()` — never `new RegExp(query)`
- Whitespace-only query bypasses filter entirely (`.trim() === ''` check)
- `null` raw_dictation handled via nullish coalescing `?? ''`

### Clear button (×)

- Visible only when `historialSearchQuery !== ""`
- Click: clears query, returns focus to input via `historialSearchRef`
- `aria-label="Limpiar búsqueda"`

### Reset on patient change

- `useEffect` on `selectedPatientId` resets `historialSearchQuery` to `''`
- Prevents stale filter when switching between patients

### Escape key

- Input focused + query not empty → clears the field
- Input focused + query empty → blurs the input

### Autofocus

- No `autoFocus` on mount (avoids unexpected keyboard on mobile)

### No result count

- Count is not displayed. The empty state covers the zero-result case.

---

## Styling Tokens

Consistent with `PatientSidebar.jsx` and `Sidebar.jsx` search inputs:

```
Desktop wrapper:  px-2 mb-3
Mobile wrapper:   px-4 py-2 border-b border-ink/[0.05] flex-shrink-0

Input:            w-full bg-white border border-black/[0.1] rounded-lg
                  px-3 py-1.5 text-sm text-[#18181b]
                  placeholder:text-ink-tertiary
                  focus:outline-none focus:border-[#5a9e8a]/60
                  transition-colors pr-7
                  maxLength={80}

Clear button:     absolute right-2, text-ink-tertiary hover:text-ink
                  p-0.5 rounded transition-colors

Empty state:      text-ink-tertiary text-[13px] text-center py-6
                  text: "Sin resultados"
```

No emoji. Placeholder is plain text only.

---

## Security

| Vector | Risk | Mitigation |
|---|---|---|
| XSS | None — React renders `historialSearchQuery` as text node, no `dangerouslySetInnerHTML` | By design |
| ReDoS | None — filter uses `.includes()`, not RegExp | By design |
| SQL injection | Not applicable — purely client-side, no DB contact | By design |
| Oversized input | Could degrade filter with very long strings | `maxLength={80}` on input |
| Null raw_dictation | `.toLowerCase()` on null would throw | `(s.raw_dictation ?? '').toLowerCase()` |
| Whitespace-only query | Would show 0 results instead of all sessions | `.trim() === ''` bypasses filter |
| Ghost filter on patient switch | Stale query from previous patient shows wrong results | `useEffect` reset on `selectedPatientId` |

**Rules for implementation:**

1. Filter with `.includes()`, never `new RegExp(historialSearchQuery)`
2. Never pass `historialSearchQuery` to `dangerouslySetInnerHTML`
3. Always set `maxLength={80}` on the input element
4. Always guard `raw_dictation` with `?? ''` before calling `.toLowerCase()`
5. Always guard the filter with `.trim() === ''` to bypass on empty/whitespace input

---

## Tests

Add to `frontend/src/App.test.jsx` (or `HistorialSearch.test.jsx` if App tests become unwieldy):

- Renders search input in desktop historial panel (Review mode)
- Renders search input in mobile historial tab
- Filters by session number — query `"3"` shows Sesión #3, hides others
- Filters by date partial — query `"ene"` shows January sessions, hides others
- Filters by keyword in raw_dictation (case-insensitive)
- Shows "Sin resultados" when no session matches the query
- Clear button (×) is hidden when query is empty
- Clear button (×) appears when query is non-empty
- Clear button click resets query and returns focus to input
- Escape clears query when non-empty
- Query resets to `""` when `selectedPatientId` changes
- Session with `null` raw_dictation does not throw during filter
- Whitespace-only query shows all sessions (no filtering)
