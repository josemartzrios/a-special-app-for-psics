# Patient Invite Email — Flujo Secuencial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescribir el template HTML del correo de invitación de paciente para mostrar dos pasos numerados: (1) crear contraseña (link de un solo uso) y (2) entrar al portal (link permanente al login).

**Architecture:** Cambio único en `backend/services/email.py` — solo se modifica el string HTML dentro de `send_patient_invite`. No hay cambios en rutas, base de datos ni frontend. Se agrega un test unitario que verifica que el HTML resultante contiene ambos links.

**Tech Stack:** Python 3.11, resend SDK, pytest, unittest.mock

---

### Task 1: Test unitario para el contenido del correo

**Files:**
- Modify: `backend/tests/test_email_service.py` (crear si no existe)

- [ ] **Step 1: Verificar si existe el archivo de tests del servicio de email**

```bash
ls backend/tests/test_email_service.py
```

Si no existe, el archivo se crea desde cero en el siguiente paso.

- [ ] **Step 2: Escribir el test que verifica el contenido del correo de invitación**

Crear el archivo `backend/tests/test_email_service.py`:

```python
"""Tests for backend/services/email.py — send_patient_invite template content."""
import pytest
import resend
from unittest.mock import patch
import services.email as email_module


@pytest.mark.asyncio
async def test_patient_invite_email_contains_invite_link():
    """El HTML del correo debe incluir el link de activación con el token."""
    sent_payloads = []

    with patch.object(resend, "api_key", "re_test_key"):
        with patch.object(resend.Emails, "send", side_effect=lambda p: sent_payloads.append(p) or {"id": "x"}):
            with patch.object(email_module, "_patient_portal_url", return_value="https://syquex.mx"):
                await email_module.send_patient_invite(
                    to_email="patient@example.com",
                    patient_name="Ana García",
                    psychologist_name="Dr. Ortega",
                    token="abc123",
                )

    assert len(sent_payloads) == 1
    html = sent_payloads[0]["html"]
    assert "/portal/invite?token=abc123" in html


@pytest.mark.asyncio
async def test_patient_invite_email_contains_login_link():
    """El HTML del correo debe incluir el link permanente al portal de login."""
    sent_payloads = []

    with patch.object(resend, "api_key", "re_test_key"):
        with patch.object(resend.Emails, "send", side_effect=lambda p: sent_payloads.append(p) or {"id": "x"}):
            with patch.object(email_module, "_patient_portal_url", return_value="https://syquex.mx"):
                await email_module.send_patient_invite(
                    to_email="patient@example.com",
                    patient_name="Ana García",
                    psychologist_name="Dr. Ortega",
                    token="abc123",
                )

    assert len(sent_payloads) == 1
    html = sent_payloads[0]["html"]
    assert "/portal/login" in html


@pytest.mark.asyncio
async def test_patient_invite_email_contains_one_time_warning():
    """El HTML debe advertir que el link de activación es de un solo uso."""
    sent_payloads = []

    with patch.object(resend, "api_key", "re_test_key"):
        with patch.object(resend.Emails, "send", side_effect=lambda p: sent_payloads.append(p) or {"id": "x"}):
            with patch.object(email_module, "_patient_portal_url", return_value="https://syquex.mx"):
                await email_module.send_patient_invite(
                    to_email="patient@example.com",
                    patient_name="Ana García",
                    psychologist_name="Dr. Ortega",
                    token="abc123",
                )

    assert len(sent_payloads) == 1
    html = sent_payloads[0]["html"]
    assert "un solo uso" in html
```

- [ ] **Step 3: Ejecutar los tests para verificar que fallan**

Desde `backend/`:
```bash
python -m pytest tests/test_email_service.py -v
```

Resultado esperado: los 3 tests fallan porque el HTML actual no contiene `/portal/login` ni "un solo uso".

---

### Task 2: Implementar el nuevo template

**Files:**
- Modify: `backend/services/email.py:62-85`

- [ ] **Step 4: Reemplazar el body HTML de `send_patient_invite`**

En `backend/services/email.py`, localizar la función `send_patient_invite` (líneas ~62-85) y reemplazar el bloque `html` por:

```python
async def send_patient_invite(to_email: str, patient_name: str, psychologist_name: str, token: str):
    invite_url = f"{_patient_portal_url()}/portal/invite?token={token}"
    portal_url = f"{_patient_portal_url()}/portal/login"
    if not resend.api_key:
        print(f"Mock email: Invite patient {patient_name} -> {invite_url}")
        return None
    try:
        r = resend.Emails.send({
            "from": FROM_EMAIL,
            "to": to_email,
            "subject": f"{psychologist_name} te ha invitado al Portal del Paciente",
            "html": f"""
            <p>Hola {patient_name},</p>
            <p>Tu psicólogo/a {psychologist_name} te ha invitado a acceder al Portal del Paciente.</p>
            <p>Aquí podrás ver los resúmenes de tus sesiones y las tareas asignadas.</p>
            <p><strong>Cómo acceder:</strong></p>
            <p>1. Crea tu contraseña (solo la primera vez)<br>
            <a href="{invite_url}">→ Activar cuenta</a><br>
            <small>Este enlace es de un solo uso. Úsalo solo una vez para activar tu cuenta.</small></p>
            <p>2. Después, entra siempre aquí al portal<br>
            <a href="{portal_url}">→ Entrar al portal</a><br>
            <small>Guarda este enlace en tus favoritos para acceder cuando quieras.</small></p>
            <br>
            <p>El equipo de SyqueX</p>
            """
        })
        return r
    except Exception as e:
        print(f"Error enviando email invite: {e}")
        return None
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

```bash
python -m pytest tests/test_email_service.py -v
```

Resultado esperado:
```
PASSED tests/test_email_service.py::test_patient_invite_email_contains_invite_link
PASSED tests/test_email_service.py::test_patient_invite_email_contains_login_link
PASSED tests/test_email_service.py::test_patient_invite_email_contains_one_time_warning
```

- [ ] **Step 6: Ejecutar suite completa para verificar regresiones**

```bash
python -m pytest tests/ -v
```

Resultado esperado: todos los tests existentes pasan (los de `test_portal_invite.py` y `test_resend_invite.py` mockean `send_patient_invite` completo, por lo que no se ven afectados).

- [ ] **Step 7: Commit**

```bash
git add backend/services/email.py backend/tests/test_email_service.py
git commit -m "feat(email): add two-step sequential flow to patient invite email"
```
