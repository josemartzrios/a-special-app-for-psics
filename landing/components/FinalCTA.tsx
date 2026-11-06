import FadeIn from './FadeIn'
import { DEMO_URL } from './demo'

export default function FinalCTA() {
  return (
    <section className="bg-surface py-20 px-4 sm:px-6">
      <FadeIn>
        <div className="max-w-2xl mx-auto text-center bg-sage rounded-2xl px-5 sm:px-14 py-16 text-white">
          <h2 className="font-serif text-3xl font-normal mb-3">
            Deja de documentar a mano.
          </h2>
          <p className="text-base opacity-85 mb-8 leading-relaxed">
            SyqueX es de uso privado. Escríbeme y te muestro cómo funciona.
          </p>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full sm:inline-block sm:w-auto bg-white text-sage font-semibold px-6 sm:px-10 py-3.5 rounded-xl text-sm sm:text-base hover:opacity-90 transition-opacity"
          >
            Solicitar demo
          </a>
          <p className="text-sm opacity-70 mt-4">Acceso por invitación</p>
        </div>
      </FadeIn>
    </section>
  )
}
