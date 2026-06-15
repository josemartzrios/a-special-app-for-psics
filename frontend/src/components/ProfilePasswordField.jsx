import { useState, useEffect, useCallback } from 'react';
import { changePassword } from '../api';

const STATES = { idle: 'idle', editing: 'editing', saving: 'saving', success: 'success', error: 'error' };

export default function ProfilePasswordField() {
  const [editState, setEditState] = useState(STATES.idle);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const reset = useCallback(() => {
    setEditState(STATES.idle);
    setCurrent('');
    setNext('');
    setConfirm('');
    setErrorMsg('');
  }, []);

  useEffect(() => {
    if (editState !== STATES.editing) return;
    const handleEsc = (e) => { if (e.key === 'Escape') reset(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [editState, reset]);

  useEffect(() => {
    if (editState !== STATES.success) return;
    const t = setTimeout(reset, 2000);
    return () => clearTimeout(t);
  }, [editState, reset]);

  async function handleSave(e) {
    e.preventDefault();
    if (editState === STATES.saving) return;
    setEditState(STATES.saving);
    setErrorMsg('');
    try {
      await changePassword(current, next);
      setEditState(STATES.success);
    } catch (err) {
      setErrorMsg(err?.message || 'Error al cambiar la contraseña');
      setEditState(STATES.error);
    }
  }

  if (editState === STATES.idle) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-ink font-medium tracking-widest">••••••••</span>
        <button
          aria-label="Editar contraseña"
          onClick={() => setEditState(STATES.editing)}
          className="p-1 rounded text-ink-tertiary hover:text-[#5a9e8a] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      </div>
    );
  }

  if (editState === STATES.success) {
    return (
      <div className="flex items-center gap-2 text-[#5a9e8a]">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-[13px] font-medium">Contraseña actualizada</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-2.5 mt-1">
      <input
        type="password"
        placeholder="Contraseña actual"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        disabled={editState === STATES.saving}
        className="w-full px-3 py-2 text-[13px] border border-[#18181b]/[0.12] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#5a9e8a] disabled:opacity-50"
      />
      <input
        type="password"
        placeholder="Nueva contraseña"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        disabled={editState === STATES.saving}
        className="w-full px-3 py-2 text-[13px] border border-[#18181b]/[0.12] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#5a9e8a] disabled:opacity-50"
      />
      <input
        type="password"
        placeholder="Confirmar nueva contraseña"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        disabled={editState === STATES.saving}
        className="w-full px-3 py-2 text-[13px] border border-[#18181b]/[0.12] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#5a9e8a] disabled:opacity-50"
      />

      {(editState === STATES.error) && errorMsg && (
        <p className="text-[12px] text-red-500">{errorMsg}</p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          aria-label="Guardar"
          disabled={editState === STATES.saving}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-[#5a9e8a] text-white text-[12px] font-semibold rounded-lg hover:bg-[#4a8e7a] disabled:opacity-60 transition-colors"
        >
          {editState === STATES.saving ? (
            <>
              <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Guardando…
            </>
          ) : 'Guardar'}
        </button>
        <button
          type="button"
          aria-label="Cancelar"
          onClick={reset}
          disabled={editState === STATES.saving}
          className="flex-1 py-2 text-[12px] text-[#71717a] border border-[#18181b]/[0.12] rounded-lg hover:bg-[#f4f4f2] disabled:opacity-40 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
