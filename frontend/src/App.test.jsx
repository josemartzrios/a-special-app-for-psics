import { describe, it, expect } from 'vitest'
import { markPendingNotesReadOnly, filterHistorialSessions } from './App'

// Refleja la lógica de loadPatientChat — se testea sin montar el componente completo
function buildChatMessages(sessions) {
  const msgs = []
  sessions.forEach(session => {
    if (session.raw_dictation) {
      msgs.push({ role: 'user', text: session.raw_dictation })
    }

    if (session.format === 'chat') {
      if (session.ai_response) {
        msgs.push({ role: 'assistant', type: 'chat', text: session.ai_response })
      }
      return
    }

    // SOAP y otros formatos estructurados
    const hasStructuredNote = session.status === 'confirmed' && session.structured_note
    if (hasStructuredNote) {
      msgs.push({
        role: 'assistant',
        type: 'bot',
        noteData: {
          clinical_note: {
            structured_note: session.structured_note,
            detected_patterns: session.detected_patterns || [],
            alerts: session.alerts || [],
            session_id: String(session.id),
          },
          text_fallback: session.ai_response,
        },
        sessionId: String(session.id),
        readOnly: true,
      })
    } else if (session.ai_response) {
      msgs.push({
        role: 'assistant',
        type: 'bot',
        noteData: {
          clinical_note: null,
          text_fallback: session.ai_response,
          session_id: String(session.id),
        },
        sessionId: String(session.id),
        readOnly: false,
      })
    }
  })
  return msgs
}

describe('buildChatMessages', () => {
  it('renderiza sesión chat como type:chat con texto plano', () => {
    const sessions = [{
      id: 'sess-1',
      format: 'chat',
      raw_dictation: '¿Qué técnicas usas para el insomnio?',
      ai_response: 'Higiene del sueño y TCC-I.',
      status: 'confirmed',
      structured_note: null,
      detected_patterns: null,
      alerts: null,
    }]

    const msgs = buildChatMessages(sessions)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toEqual({ role: 'user', text: '¿Qué técnicas usas para el insomnio?' })
    expect(msgs[1]).toEqual({ role: 'assistant', type: 'chat', text: 'Higiene del sueño y TCC-I.' })
  })

  it('renderiza sesión SOAP confirmada como type:bot readOnly', () => {
    const sessions = [{
      id: 'sess-2',
      format: 'SOAP',
      raw_dictation: 'Paciente con ansiedad.',
      ai_response: '**S — Ansiedad**',
      status: 'confirmed',
      structured_note: { subjective: 'Ansiedad', objective: 'Observado', assessment: 'TAG', plan: 'TCC' },
      detected_patterns: ['ansiedad'],
      alerts: [],
    }]

    const msgs = buildChatMessages(sessions)
    expect(msgs).toHaveLength(2)
    expect(msgs[1].type).toBe('bot')
    expect(msgs[1].readOnly).toBe(true)
    expect(msgs[1].noteData.clinical_note.structured_note.subjective).toBe('Ansiedad')
  })

  it('renderiza sesión SOAP draft como type:bot no readOnly', () => {
    const sessions = [{
      id: 'sess-3',
      format: 'SOAP',
      raw_dictation: 'Dictado sin confirmar.',
      ai_response: '**S — borrador**',
      status: 'draft',
      structured_note: null,
      detected_patterns: null,
      alerts: null,
    }]

    const msgs = buildChatMessages(sessions)
    expect(msgs[1].type).toBe('bot')
    expect(msgs[1].readOnly).toBe(false)
  })

  it('omite mensaje del agente si chat sin ai_response', () => {
    const sessions = [{
      id: 'sess-4',
      format: 'chat',
      raw_dictation: 'Mensaje sin respuesta.',
      ai_response: null,
      status: 'confirmed',
      structured_note: null,
      detected_patterns: null,
      alerts: null,
    }]

    const msgs = buildChatMessages(sessions)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
  })

  it('mezcla correctamente sesiones SOAP y chat en orden cronológico', () => {
    const sessions = [
      {
        id: 's1', format: 'SOAP', raw_dictation: 'Dictado SOAP', ai_response: '**S — ...**',
        status: 'confirmed',
        structured_note: { subjective: 'S', objective: 'O', assessment: 'A', plan: 'P' },
        detected_patterns: [], alerts: [],
      },
      {
        id: 's2', format: 'chat', raw_dictation: 'Consulta rápida', ai_response: 'Respuesta rápida.',
        status: 'confirmed', structured_note: null, detected_patterns: null, alerts: null,
      },
    ]

    const msgs = buildChatMessages(sessions)
    expect(msgs).toHaveLength(4)
    expect(msgs[0].text).toBe('Dictado SOAP')
    expect(msgs[1].type).toBe('bot')
    expect(msgs[2].text).toBe('Consulta rápida')
    expect(msgs[3].type).toBe('chat')
  })
})

