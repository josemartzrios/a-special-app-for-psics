# Patient Invite Email — Flujo secuencial (diseño)

**Fecha:** 2026-05-20  
**Archivo afectado:** `backend/services/email.py` — función `send_patient_invite`

## Problema

Los pacientes se confunden después de crear su contraseña: regresan al link de invitación (de un solo uso) en lugar de ir al portal de login. El correo actual no distingue el paso de activación del acceso recurrente, ni incluye la URL del portal como referencia guardable.

## Solución

Reescribir el template HTML de `send_patient_invite` con un flujo de dos pasos numerados y formato simple (texto plano estilizado), consistente con el tono actual del correo.

## Estructura del correo

```
Asunto: [Nombre psicólogo] te ha invitado al Portal del Paciente

Hola [nombre paciente],

Tu psicólogo/a [nombre psicólogo] te ha invitado a acceder al Portal del Paciente.
Aquí podrás ver los resúmenes de tus sesiones y las tareas asignadas.

── Cómo acceder ──────────────────

1. Crea tu contraseña (solo la primera vez)
   [→ Activar cuenta]
   Este enlace es de un solo uso. Úsalo solo una vez para activar tu cuenta.

2. Después, entra siempre aquí al portal
   [→ Entrar al portal]
   Guarda este enlace en tus favoritos para acceder cuando quieras.

──────────────────────────────────

El equipo de SyqueX
```

## URLs

| Destino | URL |
|---------|-----|
| Activar cuenta (step 1) | `{_patient_portal_url()}/portal/invite?token={token}` (sin cambios) |
| Entrar al portal (step 2) | `{_patient_portal_url()}/portal/login` |

## Decisiones de diseño

- **Formato simple** (texto plano con `<p>` y `<a>`), igual que el correo actual — no se adopta el estilo card HTML del correo de reset de contraseña.
- El step 2 usa `/portal/login` y no solo `/portal`, para que el link sea semánticamente claro como "página de inicio de sesión".
- El texto "de un solo uso" aparece bajo el step 1 para desalentar reingreso al link de activación.
- No se modifica la lógica de backend ni el token — solo el template del correo.

## Alcance

- Un solo cambio: `send_patient_invite` en `backend/services/email.py`
- Sin cambios en frontend, backend routes, base de datos, ni otros correos
