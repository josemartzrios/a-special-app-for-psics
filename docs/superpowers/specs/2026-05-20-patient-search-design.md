# Patient Search Bar — Design Spec

**Date:** 2026-05-20  
**Status:** Approved  
**Scope:** Client-side patient search in desktop sidebar and mobile slide-over

---

## Problem

Psychologists with many patients must scroll the full list to find a patient by name. No filtering mechanism exists.

---

## Solution

Add a client-side search input that filters the patient list by name in real time. Pure in-memory filter — no network calls, no new API endpoints.

---

## Affected Files

| File | Change |
|---|---|
| `frontend/src/components/PatientSidebar.jsx` | Add search state + input + filtered list + empty state |
| `frontend/src/components/Sidebar.jsx` | Add search state + input (replaces "N sesiones" row) + filtered list + empty state |

`App.jsx` is not modified.

---

## Layout

### Desktop — PatientSidebar.jsx

Search input appears between the "PACIENTES [+]" label and the patient list.

```
┌────────────────────────────┐
│ SyqueX                     │
├────────────────────────────┤
│  PACIENTES             [+] │
├────────────────────────────┤
│  [Buscar paciente...    ]  │
├────────────────────────────┤
│  María García              │
│  Sesión #3 · Confirmada    │
│  Juan Pérez                │
│  Sin sesiones              │
└────────────────────────────┘
```

With active query and clear button:

```
│  [garcia              [×]] │
├────────────────────────────┤
│  María García              │
│  Sesión #3 · Confirmada    │
```

No results:

```
│  [xyz                 [×]] │
├────────────────────────────┤
│                            │
│       Sin resultados       │
│                            │
```

### Mobile — Sidebar.jsx (slide-over)

Search input replaces the "N sesiones" label row entirely.

```
┌──────────────────────────────┐
│ ▌ Sesiones clínicas      [✕] │
├──────────────────────────────┤
│ [Buscar paciente...        ] │
├──────────────────────────────┤
│ MARÍA GARCÍA          12 ene │
│ Sesión #3 · Confirmada       │
```

No results:

```
├──────────────────────────────┤
│                              │
│       Sin resultados         │
│                              │
```

---

## Behavior

### Filtering
- Case-insensitive match on `patient_name` only
- Uses `String.prototype.includes()` — never `new RegExp(searchQuery)`
- Filters the `conversations` prop already in memory — instant, no network

### Clear button (×)
- Visible only when `searchQuery !== ""`
- Click: clears query, returns focus to input

### Reset
- Desktop: query persists while sidebar is visible; cleared only via × or Escape
- Mobile: query resets to `""` when the slide-over closes (natural state teardown)

### Escape key
- Input focused + query not empty → clears the field
- Input focused + query empty → blurs the input

### Autofocus
- Neither desktop nor mobile auto-focuses the input on mount (avoids unexpected keyboard on mobile, avoids stealing focus on desktop)

---

## Styling Tokens

All tokens consistent with existing design system:

```
Input wrapper:   px-3 py-2 (desktop) / px-5 py-2 (mobile, matches surrounding padding)
Input element:   bg-white border border-black/[0.1] rounded-lg px-3 py-1.5
                 text-sm text-[#18181b] placeholder:text-ink-tertiary
                 focus:outline-none focus:border-[#5a9e8a]/60 transition-colors
                 maxLength={100}
Clear button:    text-ink-tertiary hover:text-ink p-0.5 rounded transition-colors
Empty state:     text-ink-tertiary text-[13px] text-center py-6
```

---

## Security

| Vector | Risk | Mitigation |
|---|---|---|
| XSS | None — React renders query as text node, no dangerouslySetInnerHTML | By design |
| ReDoS | None — filter uses `.includes()`, not RegExp | By design |
| SQL injection | Not applicable — purely client-side, no DB contact | By design |
| Oversized input | Low — could degrade filter with huge strings | `maxLength={100}` on input |

**Rules for implementation:**
1. Filter with `.includes()`, never `new RegExp(searchQuery)`
2. Never pass `searchQuery` to `dangerouslySetInnerHTML`
3. Always set `maxLength={100}` on the input element

---

## State Architecture

**Approach:** Local state in each component (Option A — approved).

```jsx
const [searchQuery, setSearchQuery] = useState('');

const filteredConversations = conversations.filter(c =>
  c.patient_name.toLowerCase().includes(searchQuery.toLowerCase())
);
```

No changes to App.jsx. Each component manages its own `searchQuery` independently.

---

## Tests

Add to existing test files (`Sidebar.test.jsx`, `PatientSidebar.test.jsx`):

- Renders search input
- Filters patient list by name (case-insensitive)
- Shows "Sin resultados" when no matches
- Clear button (×) appears when query is non-empty
- Clear button click resets query
- Escape clears query when non-empty
- Escape blurs input when query is empty
