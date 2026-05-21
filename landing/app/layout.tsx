import type { Metadata } from 'next'
import './globals.css'
import WhatsAppButton from '../components/WhatsAppButton'

export const metadata: Metadata = {
  title: 'SyqueX — Documentación clínica con IA para psicólogos',
  description:
    'Dicta tu sesión. SyqueX genera la nota personalizada o SOAP al instante — estructurada, lista para el expediente.',
  metadataBase: new URL('https://syquex.mx'),
  openGraph: {
    title: 'SyqueX — Documentación clínica con IA para psicólogos',
    description:
      'Dicta tu sesión. SyqueX genera la nota clínica personalizada o SOAP al instante.',
    url: 'https://syquex.mx',
    siteName: 'SyqueX',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    locale: 'es_MX',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SyqueX — Documentación clínica con IA',
    description: 'Notas personalizadas o SOAP generadas con IA en segundos.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: '/logotransparente.png',
    apple: '/logotransparente.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es-MX">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Lora:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-white text-ink font-sans antialiased">
        {children}
        <WhatsAppButton />
      </body>
    </html>
  )
}
