import { useState, useRef, useEffect } from 'react';

export default function Sidebar({ open, onClose, conversations, onSelectConversation, onDeleteConversation, onLogout, draftPatientIds = new Set(), canCancelSubscription = false, onCancelSubscription }) {
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) setSearchQuery('');
  }, [open]);

  const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filteredConversations = conversations.filter(c =>
    normalize(c.patient_name).includes(normalize(searchQuery))
  );

  return (
    <>
      {open && (
        <div
          data-testid="sidebar-backdrop"
          className="fixed inset-0 bg-ink/20 backdrop-blur-[2px] z-30"
          onClick={onClose}
        />
      )}

      <div data-testid="sidebar-panel" className={`fixed left-0 top-0 h-full w-[85vw] max-w-sm bg-white z-40 flex flex-col transform transition-transform duration-300 ease-out border-r border-ink/[0.07] shadow-xl ${open ? 'translate-x-0' : '-translate-x-full'}`}>

        <div className="px-5 py-4 border-b border-ink/[0.07] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-5 bg-sage rounded-full"></div>
            <h2 className="font-semibold text-ink text-[14px] tracking-tight">Sesiones clínicas</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-ink-tertiary hover:text-ink-secondary hover:bg-parchment transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search input — replaces the previous "N sesiones" count row */}
        <div className="px-5 py-2 border-b border-ink/[0.05] flex-shrink-0">
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              placeholder="Buscar paciente..."
              maxLength={100}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  if (searchQuery) {
                    setSearchQuery('');
                  } else {
                    e.currentTarget.blur();
                  }
                }
              }}
              className="w-full bg-white border border-black/[0.1] rounded-lg px-3 py-1.5 text-sm text-[#18181b] placeholder:text-ink-tertiary focus:outline-none focus:border-[#5a9e8a]/60 transition-colors pr-7"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); inputRef.current?.focus(); }}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 text-ink-tertiary hover:text-ink p-0.5 rounded transition-colors"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 px-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-parchment border border-ink/[0.07] flex items-center justify-center">
                <svg className="w-5 h-5 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-ink-tertiary text-sm">Sin sesiones registradas</p>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-ink-tertiary text-[13px]">Sin resultados</p>
            </div>
          ) : (
            filteredConversations.map(conv => (
              <ConversationItem
                key={conv.patient_id}
                conv={conv}
                onClick={() => { onSelectConversation(conv); onClose(); }}
                onDelete={() => onDeleteConversation(conv.id, conv.patient_id)}
                hasDraft={draftPatientIds.has(String(conv.patient_id))}
              />
            ))
          )}
        </div>
        
        {/* Logout — pinned to bottom of drawer */}
        <div className="border-t border-ink/[0.07] flex-shrink-0">
          {canCancelSubscription && (
            <button
              onClick={onCancelSubscription}
              className="w-full text-left px-5 py-[10px] text-[12px] text-ink-tertiary hover:text-ink-secondary hover:bg-parchment transition-colors border-b border-ink/[0.04]"
            >
              Cancelar suscripción
            </button>
          )}
          <button
            onClick={onLogout}
            className="w-full text-left px-5 py-3 text-[13px] text-ink-secondary hover:text-ink transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </>
  );
}

function ConversationItem({ conv, onClick, onDelete, hasDraft }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = (e) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete();
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      className="group px-4 py-3.5 border-b border-ink/[0.05] cursor-pointer hover:bg-parchment transition-colors relative"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1 pr-8">
        <span className="text-sage text-[11px] font-bold uppercase tracking-wider truncate">
          {conv.patient_name}
        </span>
        <span className="text-ink-tertiary text-[11px] flex-shrink-0 ml-2">{formatDate(conv.session_date)}</span>
      </div>

      <p className="text-ink-secondary text-[13px] leading-snug line-clamp-2 pr-2">
        {conv.dictation_preview || <span className="italic text-ink-muted">Sesión sin contenido</span>}
      </p>

      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <span className="text-[10px] text-ink-tertiary">Sesión #{conv.session_number}</span>
        {hasDraft ? (
          <span className="text-[10px] font-semibold text-[#c4935a] bg-[#fef3e2] rounded px-1 leading-4">
            Borrador
          </span>
        ) : conv.status === 'confirmed' ? (
          <span className="text-[10px] font-semibold text-[#5a9e8a] bg-[#f0faf7] rounded px-1 leading-4">
            Confirmada
          </span>
        ) : null}
      </div>

      <button
        onClick={handleDelete}
        title={confirmDelete ? 'Confirmar' : 'Archivar sesión'}
        className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all sm:opacity-0 sm:group-hover:opacity-100
          ${confirmDelete
            ? 'bg-red-50 text-red-500 !opacity-100'
            : 'text-ink-muted hover:bg-red-50 hover:text-red-400'
          }`}
      >
        {confirmDelete ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        )}
      </button>
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
}
