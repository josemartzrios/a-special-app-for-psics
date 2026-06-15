import { getAccessToken, refreshAccessToken, clearAccessToken } from './auth.js';

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8000") + "/api/v1";

// Callbacks para manejar redirecciones desde fuera de api.js
let _onUnauthorized = null;  // () => void — redirige a login
let _onPaymentRequired = null; // () => void — redirige a billing

export function setAuthCallbacks({ onUnauthorized, onPaymentRequired }) {
  _onUnauthorized = onUnauthorized;
  _onPaymentRequired = onPaymentRequired;
}

export class ApiError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function _handleResponse(res) {
  if (res.ok) {
    if (res.status === 204) return null;
    return res.json();
  }

  let detail = `Error ${res.status}`;
  let code = null;
  try {
    const body = await res.json();
    if (Array.isArray(body.detail)) {
      // FastAPI 422: detail is an array of { msg, loc, ... }
      detail = body.detail
        .map((e) => (typeof e === 'object' && e.msg ? e.msg.replace(/^Value error,\s*/i, '') : String(e)))
        .join('; ');
    } else {
      detail = body.detail || detail;
    }
    code = body.code || null;
  } catch (_) { /* response body not JSON */ }

  throw new ApiError(detail, res.status, code);
}

/**
 * fetch con manejo automático de JWT, refresh y errores 401/402.
 */
async function _authFetch(url, options = {}) {
  const token = getAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };

  let res = await fetch(url, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    const newToken = await refreshAccessToken(API_BASE);
    if (!newToken) {
      clearAccessToken();
      _onUnauthorized?.();
      throw new ApiError('Sesión expirada', 401);
    }
    res = await fetch(url, {
      ...options,
      headers: { ...headers, 'Authorization': `Bearer ${newToken}` },
      credentials: 'include',
    });
  }

  if (res.status === 402) {
    _onPaymentRequired?.();
    throw new ApiError('Suscripción requerida', 402, 'SUBSCRIPTION_EXPIRED');
  }

  return _handleResponse(res);
}

export async function processSession(patientId, dictation, format = 'SOAP') {
  return await _authFetch(`${API_BASE}/sessions/${patientId}/process`, {
    method: 'POST',
    body: JSON.stringify({ raw_dictation: dictation, format })
  });
}

export async function getJobStatus(jobId) {
  return await _authFetch(`${API_BASE}/jobs/${jobId}`);
}

export function openJobStream(jobId, onMessage, onError) {
  const token = getAccessToken();
  const url = `${API_BASE}/jobs/${jobId}/stream`;
  // Our backend now supports token in query param for SSE
  const sseUrl = `${url}?token=${token}`;
  const eventSource = new EventSource(sseUrl);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
      if (data.status === 'completed' || data.status === 'failed') {
        eventSource.close();
      }
    } catch (err) {
      console.error("Error parsing SSE data", err);
    }
  };

  eventSource.onerror = (err) => {
    eventSource.close();
    onError(err);
  };

  return () => {
    eventSource.close();
  };
}

