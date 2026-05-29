'use client'
import { useState } from 'react'
import FadeIn from './FadeIn'

const faqs = [
  {
    question: '¿Dónde se almacenan los datos de mis pacientes?',
    answer:
      'Los datos de tus pacientes se almacenan en Supabase, una plataforma de base de datos en la nube con cifrado en reposo y en tránsito. Los campos sensibles del expediente se cifran individualmente con Fernet (AES-128-CBC + HMAC-SHA256) antes de guardarse en la base de datos. Para la generación de notas utilizamos la API de Anthropic, que según su política de uso de API no utiliza los datos enviados vía API para entrenar sus modelos. Operamos bajo los lineamientos de la LFPDPPP y nunca compartimos datos con terceros.',
  },
  {
    question: '¿SyqueX cumple con la NOM-004-SSA3?',
    answer:
      'Sí. El expediente clínico de SyqueX incluye los elementos requeridos por la norma: datos del paciente, notas de evolución, plan terapéutico y motivo de consulta. Diseñado para que tu documentación siempre esté en orden.',
  },
  {
    question: '¿La IA escucha o graba mis sesiones?',
    answer:
      'No. SyqueX nunca graba audio ni video de tus sesiones. Tú dictas o escribes un resumen después de la sesión y la IA genera la nota a partir de ese texto. El contenido real de tus sesiones nunca se captura directamente.',
  },
  {
    question: '¿Qué diferencia hay entre SyqueX y usar ChatGPT?',
    answer:
      'ChatGPT no recuerda a tu paciente entre conversaciones. Cada vez que abres una conversación nueva, empieza desde cero. SyqueX mantiene el historial completo de cada paciente y analiza patrones entre todas sus sesiones. Además, usar ChatGPT con datos reales de pacientes tiene implicaciones legales bajo la LFPDPPP que SyqueX resuelve desde el primer día.',
  },
  {
    question: '¿Puedo cancelar cuando quiera?',
    answer:
      'Sí. Puedes cancelar tu suscripción directamente desde tu cuenta con un click. Sin llamadas, sin correos, sin preguntas. Tu información permanece disponible para exportar durante 30 días después de cancelar.',
  },
  {
    question: '¿El psicólogo sigue siendo responsable del contenido clínico?',
    answer:
      'Siempre. SyqueX genera una propuesta de nota basada en tu dictado. Tú la revisas, la editas y la confirmas antes de que quede guardada en el expediente. Ninguna nota se guarda sin tu aprobación explícita. La inteligencia clínica y las decisiones terapéuticas son y seguirán siendo tuyas.',
  },
]

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="py-20 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <FadeIn>
          <h2 className="font-serif text-3xl font-normal text-center mb-10 text-ink">
            Preguntas frecuentes
          </h2>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="divide-y divide-ink-muted">
            {faqs.map((faq, index) => {
              const isOpen = openIndex === index
              return (
                <div key={index}>
                  <button
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className="w-full flex items-center justify-between py-5 text-left gap-4"
                    aria-expanded={isOpen}
                  >
                    <span className="font-medium text-ink text-sm sm:text-base">
                      {faq.question}
                    </span>
                    <svg
                      className={`shrink-0 w-5 h-5 text-ink-tertiary transition-transform duration-300 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                  <div
                    className={`grid transition-all duration-300 ease-in-out ${
                      isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <p className="text-sm text-ink-secondary leading-relaxed pb-5">
                        {faq.answer}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
