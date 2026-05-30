import { useState } from 'react';
import { navigateTo } from '../auth';
import { acceptPatientInvite } from '../patientApi';

export default function PatientInviteAccept({ inviteToken, setScreen }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError('La contraseña debe incluir al menos una letra mayúscula');
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError('La contraseña debe incluir al menos un número');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await acceptPatientInvite(inviteToken, password);
      sessionStorage.setItem('portal_session', '1');
      setSuccess(true);
      setTimeout(() => {
        navigateTo('/portal');
        setScreen('patient-portal');
      }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#f4f4f2] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-[#5a9e8a] px-5 py-4 max-w-sm w-full flex items-center gap-4">
          <svg className="w-5 h-5 text-[#5a9e8a] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          <div>
            <p className="text-[14px] font-semibold text-[#5a9e8a] font-serif">¡Cuenta activada!</p>
            <p className="text-[12px] text-[#9ca3af] mt-0.5">Redirigiendo a tu portal…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f4f2] flex flex-col md:flex-row font-sans">

      {/* Sage panel — header en móvil, columna izquierda en desktop */}
      <div className="bg-[#5a9e8a] px-6 py-8 md:w-[42%] md:min-h-screen md:flex md:flex-col md:justify-between">
        <div>
          {/* Logo mark */}
          <div className="flex items-center gap-2.5 mb-6">
            <span className="text-white text-[15px] font-bold tracking-tight">SyqueX</span>
          </div>
          <h1 className="text-white text-[22px] font-bold font-serif leading-snug mb-2">
            Tu psicólogo te invitó
          </h1>
          <p className="text-white/70 text-[13px] leading-relaxed">
            Aquí verás los resúmenes de tus sesiones en un espacio privado.
          </p>
        </div>
        {/* Privacy badge — solo desktop */}
        <div className="hidden md:flex items-center gap-2 mt-8 pt-6 border-t border-white/[0.18]">
          <svg className="w-3.5 h-3.5 text-white/55 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-white/55 text-[11px]">Datos encriptados</span>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 bg-white px-6 py-8 md:flex md:items-center md:justify-center">
        <div className="w-full max-w-sm">
          <h2 className="text-[18px] font-bold font-serif text-[#18181b] mb-6">
            Crea tu contraseña
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[9px] font-bold text-[#5a9e8a] uppercase tracking-[0.1em] mb-1.5">
                Contraseña
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#f4f4f2] border border-black/[0.08] rounded-xl px-3 py-2.5 text-[14px] text-[#18181b] focus:outline-none focus:border-[#5a9e8a]/60 focus:ring-1 focus:ring-[#5a9e8a]/20 transition-all"
              />
              <p className="text-[11px] text-[#9ca3af] mt-1.5 pl-0.5">Mínimo 8 caracteres · 1 mayúscula · 1 número</p>
            </div>

            <div>
              <label className="block text-[9px] font-bold text-[#5a9e8a] uppercase tracking-[0.1em] mb-1.5">
                Confirmar contraseña
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#f4f4f2] border border-black/[0.08] rounded-xl px-3 py-2.5 text-[14px] text-[#18181b] focus:outline-none focus:border-[#5a9e8a]/60 focus:ring-1 focus:ring-[#5a9e8a]/20 transition-all"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2.5 bg-[#fef2f2] border border-red-300 rounded-xl px-3 py-2.5">
                <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[9px] font-bold">!</span>
                </div>
                <p className="text-[12px] text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#5a9e8a] hover:bg-[#4a8a78] active:scale-[0.98] text-white rounded-xl py-2.5 text-[14px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? 'Creando cuenta…' : 'Activar cuenta'}
            </button>
          </form>

          {/* Privacy note — solo móvil */}
          <div className="flex items-center justify-center gap-1.5 mt-6 md:hidden">
            <svg className="w-3 h-3 text-[#9ca3af]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-[11px] text-[#9ca3af]">Datos encriptados · Solo tú los ves</span>
          </div>
        </div>
      </div>

    </div>
  );
}
