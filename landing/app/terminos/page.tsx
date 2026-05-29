import type { Metadata } from 'next'
import Nav from '../../components/Nav'
import Footer from '../../components/Footer'

export const metadata: Metadata = {
  title: 'Términos y Condiciones — SyqueX',
}

export default function Terminos() {
  return (
    <>
      <Nav />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <h1 className="font-serif text-3xl font-semibold text-ink mb-8">
          Términos y Condiciones
        </h1>
        <div className="space-y-6 text-sm text-ink-secondary leading-relaxed">

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">1. Descripción del servicio</h2>
            <p>
              SyqueX es una plataforma de documentación clínica asistida por
              inteligencia artificial, dirigida a psicólogos profesionales. El
              servicio permite generar notas personalizadas o SOAP a partir de dictados de
              sesión y mantener un historial clínico estructurado.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">2. Prueba gratuita</h2>
            <p>
              Al registrarse, los usuarios tienen acceso gratuito por 14 días
              calendario sin necesidad de proporcionar datos de pago. Al
              término del período de prueba, se requiere activar una
              suscripción para continuar usando el servicio.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">3. Precios y facturación</h2>
            <p>
              El servicio se ofrece por $499 MXN (pesos mexicanos) al mes,
              facturado mensualmente. El cobro se realiza a través de Stripe.
              Los precios pueden cambiar con previo aviso de 30 días.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">4. Cancelación y reembolsos</h2>
            <p>
              Puedes cancelar tu suscripción en cualquier momento directamente
              desde tu cuenta con un clic, sin necesidad de contactar a soporte.
              Al cancelar, tu acceso continúa hasta el fin del período pagado
              en curso. <strong className="text-ink">No se emiten reembolsos
                por períodos parciales.</strong>
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">5. Propiedad de los datos clínicos</h2>
            <p>
              Los contenidos clínicos que el usuario ingresa a la plataforma
              (dictados, notas, información de pacientes) son de su exclusiva
              propiedad. SyqueX no reivindica derechos sobre ellos y los
              utiliza únicamente para proveer el servicio. El usuario es
              responsable de obtener el consentimiento de sus pacientes conforme
              a la LFPDPPP antes de ingresar sus datos a la plataforma.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">6. Uso aceptable</h2>
            <p>
              El servicio está destinado exclusivamente a profesionales de la
              salud mental con cédula profesional vigente. El usuario es
              responsable de la confidencialidad de los datos de sus pacientes
              y de cumplir con las obligaciones legales aplicables en México
              respecto al manejo de datos clínicos.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">7. Limitación de responsabilidad</h2>
            <p>
              SyqueX proporciona una herramienta de apoyo a la documentación.
              Las notas generadas por IA deben ser revisadas y validadas por el
              profesional antes de incorporarse al expediente clínico. SyqueX
              no es responsable por decisiones clínicas tomadas con base en
              contenido generado por la plataforma.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">8. Ley aplicable</h2>
            <p>
              Estos términos se rigen por las leyes de los Estados Unidos
              Mexicanos. Cualquier controversia se resolverá ante los
              tribunales competentes.
            </p>
          </section>

          <p className="text-xs text-ink-tertiary pt-4 border-t border-ink-muted">
            Última actualización: abril 2026 · Versión 1.0
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
