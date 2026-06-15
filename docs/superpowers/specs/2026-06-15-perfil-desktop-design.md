# Vista Desktop del Perfil del Psicólogo — Design

**Fecha:** 2026-06-15
**Estado:** Aprobado
**Branch:** `feature/psic-profile`

## Contexto

El plan `docs/superpowers/plans/2026-05-29-perfil-psicologo.md` implementó la pantalla
"Mi Perfil" mobile-first. El componente `ProfileScreen.jsx` quedó correctamente
responsive (usa `md:grid-cols-2`, `max-w-3xl mx-auto`, `px-6 md:px-8 py-6 md:py-8`),
pero **nunca se cableó al layout desktop de `App.jsx`**.

### Causa raíz

`App.jsx` mantiene dos árboles de layout mutuamente excluyentes por viewport:

- **Desktop** (`hidden md:flex`, ~línea 924): su "Right work area" (~línea 994) solo
  renderiza `activeSection === 'agenda'` y `activeSection === 'patients'`. **No existe
  un bloque `activeSection === 'profile'`.**
- **Mobile** (`md:hidden`, ~línea 1298): aquí sí está el bloque `activeSection === 'profile'`
  (~línea 1645) junto al `BottomNav`.

El botón "Mi Perfil" del sidebar desktop (~línea 958) sí cambia `activeSection` a
`'profile'`, pero el área de trabajo desktop no tiene qué renderizar → **pantalla en
blanco en desktop**.

## Alcance

**Cablear + pulir ancho.** Sin cambios de backend, sin cambios de comportamiento.
Solo el render desktop y el ancho del contenedor.

## Diseño

### 1. Cableado desktop — `App.jsx`

Añadir al "Right work area" del layout desktop (`hidden md:flex`), después del bloque
`activeSection === 'patients'` (~línea 1293), el mismo bloque que ya existe en mobile:

```jsx
{activeSection === 'profile' && (
  <div className="flex flex-col flex-1 min-h-0">
    <ProfileScreen />
  </div>
)}
```

Replica el patrón del bloque mobile (~línea 1645). Como desktop (`hidden md:flex`) y
mobile (`md:hidden`) son excluyentes por viewport, no hay doble render visible.

### 2. Pulir ancho — `ProfileScreen.jsx`

Cambios en el contenedor interno (línea 90):

- `max-w-3xl` → `max-w-5xl` (1024px; ancho cómodo cercano a ~1100px usando token estándar).
- `gap-4` entre las dos cards → `gap-5 md:gap-6` para que respiren al ancho mayor.

El resto del componente ya es responsive y no se toca.

### 3. Característica conocida (no regresión)

Ambos layouts viven siempre en el DOM (uno oculto por `display:none` vía CSS), y React
monta los hijos de un nodo `display:none`. Con `activeSection === 'profile'` se montarán
**dos** instancias de `ProfileScreen` → dos llamadas a `getMyProfile` + `getBillingStatus`.

Esto **ya ocurre hoy** con `patients`, `agenda` y `CalendarScreen` — es la arquitectura
existente de la app, no algo que introduzca este cambio. Se mantiene igual por
consistencia. El doble-fetch queda **fuera de alcance**; atacarlo requeriría reestructurar
ambos layouts.

## Testing

- No hay test de comportamiento nuevo: es cableado + clases CSS, sin lógica nueva.
- Verificar sin regresiones:
  - `frontend/src/components/ProfileScreen.test.jsx`
  - `frontend/src/components/ProfilePasswordField.test.jsx`
  - `frontend/src/components/BottomNav.test.jsx`

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `frontend/src/App.jsx` | Añadir bloque `activeSection === 'profile'` al Right work area desktop |
| `frontend/src/components/ProfileScreen.jsx` | `max-w-3xl` → `max-w-5xl`; `gap-4` → `gap-5 md:gap-6` |

## Fuera de alcance

- Rediseño desktop específico (dos paneles, sub-navegación).
- Eliminar el doble-mount/doble-fetch de los layouts desktop+mobile.
- Cambios de backend.
