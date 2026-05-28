import { navigateTo } from './auth'

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/api/v1'

let _patientToken = null

export function setPatientToken(token) {
  _patientToken = token
  if (token) {
    localStorage.setItem('patient_token', token)
  } else {
    localStorage.removeItem('patient_token')
  }
}

export function getPatientToken() {
  if (!_patientToken) {
    _patientToken = localStorage.getItem('patient_token')
  }
  return _patientToken
}

export function clearPatientToken() {
  _patientToken = null
  localStorage.removeItem('patient_token')
}

async function patientFetch(path, options = {}) {
  const token = getPatientToken()
  const headers = { ...options.headers }
  if (options.body) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    if (res.status === 401) {
      clearPatientToken()
      navigateTo('/portal/login')
      window.location.reload()
    }
    let msg = 'Error en el portal'
    try {
      const data = await res.json()
      if (Array.isArray(data.detail)) {
        msg = data.detail.map(e => e.msg).join('; ')
      } else {
        msg = data.detail || msg
      }
    } catch (e) {
      msg = await res.text() || msg
    }
    throw new Error(msg)
  }

  return res.json()
}

export async function patientLogin(email, password) {
  const res = await fetch(`${API_BASE}/auth/patient/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  
  if (!res.ok) {
    let msg = 'Error al iniciar sesión'
    try {
      const data = await res.json()
      msg = data.detail || msg
    } catch (e) {}
    throw new Error(msg)
  }

  const data = await res.json()
  setPatientToken(data.access_token)
  return data
}

export async function acceptPatientInvite(token, password) {
  const res = await fetch(`${API_BASE}/auth/patient/accept-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
  
  if (!res.ok) {
    let msg = 'Error al aceptar invitación'
    try {
      const data = await res.json()
      msg = data.detail || msg
    } catch (e) {}
    throw new Error(msg)
  }

  const data = await res.json()
  setPatientToken(data.access_token)
  return data
}

export async function getPatientSummaries() {
  return patientFetch('/portal/summaries')
}

export async function getPatientSummaryDetail(summaryId) {
  return patientFetch(`/portal/summaries/${summaryId}`)
}

export async function requestPatientPasswordReset(email) {
  const res = await fetch(`${API_BASE}/auth/patient/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })

  if (!res.ok) {
    let msg = 'Error al procesar la solicitud'
    try {
      const data = await res.json()
      msg = data.detail || msg
    } catch (e) {}
    throw new Error(msg)
  }

  return res.json()
}

export async function resetPatientPassword(token, newPassword) {
  const res = await fetch(`${API_BASE}/auth/patient/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  })

  if (!res.ok) {
    let msg = 'El link de recuperación no es válido o ha expirado.'
    try {
      const data = await res.json()
      msg = data.detail || msg
    } catch (e) {}
    throw new Error(msg)
  }

  const data = await res.json()
  setPatientToken(data.access_token)
  return data
}

// --- Booking ---
export async function getPatientAvailability(month) {
  return patientFetch(`/portal/availability?month=${month}`)
}

export async function bookPatientSlot(slotId) {
  return patientFetch('/portal/book', {
    method: 'POST',
    body: JSON.stringify({ slot_id: slotId })
  })
}

export async function cancelPatientBooking(slotId) {
  return patientFetch(`/portal/booking/${slotId}`, {
    method: 'DELETE'
  })
}

export async function acknowledgeBookingCancellation(slotId) {
  return patientFetch(`/portal/booking/${slotId}/acknowledge`, {
    method: 'POST'
  })
}

export async function explainText(selectedText, context) {
  return patientFetch('/portal/explain', {
    method: 'POST',
    body: JSON.stringify({ selected_text: selectedText, context })
  })
}
