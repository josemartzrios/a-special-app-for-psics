import { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import PatientSidebar from './components/PatientSidebar'
import PatientHeader from './components/PatientHeader'
import SoapNoteDocument from './components/SoapNoteDocument'
import DictationPanel from './components/DictationPanel'
import PatientIntakeModal from './components/PatientIntakeModal'
import EvolucionPanel from './components/EvolucionPanel'
import { processSession, confirmNote, getTemplate, createPatient, getPatientSessions, listConversations, archivePatientSessions, getPatientProfile, setAuthCallbacks, getBillingStatus, createCheckout, logout, deleteSession, cancelSubscription, parseAvailability, createCalendarSlotsBatch } from './api'
import useDraft from './hooks/useDraft';
import { getScreenFromUrl, navigateTo, refreshAccessToken, clearAccessToken, getAccessToken, setAccessToken } from './auth.js';
import LoginScreen from './components/LoginScreen.jsx';
import RegisterScreen from './components/RegisterScreen.jsx';
import ForgotPasswordScreen from './components/ForgotPasswordScreen.jsx';
import ResetPasswordScreen from './components/ResetPasswordScreen.jsx';
import BillingScreen from './components/BillingScreen.jsx';
import TrialBanner from './components/TrialBanner.jsx';
import CustomNoteDocument from './components/CustomNoteDocument.jsx';
import OnboardingScreen from './components/OnboardingScreen.jsx';
import NoteConfigurator from './components/NoteConfigurator.jsx';
import { saveTemplate } from './api';
import TutorialModal from './components/TutorialModal';
import CancelSubscriptionModal from './components/CancelSubscriptionModal';
import PatientInviteModal from './components/PatientInviteModal';
import PatientSummarySection from './components/PatientSummarySection';
import CalendarScreen from './components/CalendarScreen';
import ProfileScreen from './components/ProfileScreen';
import BottomNav from './components/BottomNav';
import PatientLogin from './pages/PatientLogin';
import PatientInviteAccept from './pages/PatientInviteAccept';
import PatientPortal from './pages/PatientPortal';
import PatientResetPassword from './pages/PatientResetPassword';
import { getPatientToken, clearPatientToken } from './patientApi';

// ── Module-level constants ─────────────────────────────────────────────────
const SOAP_HEADER_BOLD_RE = /^\*\*(S|O|A|P)\s*[—–\-]/i;
const SOAP_HEADER_MD_RE = /^##\s*(S|O|A|P)\s*[—–\-]/i;
const BOLD_LINE_RE = /^\*\*[^*]+\*\*\s*$/;
const BOLD_INLINE_RE = /\*\*([^*]+)\*\*/;

// ── Static JSX (hoisted outside components to avoid recreation on render) ──
const EmptyState = ({ onOpenCalendar, onNewPatient }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center px-8">
    <div className="w-16 h-16 rounded-3xl  text-sage flex items-center justify-center mb-2">
      <img src="/icons/logotransparente.png" alt="SyqueX" className="w-16 h-16 object-contain" />
    </div>
    <div>
      <p className="text-ink text-lg font-medium">Bienvenido a SyqueX</p>
      <p className="text-ink-tertiary text-sm mt-1 max-w-sm">Selecciona un paciente en el menú lateral o comienza una consulta con un nuevo expediente.</p>
    </div>
    <div className="flex items-center gap-3 mt-4">
      <button onClick={onNewPatient} className="px-5 py-2.5 rounded-xl bg-sage hover:bg-sage-dark text-white text-sm font-medium transition-colors flex items-center gap-2 shadow-sm">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
        </svg>
        Nuevo Expediente
      </button>
      <button onClick={onOpenCalendar} className="px-5 py-2.5 rounded-xl border border-ink/[0.08] hover:bg-black/[0.02] text-ink-secondary text-sm font-medium transition-colors flex items-center gap-2">
        <svg className="w-4 h-4 text-ink-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Mi Agenda
      </button>
    </div>
  </div>
);

const LOADING_DOTS = (
  <div className="flex items-center gap-1.5 py-2">
    <span className="w-1.5 h-1.5 bg-sage rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
    <span className="w-1.5 h-1.5 bg-sage/70 rounded-full animate-bounce" style={{ animationDelay: '120ms' }}></span>
    <span className="w-1.5 h-1.5 bg-sage/40 rounded-full animate-bounce" style={{ animationDelay: '240ms' }}></span>
  </div>
);

const NOTE_EMPTY_STATE = (
  <div className="flex flex-col items-center justify-center gap-4 text-center px-8 h-full">
    <div className="w-14 h-14 rounded-2xl bg-parchment-dark border border-ink/[0.07] flex items-center justify-center">
      <svg className="w-7 h-7 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </div>
    <div>
      <p className="text-ink-secondary text-sm font-medium">Aún no hay nota generada</p>
      <p className="text-ink-tertiary text-xs mt-1">Dicta los puntos de la sesión y presiona «Generar nota →»</p>
    </div>
  </div>
);

// ── Clinical note renderer ───────────────────────────────────────────────────
function ClinicalNote({ text }) {
  const lines = text.split('\n');
  const result = [];

  lines.forEach((line, i) => {
    // SOAP section header: **S —, **O —, **A —, **P —
    const soapMatch = line.match(SOAP_HEADER_BOLD_RE) || line.match(SOAP_HEADER_MD_RE);
    if (soapMatch) {
      const clean = line.replace(/^\*\*/, '').replace(/\*\*$/, '').replace(/^#+\s*/, '');
      result.push(
        <div key={i} className={`${result.length > 0 ? 'mt-5' : ''} mb-2`}>
          <span className="font-sans text-[10px] font-bold text-sage tracking-[0.14em] uppercase">{clean}</span>
          <div className="h-px bg-sage/20 mt-1.5" />
        </div>
      );
      return;
    }

    // Bold full line = subheader
    if (BOLD_LINE_RE.test(line)) {
      const clean = line.replace(/\*\*/g, '').trim();
      result.push(
        <p key={i} className="font-semibold text-ink text-[13px] mt-4 mb-1 leading-snug">{clean}</p>
      );
      return;
    }

    // Empty line
    if (!line.trim()) {
      result.push(<div key={i} className="h-1.5" />);
      return;
    }

    // Regular line — render inline **bold**
    const parts = line.split(BOLD_INLINE_RE);
    result.push(
      <p key={i} className="text-ink-secondary text-[14px] leading-relaxed">
        {parts.map((part, j) =>
          j % 2 === 1
            ? <strong key={j} className="font-medium text-ink">{part}</strong>
            : part
        )}
      </p>
    );
  });

  return <div className="font-serif">{result}</div>;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
}

// ── Helper: mark pending SOAP notes as read-only ────────────────────────────
export function markPendingNotesReadOnly(messages) {
  return messages.map(msg =>
    msg.type === 'bot' && msg.noteData
      ? { ...msg, readOnly: true }
      : msg
  )
}

// ── App ──────────────────────────────────────────────────────────────────────
export function toggleExpandedSession(currentId, clickedId) {
  return currentId === clickedId ? null : clickedId;
}

// Pure filter for the Historial session list. Exported for unit testing.
// Searches simultaneously: session display number, formatted date, raw_dictation.
// Security: uses .includes() (no RegExp), guards null dictation with ?? '',
// bypasses filter on whitespace-only query via .trim().
export function filterHistorialSessions(sessions, query, displayNumMap) {
  if (query.trim() === '') return sessions;
  const q = query.toLowerCase();
  return sessions.filter(s => {
    const num = String(displayNumMap.get(String(s.id)) ?? '');
    const date = formatDate(s.session_date).toLowerCase();
    const dictation = (s.raw_dictation ?? '').toLowerCase();
    return num.includes(q) || date.includes(q) || dictation.includes(q);
  });
}

function App() {
  // Estado de pantalla
  const [authScreen, setAuthScreen] = useState(() => getScreenFromUrl());
  const [billingStatus, setBillingStatus] = useState(null);

  const [messages, setMessages] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [selectedPatientName, setSelectedPatientName] = useState(null);
  const [isCreatingPatient, setIsCreatingPatient] = useState(false);
  const [invitingPatientId, setInvitingPatientId] = useState(null);
  const [selectedPatientPortalStatus, setSelectedPatientPortalStatus] = useState(null);
  const [editingPatientId, setEditingPatientId] = useState(null);
  const [newPatientName, setNewPatientName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { draft, setDraft, clearDraft } = useDraft(selectedPatientId);
  const [conversations, setConversations] = useState([]);
  const [mobileTab, setMobileTab] = useState('escribir');
  const [currentSessionNote, setCurrentSessionNote] = useState(null);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [processingJobs, setProcessingJobs] = useState(new Map()); // Map<jobId, { status, progress, result }>
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('patients'); // 'patients' | 'agenda'
  const [agendaMobileTab, setAgendaMobileTab] = useState('disponibilidad'); // 'disponibilidad' | 'calendario'
  const [agendaCalendarKey, setAgendaCalendarKey] = useState(0);

  // Desktop two-mode layout state
  const [desktopMode, setDesktopMode] = useState('session'); // 'session' | 'review'
  const [reviewExpandedSessionId, setReviewExpandedSessionId] = useState(null);

  // Historial session search
  const [historialSearchQuery, setHistorialSearchQuery] = useState('');
  const historialSearchDesktopRef = useRef(null);
  const historialSearchMobileRef  = useRef(null);

  // Template state
  const [template, setTemplate] = useState(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(() => localStorage.getItem('syquex_onboarding_done') === 'true');
  const [noteFormat, setNoteFormat] = useState(() => localStorage.getItem('syquex_note_format') || 'soap');
  const [showNoteConfigurator, setShowNoteConfigurator] = useState(false);
  const [isConfiguratorFirstTime, setIsConfiguratorFirstTime] = useState(false);
  const [newlyConfirmedSessionId, setNewlyConfirmedSessionId] = useState(null);
  const [toast, setToast] = useState(null);
  const [dismissedOrphanIds, setDismissedOrphanIds] = useState(new Set());
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Cancel subscription modal state
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Evolución tab state
  const [evolutionMessages, setEvolutionMessages] = useState(new Map()); // Map<patientId, Message[]>
  const [evolutionLoading, setEvolutionLoading] = useState(false);
  const [evolutionSending, setEvolutionSending] = useState(false);
  const [evolutionError, setEvolutionError] = useState(null);
  const [patientProfile, setPatientProfile] = useState(null);

  const evolutionMessagesRef = useRef(evolutionMessages);
  useEffect(() => { evolutionMessagesRef.current = evolutionMessages; }, [evolutionMessages]);
  const scrollRef = useRef(null);
  const mobileScrollRef = useRef(null);

  // Limpia todo estado perteneciente al usuario anterior.
  // Llamar antes de mostrar la pantalla de login o app de un usuario distinto.
  const resetUserState = useCallback(() => {
    setConversations([]);
    setSelectedPatientId(null);
    setSelectedPatientName(null);
    setMessages([]);
    setSessionHistory([]);
    setCurrentSessionNote(null);
    setTemplate(null);
    setPatientProfile(null);
    setEvolutionMessages(new Map());
    setExpandedSessionId(null);
    setReviewExpandedSessionId(null);
    setDismissedOrphanIds(new Set());
    setNewlyConfirmedSessionId(null);
    setMobileTab('escribir');
    setDesktopMode('session');
    setBillingStatus(null);
    // Onboarding state is per-user — clear on logout so the next user sees the selector
    localStorage.removeItem('syquex_onboarding_done');
    localStorage.removeItem('syquex_note_format');
    setOnboardingCompleted(false);
    setNoteFormat('soap');
    setProcessingJobs(new Map());
  }, []);

  const checkBillingAndRoute = useCallback(async () => {
    try {
      const status = await getBillingStatus();
      setBillingStatus(status);
      if (status.status === 'trialing' || status.status === 'active') {
        setAuthScreen({ screen: 'app' });
        // Re-fetch con el token del usuario recién autenticado
        listConversations().then(setConversations).catch(() => { });
        getTemplate().then(t => setTemplate(t ?? {})).catch(() => setTemplate({}));
      } else {
        setAuthScreen({ screen: 'billing' });
      }
    } catch {
      setAuthScreen({ screen: 'billing' });
    }
  }, [resetUserState]);

  async function handleLogout() {
    try {
      await logout();
    } finally {
      resetUserState();
      setAuthScreen({ screen: 'login' });
    }
  }

  async function handleCancelSubscription() {
    console.log('Attempting to cancel subscription. Current status:', billingStatus);
    setIsCancelling(true);
    setCancelError('');
    try {
      await cancelSubscription();
      // Refrescar estado de facturación para actualizar UI
      const status = await getBillingStatus();
      setBillingStatus(status);
      setIsCancelModalOpen(false);
      setToast('Suscripción cancelada exitosamente');
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setCancelError(err.message || 'Error al cancelar la suscripción');
    } finally {
      setIsCancelling(false);
    }
  }

  // Diagnostic log
  useEffect(() => {
    if (billingStatus) {
      console.log('DEBUG Billing Status:', {
        status: billingStatus.status,
        cancel_at_period_end: billingStatus.cancel_at_period_end,
        canCancel: billingStatus.status === 'active' && !billingStatus.cancel_at_period_end
      });
    }
  }, [billingStatus]);

  // Inicializar auth al montar
  useEffect(() => {
    setAuthCallbacks({
      onUnauthorized: () => {
        clearAccessToken();
        setAuthScreen({ screen: 'login' });
      },
      onPaymentRequired: () => {
        setAuthScreen({ screen: 'billing' });
      },
    });

    async function initAuth() {
      const { screen, resetToken, inviteToken } = authScreen;

      // Patient portal check — require both localStorage token AND active session flag
      if (screen === 'patient-portal' || screen === 'patient-login') {
        const ptoken = getPatientToken();
        const sessionActive = sessionStorage.getItem('portal_session') === '1';
        if (ptoken && sessionActive) {
          setAuthScreen({ screen: 'patient-portal' });
        } else {
          clearPatientToken();
          setAuthScreen({ screen: 'patient-login' });
        }
        return;
      }

      // Si es register, forgot-password, reset-password o invite, no intentar refresh
      if (screen === 'register' || screen === 'forgot-password' || screen === 'reset-password' || screen === 'patient-invite' || screen === 'patient-reset') return;

      // Intentar refresh silencioso
      const token = await refreshAccessToken(
        (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/api/v1'
      );

      if (token) {
        setAccessToken(token);
        await checkBillingAndRoute();
      } else {
        setAuthScreen({ screen: 'login' });
      }
    }

    initAuth();
  }, []); // solo al montar

  const fetchConversations = async () => {
    try {
      const data = await listConversations();
      setConversations(data);
    } catch (err) {
      console.error("Error loading conversations:", err);
    }
  };

  const fetchPatientSessions = async (patientId, patientName) => {
    setSessionsLoading(true);
    try {
      const history = await getPatientSessions(patientId);
      setSessionHistory(history);
      if (patientName) loadPatientChat(patientId, patientName, history);
    } catch (err) {
      console.error("Error loading sessions:", err);
    } finally {
      setSessionsLoading(false);
    }
  };

  const loadPatientChat = (patientId, patientName, history = []) => {
    setSelectedPatientId(patientId);
    setSelectedPatientName(patientName);
    setMobileTab('escribir');
    setSessionHistory(history);
    setExpandedSessionId(null);
    setDesktopMode('session');
    setReviewExpandedSessionId(null);
    setSelectedPatientPortalStatus(null);
    // Reset evolution state for new patient (evolutionMessages Map se conserva)
    setPatientProfile(null);
    setEvolutionError(null);
    setEvolutionSending(false);
    setCurrentSessionNote(null);

    if (history.length === 0) {
      setMessages([{ role: 'assistant', type: 'welcome', text: `Hola Doctor. ¿Sobre qué desea escribir para ${patientName} hoy?` }]);
      return;
    }

    const historyMessages = [];
    // Only include confirmed sessions in chat bubbles
    const historyToShow = history.filter(s => s?.status === 'confirmed');
    historyToShow.forEach(session => {
      if (!session) return;
      if (session.raw_dictation) {
        historyMessages.push({ role: 'user', text: session.raw_dictation });
      }

      if (session.format === 'chat') {
        if (session.ai_response) {
          historyMessages.push({ role: 'assistant', type: 'chat', text: session.ai_response });
        }
        return;
      }

      const hasStructuredNote = session.status === 'confirmed' && session.structured_note;
      if (hasStructuredNote) {
        historyMessages.push({
          role: 'assistant',
          type: 'bot',
          noteData: {
            clinical_note: {
              structured_note: session.structured_note,
              detected_patterns: session.detected_patterns || [],
              alerts: session.alerts || [],
              session_id: String(session.id),
            },
            text_fallback: session.ai_response,
          },
          sessionId: String(session.id),
          readOnly: true,
        });
      } else if (session.ai_response) {
        historyMessages.push({
          role: 'assistant',
          type: 'bot',
          noteData: {
            clinical_note: null,
            text_fallback: session.ai_response,
            session_id: String(session.id),
          },
          sessionId: String(session.id),
          readOnly: false,
        });
      }
    });

    setMessages(historyMessages);
  };

  const loadEvolutionChat = async (patientId) => {
    setEvolutionLoading(true);
    try {
      const sessions = await getPatientSessions(patientId, 200);
      const chatSessions = sessions
        .filter(s => s.format === 'chat')
        .sort((a, b) => a.session_number - b.session_number);
      const messages = [];
      chatSessions.forEach(s => {
        messages.push({ role: 'user', content: s.raw_dictation });
        if (s.ai_response) messages.push({ role: 'agent', content: s.ai_response });
      });
      setEvolutionMessages(prev => new Map(prev).set(patientId, messages));
    } catch (err) {
      console.error('Error loading evolution chat:', err);
      setEvolutionMessages(prev => new Map(prev).set(patientId, []));
    } finally {
      setEvolutionLoading(false);
    }
  };

  const loadPatientProfile = async (patientId) => {
    try {
      const profile = await getPatientProfile(patientId);
      setPatientProfile(profile);
    } catch (err) {
      console.error('Error loading patient profile:', err);
      setPatientProfile(null);
    }
  };

  const handleEvolutionSend = async (text) => {
    if (!selectedPatientId || !text.trim()) return;
    const patientId = selectedPatientId;

    // Optimistic user append
    setEvolutionMessages(prev => {
      const current = prev.get(patientId) || [];
      return new Map(prev).set(patientId, [...current, { role: 'user', content: text }]);
    });
    setEvolutionSending(true);
    setEvolutionError(null);

    try {
      const { job_id } = await processSession(patientId, text, 'chat');

      const { openJobStream } = await import('./api');
      openJobStream(job_id, (job) => {
        if (job.status === 'completed') {
          setEvolutionMessages(prev => {
            const current = prev.get(patientId) || [];
            return new Map(prev).set(patientId, [...current, { role: 'agent', content: job.result.text_fallback || '' }]);
          });
          setEvolutionSending(false);
        } else if (job.status === 'failed') {
          setEvolutionError('Error: ' + (job.error || 'Desconocido'));
          setEvolutionSending(false);
        }
      }, (err) => {
        setEvolutionError('Anomalía de conexión.');
        setEvolutionSending(false);
      });
    } catch (err) {
      setEvolutionError('No se pudo enviar.');
      setEvolutionSending(false);
    }
  };

  const handleSelectConversation = async (conv) => {
    setActiveSection('patients');
    setSelectedPatientId(conv.patient_id);
    setSelectedPatientName(conv.patient_name);
    setSelectedPatientPortalStatus(conv.portal_status ?? null);
    fetchPatientSessions(conv.patient_id, conv.patient_name);
  };

  const handleDeleteConversation = async (sessionId, patientId) => {
    try {
      if (patientId) await archivePatientSessions(patientId);
      useDraft.clearDraftFor(patientId);
      setConversations(prev => prev.filter(c => c.patient_id !== patientId));
    } catch (err) {
      console.error("Error archiving conversation:", err);
    }
  };

  const handleSavePatient = async () => {
    // Legacy chat-style inline patient creation — deprecated.
    // PatientIntakeModal is the primary creation path (see handleModalPatientCreated).
    if (!newPatientName.trim()) return;
    alert("Por favor usa el botón Nuevo Paciente — ahora pide datos clínicos adicionales.");
    setIsCreatingPatient(true);
  };

  // Callback for PatientIntakeModal
  const handleModalPatientCreated = (patient) => {
    setIsCreatingPatient(false);
    loadPatientChat(patient.id, patient.name);
    setConversations(prev => [{
      id: null,
      patient_id: String(patient.id),
      patient_name: patient.name,
      session_number: null,
      session_date: null,
      dictation_preview: null,
      status: null,
      message_count: 0,
    }, ...prev]);
  };

  const handleToggleSession = (sessionId) => {
    setExpandedSessionId(prev => toggleExpandedSession(prev, sessionId));
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (mobileScrollRef.current) mobileScrollRef.current.scrollTop = mobileScrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (mobileTab === 'evolucion' && selectedPatientId) {
      if (!evolutionMessagesRef.current.has(selectedPatientId)) {
        loadEvolutionChat(selectedPatientId);
      }
      if (!patientProfile) {
        loadPatientProfile(selectedPatientId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileTab, selectedPatientId]);

  // Desktop: lazy load evolution cuando se activa modo Revisión
  useEffect(() => {
    if (desktopMode === 'review' && selectedPatientId) {
      if (!evolutionMessagesRef.current.has(selectedPatientId)) {
        loadEvolutionChat(selectedPatientId);
      }
      if (!patientProfile) {
        loadPatientProfile(selectedPatientId);
      }
    }
  }, [desktopMode, selectedPatientId]);

  useEffect(() => {
    localStorage.setItem('syquex_note_format', noteFormat);
  }, [noteFormat]);

  // Clear "Nueva" badge when patient changes
  useEffect(() => { setNewlyConfirmedSessionId(null); setDismissedOrphanIds(new Set()); }, [selectedPatientId]);
  useEffect(() => { setHistorialSearchQuery(''); }, [selectedPatientId]);

  const handleSendDictation = async (dictation) => {
    const activeFormat = noteFormat;
    setMessages(prev => [
      ...markPendingNotesReadOnly(prev),
      { role: 'user', text: dictation },
      { role: 'assistant', type: 'loading' }
    ]);
    if (activeFormat === 'soap' || activeFormat === 'custom') setMobileTab('nota');
    if (activeFormat === 'soap' || activeFormat === 'custom') setCurrentSessionNote({ type: 'loading' });

    try {
      const { job_id } = await processSession(selectedPatientId, dictation, activeFormat);
      clearDraft();

      const { openJobStream } = await import('./api');
      const closeStream = openJobStream(job_id, (job) => {
        setProcessingJobs(prev => new Map(prev).set(job_id, job));

        if (job.status === 'completed' || job.status === 'failed') {
          if (job.status === 'completed') {
            const noteData = job.result;
            const botMessage = (activeFormat === 'soap' || activeFormat === 'custom')
              ? { role: 'assistant', type: 'bot', noteData, sessionId: noteData.session_id }
              : { role: 'assistant', type: 'chat', text: noteData.text_fallback || '' };

            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.type === 'loading') return [...prev.slice(0, -1), botMessage];
              return prev;
            });

            if (activeFormat === 'soap' || activeFormat === 'custom') {
              setCurrentSessionNote({
                type: 'bot',
                noteData,
                sessionId: noteData.session_id,
                readOnly: false,
              });
            }
            fetchConversations();
          } else {
            const errorMsg = 'Error en el procesamiento: ' + (job.error || 'Desconocido');
            setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', type: 'error', text: errorMsg }]);
            if (activeFormat === 'soap' || activeFormat === 'custom') {
              setCurrentSessionNote({ type: 'error', text: errorMsg });
            }
          }
          setProcessingJobs(prev => {
            const next = new Map(prev);
            next.delete(job_id);
            return next;
          });
        }
      }, (err) => {
        console.error("Job stream error", err);
        const errorMsg = 'Error de conexión al procesar la nota. Por favor intenta de nuevo.';
        setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', type: 'error', text: errorMsg }]);
        if (activeFormat === 'soap' || activeFormat === 'custom') {
          setCurrentSessionNote({ type: 'error', text: errorMsg });
        }
      });

      // Track cleanup
      return closeStream;
    } catch (err) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', type: 'error', text: 'Error al iniciar proceso: ' + err.message }
      ]);
      if (activeFormat === 'soap' || activeFormat === 'custom') {
        setCurrentSessionNote({ type: 'error', text: 'Error al iniciar proceso: ' + err.message });
      }
    }
  };

  const handleResumeOrphan = (orphan) => {
    setDraft(orphan.raw_dictation);
    setDismissedOrphanIds(prev => new Set([...prev, String(orphan.id)]));
  };

  const handleDiscardOrphan = async (sessionId) => {
    setDismissedOrphanIds(prev => new Set([...prev, String(sessionId)]));
    try {
      await deleteSession(sessionId);
      if (selectedPatientId) fetchPatientSessions(selectedPatientId);
    } catch (err) {
      console.error("Error discarding orphan:", err);
      setDismissedOrphanIds(prev => { const next = new Set(prev); next.delete(String(sessionId)); return next; });
    }
  };


  const handleParseAvailability = async (text, referenceDate) => {
    const result = await parseAvailability(text, referenceDate);
    return result.slots;
  };

  const handleConfirmSlots = async (slots) => {
    const formatted = slots.map(s => ({
      slot_date: s.slot_date,
      start_time: s.start_time.substring(0, 5),
      duration_minutes: s.duration_minutes,
    }));
    const result = await createCalendarSlotsBatch(formatted);
    setAgendaCalendarKey(k => k + 1);
    setToast(`${result.created} horario${result.created !== 1 ? 's' : ''} creado${result.created !== 1 ? 's' : ''}`);
    setTimeout(() => setToast(null), 3500);
  };

  const isLoading = messages[messages.length - 1]?.type === 'loading';
  const hasActivePatient = !!selectedPatientId;
  const draftPatientIds = new Set(
    conversations.map(c => String(c.patient_id)).filter(useDraft.hasDraft)
  );

  const soapSessions = sessionHistory.filter(s => s.format !== 'chat');
  const confirmedSessions = soapSessions.filter(s => s.status === 'confirmed');
  const orphanedSessions = soapSessions.filter(s => s.status === 'draft' && !dismissedOrphanIds.has(String(s.id)));
  // Sequential display number per confirmed session (oldest = #1). Sessions come
  // oldest-first from the backend (asc), so index 0 = oldest → gets number 1.
  const confirmedDisplayNum = new Map(
    confirmedSessions.map((s, i) => [String(s.id), i + 1])
  );

  const filteredHistorialSessions = filterHistorialSessions(
    confirmedSessions,
    historialSearchQuery,
    confirmedDisplayNum
  );

  // Derive the latest note message for the note panel
  const latestNoteMsg = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === 'loading' || (m.type === 'bot' && m.noteData) || m.type === 'error') return m;
    }
    return null;
  })();

  // Screen manager — antes del return principal
  const { screen, resetToken, inviteToken } = authScreen;

  if (screen === 'loading') {
    return (
      <div className="min-h-screen bg-parchment flex items-center justify-center">
        <div className="text-ink-tertiary text-sm">Cargando…</div>
      </div>
    );
  }

  if (screen === 'reset-password') {
    return <ResetPasswordScreen token={resetToken} setScreen={(s) => setAuthScreen({ screen: s })} />;
  }
  if (screen === 'patient-reset') {
    return <PatientResetPassword resetToken={authScreen.resetToken} setScreen={(s) => setAuthScreen({ screen: s })} />;
  }
  if (screen === 'patient-login') {
    return <PatientLogin setScreen={(s) => setAuthScreen({ screen: s })} />;
  }
  if (screen === 'patient-invite') {
    return <PatientInviteAccept inviteToken={inviteToken} setScreen={(s) => setAuthScreen({ screen: s })} />;
  }
  if (screen === 'patient-portal') {
    return <PatientPortal />;
  }
  if (screen === 'login') {
    return <LoginScreen
      onSuccess={() => checkBillingAndRoute()}
      onRegister={() => { navigateTo('/registro'); setAuthScreen({ screen: 'register' }); }}
      onForgotPassword={() => { navigateTo('/forgot-password'); setAuthScreen({ screen: 'forgot-password' }); }}
    />;
  }
  if (screen === 'register') {
    return <RegisterScreen
      onSuccess={() => checkBillingAndRoute()}
      onLogin={() => { navigateTo('/'); setAuthScreen({ screen: 'login' }); }}
    />;
  }
  if (screen === 'forgot-password') {
    return <ForgotPasswordScreen
      onBack={() => { navigateTo('/'); setAuthScreen({ screen: 'login' }); }}
    />;
  }
  if (screen === 'billing') {
    return <BillingScreen
      onActivated={() => checkBillingAndRoute()}
    />;
  }

  // Onboarding Screen Logic
  if (!onboardingCompleted && template !== null) {
    if (template.fields?.length > 0) {
      // Auto-complete if they already have a template; sync format to match
      localStorage.setItem('syquex_onboarding_done', 'true');
      localStorage.setItem('syquex_note_format', 'custom');
      setOnboardingCompleted(true);
      setNoteFormat('custom');
    } else if (showNoteConfigurator) {
      return (
        <NoteConfigurator
          initialFields={[]}
          isFirstTime={true}
          onSave={async (fields) => {
            await saveTemplate(fields);
            setTemplate({ fields });
            setNoteFormat('custom');
            localStorage.setItem('syquex_onboarding_done', 'true');
            setOnboardingCompleted(true);
            setShowNoteConfigurator(false);
            if (localStorage.getItem('syquex_tutorial_done') !== 'true') {
              setTutorialVisible(true);
            }
          }}
          onCancel={() => {
            setShowNoteConfigurator(false);
          }}
        />
      );
    } else {
      return (
        <OnboardingScreen
          onSelectSoap={() => {
            setNoteFormat('soap');
            localStorage.setItem('syquex_onboarding_done', 'true');
            setOnboardingCompleted(true);
            if (localStorage.getItem('syquex_tutorial_done') !== 'true') {
              setTutorialVisible(true);
            }
          }}
          onSelectCustom={() => {
            setShowNoteConfigurator(true);
          }}
        />
      );
    }
  }

  return (
    <div className="h-screen bg-white font-sans flex flex-col overflow-hidden">
      {showNoteConfigurator && (
        <NoteConfigurator
          initialFields={template?.fields || []}
          isFirstTime={false}
          onSave={async (fields) => {
            await saveTemplate(fields);
            setTemplate({ fields });
            setNoteFormat('custom');
            setShowNoteConfigurator(false);
          }}
          onCancel={() => {
            setShowNoteConfigurator(false);
          }}
        />
      )}

      <PatientInviteModal
        open={!!invitingPatientId}
        patient={invitingPatientId ? { id: invitingPatientId, name: selectedPatientName } : null}
        onClose={() => setInvitingPatientId(null)}
        onSuccess={() => {
          setSelectedPatientPortalStatus('invited');
          setConversations(prev => prev.map(c =>
            c.patient_id === String(invitingPatientId) ? { ...c, portal_status: 'invited' } : c
          ));
        }}
        onStatusUpdate={(status) => {
          setSelectedPatientPortalStatus(status);
          setConversations(prev => prev.map(c =>
            c.patient_id === String(invitingPatientId) ? { ...c, portal_status: status } : c
          ));
        }}
      />

      {billingStatus?.status === 'trialing' && billingStatus?.days_remaining != null && (
        <TrialBanner
          daysRemaining={billingStatus.days_remaining}
          onActivate={async () => {
            const { checkout_url } = await createCheckout();
            window.location.href = checkout_url;
          }}
        />
      )}

      {/* Mobile slide-over sidebar */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={conversations}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onLogout={handleLogout}
        draftPatientIds={draftPatientIds}
        canCancelSubscription={billingStatus?.status === 'active' && !billingStatus?.cancel_at_period_end}
        onCancelSubscription={() => {
          setSidebarOpen(false); // Cerrar sidebar móvil antes de abrir modal
          setIsCancelModalOpen(true);
        }}
      />

      {/* ── DESKTOP LAYOUT (md+) ── */}
      <div className="hidden md:flex flex-1 overflow-hidden">

        {/* Left sidebar — patient list + agenda nav */}
        <div className="flex flex-col flex-shrink-0 border-r border-ink/[0.07]" style={{ width: '256px' }}>
          <div className="flex-1 overflow-hidden">
            <PatientSidebar
              conversations={conversations}
              selectedPatientId={selectedPatientId}
              onSelectConversation={handleSelectConversation}
              onDeleteConversation={handleDeleteConversation}
              onNewPatient={() => setIsCreatingPatient(true)}
              isCreatingPatient={isCreatingPatient}
              newPatientName={newPatientName}
              onNewPatientNameChange={(e) => setNewPatientName(e.target.value)}
              onSavePatient={handleSavePatient}
              onCancelNewPatient={() => { setIsCreatingPatient(false); setNewPatientName(''); }}
              draftPatientIds={draftPatientIds}
              canCancelSubscription={billingStatus?.status === 'active' && !billingStatus?.cancel_at_period_end}
              onCancelSubscription={() => setIsCancelModalOpen(true)}
            />
          </div>
          <div className="border-t border-ink/[0.07] p-3 flex-shrink-0 flex flex-col gap-1">
            <button
              onClick={() => setActiveSection(activeSection === 'agenda' ? 'patients' : 'agenda')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${activeSection === 'agenda'
                ? 'bg-[#5a9e8a]/10 text-[#5a9e8a]'
                : 'text-ink-secondary hover:bg-ink/[0.04] hover:text-ink'
                }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Mi Agenda
            </button>
            <button
              onClick={() => setActiveSection('profile')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${activeSection === 'profile'
                ? 'bg-[#5a9e8a]/10 text-[#5a9e8a]'
                : 'text-ink-secondary hover:bg-ink/[0.04] hover:text-ink'
                }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Mi Perfil
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-ink-secondary hover:bg-ink/[0.04] hover:text-ink"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Cerrar sesión
            </button>
            {billingStatus?.status === 'active' && !billingStatus?.cancel_at_period_end && (
              <button
                onClick={() => setIsCancelModalOpen(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-ink-secondary hover:bg-ink/[0.04] hover:text-ink"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                Cancelar suscripción
              </button>
            )}
          </div>
        </div>

        {/* Right work area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Agenda section */}
          {activeSection === 'agenda' && (
            <div className="flex-1 flex overflow-hidden min-h-0">
              <div className="w-80 flex-shrink-0 flex flex-col border-r border-black/[0.07] bg-[#f4f4f2]">
                <DictationPanel
                  value=""
                  onChange={() => { }}
                  onGenerate={() => { }}
                  loading={false}
                  panelMode="disponibilidad"
                  onParseAvailability={handleParseAvailability}
                  onConfirmSlots={handleConfirmSlots}
                />
              </div>
              <div className="flex-1 overflow-hidden">
                <CalendarScreen key={agendaCalendarKey} mode="inline" onClose={() => { }} />
              </div>
            </div>
          )}

          {activeSection === 'patients' && (<>
            {/* Patient header */}
            <PatientHeader
              patientName={hasActivePatient ? selectedPatientName : null}
              sessionCount={soapSessions.filter(s => s.status === 'confirmed').length}
              mode={desktopMode}
              onModeChange={hasActivePatient ? setDesktopMode : undefined}
              patientId={selectedPatientId}
              onEditPatient={(id) => setEditingPatientId(id)}
              onInvitePatient={(id) => setInvitingPatientId(id)}
              onShowTutorial={() => setTutorialVisible(true)}
              portalStatus={selectedPatientPortalStatus}
            />

            {/* Content area */}
            {!hasActivePatient ? (
              <EmptyState
                onOpenCalendar={() => setActiveSection('agenda')}
                onNewPatient={() => setIsCreatingPatient(true)}
              />
            ) : (
              /* Split: Dictation (320px) | Note (flex) */
              <div className="flex-1 flex overflow-hidden min-h-0">
                {desktopMode === 'session' ? (
                  <>
                    {/* Left: Dictation panel */}
                    <div className="w-80 flex-shrink-0 flex flex-col border-r border-black/[0.07] bg-[#f4f4f2]">
                      <DictationPanel
                        value={draft}
                        onChange={setDraft}
                        onGenerate={(d) => handleSendDictation(d)}
                        loading={isLoading}
                        orphanedSessions={orphanedSessions}
                        onResumeOrphan={handleResumeOrphan}
                        onDiscardOrphan={handleDiscardOrphan}
                        noteFormat={noteFormat}
                        onFormatChange={(format) => {
                          if (format === 'custom' && (!template?.fields || template.fields.length === 0)) {
                            setIsConfiguratorFirstTime(false);
                            setShowNoteConfigurator(true);
                          } else {
                            setNoteFormat(format);
                          }
                        }}
                        onEditTemplate={() => {
                          setIsConfiguratorFirstTime(false);
                          setShowNoteConfigurator(true);
                        }}
                      />

                    </div>

                    {/* Right: Note panel */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-7 bg-white">
                      {currentSessionNote === null ? (
                        NOTE_EMPTY_STATE
                      ) : currentSessionNote.type === 'loading' ? (
                        <div className="flex flex-col gap-3 py-6">
                          <div className="flex items-center gap-3">
                            {LOADING_DOTS}
                            <span className="text-ink text-[14px] font-medium">
                              {Array.from(processingJobs.values())[0]?.status === 'processing'
                                ? (Array.from(processingJobs.values())[0]?.progress || 'Procesando...')
                                : 'Iniciando generación...'}
                            </span>
                          </div>
                          <p className="text-ink-tertiary text-xs max-w-sm leading-relaxed">
                            Estamos analizando tu dictado con IA para generar una nota clínica precisa. Esto suele tomar de 10 a 20 segundos.
                          </p>
                        </div>
                      ) : currentSessionNote.type === 'error' ? (
                        <div className="bg-red-50 border border-red-200/80 text-red-700 rounded-xl p-4 text-sm">
                          <strong className="font-medium">Error:</strong> {currentSessionNote.text}
                        </div>
                      ) : currentSessionNote.type === 'bot' && currentSessionNote.noteData?.format === 'custom' ? (
                        <CustomNoteDocument
                          templateFields={currentSessionNote.noteData.template_fields || template?.fields || []}
                          values={currentSessionNote.noteData.custom_fields || {}}
                          onConfirm={async (editedValues) => {
                            const sid = currentSessionNote.noteData.session_id;
                            await confirmNote(sid, {
                              format: 'custom',
                              custom_fields: editedValues,
                            });
                            setNewlyConfirmedSessionId(sid);
                            fetchPatientSessions(selectedPatientId);
                            fetchConversations();
                            setDesktopMode('review');
                            setCurrentSessionNote(null);
                            setToast('Sesión confirmada — nota guardada en historial');
                            setTimeout(() => setToast(null), 3500);
                          }}
                          onDelete={async () => {
                            const sid = currentSessionNote.noteData.session_id;
                            await deleteSession(sid);
                            setCurrentSessionNote(null);
                            fetchPatientSessions(selectedPatientId);
                          }}
                        />
                      ) : currentSessionNote.type === 'bot' && currentSessionNote.noteData ? (
                        <SoapNoteDocument
                          noteData={currentSessionNote.noteData}
                          onConfirm={async () => {
                            const sid = currentSessionNote.noteData?.session_id || currentSessionNote.sessionId;
                            if (sid) setNewlyConfirmedSessionId(sid);
                            fetchPatientSessions(selectedPatientId);
                            fetchConversations();
                            setDesktopMode('review');
                            setCurrentSessionNote(null);
                            setToast('Sesión confirmada — nota guardada en historial');
                            setTimeout(() => setToast(null), 3500);
                          }}
                          readOnly={currentSessionNote.readOnly}
                          onDelete={!currentSessionNote.readOnly ? async () => {
                            const sid = currentSessionNote.noteData?.session_id || currentSessionNote.noteData?.clinical_note?.session_id || currentSessionNote.sessionId;
                            if (!sid) return;
                            await deleteSession(sid);
                            setCurrentSessionNote(null);
                            fetchPatientSessions(selectedPatientId);
                          } : undefined}
                        />
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Mode: Review */}
                    {/* Left: Historial (380px wide in Review mode) */}
                    <div className="w-[380px] flex-shrink-0 flex flex-col border-r border-black/[0.07] bg-[#f4f4f2] overflow-y-auto px-5 py-6">
                      <p className="text-[10px] font-bold uppercase tracking-[0.10em] text-ink-muted mb-4 px-2">Historial de Notas</p>

                      {/* Session search input */}
                      <div className="px-2 mb-3">
                        <div className="relative flex items-center">
                          <input
                            ref={historialSearchDesktopRef}
                            type="text"
                            placeholder="Buscar por sesión, fecha o palabra..."
                            maxLength={80}
                            value={historialSearchQuery}
                            onChange={e => setHistorialSearchQuery(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Escape') {
                                if (historialSearchQuery) {
                                  setHistorialSearchQuery('');
                                } else {
                                  e.currentTarget.blur();
                                }
                              }
                            }}
                            className="w-full bg-white border border-black/[0.1] rounded-lg px-3 py-1.5 text-sm text-[#18181b] placeholder:text-ink-tertiary focus:outline-none focus:border-[#5a9e8a]/60 transition-colors pr-7"
                          />
                          {historialSearchQuery && (
                            <button
                              onClick={() => { setHistorialSearchQuery(''); historialSearchDesktopRef.current?.focus(); }}
                              aria-label="Limpiar búsqueda"
                              className="absolute right-2 text-ink-tertiary hover:text-ink p-0.5 rounded transition-colors"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {sessionsLoading ? (
                          <div className="flex flex-col items-center gap-2 py-8">
                            {LOADING_DOTS}
                            <p className="text-ink-tertiary text-[11px] uppercase tracking-wider">Cargando historial...</p>
                          </div>
                        ) : confirmedSessions.length === 0 ? (
                          <p className="text-ink-tertiary text-xs px-2 italic">Sin notas SOAP confirmadas.</p>
                        ) : filteredHistorialSessions.length === 0 ? (
                          <p className="text-ink-tertiary text-[13px] text-center py-6">Sin resultados</p>
                        ) : (
                          filteredHistorialSessions.map((s, i) => {
                            const isExpanded = reviewExpandedSessionId === String(s.id);
                            const isCustom = s.format === 'custom';
                            const hasNote = s.status === 'confirmed' && (
                              s.structured_note ||
                              (s.custom_fields && Object.keys(s.custom_fields).length > 0)
                            );
                            return (
                              <div
                                key={s.id || i}
                                className={`rounded-xl overflow-hidden transition-all duration-200 bg-white border-l-[3px] ${s.status === 'confirmed' ? 'border-l-[#5a9e8a]' : 'border-l-[#c4935a]'
                                  } ${isExpanded ? 'ring-1 ring-[#5a9e8a]/20' : ''}`}
                              >
                                <div
                                  className="px-3 py-3 flex items-start gap-3 cursor-pointer group"
                                  onClick={() => hasNote && setReviewExpandedSessionId(toggleExpandedSession(reviewExpandedSessionId, String(s.id)))}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-1.5">
                                        <p className="text-[13px] font-semibold text-ink">Sesión #{confirmedDisplayNum.get(String(s.id)) ?? i + 1}</p>
                                        {String(s.id) === newlyConfirmedSessionId && (
                                          <span className="text-[9px] font-bold bg-[#5a9e8a] text-white rounded-full px-2 py-0.5">
                                            Nueva
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[11px] text-ink-tertiary font-medium">{formatDate(s.session_date)}</span>
                                    </div>
                                    {!isExpanded && s.raw_dictation && (
                                      <>
                                        <p className="text-[11px] text-ink-muted line-clamp-2 mt-0.5 leading-relaxed">
                                          {s.raw_dictation}
                                        </p>
                                        <span className={`inline-block mt-1 text-[10px] font-medium uppercase tracking-wide ${s.status === 'confirmed' ? 'text-[#5a9e8a]' : 'text-[#c4935a]'
                                          }`}>
                                          {s.status === 'confirmed' ? 'Confirmada' : 'Pendiente'}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  {hasNote && (
                                    <svg
                                      className={`w-4 h-4 mt-0.5 text-ink-tertiary group-hover:text-ink-secondary transition-transform duration-200 ${isExpanded ? 'rotate-180 text-[#5a9e8a]' : ''}`}
                                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  )}
                                </div>
                                {isExpanded && hasNote && (
                                  <div className="bg-white border-t border-ink/[0.04]">
                                    {isCustom ? (
                                      <CustomNoteDocument
                                        templateFields={s.template_fields || template?.fields || []}
                                        values={s.custom_fields || {}}
                                        readOnly
                                      />
                                    ) : (
                                      <SoapNoteDocument
                                        noteData={{
                                          clinical_note: {
                                            structured_note: s.structured_note,
                                            detected_patterns: s.detected_patterns || [],
                                            alerts: s.alerts || [],
                                            session_id: String(s.id),
                                          },
                                          text_fallback: s.ai_response,
                                        }}
                                        readOnly
                                        compact
                                      />
                                    )}
                                    <PatientSummarySection
                                      sessionId={String(s.id)}
                                      patientName={selectedPatientName}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Right: Evolution Area */}
                    <div className="flex-1 flex flex-col bg-white overflow-hidden">
                      <EvolucionPanel
                        patient={{ id: selectedPatientId, name: selectedPatientName }}
                        messages={evolutionMessages.get(selectedPatientId) || []}
                        profile={patientProfile}
                        loading={evolutionLoading}
                        onSend={handleEvolutionSend}
                        sending={evolutionSending}
                        error={evolutionError}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </>)}
        </div>
      </div>

      {/* ── MOBILE LAYOUT (<md) ── */}
      <div className="md:hidden flex-1 flex flex-col overflow-hidden">

        {/* Mobile top bar */}
        <header className="px-4 py-3 border-b border-ink/[0.07] bg-white flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg text-ink-secondary hover:text-ink hover:bg-ink/[0.05] transition-colors flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="font-semibold text-[#18181b] text-[15px] tracking-tight">SyqueX</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTutorialVisible(true)}
              className="w-8 h-8 rounded-full border border-ink/[0.07] text-ink-muted hover:text-ink hover:bg-ink/[0.05] transition-colors flex items-center justify-center flex-shrink-0"
              aria-label="Abrir tutorial"
            >
              ?
            </button>
          </div>
        </header>

        {activeSection === 'patients' && (<>
          {/* No patient selected — empty state */}
          {!hasActivePatient && <EmptyState onOpenCalendar={() => setActiveSection('agenda')} onNewPatient={() => setIsCreatingPatient(true)} />}

          {/* Patient active — strip + tabs */}
          {hasActivePatient && (
            <div className="flex flex-col flex-1 min-h-0">

              {/* Patient strip */}
              <PatientHeader
                patientName={selectedPatientName}
                sessionCount={confirmedSessions.length}
                compact
                patientId={selectedPatientId}
                onEditPatient={(id) => setEditingPatientId(id)}
                onInvitePatient={(id) => setInvitingPatientId(id)}
                portalStatus={selectedPatientPortalStatus}
              />

              {/* Tab nav */}
              <div className="flex border-b border-ink/[0.07] bg-white flex-shrink-0">
                {[
                  { id: 'escribir', label: 'Escribir' },
                  { id: 'nota', label: 'Nota' },
                  { id: 'historial', label: 'Historial' },
                  { id: 'evolucion', label: 'Evolución' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setMobileTab(id)}
                    className={`flex-1 py-3 text-[12px] font-medium transition-colors border-b-2 ${mobileTab === id
                      ? 'border-[#5a9e8a] text-[#5a9e8a]'
                      : 'border-transparent text-ink-secondary hover:text-ink'
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab: Escribir */}
              {mobileTab === 'escribir' && (
                <div className="flex flex-col flex-1 min-h-0 bg-[#f4f4f2]">
                  <DictationPanel
                    value={draft}
                    onChange={setDraft}
                    onGenerate={(d) => handleSendDictation(d)}
                    loading={isLoading}
                    orphanedSessions={orphanedSessions}
                    onResumeOrphan={handleResumeOrphan}
                    onDiscardOrphan={handleDiscardOrphan}
                    noteFormat={noteFormat}
                    onFormatChange={(format) => {
                      if (format === 'custom' && (!template?.fields || template.fields.length === 0)) {
                        setIsConfiguratorFirstTime(false);
                        setShowNoteConfigurator(true);
                      } else {
                        setNoteFormat(format);
                      }
                    }}
                    onEditTemplate={() => {
                      setIsConfiguratorFirstTime(false);
                      setShowNoteConfigurator(true);
                    }}
                  />
                </div>
              )}

              {/* Tab: Nota */}
              {mobileTab === 'nota' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div ref={mobileScrollRef} className="flex-1 overflow-y-auto px-4 py-5">
                    {currentSessionNote === null ? (
                      NOTE_EMPTY_STATE
                    ) : currentSessionNote.type === 'loading' ? (
                      <div className="flex flex-col gap-2 py-4">
                        <div className="flex gap-2 items-center">
                          {[0, 0.2, 0.4].map((d, i) => (
                            <div key={i} className="w-2 h-2 rounded-full bg-sage/60 animate-pulse" style={{ animationDelay: `${d}s` }} />
                          ))}
                          <span className="text-ink text-sm font-medium">
                            {Array.from(processingJobs.values())[0]?.status === 'processing'
                              ? (Array.from(processingJobs.values())[0]?.progress || 'Procesando...')
                              : 'Iniciando generación...'}
                          </span>
                        </div>
                        <p className="text-ink-tertiary text-xs leading-relaxed">
                          Analizando dictado con IA. Esto suele tomar 15 segundos.
                        </p>
                      </div>
                    ) : currentSessionNote.type === 'error' ? (
                      <div className="bg-red-50 border border-red-200/80 text-red-700 rounded-xl p-4 text-sm">
                        <strong>Error:</strong> {currentSessionNote.text}
                      </div>
                    ) : currentSessionNote.type === 'bot' && currentSessionNote.noteData?.format === 'custom' ? (
                      <CustomNoteDocument
                        templateFields={currentSessionNote.noteData.template_fields || template?.fields || []}
                        values={currentSessionNote.noteData.custom_fields || {}}
                        onConfirm={async (editedValues) => {
                          const sid = currentSessionNote.noteData.session_id;
                          await confirmNote(sid, {
                            format: 'custom',
                            custom_fields: editedValues,
                          });
                          setNewlyConfirmedSessionId(sid);
                          fetchPatientSessions(selectedPatientId);
                          fetchConversations();
                          setCurrentSessionNote(null);
                          setToast('Sesión confirmada — nota guardada en historial');
                          setTimeout(() => setToast(null), 3500);
                        }}
                        onDelete={async () => {
                          const sid = currentSessionNote.noteData.session_id;
                          await deleteSession(sid);
                          setCurrentSessionNote(null);
                          fetchPatientSessions(selectedPatientId);
                        }}
                      />
                    ) : currentSessionNote.type === 'bot' && currentSessionNote.noteData ? (
                      <SoapNoteDocument
                        noteData={currentSessionNote.noteData}
                        onConfirm={async () => {
                          const sid = currentSessionNote.noteData?.session_id || currentSessionNote.sessionId;
                          if (sid) setNewlyConfirmedSessionId(sid);
                          fetchPatientSessions(selectedPatientId);
                          fetchConversations();
                          setCurrentSessionNote(null);
                          setToast('Sesión confirmada — nota guardada en historial');
                          setTimeout(() => setToast(null), 3500);
                        }}
                        readOnly={currentSessionNote.readOnly}
                        onDelete={!currentSessionNote.readOnly ? async () => {
                          const sid = currentSessionNote.noteData?.session_id || currentSessionNote.noteData?.clinical_note?.session_id || currentSessionNote.sessionId;
                          if (!sid) return;
                          await deleteSession(sid);
                          setCurrentSessionNote(null);
                          fetchPatientSessions(selectedPatientId);
                        } : undefined}
                      />
                    ) : null}
                  </div>
                </div>
              )}

              {/* Tab: Historial */}
              {mobileTab === 'historial' && (
                <div className="flex-1 flex flex-col min-h-0">

                  {/* Sticky search bar */}
                  <div className="px-4 py-2 border-b border-ink/[0.05] flex-shrink-0 bg-white">
                    <div className="relative flex items-center">
                      <input
                        ref={historialSearchMobileRef}
                        type="text"
                        placeholder="Buscar por sesión, fecha o palabra..."
                        maxLength={80}
                        value={historialSearchQuery}
                        onChange={e => setHistorialSearchQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') {
                            if (historialSearchQuery) {
                              setHistorialSearchQuery('');
                            } else {
                              e.currentTarget.blur();
                            }
                          }
                        }}
                        className="w-full bg-white border border-black/[0.1] rounded-lg px-3 py-1.5 text-sm text-[#18181b] placeholder:text-ink-tertiary focus:outline-none focus:border-[#5a9e8a]/60 transition-colors pr-7"
                      />
                      {historialSearchQuery && (
                        <button
                          onClick={() => { setHistorialSearchQuery(''); historialSearchMobileRef.current?.focus(); }}
                          aria-label="Limpiar búsqueda"
                          className="absolute right-2 text-ink-tertiary hover:text-ink p-0.5 rounded transition-colors"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Scrollable session list */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {confirmedSessions.length === 0 ? (
                      <p className="text-ink-tertiary text-[14px] text-center mt-10">Sin sesiones registradas aún.</p>
                    ) : filteredHistorialSessions.length === 0 ? (
                      <p className="text-ink-tertiary text-[13px] text-center py-6">Sin resultados</p>
                    ) : (
                      <div className="space-y-2">
                        {filteredHistorialSessions.map((s, i) => {
                        const isExpanded = expandedSessionId === String(s.id);
                        const isCustom = s.format === 'custom';
                        const hasNote = s.status === 'confirmed' && (
                          s.structured_note ||
                          (s.custom_fields && Object.keys(s.custom_fields).length > 0)
                        );
                        return (
                          <div
                            key={s.id || i}
                            className={`rounded-xl overflow-hidden transition-all ${isExpanded
                              ? 'bg-[#fafaf9] border-[1.5px] border-[#5a9e8a]/25'
                              : 'bg-[#f4f4f2]'
                              }`}
                          >
                            <div
                              className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-black/[0.02] transition-colors"
                              onClick={() => hasNote && handleToggleSession(String(s.id))}
                            >
                              <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${s.status === 'confirmed' ? 'bg-[#5a9e8a]' : 'bg-[#c4935a]'}`} />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium text-ink">
                                  Sesión #{confirmedDisplayNum.get(String(s.id)) ?? '—'} · {formatDate(s.session_date)}
                                </p>
                                {s.raw_dictation && (
                                  <p className="text-[12px] text-ink-muted mt-0.5 line-clamp-2">{s.raw_dictation}</p>
                                )}
                                <span className={`inline-block mt-1 text-[10px] font-medium uppercase tracking-wide ${s.status === 'confirmed' ? 'text-[#5a9e8a]' : 'text-[#c4935a]'}`}>
                                  {s.status === 'confirmed' ? 'Confirmada' : 'Pendiente'}
                                </span>
                              </div>
                              {hasNote && (
                                <svg
                                  className={`w-4 h-4 mt-1 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180 text-[#5a9e8a]' : 'text-[#9ca3af]'}`}
                                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 9l6 6 6-6" />
                                </svg>
                              )}
                            </div>
                            {isExpanded && hasNote && (
                              <div className="border-t border-ink/[0.06]">
                                {isCustom ? (
                                  <CustomNoteDocument
                                    templateFields={s.template_fields || template?.fields || []}
                                    values={s.custom_fields || {}}
                                    readOnly
                                  />
                                ) : (
                                  <SoapNoteDocument
                                    noteData={{
                                      clinical_note: {
                                        structured_note: s.structured_note,
                                        detected_patterns: s.detected_patterns || [],
                                        alerts: s.alerts || [],
                                        session_id: String(s.id),
                                      },
                                      text_fallback: s.ai_response,
                                    }}
                                    readOnly
                                    compact
                                  />
                                )}
                                <PatientSummarySection
                                  sessionId={String(s.id)}
                                  patientName={selectedPatientName}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  </div>
                </div>
              )}

              {/* Tab: Evolución */}
              {mobileTab === 'evolucion' && (
                <EvolucionPanel
                  patient={{ id: selectedPatientId, name: selectedPatientName }}
                  messages={evolutionMessages.get(selectedPatientId) || []}
                  profile={patientProfile}
                  loading={evolutionLoading}
                  onSend={handleEvolutionSend}
                  sending={evolutionSending}
                  error={evolutionError}
                />
              )}

            </div>
          )}
        </>)}

        {activeSection === 'agenda' && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex border-b border-ink/[0.07] bg-white flex-shrink-0">
              {['disponibilidad', 'calendario'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setAgendaMobileTab(tab)}
                  className={`flex-1 py-3 text-[12px] font-medium transition-colors border-b-2 capitalize ${agendaMobileTab === tab
                    ? 'border-[#5a9e8a] text-[#5a9e8a]'
                    : 'border-transparent text-ink-secondary hover:text-ink'
                    }`}
                >
                  {tab === 'disponibilidad' ? 'Disponibilidad' : 'Calendario'}
                </button>
              ))}
            </div>
            {agendaMobileTab === 'disponibilidad' && (
              <div className="flex flex-col flex-1 min-h-0 bg-[#f4f4f2]">
                <DictationPanel
                  value=""
                  onChange={() => { }}
                  onGenerate={() => { }}
                  loading={false}
                  panelMode="disponibilidad"
                  onParseAvailability={handleParseAvailability}
                  onConfirmSlots={handleConfirmSlots}
                />
              </div>
            )}
            {agendaMobileTab === 'calendario' && (
              <div className="flex-1 overflow-hidden">
                <CalendarScreen key={agendaCalendarKey} mode="inline" onClose={() => { }} />
              </div>
            )}
          </div>
        )}

        {activeSection === 'profile' && (
          <div className="flex flex-col flex-1 min-h-0">
            <ProfileScreen />
          </div>
        )}

        <BottomNav
          activeSection={activeSection}
          onSectionChange={(section) => {
            setActiveSection(section);
            if (section === 'patients') setSelectedPatientId(null);
          }}
        />
      </div>



      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#18181b] text-white text-[13px] font-medium px-5 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Calendar Screen (Psychologist native agenda) */}
      {calendarOpen && <CalendarScreen onClose={() => setCalendarOpen(false)} />}

      {/* PatientIntakeModal — crear o editar expediente */}
      <PatientIntakeModal
        open={isCreatingPatient || editingPatientId != null}
        mode={editingPatientId != null ? 'edit' : 'create'}
        initialPatient={editingPatientId != null ? { id: editingPatientId } : null}
        onClose={() => {
          setIsCreatingPatient(false);
          setEditingPatientId(null);
        }}
        onSaved={(patient) => {
          if (editingPatientId != null) {
            // EDIT — update conversation entry with fresh name
            setConversations((prev) => prev.map((c) =>
              c.patient_id === String(patient.id) ? { ...c, patient_name: patient.name } : c
            ));
            setEditingPatientId(null);
          } else {
            // CREATE
            handleModalPatientCreated(patient);
          }
        }}
      />

      <TutorialModal
        visible={tutorialVisible}
        onClose={() => setTutorialVisible(false)}
        isMobile={isMobile}
        noteFormat={noteFormat}
      />

      <CancelSubscriptionModal
        open={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        onConfirm={handleCancelSubscription}
        loading={isCancelling}
        error={cancelError}
        periodEnd={billingStatus?.period_end}
      />

    </div>
  );
}

export default App
