import { useState, useEffect } from 'react'
import usePWAInstall from '../hooks/usePWAInstall'

const SLIDES_DESKTOP = [
  {
    icon: '👋',
    title: 'Bienvenido a SyqueX',
    body: 'Tu flujo de trabajo: Crea el expediente de tu paciente → Escribe/dicta tus apuntes → Invita al paciente al portal → Envía un resumen al paciente → Establece tus horarios disponibles -> Tu paciente agenda una nueva sesión.',
  },
  {
    icon: '👤',
    title: 'Crea el expediente del paciente',
    body: 'Haz clic en el botón Nuevo Expediente. Cada paciente tiene su propio historial de sesiones y notas clínicas.',
  },
  {
    icon: '📧',
    title: 'Invita al paciente al portal',
    body: 'Invita al paciente a su portal privado. A tu paciente le llegará una invitación por correo electrónico. Ahí puede ver sus notas, resúmenes y próximos pasos. También puede agendar nuevas sesiones contigo.',
  },
  {
    icon: '✏️',
    title: 'Documenta tu sesión',
    body: 'Cuando tengas sesión con tu paciente. Escribe o dicta libremente tus apuntes, puedes personalizar tu nota clínica. El asistente organiza automáticamente tu nota y confirmas.',
  },
  {
    icon: '📨',
    title: 'Envía un resumen al paciente',
    body: 'Después de confirmar la nota, genera un seguimiento a partir de la sesión que tuviste con tu paciente. Lo revisas, lo editas y lo envías. El paciente lo ve en su propio portal.',
  },
  {
    icon: '👤',
    title: 'Tu paciente agenda una nueva sesión',
    body: 'En tu calendario veras las sesiones agendadas del dia. El paciente puede agendar nuevas sesiones desde su portal, eligiendo entre los horarios que tú estableciste como disponibles.',
  }
]

function FlowDiagram() {
  const steps = ['Paciente', 'Escribe', 'Nota IA', 'Confirmar']
  return (
    <div className="flex items-center justify-center gap-1 mt-3 flex-wrap">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <span className="text-[11px] font-medium bg-[#f4f4f2] text-[#18181b] px-2 py-1 rounded-md">{s}</span>
          {i < steps.length - 1 && <span className="text-[#5a9e8a] text-[10px]">→</span>}
        </div>
      ))}
    </div>
  )
}

