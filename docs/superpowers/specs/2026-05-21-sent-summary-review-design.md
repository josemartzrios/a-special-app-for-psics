# Spec: Revisión de resumen enviado al paciente

**Fecha:** 2026-05-21
**Estado:** Aprobado

---

## Problema

Cuando el psicólogo envía el resumen de seguimiento al portal del paciente, el componente `PatientSummarySection` colapsa a un banner de confirmación. El contenido enviado (temas trabajados y tarea) deja de ser visible — el psicólogo no puede consultar qué envió en sesiones anteriores.

Los datos **sí existen** en el backend: `getSummary` los carga al montar el componente y los guarda en el estado `fields`. El problema es exclusivamente de UI: el bloque `phase === 'sent'` no los renderiza.

---

## Solución

Toggle booleano `showContent` dentro del bloque `phase === 'sent'` en `PatientSummarySection.jsx`. Sin cambios al backend, sin archivos nuevos, sin modificación al FSM de fases.

---

## Comportamiento

### Estado colapsado (default al abrir una sesión ya enviada)

El banner existente con un botón **"Ver resumen"** alineado a la derecha:

```
┌─────────────────────────────────────────┐
│ ✓ Seguimiento enviado a Ana              │
│   Hoy · 14:32              [Ver resumen]│
└─────────────────────────────────────────┘
```

### Estado expandido (tras tocar "Ver resumen")

El banner más los campos en modo lectura, con botón **"Ocultar ↑"** para colapsar:

```
┌─────────────────────────────────────────┐
│ ✓ Seguimiento enviado a Ana              │
│   Hoy · 14:32            [Ocultar ↑]   │
├─────────────────────────────────────────┤
│ TEMAS TRABAJADOS                        │
│ ─────────────────────────────────────── │
│  Hoy hablamos sobre cómo te has…       │
│                                         │
│ TAREA PARA ESTA SEMANA                 │
│ ─────────────────────────────────────── │
│  —                                      │
└─────────────────────────────────────────┘
```

### Campos en modo lectura

- Elemento `<p>` estático — sin `onClick`, sin `cursor: text`
- Sin borde punteado (`border: 1.5px dashed`)
- Color de texto: `MUTED` (`#9ca3af`) para distinguirlo visualmente del modo edición
- Si el campo está vacío, mostrar `—` (mismo comportamiento que el modo edición)
- Los separadores `<hr>` y labels de sección se mantienen idénticos al modo edición

---

## Cambios de código

### `frontend/src/components/PatientSummarySection.jsx`

1. Agregar `const [showContent, setShowContent] = useState(false)` junto a los demás estados.
2. En el bloque `if (phase === 'sent')`:
   - Añadir el botón toggle dentro del banner (derecha del timestamp).
   - Renderizar condicionalmente los campos de solo lectura debajo del banner cuando `showContent === true`.
3. El componente no recibe props adicionales — todo el estado es local.

---

## Fuera de alcance

- Re-edición o re-envío del resumen desde esta vista.
- Historial de versiones enviadas (solo la última).
- Cambios al backend o a `api.js`.
- Cambios a cómo se renderizan los resúmenes en el portal del paciente.

---

## Testing

- Test unitario en `PatientSummarySection.test.jsx` (o nuevo archivo si no existe): verificar que al renderizar con `phase === 'sent'` y datos en `fields`, el contenido **no** está visible por defecto y **sí** aparece tras simular click en "Ver resumen".
- Verificar que los campos renderizados no tienen `cursor: text` ni `onClick` activos.
