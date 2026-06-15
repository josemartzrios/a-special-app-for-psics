import { useState, useEffect, useCallback } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { createSetupIntent } from '../api';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

function CardForm({ onClose, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || confirming) return;
    setConfirming(true);
    setError('');

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.origin + '/billing' },
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message);
      setConfirming(false);
      return;
    }

    if (setupIntent.status === 'succeeded') {
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && (
        <p className="text-[12px] text-red-500">{error}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={!stripe || confirming}
          className="flex-1 py-2.5 bg-[#5a9e8a] text-white text-[13px] font-semibold rounded-lg hover:bg-[#4a8e7a] disabled:opacity-60 transition-colors"
        >
          {confirming ? 'Guardando…' : 'Guardar tarjeta'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={confirming}
          className="flex-1 py-2.5 text-[13px] text-[#71717a] border border-[#18181b]/[0.12] rounded-lg hover:bg-[#f4f4f2] disabled:opacity-40 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function UpdateCardModal({ open, onClose, onSuccess }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [loadingSecret, setLoadingSecret] = useState(false);

  const reset = useCallback(() => {
    setClientSecret(null);
    setLoadingSecret(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoadingSecret(true);
    createSetupIntent()
      .then((data) => setClientSecret(data.client_secret))
      .finally(() => setLoadingSecret(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e) => { if (e.key === 'Escape') { onClose(); reset(); } };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose, reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 overflow-hidden" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#18181b]/[0.06]">
          <h3 className="text-[15px] font-semibold text-[#18181b]">Actualizar método de pago</h3>
          <button
            onClick={() => { onClose(); reset(); }}
            aria-label="Cerrar"
            className="p-1 rounded text-[#71717a] hover:text-[#18181b] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {loadingSecret ? (
            <div className="flex items-center justify-center py-8">
              <div role="status" className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#5a9e8a]" />
            </div>
          ) : clientSecret ? (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <CardForm onClose={() => { onClose(); reset(); }} onSuccess={onSuccess} />
            </Elements>
          ) : (
            <p className="text-[13px] text-red-500 text-center py-4">
              Error al conectar con Stripe. Intenta de nuevo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