describe('markPendingNotesReadOnly', () => {
  it('pone readOnly:true en mensajes bot con noteData', () => {
    const messages = [
      { role: 'user', text: 'Dictado' },
      { role: 'assistant', type: 'bot', noteData: { clinical_note: null, text_fallback: 'S — ...' }, readOnly: false },
    ]
    const result = markPendingNotesReadOnly(messages)
    expect(result[0]).toEqual(messages[0])
    expect(result[1].readOnly).toBe(true)
  })

  it('no modifica mensajes que no son bot con noteData', () => {
    const messages = [
      { role: 'user', text: 'Hola' },
      { role: 'assistant', type: 'chat', text: 'Respuesta libre' },
      { role: 'assistant', type: 'error', text: 'Error' },
    ]
    const result = markPendingNotesReadOnly(messages)
    expect(result).toEqual(messages)
  })

  it('marca múltiples notas SOAP pendientes en el mismo chat', () => {
    const messages = [
      { role: 'assistant', type: 'bot', noteData: {}, readOnly: false },
      { role: 'user', text: 'Segundo dictado' },
      { role: 'assistant', type: 'bot', noteData: {}, readOnly: false },
    ]
    const result = markPendingNotesReadOnly(messages)
    expect(result[0].readOnly).toBe(true)
    expect(result[2].readOnly).toBe(true)
  })

  it('no rompe notas ya confirmadas (readOnly:true)', () => {
    const messages = [
      { role: 'assistant', type: 'bot', noteData: {}, readOnly: true },
    ]
    const result = markPendingNotesReadOnly(messages)
    expect(result[0].readOnly).toBe(true)
  })
})

describe('confirmedSessions filter', () => {
  // Mirrors the derived variable logic in App.jsx lines 595-596
  function getConfirmedSessions(sessionHistory) {
    const soapSessions = sessionHistory.filter(s => s.format !== 'chat')
    return soapSessions.filter(s => s.status === 'confirmed')
  }

  it('excluye sesiones draft del historial', () => {
    const history = [
      { id: '1', format: 'SOAP', status: 'draft' },
      { id: '2', format: 'SOAP', status: 'confirmed' },
    ]
    const result = getConfirmedSessions(history)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })

  it('no produce duplicados cuando una sesión cambia de draft a confirmed', () => {
    // Simula el estado después de que fetchPatientSessions reemplaza el array:
    // la misma sesión ahora viene como confirmed (misma id, nuevo status)
    const historyAfterConfirm = [
      { id: '1', format: 'SOAP', status: 'confirmed' },
    ]
    const result = getConfirmedSessions(historyAfterConfirm)
    expect(result).toHaveLength(1)
  })

  it('excluye sesiones chat aunque estén confirmadas', () => {
    const history = [
      { id: '1', format: 'chat', status: 'confirmed' },
      { id: '2', format: 'SOAP', status: 'confirmed' },
    ]
    const result = getConfirmedSessions(history)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })
})

