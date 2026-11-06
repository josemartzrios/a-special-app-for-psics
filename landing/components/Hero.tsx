'use client'
import FadeIn from './FadeIn'
import { DEMO_URL } from './demo'

export default function Hero() {
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-8 py-16 sm:py-24">
      <div className="flex flex-col sm:flex-row items-center gap-12 sm:gap-16">

        {/* Left — copy */}
        <div className="flex-1 text-center sm:text-left">
          <FadeIn>
            <div className="inline-block text-xs font-semibold text-sage bg-sage-light px-4 py-1.5 rounded-full mb-5 tracking-wide">
              HECHO EN MÉXICO · ACCESO PRIVADO POR INVITACIÓN
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1 className="font-serif text-4xl sm:text-5xl font-normal leading-tight mb-5 text-ink">
              Genera tu nota clínica en{' '}
              <em className="text-sage">45 segundos</em>.
              <br />
              Llega preparado a cada sesión.
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="text-lg text-ink-secondary leading-relaxed mb-8 max-w-xl">
              Dicta lo que pasó en sesión, SyqueX genera la nota clínica y analiza el
              historial completo de tu paciente con IA. Pregúntale cualquier cosa antes
              de tu próxima cita.
            </p>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="flex gap-4 flex-wrap items-center justify-center sm:justify-start">
              <a
                href={DEMO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base text-white bg-sage hover:bg-sage-dark px-8 py-3.5 rounded-xl font-semibold shadow-lg shadow-sage/30 transition-all hover:-translate-y-0.5"
              >
                Solicitar demo
              </a>
              <span className="text-sm text-ink-tertiary">Te muestro la plataforma en vivo</span>
            </div>
          </FadeIn>
        </div>

        {/* Right — phone-frame video */}
        <FadeIn delay={0.25} className="flex-none flex justify-center w-full sm:w-[280px]">
          <div
            className="rounded-[2rem] overflow-hidden shadow-2xl border-4 border-ink-muted bg-black"
            style={{ width: '100%', maxWidth: '280px' }}
          >
            <div style={{ position: 'relative', paddingBottom: '177.78%', height: 0, overflow: 'hidden' }}>
              <iframe
                src="https://www.youtube.com/embed/czmHUu2LU30?rel=0&modestbranding=1"
                frameBorder={0}
                allowFullScreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                title="SyqueX en acción — crea una nota clínica en segundos"
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
              />
            </div>
          </div>
        </FadeIn>

      </div>
    </section>
  )
}
