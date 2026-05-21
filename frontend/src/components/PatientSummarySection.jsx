import { useState, useEffect } from 'react'
import { getSummary, generateSummary, saveSummary, sendSummaryToPortal } from '../api'

const SAGE = '#5a9e8a'
const AMBER = '#c4935a'
const MUTED = '#9ca3af'
const INK = '#18181b'

const SECTIONS = [
  { key: 'topics_worked', label: 'Temas trabajados', color: SAGE, isDate: false },
  { key: 'homework', label: 'Tarea para esta semana', color: AMBER, isDate: false },
]

/**
 * PatientSummarySection
 *
 * Sección debajo de una nota confirmada.
 * Permite al psicólogo generar → editar (estilo Google Docs) → enviar un resumen al paciente.
 *
 * Props:
 *   sessionId   — string, ID de la sesión confirmada
 *   patientName — string, nombre del paciente para los labels
 */
export default function PatientSummarySection({ sessionId, patientName }) {
  // phase: 'idle' | 'loading' | 'editing' | 'sent'
  const [phase, setPhase] = useState('idle')
  const [fields, setFields] = useState({ topics_worked: '', homework: '' })
  const [activeField, setActiveField] = useState(null)
  const [sentAt, setSentAt] = useState(null)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [showContent, setShowContent] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    getSummary(sessionId)
      .then(data => {
        if (!data?.id) return
        setFields({
          topics_worked: data.topics_worked || '',
          homework: data.homework || '',
        })
        if (data.sent_at) {
          setSentAt(data.sent_at)
          setPhase('sent')
        } else if (data.topics_worked) {
          setPhase('editing')
        }
      })
      .catch(() => { })
  }, [sessionId])

  const handleGenerate = async () => {
    setPhase('loading')
    setError(null)
    try {
      const data = await generateSummary(sessionId)
      setFields({
        topics_worked: data.topics_worked || '',
        homework: data.homework || '',
      })
      setPhase('editing')
    } catch (err) {
      setError(err.message || 'No se pudo generar el resumen. Intenta de nuevo.')
      setPhase('idle')
    }
  }

  const handleSend = async () => {
    setSending(true)
    setError(null)
    try {
      await saveSummary(sessionId, fields)
      const result = await sendSummaryToPortal(sessionId)
      setSentAt(result?.sent_at || new Date().toISOString())
      setPhase('sent')
    } catch (err) {
      setError(err.message || 'Error al enviar. Verifica que el paciente tenga email en su expediente.')
    } finally {
      setSending(false)
    }
  }

  const firstName = patientName?.split(' ')[0] || patientName || 'el paciente'

  // ── Sent ──
  if (phase === 'sent') {
    const hourStr = sentAt
      ? new Date(sentAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      : ''
    return (
      <div className="border-t border-[#5a9e8a]/20 mt-2 px-6 pt-4 pb-5">
        <div className="bg-[#f4faf8] border border-[#5a9e8a] rounded-xl px-3 py-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[#5a9e8a] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="text-[13px] font-semibold text-[#5a9e8a] truncate">Seguimiento enviado a {firstName}</p>
              {hourStr && <p className="text-[11px] text-[#9ca3af]">Hoy · {hourStr}</p>}
            </div>
            <button
              onClick={() => setShowContent(v => !v)}
              className="text-[12px] font-medium text-[#5a9e8a] hover:underline flex-shrink-0"
            >
              {showContent ? 'Ocultar ↑' : 'Ver resumen'}
            </button>
          </div>

          {showContent && (
            <div className="mt-4 pt-4 border-t border-[#5a9e8a]/20">
              {SECTIONS.map(({ key, label, color }, idx) => {
                const content = fields[key]
                return (
                  <div key={key} className={idx > 0 ? 'mt-6' : ''}>
                    <p
                      className="font-sans text-[10px] font-bold tracking-[0.12em] uppercase"
                      style={{ fontVariant: 'small-caps', color: MUTED }}
                    >
                      {label}
                    </p>
                    <hr
                      className="border-0 border-t border-current mt-1 mb-3"
                      style={{ color: `${MUTED}33` }}
                    />
                    <p
                      className="font-sans text-[14px] leading-relaxed px-1"
                      style={{ color: MUTED }}
                    >
                      {content || '—'}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Loading (generando) ──
  if (phase === 'loading') {
    return (
      <div className="border-t border-ink/[0.06] mt-2 px-6 pt-4 pb-5">
        <div className="bg-[#f4faf8] border border-[#5a9e8a] rounded-xl px-4 py-3 text-[13px] text-[#5a9e8a] text-center animate-pulse">
          Generando seguimiento…
        </div>
      </div>
    )
  }

  // ── Idle ──
  if (phase === 'idle') {
    return (
      <div className="border-t border-ink/[0.06] mt-2 px-6 pt-4 pb-5">
        {error && <p className="text-[12px] text-red-500 mb-2">{error}</p>}
        <button
          onClick={handleGenerate}
          className="w-full bg-[#f4faf8] border border-[#5a9e8a] rounded-xl px-4 py-3 text-[13px] font-semibold text-[#5a9e8a] hover:bg-[#eaf5f2] transition-colors text-left flex items-center gap-2"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
          Generar seguimiento de {patientName}
        </button>
      </div>
    )
  }

  // ── Editing ──
  return (
    <div className="font-sans border-t border-[#5a9e8a]/20 mt-2 px-6 pt-5 pb-5 bg-[#f4faf8]">

      <div className="flex items-center gap-2 mb-1">
        <p className="font-sans text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: SAGE }}>
          Seguimiento para el paciente
        </p>
        <span className="inline-flex items-center gap-1 bg-[#5a9e8a]/10 text-[#5a9e8a] text-[10px] font-sans font-medium px-2 py-0.5 rounded-full">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Visible para el paciente
        </span>
      </div>
      <p className="font-sans text-[11px] text-right mb-4" style={{ color: MUTED }}>
        Toca cualquier campo para editar
      </p>

      {SECTIONS.map(({ key, label, color, isDate }, idx) => {
        const content = fields[key]
        const isActive = activeField === key
        const hasContent = !!content

        return (
          <div key={key} className={idx > 0 ? 'mt-8' : ''}>
            <p
              className="font-sans text-[10px] font-bold tracking-[0.12em] uppercase"
              style={{ fontVariant: 'small-caps', color: hasContent ? color : MUTED }}
            >
              {label}
            </p>
            <hr
              className="border-0 border-t border-current mt-1 mb-3"
              style={{ color: hasContent ? `${color}33` : `${MUTED}33` }}
            />

            {isDate ? (
              isActive ? (
                <input
                  autoFocus
                  type="date"
                  defaultValue={content}
                  className="font-sans text-[14px] w-full rounded-md p-2 outline-none"
                  style={{ border: `1.5px solid ${SAGE}`, background: '#fffef9', color: INK }}
                  onBlur={e => { setFields(f => ({ ...f, [key]: e.target.value })); setActiveField(null) }}
                />
              ) : (
                <p
                  className="font-sans text-[14px] leading-relaxed rounded-md p-2"
                  style={{ color: hasContent ? INK : MUTED, cursor: 'text', border: '1.5px dashed #d1d5db' }}
                  onClick={() => setActiveField(key)}
                >
                  {content
                    ? new Date(content + 'T12:00:00').toLocaleDateString('es-MX', {
                      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                    })
                    : '—'}
                </p>
              )
            ) : isActive ? (
              <textarea
                autoFocus
                defaultValue={content}
                className="font-sans text-[14px] leading-relaxed w-full resize-none rounded-md p-2 outline-none"
                style={{ border: `1.5px solid ${SAGE}`, background: '#fffef9', color: INK, overflow: 'hidden' }}
                ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                onBlur={e => { setFields(f => ({ ...f, [key]: e.target.value })); setActiveField(null) }}
              />
            ) : (
              <p
                className="font-sans text-[14px] leading-relaxed rounded-md p-2"
                style={{ color: INK, cursor: 'text', border: '1.5px dashed #d1d5db' }}
                onClick={() => setActiveField(key)}
              >
                {content || <span style={{ color: MUTED }}>—</span>}
              </p>
            )}
          </div>
        )
      })}

      {error && <p className="font-sans mt-4 text-[13px] text-red-600">{error}</p>}

      <div className="font-sans flex items-center gap-2 border-t border-ink/[0.06] pt-4 mt-8">
        <button
          onClick={() => { setPhase('idle'); setError(null) }}
          className="text-[13px] font-medium text-[#6b7280] border border-ink/15 rounded-xl px-4 py-2 hover:bg-[#f4f4f2] transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={handleSend}
          disabled={sending}
          className={`ml-auto text-[13px] font-medium rounded-xl px-4 py-2.5 transition-colors ${sending
            ? 'bg-[#5a9e8a]/40 text-white cursor-not-allowed'
            : 'bg-[#5a9e8a] text-white hover:bg-[#4a8a78]'
            }`}
        >
          {sending ? 'Enviando…' : 'Enviar al paciente'}
        </button>
      </div>
    </div>
  )
}
