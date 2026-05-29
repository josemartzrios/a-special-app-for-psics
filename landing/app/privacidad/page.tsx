import type { Metadata } from 'next'
import Nav from '../../components/Nav'
import Footer from '../../components/Footer'

export const metadata: Metadata = {
  title: 'Aviso de Privacidad — SyqueX',
}

export default function Privacidad() {
  return (
    <>
      <Nav />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <h1 className="font-serif text-3xl font-semibold text-ink mb-8">
          Aviso de Privacidad
        </h1>
        <div className="space-y-6 text-sm text-ink-secondary leading-relaxed">

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">1. Identidad del responsable</h2>
            <p>
              José Francisco Martínez Ríos, con RFC MARF9712139DA, con domicilio en
              Culiacán, Sinaloa, México, es el responsable del tratamiento de sus
              datos personales (en adelante "SyqueX").
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">2. Datos personales recabados</h2>
            <p>
              SyqueX recaba los siguientes datos personales: nombre completo,
              correo electrónico, contraseña (almacenada en forma de hash),
              cédula profesional (opcional), y datos de pago (procesados
              directamente por Stripe — SyqueX no almacena datos de tarjeta).
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">3. Finalidades del tratamiento</h2>
            <p>
              Sus datos se utilizan para: (a) proveer el servicio de
              documentación clínica con inteligencia artificial; (b) gestionar
              su cuenta y suscripción; (c) enviar comunicaciones relacionadas
              con el servicio (no publicidad).
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">4. Datos clínicos de pacientes</h2>
            <p>
              SyqueX procesa los textos de dictado y notas clínicas que el
              psicólogo usuario ingresa a la plataforma. Estos contenidos pueden
              incluir datos de salud de terceros (pacientes). El psicólogo
              usuario es el responsable del tratamiento de los datos de sus
              propios pacientes y debe contar con el consentimiento
              correspondiente conforme a la LFPDPPP y a las normas profesionales
              aplicables. Al aceptar este Aviso, el psicólogo declara haber
              cumplido con dicha obligación.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">5. Transferencias de datos</h2>
            <p>
              Para proveer el servicio, SyqueX comparte datos con: (a) Stripe
              Inc., para el procesamiento de pagos; (b) Supabase Inc., que
              actúa como proveedor de base de datos en la nube donde se
              almacenan los datos de cuenta y los expedientes clínicos cifrados;
              (c) Anthropic PBC, para la generación de notas clínicas — los
              textos de dictado se envían a Anthropic vía API para su
              procesamiento y no son utilizados para entrenar sus modelos según
              su política de uso de API. Todos los proveedores cuentan con
              políticas de privacidad propias.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">6. Retención y supresión de datos</h2>
            <p>
              Los datos de cuenta (nombre, correo) se conservan durante la
              vigencia de la suscripción. Los datos clínicos (dictados y notas)
              se conservan mientras la cuenta esté activa y por 30 días
              adicionales tras la cancelación, para permitir su exportación.
              Transcurrido ese plazo, se eliminan de forma permanente. El
              usuario puede solicitar la eliminación anticipada ejerciendo sus
              derechos ARCO.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">7. Derechos ARCO</h2>
            <p>
              Usted tiene derecho a Acceder, Rectificar, Cancelar u Oponerse al
              tratamiento de sus datos personales (derechos ARCO). Para
              ejercerlos, envíe un correo a{' '}
              <a href="mailto:hola@syquex.mx" className="text-sage underline">
                hola@syquex.mx
              </a>{' '}
              con el asunto "Derechos ARCO". Responderemos en un plazo máximo
              de 20 días hábiles.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">8. Limitación del uso</h2>
            <p>
              Para limitar el uso o divulgación de sus datos, puede enviarnos
              un correo a hola@syquex.mx en cualquier momento.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-ink text-base mb-2">9. Cambios a este aviso</h2>
            <p>
              Cualquier modificación a este Aviso de Privacidad será notificada
              a través de la aplicación o por correo electrónico. La versión
              vigente siempre estará disponible en{' '}
              <a href="/privacidad" className="text-sage underline">
                syquex.mx/privacidad
              </a>
              .
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
