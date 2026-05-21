"""Tests for backend/services/email.py — send_patient_invite template content."""
import pytest
import resend
from unittest.mock import patch
import services.email as email_module


@pytest.fixture
def invite_email_html():
    """Ejecuta send_patient_invite con mocks y retorna el HTML del payload enviado."""
    import asyncio
    sent_payloads = []

    def mock_send(payload):
        sent_payloads.append(payload)
        return {"id": "mock-id"}

    # resend.api_key es necesario porque email.py hace `if not resend.api_key: return None`
    with patch.object(resend, "api_key", "re_test_key"):
        with patch.object(resend.Emails, "send", side_effect=mock_send):
            with patch.object(email_module, "_patient_portal_url", return_value="https://syquex.mx"):
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(
                        email_module.send_patient_invite(
                            to_email="patient@example.com",
                            patient_name="Ana García",
                            psychologist_name="Dr. Ortega",
                            token="abc123",
                        )
                    )
                finally:
                    loop.close()

    assert len(sent_payloads) == 1
    return sent_payloads[0]["html"]


def test_patient_invite_email_contains_invite_link(invite_email_html):
    """El HTML del correo debe incluir el link de activación con el token."""
    assert "/portal/invite?token=abc123" in invite_email_html


def test_patient_invite_email_contains_login_link(invite_email_html):
    """El HTML del correo debe incluir el link permanente al portal de login."""
    assert "/portal/login" in invite_email_html


def test_patient_invite_email_contains_one_time_warning(invite_email_html):
    """El HTML debe advertir que el link de activación es de un solo uso."""
    assert "un solo uso" in invite_email_html
