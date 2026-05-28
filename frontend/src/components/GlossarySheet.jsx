import { useState, useEffect } from 'react';
import { explainText } from '../patientApi';

/**
 * Bottom sheet (mobile) / floating card (desktop) that explains a selected term
 * using the patient's session context.
 *
 * Props:
 *   selectedText    — the word or phrase the patient selected
 *   context         — plain-text summary content passed to the AI
 *   desktopPosition — { top, left } in viewport px for desktop card placement
 *   onClose         — called when patient dismisses
 */
export default function GlossarySheet({ selectedText, context, desktopPosition, onClose }) {
  const [explanation, setExplanation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedText) return;
    setLoading(true);
    setError(null);
    setExplanation(null);

    explainText(selectedText, context)
      .then(data => setExplanation(data.explanation))
      .catch(err => setError(err.message || 'No se pudo obtener la explicación.'))
      .finally(() => setLoading(false));
  }, [selectedText, context]);

  const innerContent = (
    <>
      <div className="text-[10px] text-[#5a9e8a] font-bold tracking-widest mb-1">GLOSARIO</div>
      <p className="text-base font-semibold text-[#18181b] mb-4">"{selectedText}"</p>

      {loading && (
        <div className="flex items-center gap-2 text-[#9ca3af] text-sm">
          <div className="w-4 h-4 border-2 border-[#5a9e8a] border-t-transparent rounded-full animate-spin flex-shrink-0" />
          Consultando...
        </div>
      )}

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {explanation && (
        <p className="text-sm leading-loose text-[#18181b]/80 whitespace-pre-wrap">{explanation}</p>
      )}
    </>
  );

  return (
    <>
      {/* ── MOBILE: bottom sheet ── */}
      <div
        className="md:hidden fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="md:hidden fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-xl px-6 pt-4 pb-8">
        <div className="w-10 h-1 bg-[#18181b]/10 rounded-full mx-auto mb-5" />
        {innerContent}
        <button
          onClick={onClose}
          className="mt-6 w-full py-3 bg-[#5a9e8a] hover:bg-[#4a8271] text-white rounded-xl text-sm font-semibold active:scale-[0.98] transition-all"
        >
          Entendido
        </button>
      </div>

      {/* ── DESKTOP: floating card near selection ── */}
      <div
        className="hidden md:block fixed z-50 w-80 bg-white rounded-2xl shadow-xl border border-[#18181b]/[0.08] p-5"
        style={{
          top: desktopPosition?.top ?? 80,
          left: desktopPosition?.left ?? '50%',
          transform: 'translateX(-50%)',
        }}
      >
        {innerContent}
        <button
          onClick={onClose}
          className="mt-5 w-full py-2.5 bg-[#5a9e8a] hover:bg-[#4a8271] text-white rounded-xl text-sm font-semibold active:scale-[0.98] transition-all"
        >
          Entendido
        </button>
        {/* close X */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-[#9ca3af] hover:bg-[#18181b]/[0.05] hover:text-[#18181b] transition-colors"
          aria-label="Cerrar"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </>
  );
}