function ProgressBar({ current, total }) {
  return (
    <div className="flex gap-1 mb-4">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-[3px] flex-1 rounded-full transition-colors ${i < current ? 'bg-[#5a9e8a]' : i === current ? 'bg-[#c4935a]' : 'bg-[#e5e7eb]'
            }`}
        />
      ))}
    </div>
  )
}

function SafariInstructions({ onDone }) {
  return (
    <div>
      <div className="flex flex-col gap-2 mb-4">
        {[
          { n: 1, text: <>Toca el ícono <strong>Compartir</strong> ⎙ en la barra inferior</> },
          { n: 2, text: <>Selecciona <strong>"Agregar a inicio"</strong></> },
          { n: 3, text: <>Toca <strong>"Agregar"</strong> ✓</> },
        ].map(({ n, text }) => (
          <div key={n} className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-[#5a9e8a] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {n}
            </span>
            <p className="text-[13px] text-[#6b7280]">{text}</p>
          </div>
        ))}
      </div>
      <button
        onClick={onDone}
        className="w-full py-2 rounded-lg border border-[#5a9e8a] text-[#5a9e8a] text-[13px] font-medium hover:bg-[#f0f8f5] transition-colors"
      >
        Ya la instalé ✓
      </button>
    </div>
  )
}

function ChromeInstructions({ isInstallable, onInstall, onDone }) {
  return (
    <div>
      {isInstallable ? (
        <button
          onClick={onInstall}
          className="w-full py-2 rounded-lg bg-[#5a9e8a] text-white text-[13px] font-medium hover:bg-[#4e8c7a] transition-colors mb-2"
        >
          Instalar app
        </button>
      ) : (
        <div className="flex flex-col gap-2 mb-4">
          {[
            { n: 1, text: <>Toca el menú <strong>⋮</strong> arriba a la derecha</> },
            { n: 2, text: <>Selecciona <strong>"Agregar a pantalla de inicio"</strong></> },
          ].map(({ n, text }) => (
            <div key={n} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#5a9e8a] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {n}
              </span>
              <p className="text-[13px] text-[#6b7280]">{text}</p>
            </div>
          ))}
        </div>
      )}
      <button onClick={onDone} className="w-full py-2 text-[12px] text-[#9ca3af] hover:text-[#6b7280] transition-colors">
        Ya la instalé ✓
      </button>
    </div>
  )
}

function FallbackInstructions({ onDone }) {
  return (
    <div>
      <div className="flex flex-col gap-2 mb-4">
        <div className="border border-[#e5e7eb] rounded-lg p-3">
          <p className="text-[11px] font-semibold text-[#18181b] mb-1">🧭 Safari (iPhone)</p>
          <p className="text-[11px] text-[#6b7280]">Compartir ⎙ → Agregar a inicio → Agregar</p>
        </div>
        <div className="border border-[#e5e7eb] rounded-lg p-3">
          <p className="text-[11px] font-semibold text-[#18181b] mb-1">🌐 Chrome (Android)</p>
          <p className="text-[11px] text-[#6b7280]">Menú ⋮ → Agregar a pantalla de inicio</p>
        </div>
      </div>
      <button onClick={onDone} className="w-full py-2 text-[12px] text-[#9ca3af] hover:text-[#6b7280] transition-colors">
        Ya la instalé ✓
      </button>
    </div>
  )
}

function PWASlide({ forceBrowser, forceInstallable, onTriggerInstall, onDone, patientMode }) {
  const pwa = usePWAInstall()
  const browser = forceBrowser ?? pwa.browser
  // En patientMode nunca activamos el prompt nativo: instalaría la app en "/" no en "/portal"
  const isInstallable = patientMode ? false : (forceInstallable ?? pwa.isInstallable)
  const triggerInstall = onTriggerInstall ?? pwa.triggerInstall

  useEffect(() => {
    localStorage.setItem('syquex_pwa_prompted', 'true')
  }, [])

  const handleInstall = async () => {
    await triggerInstall()
    onDone()
  }

  return (
    <div>
      <div className="text-center mb-4">
        <div className="text-3xl mb-2">📲</div>
        <p className="text-[15px] font-semibold text-[#18181b] mb-1">
          {patientMode ? 'Accede siempre desde tu celular' : 'Instala la app en tu celular'}
        </p>
        <p className="text-[12px] text-[#9ca3af]">Acceso directo desde tu pantalla de inicio</p>
      </div>

      {patientMode && (
        <div className="bg-[#f4f4f2] rounded-xl px-3 py-2.5 mb-4 text-center">
          <p className="text-[10px] text-[#9ca3af] uppercase tracking-wide mb-0.5">Tu portal</p>
          <p className="text-[13px] font-mono font-semibold text-[#5a9e8a] break-all select-all">
            app.syquex.mx/portal
          </p>
        </div>
      )}

      {browser === 'safari' && <SafariInstructions onDone={onDone} />}
      {browser === 'chrome' && <ChromeInstructions isInstallable={isInstallable} onInstall={handleInstall} onDone={onDone} />}
      {browser === 'other' && <FallbackInstructions onDone={onDone} />}
    </div>
  )
}

export default function TutorialModal({
  visible,
  onClose,
  isMobile,
  noteFormat,
  patientMode,
  // test-only escape hatches
  forceBrowser,
  forceInstallable,
  onTriggerInstall,
}) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (visible) setStep(0)
  }, [visible])

  if (!visible) return null

  const slides = patientMode
    ? [{ pwa: true }]
    : isMobile ? [...SLIDES_DESKTOP, { pwa: true }] : SLIDES_DESKTOP

  const total = slides.length
  const current = slides[step]
  const isFirst = step === 0
  const isLast = step === total - 1

  const handleClose = () => {
    const key = patientMode ? 'patient_tutorial_done' : 'syquex_tutorial_done'
    localStorage.setItem(key, 'true')
    onClose()
  }

  const handleNext = () => {
    if (isLast) { handleClose(); return }
    setStep((s) => s + 1)
  }

  const handlePrev = () => setStep((s) => Math.max(0, s - 1))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(24,24,27,0.55)' }}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl">

        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-[#9ca3af] uppercase tracking-wide font-medium">
            {step + 1} de {total}
          </span>
          <button
            onClick={handleClose}
            aria-label="Cerrar tutorial"
            className="text-[#d1d5db] hover:text-[#9ca3af] transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <ProgressBar current={step} total={total} />

        {!current.pwa && (
          <div className="text-center">
            <div className="text-3xl mb-2">{current.icon}</div>
            <p className="text-[15px] font-semibold text-[#18181b] mb-2">{current.title}</p>
            <p className="text-[13px] text-[#6b7280] leading-relaxed">{current.body}</p>
            {current.flow && <FlowDiagram />}
          </div>
        )}

        {current.pwa && (
          <PWASlide
            forceBrowser={forceBrowser}
            forceInstallable={forceInstallable}
            onTriggerInstall={onTriggerInstall}
            onDone={handleClose}
            patientMode={patientMode}
          />
        )}

        <div className="flex items-center justify-between mt-5">
          {!isFirst ? (
            <button onClick={handlePrev} className="text-[13px] text-[#9ca3af] hover:text-[#6b7280] transition-colors">
              ← Anterior
            </button>
          ) : <div />}
          <button
            onClick={handleNext}
            className="px-4 py-2 rounded-lg bg-[#5a9e8a] text-white text-[13px] font-medium hover:bg-[#4e8c7a] transition-colors"
          >
            {isLast ? 'Finalizar' : 'Siguiente →'}
          </button>
        </div>

      </div>
    </div>
  )
}
