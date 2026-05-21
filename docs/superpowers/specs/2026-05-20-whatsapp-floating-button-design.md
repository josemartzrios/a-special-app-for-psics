# WhatsApp Floating Button — SyqueX Landing

**Date:** 2026-05-20  
**Status:** Approved

---

## Objetivo

Añadir un botón flotante de contacto directo a WhatsApp en la landing de SyqueX, visible en todas las páginas del sitio.

---

## Componente

**Archivo:** `landing/components/WhatsAppButton.tsx`

Componente cliente (`'use client'`) que renderiza un enlace `<a>` fijo en pantalla. Se monta una sola vez en `landing/app/layout.tsx` para que aparezca en todas las rutas (landing, /privacidad, /terminos).

---

## Enlace

```
https://wa.me/526676998993
```

- `target="_blank"`
- `rel="noopener noreferrer"`
- Sin mensaje pre-llenado (chat en blanco)

---

## Comportamiento visual

### Desktop (≥ sm)
- Pill redondeada (`rounded-full`)
- Fondo: `#25D366` (verde WhatsApp oficial)
- Texto: blanco
- Contenido: ícono SVG de WhatsApp + texto "WhatsApp"
- Tamaño: `h-14 px-5 gap-3`
- Posición fija: `bottom-6 right-6 z-50`
- Sombra: `shadow-lg`
- Hover: `scale-105` + `shadow-xl` (transición suave 200ms)

### Mobile (< sm)
- Círculo (`rounded-full w-14 h-14`)
- Solo ícono SVG de WhatsApp (sin texto)
- Misma posición y colores

---

## Ícono

SVG inline del logo oficial de WhatsApp en blanco. Sin dependencias de librerías de íconos externas.

---

## Accesibilidad

- `aria-label="Contactar por WhatsApp"` en el `<a>`
- `focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#25D366]`

---

## Integración

```tsx
// landing/app/layout.tsx
import WhatsAppButton from '../components/WhatsAppButton'

export default function RootLayout({ children }) {
  return (
    <html lang="es-MX">
      <body className="bg-white text-ink font-sans antialiased">
        {children}
        <WhatsAppButton />
      </body>
    </html>
  )
}
```

---

## Archivos a modificar

| Acción | Archivo |
|--------|---------|
| Crear | `landing/components/WhatsAppButton.tsx` |
| Modificar | `landing/app/layout.tsx` |

---

## Fuera de alcance

- Mensaje pre-llenado
- Analytics/tracking de clics
- Tooltip emergente al hover
- Comportamiento diferente por scroll position
