# Vista Desktop del Perfil del Psicólogo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que la pantalla "Mi Perfil" se renderice en el layout desktop de `App.jsx` (hoy queda en blanco) y pulir el ancho del componente para aprovechar el espacio desktop.

**Architecture:** `App.jsx` mantiene dos árboles de layout excluyentes por viewport (`hidden md:flex` para desktop, `md:hidden` para mobile). El bloque `activeSection === 'profile'` solo existe en el árbol mobile. La solución es añadir el mismo bloque al "Right work area" del árbol desktop y ampliar el `max-width` del contenedor de `ProfileScreen`. Sin cambios de backend ni de comportamiento.

**Tech Stack:** React 18, Tailwind CSS (CDN), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-15-perfil-desktop-design.md`

---

## Mapa de archivos

**Modificados:**
- `frontend/src/App.jsx` — añadir bloque `activeSection === 'profile'` al Right work area desktop (entre línea 1293 `</>)}` y línea 1294 `</div>`)
- `frontend/src/components/ProfileScreen.jsx` — `max-w-3xl` → `max-w-5xl` (línea 90); `gap-4` → `gap-5 md:gap-6` (línea 96)

**Sin tests nuevos:** el cambio es cableado JSX + clases CSS, sin lógica nueva. Se verifica que los tests existentes sigan verdes.

---

## Task 1: Pulir ancho de ProfileScreen

**Files:**
- Modify: `frontend/src/components/ProfileScreen.jsx:90` y `:96`

- [ ] **Step 1: Ampliar el max-width del contenedor**

En `frontend/src/components/ProfileScreen.jsx`, localizar la línea 90:

```jsx
      <div className="max-w-3xl mx-auto px-6 md:px-8 py-6 md:py-8">
```

Reemplazar por:

```jsx
      <div className="max-w-5xl mx-auto px-6 md:px-8 py-6 md:py-8">
```

- [ ] **Step 2: Ampliar el gap entre las dos cards**

En el mismo archivo, localizar la línea 96:

```jsx
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
```

Reemplazar por:

```jsx
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
```

- [ ] **Step 3: Verificar que los tests de ProfileScreen siguen verdes**

```bash
cd frontend
npx vitest run src/components/ProfileScreen.test.jsx
```

Esperado: todos los tests `PASSED` (las clases CSS no afectan las queries de los tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ProfileScreen.jsx
git commit -m "feat(frontend): widen ProfileScreen container for desktop"
```

---

## Task 2: Cablear ProfileScreen al layout desktop

**Files:**
- Modify: `frontend/src/App.jsx` (insertar entre línea 1293 y 1294)

El "Right work area" del layout desktop (`<div className="flex-1 flex flex-col min-w-0 overflow-hidden">`, ~línea 994) hoy solo renderiza `activeSection === 'agenda'` y `activeSection === 'patients'`. Falta el bloque de `'profile'`. `ProfileScreen` ya está importado en `App.jsx` (línea 27), así que no hace falta añadir import.

- [ ] **Step 1: Insertar el bloque profile en el Right work area desktop**

En `frontend/src/App.jsx`, localizar el cierre del bloque `patients` desktop seguido de los dos `</div>` de cierre:

```jsx
          </>)}
        </div>
      </div>

      {/* ── MOBILE LAYOUT (<md) ── */}
```

Reemplazar por (se inserta el bloque profile **antes** del primer `</div>`, que cierra el Right work area):

```jsx
          </>)}

          {activeSection === 'profile' && (
            <div className="flex flex-col flex-1 min-h-0">
              <ProfileScreen />
            </div>
          )}
        </div>
      </div>

      {/* ── MOBILE LAYOUT (<md) ── */}
```

- [ ] **Step 2: Verificar que la app levanta sin errores de compilación**

```bash
cd frontend
npx vite build
```

Esperado: build exitoso, sin errores de JSX/sintaxis. (Alternativa rápida si `vite build` es lento: `npx eslint src/App.jsx` si el proyecto tiene eslint configurado; de lo contrario usar el build.)

- [ ] **Step 3: Verificación manual en navegador**

```bash
cd frontend
npm run dev
```

En una ventana de escritorio (ancho ≥ 768px):
1. Iniciar sesión.
2. Click en "Mi Perfil" en el sidebar izquierdo.
3. Confirmar que la pantalla de perfil se renderiza (antes salía en blanco): se ven las dos cards "Datos personales" y "Suscripción y pago" centradas con ancho amplio (max-w-5xl).
4. Estrechar la ventana a < 768px: confirmar que el `BottomNav` aparece y el perfil sigue funcionando en una sola columna.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): render ProfileScreen in desktop layout"
```

---

## Task 3: Verificación final sin regresiones

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Correr la suite de tests del frontend afectada**

```bash
cd frontend
npx vitest run src/components/ProfileScreen.test.jsx src/components/ProfilePasswordField.test.jsx src/components/BottomNav.test.jsx
```

Esperado: todos `PASSED`.

- [ ] **Step 2: Confirmar el diff final**

```bash
git diff dev --stat
```

Esperado: solo dos archivos modificados — `frontend/src/App.jsx` y `frontend/src/components/ProfileScreen.jsx`.
