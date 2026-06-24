import { useState, useEffect } from 'react';
import { getMyProfile, getBillingStatus } from '../api';
import UpdateCardModal from './UpdateCardModal';
import ProfilePasswordField from './ProfilePasswordField';

const BRAND_LABELS = { visa: 'VISA', mastercard: 'MC', amex: 'AMEX', discover: 'DISC' };

function FieldRow({ label, value }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-[10px] font-semibold text-ink-tertiary uppercase tracking-widest mb-1">
        {label}
      </div>
      {value ? (
        <div className="text-[13px] text-ink font-medium">{value}</div>
      ) : (
        <div className="text-[13px] text-ink-muted italic">No registrada</div>
      )}
    </div>
  );
}

function PlanBadge({ status }) {
  const variants = {
    active: 'bg-[#f0faf7] text-[#5a9e8a]',
    trialing: 'bg-[#fef9ec] text-[#c4935a]',
    past_due: 'bg-[#fef2f2] text-red-500',
    canceled: 'bg-[#fef2f2] text-red-500',
    unpaid: 'bg-[#fef2f2] text-red-500',
    courtesy: 'bg-[#f4f4f2] text-[#71717a]',
  };
  const labels = {
    active: 'Plan Pro — Activo',
    trialing: 'Período de prueba',
    past_due: 'Pago pendiente',
    canceled: 'Suscripción cancelada',
    unpaid: 'Pago pendiente',
    courtesy: 'Acceso de Cortesía',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${variants[status] || variants.canceled}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {labels[status] || status}
    </span>
  );
}

function PaymentChip({ brand, last4 }) {
  return (
    <div className="flex items-center gap-2 bg-[#f4f4f2] rounded-lg px-3 py-2 mt-2">
      <span className="text-[9px] font-bold bg-[#18181b] text-white px-1.5 py-0.5 rounded tracking-wider">
        {BRAND_LABELS[brand] || brand?.toUpperCase()}
      </span>
      <span className="text-[12px] text-ink-secondary font-mono">
        <span className="tracking-widest text-ink-muted">•••• </span>{last4}
      </span>
    </div>
  );
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState(null);
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cardModalOpen, setCardModalOpen] = useState(false);

  useEffect(() => {
    Promise.all([getMyProfile(), getBillingStatus()])
      .then(([p, b]) => { setProfile(p); setBilling(b); })
      .finally(() => setLoading(false));
  }, []);

  const handleCardSuccess = () => {
    setCardModalOpen(false);
    getBillingStatus().then(setBilling);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#fefcfb]">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#5a9e8a]" />
      </div>
    );
  }

  const canChangeCard = billing?.status === 'active' && billing?.payment_method;
  const showNextBilling = billing?.status === 'active' && !billing?.cancel_at_period_end && billing?.current_period_end;

  return (
    <div className="flex-1 overflow-y-auto bg-[#fefcfb]">
      <div className="max-w-5xl mx-auto px-6 md:px-8 py-6 md:py-8">
        <div className="mb-6 pb-4 border-b border-[#18181b]/[0.06]">
          <h2 className="text-xl font-bold text-[#18181b]">Mi Perfil</h2>
          <p className="text-sm text-[#71717a] mt-1">Información de tu cuenta y suscripción</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
          <div className="bg-white border border-[#18181b]/[0.08] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[#18181b]/[0.05]">
              <div className="w-7 h-7 rounded-lg bg-[#5a9e8a]/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-[#5a9e8a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <span className="text-[13px] font-semibold text-[#18181b]">Datos personales</span>
            </div>
            <div className="px-4 py-4">
              <FieldRow label="Nombre" value={profile?.name} />
              <FieldRow label="Correo electrónico" value={profile?.email} />
              <div className="mb-4">
                <div className="text-[10px] font-semibold text-ink-tertiary uppercase tracking-widest mb-1">
                  Contraseña
                </div>
                <ProfilePasswordField />
              </div>
              <FieldRow label="Cédula profesional" value={profile?.cedula_profesional} />
            </div>
          </div>

          <div className="bg-white border border-[#18181b]/[0.08] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[#18181b]/[0.05]">
              <div className="w-7 h-7 rounded-lg bg-[#c4935a]/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-[#c4935a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <span className="text-[13px] font-semibold text-[#18181b]">Suscripción y pago</span>
            </div>
            <div className="px-4 py-4">
              <div className="mb-4">
                <div className="text-[10px] font-semibold text-ink-tertiary uppercase tracking-widest mb-2">Plan actual</div>
                {billing && <PlanBadge status={billing.status} />}
              </div>

              {showNextBilling && (
                <div className="mb-4">
                  <div className="text-[10px] font-semibold text-ink-tertiary uppercase tracking-widest mb-1">Próximo cobro</div>
                  <div className="text-[13px] text-[#18181b] font-medium">
                    {new Date(billing.current_period_end).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })} — $499 MXN
                  </div>
                </div>
              )}

              {billing?.payment_method && (
                <div className="mb-4">
                  <div className="text-[10px] font-semibold text-ink-tertiary uppercase tracking-widest mb-1">Método de pago</div>
                  <PaymentChip brand={billing.payment_method.brand} last4={billing.payment_method.last4} />
                  {canChangeCard && (
                    <button
                      onClick={() => setCardModalOpen(true)}
                      className="mt-2 text-[12px] text-[#5a9e8a] font-medium hover:underline"
                    >
                      Cambiar tarjeta
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <UpdateCardModal
          open={cardModalOpen}
          onClose={() => setCardModalOpen(false)}
          onSuccess={handleCardSuccess}
        />
      </div>
    </div>
  );
}
