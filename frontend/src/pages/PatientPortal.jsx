import { useState, useEffect, useRef } from 'react';
import { clearPatientToken, getPatientSummaries, getPatientSummaryDetail, getPatientAvailability, cancelPatientBooking, acknowledgeBookingCancellation } from '../patientApi';
import { navigateTo } from '../auth';
import TutorialModal from '../components/TutorialModal';
import PatientBookingModal from '../components/PatientBookingModal';
import UpcomingBookingCard from '../components/UpcomingBookingCard';
import CancelledBookingCard from '../components/CancelledBookingCard';
import GlossarySheet from '../components/GlossarySheet';

export default function PatientPortal() {
  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSummary, setSelectedSummary] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [upcomingBooking, setUpcomingBooking]   = useState(null);
  const [cancelingBooking, setCancelingBooking] = useState(false);
  const [cancelError, setCancelError]           = useState(null);
  const [cancelledBooking, setCancelledBooking] = useState(null);
  const [acknowledging, setAcknowledging]       = useState(false);
  const [hasAvailability, setHasAvailability]   = useState(null);
  const [selectionText, setSelectionText]       = useState('');
  const [pillVisible, setPillVisible]           = useState(false);
  const [pillPosition, setPillPosition]         = useState(null); // { top, left } desktop only
  const [glossaryOpen, setGlossaryOpen]         = useState(false);
  const [glossaryContext, setGlossaryContext]   = useState('');
  const detailRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = 'auto';
    return () => { document.body.style.overflow = 'hidden'; };
  }, []);

  // Swap manifest so "Add to Home Screen" saves /portal, not /
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    const original = link.getAttribute('href');
    link.setAttribute('href', '/portal-manifest.json');
    return () => link.setAttribute('href', original);
  }, []);

  useEffect(() => {
    if (localStorage.getItem('patient_tutorial_done') !== 'true') {
      setTutorialVisible(true);
    }
  }, []);

  useEffect(() => {
    loadSummaries();
  }, []);

  const loadUpcomingBooking = () => {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    return getPatientAvailability(month)
      .then(data => {
        setUpcomingBooking(data.upcoming_booking ?? null);
        setCancelledBooking(data.cancelled_booking ?? null);
        setHasAvailability(data.has_future_availability ?? false);
        setCancelError(null);
      })
      .catch(() => {});
  };

  useEffect(() => { loadUpcomingBooking(); }, []);

  // Text-selection detection for glossary pill
  useEffect(() => {
    if (!selectedSummary) return;
    let timer;

    const handleSelectionChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (glossaryOpen) return;

        const selection = window.getSelection();
        const text = selection?.toString().trim();

        if (!text || text.length > 500 || !contentRef.current || !selection.rangeCount) {
          setPillVisible(false);
          return;
        }

        const range = selection.getRangeAt(0);
        if (!contentRef.current.contains(range.commonAncestorContainer)) {
          setPillVisible(false);
          return;
        }

        setSelectionText(text);

        if (window.innerWidth >= 768) {
          const rect = range.getBoundingClientRect();
          setPillPosition({
            top: Math.max(60, rect.top - 52),
            left: rect.left + rect.width / 2,
          });
        }

        setPillVisible(true);
      }, 60);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      clearTimeout(timer);
    };
  }, [selectedSummary, glossaryOpen]);

  const openGlossary = () => {
    const context = [
      selectedSummary?.topics_worked && `Temas trabajados: ${selectedSummary.topics_worked}`,
      selectedSummary?.homework && `Tarea: ${selectedSummary.homework}`,
    ].filter(Boolean).join('\n\n');
    setGlossaryContext(context);
    setGlossaryOpen(true);
    setPillVisible(false);
  };

  const closeGlossary = () => {
    setGlossaryOpen(false);
    setPillVisible(false);
    setSelectionText('');
    window.getSelection()?.removeAllRanges();
  };

  const loadSummaries = async () => {
    setLoading(true);
    try {
      const data = await getPatientSummaries();
      setSummaries(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelBooking = async (slotId) => {
    setCancelingBooking(true);
    setCancelError(null);
    try {
      await cancelPatientBooking(slotId);
      setUpcomingBooking(null);
    } catch (err) {
      setCancelError(err.message || 'No se pudo cancelar. Intenta de nuevo.');
    } finally {
      setCancelingBooking(false);
    }
  };

  const handleAcknowledge = async (slotId) => {
    setAcknowledging(true);
    try {
      await acknowledgeBookingCancellation(slotId);
      setCancelledBooking(null);
    } catch {
      // Card stays visible if request fails — patient can retry
    } finally {
      setAcknowledging(false);
    }
  };

  const handleViewDetail = async (summaryId) => {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const detail = await getPatientSummaryDetail(summaryId);
      setSelectedSummary(detail);
      setSummaries(prev => prev.map(s => s.id === summaryId ? { ...s, viewed_at: detail.viewed_at } : s));
      if (window.innerWidth < 768) {
        setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      }
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleLogout = () => {
    clearPatientToken();
    sessionStorage.removeItem('portal_session');
    navigateTo('/portal/login');
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fefaf6] flex items-center justify-center">
        <div className="animate-pulse text-[#5a9e8a] font-medium text-lg">Cargando tu portal...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fefaf6] font-sans pb-12">
      {/* Header */}
      <nav className="bg-white border-b border-[#18181b]/[0.06] sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 sm:h-16">

            {/* Brand — always visible */}
            <div className="flex items-center gap-2.5">
              <span className="font-semibold text-[#18181b] text-[15px] tracking-tight">SyqueX</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 sm:gap-2">

              {/* Tutorial — desktop only */}
              <button
                onClick={() => setTutorialVisible(true)}
                className="hidden sm:flex w-9 h-9 rounded-full border border-[#18181b]/[0.07] text-[#9ca3af] hover:text-[#18181b] hover:bg-[#18181b]/[0.05] transition-colors items-center justify-center text-sm"
                aria-label="Abrir tutorial"
              >?</button>

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="flex items-center justify-center gap-1.5 w-10 h-10 sm:w-auto sm:h-auto sm:px-3 sm:py-2 rounded-lg text-[#9ca3af] hover:text-[#18181b] hover:bg-[#18181b]/[0.05] active:scale-95 transition-all"
                aria-label="Cerrar sesión"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="hidden sm:inline text-sm font-medium">Cerrar sesión</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {bookingSuccess && (
          <div className="mb-6 bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-[#22c55e] flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h3 className="text-[#166534] font-semibold">¡Cita confirmada exitosamente!</h3>
              <p className="text-[#15803d] text-sm mt-1">
                Hemos enviado un correo con los detalles de tu cita y un archivo de calendario (.ics) para que la guardes.
              </p>
            </div>
            <button onClick={() => setBookingSuccess(false)} className="ml-auto text-[#166534] hover:bg-[#dcfce7] p-1.5 rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

          {/* List Section */}
          <div className="md:col-span-1 md:sticky md:top-[88px] md:max-h-[calc(100vh-104px)] md:overflow-y-auto md:pr-1">

            {/* Próxima cita / cancelación */}
            {cancelledBooking ? (
              <CancelledBookingCard
                booking={cancelledBooking}
                onAcknowledge={handleAcknowledge}
                acknowledging={acknowledging}
              />
            ) : (
              <UpcomingBookingCard
                booking={upcomingBooking}
                onCancel={handleCancelBooking}
                canceling={cancelingBooking}
                error={cancelError}
              />
            )}

            {/* Booking CTA — solo visible cuando no hay cita activa, ni cancelación pendiente, y el psicólogo tiene horarios disponibles */}
            {!cancelledBooking && !upcomingBooking && hasAvailability === true && (
              <button
                onClick={() => setBookingModalOpen(true)}
                className="w-full mb-5 flex items-center gap-3 bg-[#5a9e8a] hover:bg-[#4a8271] active:scale-[0.98] text-white rounded-xl px-4 py-3 transition-all"
              >
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold leading-tight">Agendar cita</div>
                  <div className="text-[11px] text-white/70 leading-tight mt-0.5">
                    Ver disponibilidad del psicólogo
                  </div>
                </div>
                <svg className="w-4 h-4 ml-auto text-white/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            <h1 className="text-lg font-bold text-[#18181b] mb-4">Mis Sesiones</h1>
            {error && (
              <div className="mb-4 flex items-center gap-2 bg-[#fef2f2] border border-red-200 rounded-xl px-3 py-2.5">
                <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[9px] font-bold">!</span>
                </div>
                <p className="text-[12px] text-red-600">{error}</p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {summaries.length === 0 ? (
                <div className="bg-white p-6 rounded-2xl border border-dashed border-[#18181b]/[0.1] text-center">
                  <p className="text-[#9ca3af] text-sm">Aún no tienes resúmenes disponibles.</p>
                </div>
              ) : (
                summaries.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleViewDetail(s.id)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl border transition-all ${selectedSummary?.id === s.id
                      ? 'border-2 border-[#5a9e8a] bg-white'
                      : 'bg-white border border-[#18181b]/[0.08] hover:border-[#5a9e8a]/30'
                      }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-[10px] text-[#5a9e8a] font-semibold tracking-wide mb-1">
                        {new Date(s.sent_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).toUpperCase()}
                      </span>
                      {!s.viewed_at && (
                        <span className="w-2 h-2 bg-[#5a9e8a] rounded-full"></span>
                      )}
                    </div>
                    <p className={`text-xs truncate ${selectedSummary?.id === s.id ? 'font-medium text-[#18181b]' : 'text-[#18181b]/60'}`}>
                      {s.topics_worked || 'Sesión sin título'}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Detail Section */}
          <div ref={detailRef} className="md:col-span-2">
            {detailError && (
              <div className="mb-4 flex items-center gap-2 bg-[#fef2f2] border border-red-200 rounded-xl px-3 py-2.5">
                <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[9px] font-bold">!</span>
                </div>
                <p className="text-[12px] text-red-600">{detailError}</p>
              </div>
            )}
            {loadingDetail ? (
              <div className="bg-white rounded-3xl border border-[#18181b]/[0.06] p-12 flex items-center justify-center h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#5a9e8a]"></div>
              </div>
            ) : selectedSummary ? (
              <div className="bg-white rounded-xl border border-[#18181b]/[0.08] overflow-hidden">
                <div className="p-4" ref={contentRef}>
                  <div className="mb-3.5">
                    <div className="text-[10px] text-[#5a9e8a] font-bold tracking-widest mb-1">RESUMEN DE SESIÓN</div>
                    <div className="text-sm font-semibold text-[#18181b]">
                      {new Date(selectedSummary.sent_at).toLocaleDateString('es-ES', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </div>
                  </div>

                  <section>
                    <div className="text-[10px] text-[#5a9e8a] font-bold tracking-widest mb-1.5">TEMAS TRABAJADOS</div>
                    <p className="text-xs leading-relaxed text-[#18181b]/60 whitespace-pre-wrap mb-4">
                      {selectedSummary.topics_worked}
                    </p>
                  </section>

                  {selectedSummary.homework && (
                    <section>
                      <div className="text-[10px] text-[#5a9e8a] font-bold tracking-widest mb-2">TAREAS Y PROPÓSITOS</div>
                      <div className="px-3.5 py-2.5 rounded-xl border-l-[3px] border-[#5a9e8a] bg-[#f4f4f2] text-xs leading-relaxed text-[#18181b] italic mb-3.5">
                        {selectedSummary.homework}
                      </div>
                    </section>
                  )}

                </div>

                <div className="bg-[#f4f4f2]/30 px-8 py-4 border-t border-[#18181b]/[0.04]">
                  <p className="text-[11px] text-[#9ca3af] text-center italic">
                    Este resumen es para tu referencia personal y apoyo en tu proceso terapéutico.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-dashed border-[#18181b]/[0.1] p-12 flex flex-col items-center justify-center text-center h-full min-h-[400px]">
                <div className="w-16 h-16 bg-[#fefaf6] rounded-full flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-[#9ca3af]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <h3 className="text-lg font-serif text-[#18181b]">Selecciona una sesión</h3>
                <p className="text-sm text-[#9ca3af] mt-2 max-w-xs">
                  Toca uno de tus resúmenes en la lista para ver los detalles.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Glossary pill — appears when patient selects text inside a summary */}
      {pillVisible && !glossaryOpen && (
        <>
          {/* Mobile: fixed bottom-center */}
          <div className="md:hidden fixed bottom-24 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
            <button
              onMouseDown={(e) => { e.preventDefault(); openGlossary(); }}
              onTouchEnd={(e) => { e.preventDefault(); openGlossary(); }}
              className="flex items-center gap-2 bg-[#18181b] text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg active:scale-95 transition-transform"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              ¿Qué significa?
            </button>
          </div>

          {/* Desktop: near the selection */}
          <div
            className="hidden md:block fixed z-40 pointer-events-auto"
            style={{ top: pillPosition?.top, left: pillPosition?.left, transform: 'translateX(-50%)' }}
          >
            <button
              onMouseDown={(e) => { e.preventDefault(); openGlossary(); }}
              className="flex items-center gap-2 bg-[#18181b] text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg hover:bg-[#18181b]/90 transition-colors"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              ¿Qué significa?
            </button>
          </div>
        </>
      )}

      {glossaryOpen && (
        <GlossarySheet
          selectedText={selectionText}
          context={glossaryContext}
          desktopPosition={pillPosition}
          onClose={closeGlossary}
        />
      )}

      <TutorialModal
        visible={tutorialVisible}
        onClose={() => setTutorialVisible(false)}
        isMobile={false}
        patientMode
      />

      <PatientBookingModal
        open={bookingModalOpen}
        onClose={() => setBookingModalOpen(false)}
        onBookingSuccess={() => {
          setBookingSuccess(true);
          setTimeout(() => setBookingSuccess(false), 8000);
          loadUpcomingBooking();
        }}
      />
    </div>
  );
}
