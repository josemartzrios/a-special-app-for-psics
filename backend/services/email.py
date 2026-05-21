import resend
from config import settings
from datetime import date, time

resend.api_key = settings.RESEND_API_KEY
FROM_EMAIL = settings.RESEND_FROM_EMAIL or "SyqueX <hola@syquex.mx>"


def _patient_portal_url() -> str:
    """Devuelve la URL base del portal del paciente. Usa PATIENT_PORTAL_URL si está configurada,
    de lo contrario cae a FRONTEND_URL (mismo deploy, rutas /portal/*)."""
    return settings.PATIENT_PORTAL_URL or settings.FRONTEND_URL


async def send_welcome_email(to_email: str, name: str, trial_ends_at):
    if not resend.api_key:
        print(f"Mock email: Welcome {name} ({to_email})")
        return None
    try:
        r = resend.Emails.send({
            "from": FROM_EMAIL,
            "to": to_email,
            "subject": "Bienvenido a SyqueX",
            "html": f"""
            <p>Hola {name},</p>
            <p>¡Bienvenido a SyqueX! Tu prueba gratuita de 14 días ha comenzado y termina el {trial_ends_at.strftime('%Y-%m-%d')}.</p>
            <p><a href="{settings.FRONTEND_URL}">Comienza a escribir</a></p>
            <br>
            <p>El equipo de SyqueX</p>
            """
        })
        return r
    except Exception as e:
        print(f"Error enviando email welcome: {e}")
        return None

async def send_reset_email(to_email: str, name: str, token: str):
    reset_url = f"{settings.FRONTEND_URL}/?token={token}"
    if not resend.api_key:
        print(f"Mock email: Reset for {to_email} -> {reset_url}")
        return None
    try:
        r = resend.Emails.send({
            "from": FROM_EMAIL,
            "to": to_email,
            "subject": "Restablece tu contraseña — SyqueX",
            "html": f"""
            <p>Hola {name},</p>
            <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta de SyqueX.</p>
            <p>Haz clic en el siguiente enlace para crear una nueva contraseña. Este enlace expira en 60 minutos.</p>
            <p><a href="{reset_url}">Restablecer contraseña</a></p>
            <p>Si no solicitaste este cambio, puedes ignorar este correo. Tu contraseña actual seguirá funcionando.</p>
            <br>
            <p>El equipo de SyqueX</p>
            """
        })
        return r
    except Exception as e:
        print(f"Error enviando email reset: {e}")
        return None

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

async def send_patient_reset_email(to_email: str, patient_name: str, token: str):
    reset_url = f"{_patient_portal_url()}/portal/reset?token={token}"
    if not resend.api_key:
        print(f"Mock email: Password reset for patient {patient_name} ({to_email}) -> {reset_url}")
        return None
    try:
        r = resend.Emails.send({
            "from": FROM_EMAIL,
            "to": to_email,
            "subject": "Restablece tu contraseña — Portal del Paciente SyqueX",
            "html": f"""
<html>
<body style="font-family:-apple-system,sans-serif;background:#f4f4f2;margin:0;padding:32px 16px;">
  <div style="max-width:480px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07);">
    <div style="background:#5a9e8a;padding:28px 32px;">
      <p style="color:white;font-size:15px;font-weight:700;margin:0 0 8px 0;letter-spacing:-.02em;">SyqueX</p>
      <h1 style="color:white;font-family:Georgia,serif;font-size:22px;margin:0 0 6px 0;line-height:1.3;">Recupera tu contraseña</h1>
      <p style="color:rgba(255,255,255,.7);font-size:13px;margin:0;line-height:1.5;">Portal del Paciente</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#18181b;font-size:14px;margin:0 0 16px 0;">Hola {patient_name},</p>
      <p style="color:#374151;font-size:13px;margin:0 0 24px 0;line-height:1.6;">
        Recibimos una solicitud para restablecer la contraseña de tu portal. Si no la pediste, puedes ignorar este mensaje.
      </p>
      <a href="{reset_url}" style="display:block;background:#5a9e8a;color:white;text-decoration:none;text-align:center;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;margin-bottom:20px;">
        Crear nueva contraseña →
      </a>
      <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0;">
        Este link es válido por 60 minutos.
      </p>
    </div>
  </div>
</body>
</html>
            """
        })
        return r
    except Exception as e:
        print(f"Error enviando email reset paciente: {e}")
        return None


