import { useState } from 'react';

const PANEL_STATES = { IDLE: 'idle', LOADING: 'loading', PREVIEW: 'preview', ERROR: 'error' };

function groupSlotsByDate(slots) {
  return slots.reduce((acc, slot) => {
    if (!acc[slot.slot_date]) acc[slot.slot_date] = [];
    acc[slot.slot_date].push(slot);
    return acc;
  }, {});
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function AvailabilityPanel({ onParseAvailability, onConfirmSlots }) {
  const [state, setState] = useState(PANEL_STATES.IDLE);
  const [text, setText] = useState('');
  const [previewSlots, setPreviewSlots] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  const today = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  const todayISO = new Date().toISOString().split('T')[0];

  const handleParse = async () => {
    if (!text.trim()) return;
    setState(PANEL_STATES.LOADING);
    setErrorMsg('');
    try {
      const slots = await onParseAvailability(text.trim(), todayISO);
      setPreviewSlots(slots);
      setState(PANEL_STATES.PREVIEW);
    } catch {
      setState(PANEL_STATES.ERROR);
      setErrorMsg('No pude identificar fechas u horas. Intenta: "Lunes de 9 a 2, sesiones 60 min"');
    }
  };

  const handleRemoveSlot = (index) => {
    setPreviewSlots(prev => prev.filter((_, i) => i !== index));
  };

  const handleDiscard = () => {
    setState(PANEL_STATES.IDLE);
    setPreviewSlots([]);
  };

  const handleConfirm = async () => {
    await onConfirmSlots(previewSlots);
    setState(PANEL_STATES.IDLE);
    setText('');
    setPreviewSlots([]);
  };

  const grouped = groupSlotsByDate(previewSlots);
  const dateCount = Object.keys(grouped).length;

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.10em] text-ink-muted mb-3">
          Disponibilidad · {today}
        </p>

        {state === PANEL_STATES.PREVIEW ? (
          <div>
            <button
              onClick={handleDiscard}
              className="text-[12px] text-ink-secondary hover:text-ink mb-4 flex items-center gap-1 transition-colors"
            >
              ← Editar texto
            </button>
            <p className="text-[10px] font-bold uppercase tracking-[0.10em] text-ink-muted mb-3">INTERPRETADO</p>
            <div className="space-y-4 pr-1">
              {Object.entries(grouped).map(([dateStr, slots]) => (
                <div key={dateStr}>
                  <p className="text-[13px] font-medium text-ink mb-1.5 capitalize">{formatDate(dateStr)}</p>
                  <div className="space-y-1.5">
                    {slots.map((slot, idx) => {
                      const globalIdx = previewSlots.indexOf(slot);
                      return (
                        <div key={idx} className="flex items-center justify-between bg-[#f4f4f2] rounded-lg px-3 py-2">
                          <span className="text-[13px] text-ink">{slot.start_time.substring(0, 5)} · {slot.duration_minutes} min</span>
                          <button
                            onClick={() => handleRemoveSlot(globalIdx)}
                            title="Eliminar slot"
                            className="text-ink-tertiary hover:text-red-500 transition-colors p-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-ink-secondary mt-3">
              {previewSlots.length} horario{previewSlots.length !== 1 ? 's' : ''}{dateCount > 1 ? ` en ${dateCount} días` : ''}
            </p>
          </div>
        ) : (
          <div>
            <textarea
              className="w-full h-52 resize-none bg-white border border-black/[0.07] rounded-xl px-4 py-3 text-[14px] leading-relaxed text-[#18181b] outline-none focus:border-[#5a9e8a] focus:ring-0 transition-colors placeholder-ink-muted disabled:bg-slate-50 disabled:opacity-50"
              placeholder="Describe cuándo estás disponible — un día, varios o una semana…"
              value={text}
              onChange={e => setText(e.target.value)}
              disabled={state === PANEL_STATES.LOADING}
            />
            <p className="text-[11px] text-ink-tertiary mt-1.5 mb-3">
              Ej: Lunes de 9 a 2, miércoles solo de 10 a 12
            </p>
            {state === PANEL_STATES.ERROR && (
              <div className="mb-3 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2">
                <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-red-700 leading-relaxed">{errorMsg}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-5 pb-5 flex-shrink-0">
        {state === PANEL_STATES.PREVIEW ? (
          <div className="flex gap-2">
            <button
              onClick={handleDiscard}
              className="flex-1 py-2.5 rounded-xl text-[14px] font-medium border border-ink/[0.1] text-ink-secondary hover:bg-ink/[0.02] transition-all"
            >
              Descartar
            </button>
            <button
              onClick={handleConfirm}
              disabled={previewSlots.length === 0}
              className="flex-1 py-2.5 rounded-xl text-[14px] font-medium bg-[#5a9e8a] text-white hover:bg-[#4a8a78] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Confirmar {previewSlots.length} →
            </button>
          </div>
        ) : (
          <button
            onClick={handleParse}
            disabled={state === PANEL_STATES.LOADING || !text.trim()}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[14px] font-medium transition-all ${
              state === PANEL_STATES.LOADING || !text.trim()
                ? 'bg-[#5a9e8a] text-white opacity-40 cursor-not-allowed'
                : 'bg-[#5a9e8a] text-white hover:bg-[#4a8a78] active:scale-95'
            }`}
          >
            {state === PANEL_STATES.LOADING ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Interpretando…
              </>
            ) : (
              'Interpretar disponibilidad'
            )}
          </button>
        )}
      </div>
    </div>
  );
}