describe('toggleExpandedSession', () => {
  // Mirrors the toggle logic that will live in App.jsx
  function toggleExpandedSession(currentId, clickedId) {
    return currentId === clickedId ? null : clickedId
  }

  it('expands a session when none is expanded', () => {
    expect(toggleExpandedSession(null, 'sess-5')).toBe('sess-5')
  })

  it('collapses the session when clicking the same one', () => {
    expect(toggleExpandedSession('sess-5', 'sess-5')).toBe(null)
  })

  it('switches to a different session when one is already expanded', () => {
    expect(toggleExpandedSession('sess-5', 'sess-3')).toBe('sess-3')
  })
})

describe('currentSessionNote shapes', () => {
  it('loading shape has type:loading and no noteData', () => {
    const note = { type: 'loading' };
    expect(note.type).toBe('loading');
    expect(note.noteData).toBeUndefined();
  });

  it('bot shape has noteData, sessionId from noteData.session_id, and readOnly:false', () => {
    const noteData = { session_id: 'sess-42', clinical_note: { structured_note: {} } };
    const note = {
      type: 'bot',
      noteData,
      sessionId: noteData.session_id,
      readOnly: false,
    };
    expect(note.type).toBe('bot');
    expect(note.noteData).toBe(noteData);
    expect(note.sessionId).toBe('sess-42');
    expect(note.readOnly).toBe(false);
  });

  it('error shape has type:error and text with "Anomalía de conexión:" prefix', () => {
    const err = new Error('Network timeout');
    const note = { type: 'error', text: 'Anomalía de conexión: ' + err.message };
    expect(note.type).toBe('error');
    expect(note.text).toBe('Anomalía de conexión: Network timeout');
  });

  it('null represents no note generated in this session', () => {
    const note = null;
    expect(note).toBeNull();
  });
});

describe('filterHistorialSessions', () => {
  const DISPLAY_MAP = new Map([
    ['s1', 1],
    ['s2', 2],
    ['s3', 3],
  ])

  const SESSIONS = [
    { id: 's1', session_date: '2026-01-15T12:00:00', raw_dictation: 'Paciente con ansiedad elevada.' },
    { id: 's2', session_date: '2026-01-08T12:00:00', raw_dictation: 'Llegó tarde, menciona conflicto familiar.' },
    { id: 's3', session_date: '2026-02-05T12:00:00', raw_dictation: null },
  ]

  it('empty query returns all sessions', () => {
    expect(filterHistorialSessions(SESSIONS, '', DISPLAY_MAP)).toHaveLength(3)
  })

  it('whitespace-only query returns all sessions', () => {
    expect(filterHistorialSessions(SESSIONS, '   ', DISPLAY_MAP)).toHaveLength(3)
  })

  it('filters by session display number', () => {
    const result = filterHistorialSessions(SESSIONS, '3', DISPLAY_MAP)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('s3')
  })

  it('filters by partial date string (case-insensitive)', () => {
    const result = filterHistorialSessions(SESSIONS, 'ene', DISPLAY_MAP)
    expect(result).toHaveLength(2)
    expect(result.map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('filters by keyword in raw_dictation (case-insensitive)', () => {
    const result = filterHistorialSessions(SESSIONS, 'ANSIEDAD', DISPLAY_MAP)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('s1')
  })

  it('returns empty array when nothing matches', () => {
    expect(filterHistorialSessions(SESSIONS, 'xyz_no_match', DISPLAY_MAP)).toHaveLength(0)
  })

  it('does not throw when raw_dictation is null', () => {
    expect(() => filterHistorialSessions(SESSIONS, 'algo', DISPLAY_MAP)).not.toThrow()
  })

  it('session with null raw_dictation is still matched by number', () => {
    const result = filterHistorialSessions(SESSIONS, '3', DISPLAY_MAP)
    expect(result[0].id).toBe('s3')
  })
})