def generate_ics(slot_date: date, start_time: time, duration_minutes: int, summary: str, description: str) -> str:
    from datetime import datetime, timedelta
    start_dt = datetime.combine(slot_date, start_time)
    end_dt = start_dt + timedelta(minutes=duration_minutes)
    
    start_str = start_dt.strftime("%Y%m%dT%H%M%00")
    end_str = end_dt.strftime("%Y%m%dT%H%M%00")
    
    return f"""BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SyqueX//Sesion//ES\r\nBEGIN:VEVENT\r\nDTSTART:{start_str}\r\nDTEND:{end_str}\r\nSUMMARY:{summary}\r\nDESCRIPTION:{description}\r\nEND:VEVENT\r\nEND:VCALENDAR"""

async def send_booking_confirmation(patient_email: str, psych_email: str, patient_name: str, psych_name: str, slot_date: date, start_time: time, duration_minutes: int):
    ics_content = generate_ics(
        slot_date, start_time, duration_minutes, 
        f"Sesión con {psych_name}", 
        "Sesión de psicoterapia agendada vía SyqueX"
    )
    
    if not resend.api_key:
        print(f"Mock email: Booking confirmation to {patient_email} and {psych_email}")
        return None
        
    try:
        # Send to Patient
        resend.Emails.send({
            "from": FROM_EMAIL,
            "to": patient_email,
            "subject": "Tu sesión está confirmada",
            "html": f"<p>Hola {patient_name}, tu sesión con {psych_name} está confirmada para el {slot_date} a las {start_time.strftime('%H:%M')}.</p>",
            "attachments": [{"filename": "sesion.ics", "content": list(ics_content.encode('utf-8'))}]
        })
    except Exception as e:
        print(f"Error enviando conf. paciente: {e}")
        
    try:
        ics_content_psych = generate_ics(
            slot_date, start_time, duration_minutes, 
            f"Sesión con {patient_name}", 
            "Sesión de psicoterapia agendada vía SyqueX"
        )
        resend.Emails.send({
            "from": FROM_EMAIL,
            "to": psych_email,
            "subject": "Nueva sesión agendada",
            "html": f"<p>El paciente {patient_name} ha agendado una sesión para el {slot_date} a las {start_time.strftime('%H:%M')}.</p>",
            "attachments": [{"filename": "sesion.ics", "content": list(ics_content_psych.encode('utf-8'))}]
        })
    except Exception as e:
        print(f"Error enviando conf. psicólogo: {e}")

async def send_booking_cancellation(patient_email: str, psych_email: str, patient_name: str, psych_name: str, slot_date: date, start_time: time, canceled_by: str = "psychologist"):
    who_patient = "tu psicólogo" if canceled_by == "psychologist" else "ti"
    who_psych = "ti" if canceled_by == "psychologist" else "el paciente"
    
    if not resend.api_key:
        print(f"Mock email: Cancellation to {patient_email} and {psych_email}")
        return None

    try:
        resend.Emails.send({
            "from": FROM_EMAIL,
            "to": patient_email,
            "subject": "Sesión cancelada",
            "html": f"<p>Hola {patient_name}, la sesión con {psych_name} del {slot_date} a las {start_time.strftime('%H:%M')} fue cancelada por {who_patient}.</p>"
        })
        resend.Emails.send({
            "from": FROM_EMAIL,
            "to": psych_email,
            "subject": "Sesión cancelada",
            "html": f"<p>Hola {psych_name}, la sesión con {patient_name} del {slot_date} a las {start_time.strftime('%H:%M')} fue cancelada por {who_psych}.</p>"
        })
    except Exception as e:
        print(f"Error enviando cancelaciones: {e}")
