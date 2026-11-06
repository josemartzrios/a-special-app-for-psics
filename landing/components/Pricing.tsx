import FadeIn from './FadeIn'
import { DEMO_URL } from './demo'

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <circle cx="10" cy="10" r="10" fill="#5a9e8a" />
      <path d="M6 10l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const features = [
  'Pacientes ilimitados',
  'Notas SOAP o personalizadas con IA',
  'Agente de evolución clínica',
  'Búsqueda semántica en historial',
  'Seguimiento del paciente con acuerdos',
  'Agendamiento con notificación por correo',
  'Expediente conforme a NOM-004',
  'Soporte prioritario por WhatsApp',
]

export default function Pricing() {
  return (
    <section id="pricing" className="py-20 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <FadeIn>
          <h2 className="font-serif text-3xl font-normal text-center mb-2 text-ink">
            Un precio simple
          </h2>
          <p className="text-center text-sm text-ink-tertiary mb-10">
            Uso privado por invitación. Agenda una demo y te explico cómo empezar.
          </p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="max-w-sm mx-auto bg-white rounded-2xl p-6 sm:p-9 border-2 border-sage relative shadow-xl shadow-sage/10">
            <div className="absolute -top-3 right-5 bg-sage text-white text-xs font-bold px-4 py-1 rounded-full tracking-wider">
              RECOMENDADO
            </div>
            <div className="text-sm font-semibold text-sage mb-2">Pro</div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-5xl font-bold text-ink">$499</span>
              <span className="text-sm text-ink-tertiary">MXN/mes</span>
            </div>
            <div className="text-xs text-ink-tertiary mb-6">Precio de referencia</div>
            <div className="flex flex-col gap-3 mb-8">
              {features.map((f) => (
                <div key={f} className="flex items-center gap-2.5">
                  <CheckIcon />
                  <span className="text-sm text-ink">{f}</span>
                </div>
              ))}
            </div>
            <a
              href={DEMO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center bg-sage hover:bg-sage-dark text-white font-semibold py-3.5 rounded-xl transition-colors text-sm shadow-lg shadow-sage/30"
            >
              Solicitar demo
            </a>
            <p className="text-xs text-ink-tertiary text-center mt-4 leading-relaxed">
              Te muestro la plataforma en vivo por videollamada.
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