export async function confirmNote(sessionId, noteData) {
  return await _authFetch(`${API_BASE}/sessions/${sessionId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ edited_note: noteData })
  });
}

export async function getPatientSessions(patientId, pageSize = 50) {
  const data = await _authFetch(`${API_BASE}/patients/${patientId}/sessions?page_size=${pageSize}`);
  return data.items;
}

export async function listPatients() {
  return await _authFetch(`${API_BASE}/patients`);
}

export async function getPatient(patientId) {
  return await _authFetch(`${API_BASE}/patients/${patientId}`);
}

export async function createPatient(data) {
  const payload = typeof data === 'string' ? { name: data, reason_for_consultation: "N/A", date_of_birth: "1900-01-01" } : data;
  return await _authFetch(`${API_BASE}/patients`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function updatePatient(patientId, data) {
  return await _authFetch(`${API_BASE}/patients/${patientId}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export async function getTemplate() {
  return _authFetch(`${API_BASE}/template`);
}

export async function saveTemplate(fields) {
  return _authFetch(`${API_BASE}/template`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
}

export async function analyzePdf(file) {
  // Use fetch() directly — _authFetch always sets Content-Type: application/json
  // which breaks multipart/form-data. Let the browser set the boundary automatically.
  const formData = new FormData();
  formData.append('file', file);
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/template/analyze-pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(err.detail || 'Error al analizar el PDF', res.status);
  }
  return res.json();
}

export async function listConversations() {
  const data = await _authFetch(`${API_BASE}/conversations`);
  return data.items;
}

export async function archiveSession(sessionId) {
  return await _authFetch(`${API_BASE}/sessions/${sessionId}/archive`, { method: 'PATCH' });
}

export async function archivePatientSessions(patientId) {
  return await _authFetch(`${API_BASE}/patients/${patientId}/sessions/archive`, { method: 'PATCH' });
}

export async function deleteSession(sessionId) {
  return await _authFetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function getPatientProfile(patientId) {
  return await _authFetch(`${API_BASE}/patients/${patientId}/profile`);
}

// --- Auth ---
export async function login(email, password) {
  const formData = new FormData();
  formData.append('username', email);
  formData.append('password', password);
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  return _handleResponse(res);
}

export async function register(name, email, password, cedula, privacyVersion = '1.0', termsVersion = '1.0') {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, email, password,
      cedula_profesional: cedula || null,
      accepted_privacy: true,
      accepted_terms: true,
      privacy_version: privacyVersion,
      terms_version: termsVersion,
    }),
    credentials: 'include',
  });
  return _handleResponse(res);
}

export async function logout() {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
  clearAccessToken();
}

export async function forgotPassword(email) {
  const res = await fetch(`${API_BASE}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return _handleResponse(res);
}

export async function resetPassword(token, newPassword) {
  const res = await fetch(`${API_BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
    credentials: 'include',
  });
  return _handleResponse(res);
}

// --- Billing ---
export async function getBillingStatus() {
  return _authFetch(`${API_BASE}/billing/status`);
}

export async function createCheckout() {
  return _authFetch(`${API_BASE}/billing/create-checkout`, { method: 'POST' });
}

export async function cancelSubscription() {
  return _authFetch(`${API_BASE}/billing/cancel`, { method: 'POST' });
}

export async function getMyProfile() {
  return _authFetch(`${API_BASE}/auth/me`);
}

export async function changePassword(currentPassword, newPassword) {
  return _authFetch(`${API_BASE}/auth/change-password`, {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export async function createSetupIntent() {
  return _authFetch(`${API_BASE}/billing/setup-intent`, { method: 'POST' });
}

// --- Patient Summaries (psychologist side) ---
export async function getSummary(sessionId) {
  return _authFetch(`${API_BASE}/sessions/${sessionId}/summary`);
}

export async function generateSummary(sessionId) {
  return _authFetch(`${API_BASE}/sessions/${sessionId}/summary/generate`, { method: 'POST' });
}

export async function saveSummary(sessionId, data) {
  return _authFetch(`${API_BASE}/sessions/${sessionId}/summary`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// --- Patient Portal ---
export async function invitePatient(patientId) {
  return await _authFetch(`${API_BASE}/patients/${patientId}/portal/invite`, {
    method: 'POST',
  });
}

export async function resendPatientInvite(patientId) {
  return await _authFetch(`${API_BASE}/patients/${patientId}/portal/resend-invite`, {
    method: 'POST',
  });
}

export async function sendSummaryToPortal(sessionId) {
  return await _authFetch(`${API_BASE}/sessions/${sessionId}/summary/send`, {
    method: 'POST',
  });
}

// --- Calendar ---
export async function getCalendarSlots(month) {
  return _authFetch(`${API_BASE}/calendar/slots?month=${month}`);
}

export async function createCalendarSlot(data) {
  return _authFetch(`${API_BASE}/calendar/slots`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteCalendarSlot(slotId) {
  return _authFetch(`${API_BASE}/calendar/slots/${slotId}`, {
    method: 'DELETE',
  });
}

export async function parseAvailability(text, referenceDate) {
  return _authFetch(`${API_BASE}/calendar/parse-availability`, {
    method: 'POST',
    body: JSON.stringify({ text, reference_date: referenceDate }),
  });
}

export async function createCalendarSlotsBatch(slots) {
  return _authFetch(`${API_BASE}/calendar/slots/batch`, {
    method: 'POST',
    body: JSON.stringify({ slots }),
  });
}
