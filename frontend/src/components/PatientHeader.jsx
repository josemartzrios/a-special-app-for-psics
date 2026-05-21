/**
 * PatientHeader
 *
 * Shows patient info: avatar initials, name, confirmed session count.
 * Used in desktop header bar and mobile patient strip.
 *
 * Props:
 *   - patientName: string | null
 *   - sessionCount: number  (confirmed sessions)
 *   - compact: boolean      (mobile strip uses smaller sizing)
 *   - patientId: string | null    (id del paciente activo — requerido para editar)
 *   - onEditPatient: (id) => void (abre el modal de edición; solo desktop)
 */

export default function PatientHeader({
  patientName,
  sessionCount = 0,
  compact = false,
  mode = 'session',
  onModeChange,
  patientId = null,
  onEditPatient = null,
  onShowTutorial = null,
  onInvitePatient = null,
  portalStatus = null,
}) {
  const tutorialButton = onShowTutorial && (
    <button
      onClick={onShowTutorial}
      className={`rounded-full border border-ink/[0.07] text-ink-muted hover:text-ink hover:bg-ink/[0.05] transition-colors flex items-center justify-center flex-shrink-0 ${compact ? 'w-7 h-7 text-[12px]' : 'w-8 h-8 text-[14px]'
        }`}
      aria-label="Ayuda"
    >
      ?
    </button>
  );

  if (!patientName) {
    return (
      <header className="px-6 py-3.5 border-b border-black/[0.07] bg-white flex items-center justify-between gap-3 flex-shrink-0 min-h-[52px]">
        <span className="text-ink-tertiary text-[14px]"></span>
        {tutorialButton}
      </header>
    );
  }

  const initials = patientName.slice(0, 2).toUpperCase();

  /* Compact = mobile patient strip style */
  if (compact) {
    return (
      <div className="px-5 py-3 bg-[#f4f4f2] border-b border-ink/[0.06] flex items-center gap-3 flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-[#5a9e8a] flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-[#18181b] leading-tight">{patientName}</p>
          <p className="text-[11px] text-ink-tertiary">
            {sessionCount} {sessionCount === 1 ? 'sesión confirmada' : 'sesiones confirmadas'}
          </p>
        </div>
        {onInvitePatient && patientId && (
          portalStatus === 'active' ? (
            <div
              className="p-2 rounded-lg text-[#5a9e8a] flex-shrink-0 cursor-default"
              title="Paciente activo en el portal"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          ) : portalStatus === 'invited' ? (
            <span className="text-[11px] font-medium text-[#c4935a] bg-[#c4935a]/10 px-2 py-1 rounded-lg flex-shrink-0 text-center leading-tight">
              Invitación<br />enviada
            </span>
          ) : (
            <button
              onClick={() => onInvitePatient(patientId)}
              className="p-2 rounded-lg text-[#9ca3af] hover:text-[#5a9e8a] hover:bg-black/[0.04] transition-colors flex-shrink-0"
              aria-label="Invitar al portal"
              title="Invitar al portal"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </button>
          )
        )}
        {onEditPatient && patientId && (
          <button
            onClick={() => onEditPatient(patientId)}
            className="p-2 rounded-lg text-[#9ca3af] hover:text-[#5a9e8a] hover:bg-black/[0.04] transition-colors flex-shrink-0"
            aria-label="Editar expediente" title="Editar expediente"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  /* Desktop header bar */
  return (
    <header className="px-6 py-3.5 border-b border-black/[0.07] bg-white flex items-center gap-3 flex-shrink-0 min-h-[52px]">
      <div className="w-7 h-7 rounded-full bg-[#5a9e8a] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
        {initials}
      </div>
      <span className="text-[#18181b] text-[15px] font-semibold">{patientName}</span>
      <span className="text-ink-muted text-[12px] ml-1">
        · {sessionCount} {sessionCount === 1 ? 'sesión' : 'sesiones'}
      </span>

      {/* Invite patient to portal — desktop only */}
      {onInvitePatient && patientId && (
        portalStatus === 'active' ? (
          <div
            className="ml-2 p-1.5 rounded-lg text-[#5a9e8a] cursor-default"
            title="Paciente activo en el portal"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        ) : portalStatus === 'invited' ? (
          <span className="ml-2 text-[11px] font-medium text-[#c4935a] bg-[#c4935a]/10 px-2 py-1 rounded-lg text-center leading-tight">
            Invitación<br />enviada
          </span>
        ) : (
          <button
            onClick={() => onInvitePatient(patientId)}
            className="ml-2 p-1.5 rounded-lg text-ink-tertiary hover:text-[#5a9e8a] hover:bg-black/[0.04] transition-colors"
            aria-label="Invitar al portal"
            title="Invitar al portal"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>
        )
      )}

      {/* Edit expediente — desktop only, requires patientId + handler */}
      {onEditPatient && patientId && (
        <button
          onClick={() => onEditPatient(patientId)}
          className="ml-2 p-1.5 rounded-lg text-ink-tertiary hover:text-[#5a9e8a] hover:bg-black/[0.04] transition-colors"
          aria-label="Editar expediente"
          title="Editar expediente"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      )}

      {/* Segmented control — desktop only, only when onModeChange is provided */}
      {onModeChange && (
        <div className="ml-auto flex items-center gap-4">
          <div className="flex bg-[#f4f4f2] rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => onModeChange('session')}
              className={`px-3 py-1 rounded-md text-[12px] transition-all ${mode === 'session'
                  ? 'bg-white shadow-sm font-medium text-[#18181b]'
                  : 'text-[#9ca3af] hover:text-[#6b7280]'
                }`}
            >
              Sesión
            </button>
            <button
              onClick={() => onModeChange('review')}
              className={`px-3 py-1 rounded-md text-[12px] transition-all ${mode === 'review'
                  ? 'bg-white shadow-sm font-medium text-[#18181b]'
                  : 'text-[#9ca3af] hover:text-[#6b7280]'
                }`}
            >
              Revisión
            </button>
          </div>
          {tutorialButton}
        </div>
      )}

      {/* Fallback for desktop when no onModeChange but tutorial is needed */}
      {!onModeChange && !compact && <div className="ml-auto">{tutorialButton}</div>}
    </header>
  );
}
