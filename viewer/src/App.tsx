/**
 * App.tsx — Root shell for Eve Os: Triage
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │  Topbar  (title · tab-bar · clock · badges) │
 *   ├─────────────────────────────────────────────┤
 *   │  Tab Content  (conditional per active tab)  │
 *   │  ─ Tasks       → TaskBoard                  │
 *   │  ─ Comms       → CommsPanel                 │
 *   │  ─ Network     → NetworkTab  (always mounted)│
 *   │  ─ Reference   → Sidebar + Search + Detail  │
 *   │  ─ Intake      → PatientIntake / MassCas    │
 *   │  ─ Ward Map    → WardMap                    │
 *   │  ─ Inventory   → InventoryTab               │
 *   │  ─ Records     → PatientRecordsTab (leader) │
 *   └─────────────────────────────────────────────┘
 *
 * NetworkTab is always mounted (display:none when inactive) so the
 * WebSocket connection persists across tab switches.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Section } from './types';
import DetailView from './components/DetailView';
import PatientIntake from './components/PatientIntake';
import MassCasIntake from './components/MassCasIntake';
import TaskBoard from './components/TaskBoard';
import CommsPanel from './components/CommsPanel';
import OnboardingWizard from './components/OnboardingWizard';
import WardMap from './components/WardMap';
import InventoryTab from './components/InventoryTab';
import NetworkTab from './components/NetworkTab';
import TriagePanel from './components/TriagePanel';
import DistributionTab from './components/DistributionTab';
import PublicLookup from './components/PublicLookup';
import { NeuralScanReport } from './components/NeuralScanReport';
import { ChildrensTab } from './components/ChildrensTab';
import { useWebRTC } from './hooks/useWebRTC';
import { api, isNative, resolveUrl } from './services/api';

import { PowerProvider, usePower } from './services/PowerContext';
import { LangProvider, useT } from './services/i18n';
import './index.css';


// ─────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────

/** Tab identifiers — used for state and conditional rendering */
type Tab = 'tasks' | 'comms' | 'intake' | 'ward' | 'inventory' | 'settings' | 'childrens';

/** Supported languages — en + 40 translation targets */
const LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ar', name: 'العربية' },
  { code: 'am', name: 'አማርኛ' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fa', name: 'فارسی' },
  { code: 'fr', name: 'Français' },
  { code: 'ha', name: 'Hausa' },
  { code: 'he', name: 'עברית' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ig', name: 'Igbo' },
  { code: 'it', name: 'Italiano' },
  { code: 'ja', name: '日本語' },
  { code: 'jw', name: 'Basa Jawa' },
  { code: 'km', name: 'ខ្មែរ' },
  { code: 'ko', name: '한국어' },
  { code: 'ku', name: 'Kurdî' },
  { code: 'la', name: 'Latina' },
  { code: 'mg', name: 'Malagasy' },
  { code: 'mr', name: 'मराठी' },
  { code: 'my', name: 'မြန်မာ' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'ps', name: 'پښتو' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'so', name: 'Soomaali' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'th', name: 'ไทย' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'uk', name: 'Українська' },
  { code: 'ur', name: 'اردو' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'xh', name: 'isiXhosa' },
  { code: 'yo', name: 'Yorùbá' },
  { code: 'zh', name: '中文' },
  { code: 'zu', name: 'isiZulu' },
];

/** Reference sidebar navigation items */
const NAV: { id: Section; labelKey: string; count?: string }[] = [
  { id: 'assessments', labelKey: 'nav.assessments', count: '6' },
  { id: 'procedures', labelKey: 'nav.procedures', count: '11' },
  { id: 'pharmacology', labelKey: 'nav.pharmacology', count: '20' },
  { id: 'protocols', labelKey: 'nav.protocols', count: '2' },
  { id: 'special_populations', labelKey: 'nav.special_populations', count: '4' },
];

/** Loads all JSON files for a given reference section in the specified language.
 *  Falls back to en.json if the target language file is not found. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSection(section: Section, lang = 'en'): Promise<any[]> {
  const manifests: Record<string, string[][]> = {
    assessments: [
      ['gcs'], ['avpu'], ['hemorrhage-class'], ['shock-index'], ['salt-triage'],
      ['dehydration-assessment'],
    ],
    procedures: [
      ['direct-pressure'], ['wound-packing'], ['tourniquet-application'],
      ['needle-decompression'], ['chest-seal-application'],
      ['airway-management-npa'], ['hypothermia-prevention'],
      ['improvised-splinting'], ['patient-movement-techniques'],
      ['heat-injury-management'], ['cold-injury-management'],
    ],
    pharmacology: [
      ['txa'], ['ketamine'], ['morphine'], ['naloxone'], ['epinephrine'],
      ['amoxicillin'], ['doxycycline'], ['ciprofloxacin'], ['metronidazole'],
      ['cefazolin'], ['lorazepam'], ['midazolam'], ['diazepam'], ['aspirin'],
      ['ondansetron'], ['dexamethasone'], ['normal-saline'], ['lactated-ringers'],
      ['oxytocin'], ['magnesium-sulfate'],
    ],
    protocols: [['march'], ['medevac-9line']],
    special_populations: [
      ['pediatric', 'vital-sign-ranges'],
      ['pediatric', 'broselow-tape'],
      ['obstetric', 'field-delivery'],
      ['obstetric', 'perimortem-csection'],
    ],
    conditions: [],
  };

  const paths = manifests[section];
  const results = await Promise.all(
    paths.map(async parts => {
      const base = `/data/${section}/${parts.join('/')}`;
      // Try translated file first, fall back to English
      if (lang !== 'en') {
        try {
          const r = await fetch(`${base}/${lang}.json`);
          if (r.ok) return await r.json();
        } catch { /* fall through */ }
      }
      return fetch(`${base}/en.json`).then(r => r.json()).catch(() => null);
    })
  );
  return results.filter(Boolean);
}

/** Common full-tab wrapper style */
const fullTab: React.CSSProperties = {
  gridColumn: '1 / -1', display: 'flex', flexDirection: 'column',
  height: '100%', overflow: 'hidden', position: 'relative',
};


// ─────────────────────────────────────────────────────────────────────
// Sub-components (Reference tab lists)
// ─────────────────────────────────────────────────────────────────────



/** Generic list for small sections (assessments, procedures, etc.) */
function SmallList({
  items, query, selected, onSelect, labelKey = 'name', subKey = 'category'
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[];
  query: string;
  selected: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSelect: (item: any) => void;
  labelKey?: string;
  subKey?: string;
}) {
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return items;
    return items.filter(i =>
      String(i[labelKey] ?? '').toLowerCase().includes(q) ||
      String(i[subKey] ?? '').toLowerCase().includes(q)
    );
  }, [items, query, labelKey, subKey]);

  return (
    <div className="list-pane">
      {filtered.map(item => (
        <div
          key={item.id}
          className={`list-item ${selected === item.id ? 'selected' : ''}`}
          onClick={() => onSelect(item)}
        >
          <div className="item-body">
            <div className="item-name">{item[labelKey]}</div>
            {item[subKey] && <div className="item-sub">{item[subKey]}</div>}
            {item.skill_level && <div className="item-sub">{item.skill_level}</div>}
            {item.time_estimate && <div className="item-sub">{item.time_estimate}</div>}
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div style={{ padding: '24px', fontSize: 12, color: 'var(--text-faint)', textAlign: 'center' }}>
          No results
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// App — root component (wraps AppInner with PowerProvider)
// ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <LangProvider>
      <AppOuter />
    </LangProvider>
  );
}

/** AppOuter — inside LangProvider so useT() works */
function AppOuter() {
  const { lang, setLang: changeLang } = useT();

  // Auto-navigate to network tab if URL has QR join params (?name=X&role=Y)
  // Check both URL params AND sessionStorage flag (set by inline script in index.html)
  const hasQRParams = !!(new URLSearchParams(window.location.search).get('name')) || !!sessionStorage.getItem('eve-qr-join');
  const meshMode = localStorage.getItem('eve-mesh-mode') || '';

  // ── Ghost lockdown: require BOTH name AND mode (leader/client) ──
  // Shows spinner on load, then setup screen or full app.
  const _isSetupComplete = () => {
    const name = (localStorage.getItem('eve-mesh-name') || '').trim();
    const mode = (localStorage.getItem('eve-mesh-mode') || '').trim();
    return !!(name && mode && mode !== 'setup');
  };
  const [authState, setAuthState] = useState<'loading' | 'setup' | 'ready'>('loading');
  const [modelsReady, setModelsReady] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{llm_ready?: boolean; llm_model?: string; tts_ready?: boolean; stt_ready?: boolean; translation_ready?: boolean} | null>(null);
  const [tab, setTab] = useState<Tab>(hasQRParams ? 'settings' : 'tasks');

  // Initial identity check + model health gate
  useEffect(() => {
    // Check identity immediately
    const timer = setTimeout(() => {
      setAuthState(_isSetupComplete() ? 'ready' : 'setup');
    }, 400);

    // Poll health for model readiness
    let cancelled = false;
    const pollHealth = async () => {
      let failures = 0;
      while (!cancelled) {
        try {
          // Try Rust invoke first (preferred in Tauri)
          let data: Record<string, unknown> | null = null;
          if (isNative) {
            const inv = await import('@tauri-apps/api/core').catch(() => null);
            if (inv) {
              try { data = await inv.invoke('get_health') as Record<string, unknown>; } catch { /* fallback */ }
            }
          }
          // Fall back to HTTP
          if (!data) {
            const res = await fetch(resolveUrl('/health'));
            if (res.ok) data = await res.json();
          }

          if (data && !cancelled) {
            setHealthStatus(data as typeof healthStatus);
            // Check Rust field names (llm_ready, stt_ready) OR legacy Python names (gguf, whisper)
            const ready = !!(data.llm_ready || (data as Record<string, unknown>).gguf);
            const hasStt = !!(data.stt_ready || (data as Record<string, unknown>).whisper);
            if (ready || hasStt) {
              setModelsReady(true);
              return;
            }
          } else {
            failures++;
          }
        } catch {
          failures++;
        }
        // After 5 failed attempts, let the app load anyway
        if (failures >= 5 && !cancelled) {
          console.warn('[Health] Proceeding without model confirmation after', failures, 'failures');
          setModelsReady(true);
          return;
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    };
    pollHealth();

    return () => { clearTimeout(timer); cancelled = true; };
  }, []);

  // Poll for setup completion while on setup screen
  useEffect(() => {
    if (authState !== 'setup') return;
    const poll = setInterval(() => {
      if (_isSetupComplete()) {
        setAuthState('ready');
        setTab('tasks');
      }
    }, 500);
    return () => clearInterval(poll);
  }, [authState]);

  // ── Reference-tab state ──
  const [section, setSection] = useState<Section>('assessments');
  const [query, setQuery] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sectionData, setSectionData] = useState<Record<string, any[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [detail, setDetail] = useState<any | null>(null);


  // ── Global UI state ──
  const [clock, setClock] = useState('');
  const [massCas, setMassCas] = useState(false);

  // Clock tick
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);


  // Load small sections on demand (re-fetch when language changes)
  useEffect(() => {
    if (sectionData[section]) return;
    loadSection(section, lang).then(data => {
      setSectionData(prev => ({ ...prev, [section]: data }));
    });
  }, [section, sectionData, lang]);

  // Clear cached data when language changes (derived state pattern)
  const [prevLang, setPrevLang] = useState(lang);
  if (lang !== prevLang) {
    setPrevLang(lang);
    setSectionData({});
    setDetail(null);
  }

  // Clear query and selection on section change (derived state pattern)
  const [prevSection, setPrevSection] = useState(section);
  if (section !== prevSection) {
    setPrevSection(section);
    setQuery('');
    setSelectedId(null);
    setDetail(null);
  }



  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSmallSelect = useCallback((item: any) => {
    setSelectedId(item.id);
    setDetail(item);
  }, []);

  const currentSection = sectionData[section] ?? [];

  // ── /lookup — public family-facing search page ──
  if (window.location.pathname === '/lookup') {
    return (
      <LangProvider>
        <PublicLookup />
      </LangProvider>
    );
  }

  // ── Loading / Model Init Splash ──
  if (authState === 'loading' || !modelsReady) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d1117' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{
            width: 56, height: 56, border: '3px solid #222', borderTop: '3px solid #3fb950',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px',
          }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e6edf3', marginBottom: 8, letterSpacing: '-0.02em' }}>HALT</div>
          <div style={{ fontSize: 12, color: '#6e7681', fontWeight: 500, letterSpacing: '0.06em', marginBottom: 24 }}>
            {authState === 'loading' ? 'Checking identity…' : 'Waiting for models…'}
          </div>
          {healthStatus && (
            <div style={{ textAlign: 'left', padding: '14px 18px', background: '#161b22', borderRadius: 8, border: '1px solid #30363d', fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
              
              {/* Models Section */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Models</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: healthStatus.llm_ready ? '#3fb950' : '#f0a500' }}>●</span>
                  <span style={{ color: '#c9d1d9' }}>LLM (GGUF): <span style={{ color: '#8b949e' }}>{healthStatus.llm_ready ? `✓ ${healthStatus.llm_model || 'Ready'}` : 'Loading…'}</span></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: healthStatus.translation_ready ? '#3fb950' : '#484f58' }}>●</span>
                  <span style={{ color: '#c9d1d9' }}>NLLB: <span style={{ color: '#8b949e' }}>{healthStatus.translation_ready ? '✓ Ready' : 'Not loaded'}</span></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: healthStatus.stt_ready ? '#3fb950' : '#484f58' }}>●</span>
                  <span style={{ color: '#c9d1d9' }}>Whisper: <span style={{ color: '#8b949e' }}>{healthStatus.stt_ready ? '✓ Ready' : 'Not loaded'}</span></span>
                </div>
              </div>

              {/* Socket & Network Section */}
              <div style={{ borderTop: '1px solid #30363d', paddingTop: 10, marginTop: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Network & Sockets</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontFamily: 'ui-monospace, Consolas, monospace' }}>
                  <span style={{ color: '#8b949e' }}>Mesh Host (WS)</span>
                  <span style={{ color: '#44ff88' }}>:7779</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontFamily: 'ui-monospace, Consolas, monospace' }}>
                  <span style={{ color: '#8b949e' }}>HTTP API (REST)</span>
                  <span style={{ color: '#44ff88' }}>:7778</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'ui-monospace, Consolas, monospace' }}>
                  <span style={{ color: '#8b949e' }}>Whisper Pipeline</span>
                  <span style={{ color: healthStatus.stt_ready ? '#44ff88' : '#f0a500' }}>:7780</span>
                </div>
              </div>
            </div>
          )}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  // ── Setup screen — hold here until identity is established ──
  if (authState === 'setup') {
    return (
      <OnboardingWizard>
        <div className="app">
          <div className="main-content" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            <NetworkTab />
          </div>
        </div>
      </OnboardingWizard>
    );
  }

  return (
    <PowerProvider>
      <AppInner tab={tab} setTab={setTab} massCas={massCas} setMassCas={setMassCas}
        section={section} setSection={setSection} query={query} setQuery={setQuery}
        currentSection={currentSection}
        selectedId={selectedId} detail={detail}
        clock={clock} meshMode={meshMode}
        changeLang={changeLang}
        handleSmallSelect={handleSmallSelect} />
    </PowerProvider>
  );
}


// ─────────────────────────────────────────────────────────────────────
// AppInner — main layout (inside PowerProvider for usePower hook)
// ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AppInner(p: any) {
  const {
    tab, setTab, massCas, setMassCas,
    section, setSection, query, setQuery,
    currentSection, selectedId, detail,
    clock,
    changeLang,
    handleSmallSelect,
  } = p;
  const { lowPower, batteryLevel, toggleLowPower } = usePower();
  const { lang, t, loading: langLoading } = useT();
  const [showTriage, setShowTriage] = useState(false);
  const [showNeuralScan, setShowNeuralScan] = useState(false);
  const [showChildrensTab, setShowChildrensTab] = useState(() => localStorage.getItem('eve-childrens-tab') === 'true');

  const [lookupQR, setLookupQR] = useState<{ url: string; qr_image: string | null } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ── WebRTC — lifted to App level so signal listener persists across all tabs ──
  const userName = localStorage.getItem('eve-mesh-name') || 'Unknown';
  const userRole = localStorage.getItem('eve-mesh-role') || 'responder';
  const webRTC = useWebRTC(userName, userRole);
  const {
    callActive, callTarget, callType, callMuted, callDuration,
    endCall, toggleMute,
    videoRefCallback, remoteVideoRefCallback,
    fmtDuration, remoteAudioLevel,
  } = webRTC;

  // ── Notification badges (unread messages & tasks) ──
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [unreadTasks, setUnreadTasks] = useState(0);
  const lastSeenMsgs = useRef(
      parseInt(localStorage.getItem('eve-mesh-last-seen-msgs') || '0', 10) || 0
  );
  const lastSeenTasks = useRef(
      parseInt(localStorage.getItem('eve-mesh-last-seen-tasks') || '0', 10) || 0
  );

  useEffect(() => {
    const myName = localStorage.getItem('eve-mesh-name') || '';
    const poll = setInterval(async () => {
      try {
        const msgs = await api<{ target_name?: string; sender_name?: string }[]>('get_chat', '/mesh/chat');
        const forMe = msgs.filter((m) =>
          !m.target_name || m.target_name.toLowerCase() === myName.toLowerCase()
        );
        if (tab === 'comms') { lastSeenMsgs.current = forMe.length; localStorage.setItem('eve-mesh-last-seen-msgs', String(forMe.length)); }
        else setUnreadMsgs(Math.max(0, forMe.length - lastSeenMsgs.current));

        const tasks = await api<{ status?: string; assignee_name?: string }[]>('list_tasks', '/tasks');
        const myTasks = tasks.filter((t) =>
          t.status !== 'done' && (!t.assignee_name || t.assignee_name.toLowerCase() === myName.toLowerCase())
        );
        if (tab === 'tasks') { lastSeenTasks.current = myTasks.length; localStorage.setItem('eve-mesh-last-seen-tasks', String(myTasks.length)); }
        else setUnreadTasks(Math.max(0, myTasks.length - lastSeenTasks.current));
      } catch { /* offline */ }
    }, 5000);
    return () => clearInterval(poll);
  }, [tab]);

  /** Notification badge pill */
  const badge = (count: number) => count > 0 ? (
    <span style={{
      display: 'inline-block', minWidth: 16, height: 16, lineHeight: '16px', textAlign: 'center',
      borderRadius: 8, background: '#e74c3c', color: '#fff', fontSize: 9, fontWeight: 700,
      marginLeft: 4, padding: '0 4px',
    }}>{count > 99 ? '99+' : count}</span>
  ) : null;

  return (
    <OnboardingWizard>
      <div className="app">
        <div className="main-content">
          {/* ── Translation Overlay ─────────────────────────────── */}
          {langLoading && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 900,
              background: 'rgba(13, 17, 23, 0.75)', backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'opacity 0.3s',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 36, height: 36, border: '3px solid #222', borderTop: '3px solid #3fb950',
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 14px',
                }} />
                <div style={{ fontSize: 13, color: '#8b949e', letterSpacing: '0.06em' }}>Translating…</div>
              </div>
            </div>
          )}
          {/* ── Topbar ──────────────────────────────────────────── */}
          {tab !== 'childrens' && (
          <header className="topbar">
            {/* Hamburger — mobile only */}
            <button
              className="hamburger-btn"
              onClick={() => setMobileMenuOpen(o => !o)}
              aria-label="Menu"
            >
              <span /><span /><span />
            </button>
            <img
              src={`/logos/${lang}.png`}
              alt="Hermetic Labs"
              onError={(e) => { (e.target as HTMLImageElement).src = '/logos/en.png'; }}
              style={{
                height: 32,
                width: 'auto',
                marginRight: 10,
                objectFit: 'contain',
                flexShrink: 0,
              }}
            />
            <span className="topbar-title" title={localStorage.getItem('eve-mesh-name') ? `Signed in as ${localStorage.getItem('eve-mesh-name')}` : ''}>
              {localStorage.getItem('eve-mesh-name')
                ? `${localStorage.getItem('eve-mesh-name')}${localStorage.getItem('eve-mesh-role') ? ` · ${localStorage.getItem('eve-mesh-role')}` : ''}`
                : t('app.title')}
            </span>
            <div className="tab-bar">
              <button className={`tab-btn ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>{t('app.tab.tasks')}{badge(unreadTasks)}</button>
              <button className={`tab-btn ${tab === 'comms' ? 'active' : ''}`} onClick={() => setTab('comms')}>{t('app.tab.comms')}{badge(unreadMsgs)}</button>
              <button className={`tab-btn ${tab === 'intake' ? 'active' : ''}`} onClick={() => setTab('intake')}>{t('app.tab.intake')}</button>
              <button className={`tab-btn ${tab === 'ward' ? 'active' : ''}`} onClick={() => setTab('ward')}>{t('app.tab.ward')}</button>
              <button className={`tab-btn ${tab === 'inventory' ? 'active' : ''}`} onClick={() => setTab('inventory')}>{t('app.tab.inventory')}</button>
            </div>
            <button
              className="settings-btn"
              onClick={() => setTab('settings')}
              title="Settings"
              style={{
                background: tab === 'settings' ? 'var(--surface3)' : 'transparent',
                border: tab === 'settings' ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                color: tab === 'settings' ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginLeft: 4, flexShrink: 0, transition: 'all 0.15s',
              }}
            >⚙</button>
            <button
              onClick={() => setShowTriage(!showTriage)}
              title="Triage AI"
              style={{
                background: showTriage ? '#58a6ff15' : 'transparent',
                border: showTriage ? '1px solid #58a6ff33' : '1px solid transparent',
                borderRadius: 6, padding: '5px 7px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginLeft: 4, flexShrink: 0, transition: 'all 0.15s',
              }}
            ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={showTriage ? '#58a6ff' : '#6e7681'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>
            {showChildrensTab && (
              <button
                onClick={() => setTab('childrens')}
                title="Children's Tab"
                style={{
                  background: tab === 'childrens' ? '#f368e015' : 'transparent',
                  border: tab === 'childrens' ? '1px solid #f368e033' : '1px solid transparent',
                  borderRadius: 6, padding: '5px 7px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginLeft: 4, flexShrink: 0, transition: 'all 0.15s',
                }}
              ><span style={{ fontSize: 16 }}>🧸</span></button>
            )}
            <span className="topbar-sep" />
            <span className="topbar-sep" />

            <select
              value={lang}
              onChange={e => changeLang(e.target.value)}
              style={{
                background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '2px 6px', fontSize: 11, cursor: 'pointer',
                maxWidth: 140, marginLeft: 'auto',
              }}
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
            <span className="topbar-clock">{clock}</span>
            <span style={{ fontSize: 10, color: '#888', marginLeft: 4, flexShrink: 0, paddingRight: 8 }}>v8a</span>
            {lowPower && (
              <button onClick={toggleLowPower} style={{ padding: '2px 8px', background: '#f0a500', border: 'none', borderRadius: 4, color: '#000', fontWeight: 700, fontSize: 11, cursor: 'pointer', marginLeft: 8 }}>{t('app.low_power')}</button>
            )}
            {!lowPower && batteryLevel !== null && batteryLevel < 0.5 && (
              <button onClick={toggleLowPower} style={{ padding: '2px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer', marginLeft: 8 }}>{Math.round(batteryLevel * 100)}%</button>
            )}
          </header>
          )}

          {/* ── Mobile Nav Drawer ───────────────────────────────── */}
          {mobileMenuOpen && (
            <div className="mobile-drawer-overlay" onClick={() => setMobileMenuOpen(false)}>
              <nav className="mobile-drawer" onClick={e => e.stopPropagation()}>
                <div className="mobile-drawer-header">
                  <img src={`/logos/${lang}.png`} alt="" onError={e => { (e.target as HTMLImageElement).src = '/logos/en.png'; }} style={{ height: 24 }} />
                  <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.08em', color: 'var(--accent)' }}>{t('app.title')}</span>
                  <button onClick={() => setMobileMenuOpen(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 20, cursor: 'pointer' }}>×</button>
                </div>
                {[
                  { id: 'tasks' as Tab, label: t('app.tab.tasks'), badgeCount: unreadTasks },
                  { id: 'comms' as Tab, label: t('app.tab.comms'), badgeCount: unreadMsgs },
                  { id: 'intake' as Tab, label: t('app.tab.intake'), badgeCount: 0 },
                  { id: 'ward' as Tab, label: t('app.tab.ward'), badgeCount: 0 },
                  { id: 'inventory' as Tab, label: t('app.tab.inventory'), badgeCount: 0 },
                  { id: 'settings' as Tab, label: '⚙ ' + (t('app.tab.settings') || 'Settings'), badgeCount: 0 },
                ].map(item => (
                  <button
                    key={item.id}
                    className={`mobile-drawer-item ${tab === item.id ? 'active' : ''}`}
                    onClick={() => { setTab(item.id); setMobileMenuOpen(false); }}
                  >
                    {item.label}{item.badgeCount > 0 ? badge(item.badgeCount) : null}
                  </button>
                ))}
              </nav>
            </div>
          )}

          {/* ── Tab content (conditionally rendered) ────────────── */}

          {/* Tasks */}
          {tab === 'tasks' && (
            <div style={fullTab}><TaskBoard /></div>
          )}

          {/* Communications */}
          {tab === 'comms' && (
            <div style={fullTab}><CommsPanel webRTC={webRTC} /></div>
          )}

          {/* ═══ Global Call Overlay — renders on ANY tab ═══════════════ */}
          {callActive && (
            <div className="call-overlay-global" style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)',
            }}>
              <div style={{
                width: '90%', maxWidth: 420, borderRadius: 20,
                background: '#111', overflow: 'hidden',
                boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                display: 'flex', flexDirection: 'column',
                maxHeight: '90vh',
              }}>
                {/* Video or Voice avatar area */}
                <div style={{ position: 'relative', background: '#000', minHeight: callType === 'video' ? 260 : 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {callType === 'video' ? (
                    <>
                      <video ref={remoteVideoRefCallback} autoPlay playsInline style={{ width: '100%', height: 260, objectFit: 'cover' }} />
                      <div style={{ position: 'absolute', top: 12, right: 12, width: 90, height: 68, borderRadius: 10, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.2)', boxShadow: '0 2px 10px #0008' }}>
                        <video ref={videoRefCallback} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                      {(() => { const lvl = remoteAudioLevel; return (
                        <div style={{
                          width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px',
                          background: '#3fb95022', border: '2px solid #3fb95044',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 24, color: '#3fb950',
                          boxShadow: lvl > 10 ? `0 0 ${lvl * 0.4}px ${lvl * 0.2}px rgba(63, 185, 80, ${Math.min(lvl / 180, 0.8)})` : 'none',
                          transition: 'box-shadow 0.15s ease',
                        }}>
                          {callTarget?.charAt(0).toUpperCase() || '?'}
                        </div>
                      ); })()}
                      <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{callTarget || 'Unknown'}</div>
                      <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Voice Call</div>
                    </div>
                  )}
                  <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.6)', padding: '3px 12px', borderRadius: 12, fontSize: 12, fontFamily: 'var(--font-mono)', color: callType === 'video' ? '#3498db' : '#3fb950' }}>
                    {fmtDuration(callDuration)}
                  </div>
                </div>
                {/* Controls */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 20, padding: '16px 24px', background: '#1a1a1a' }}>
                  <button onClick={toggleMute} title={callMuted ? 'Unmute' : 'Mute'} style={{ width: 52, height: 52, borderRadius: '50%', background: callMuted ? '#f0a50022' : '#ffffff15', border: `2px solid ${callMuted ? '#f0a500' : '#555'}`, color: callMuted ? '#f0a500' : '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {callMuted ? '🔇' : '🔊'}
                  </button>
                  <button onClick={endCall} title="End Call" style={{ width: 52, height: 52, borderRadius: '50%', background: '#e74c3c', border: '2px solid #e74c3c', color: '#fff', fontSize: 20, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    ✕
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Patient Intake / Mass Casualty */}
          {tab === 'intake' && (
            <div style={fullTab}>
              {!massCas && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                  <button onClick={() => setMassCas(true)} style={{ padding: '6px 12px', background: '#e74c3c18', border: '1px solid #e74c3c55', borderRadius: 6, color: '#e74c3c', fontWeight: 700, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'background 0.2s' }}>
                    ⚠ {t('intake.mass_cas') || 'MASS CASUALTY MODE'}
                  </button>
                </div>
              )}
              {massCas ? <MassCasIntake onExit={() => setMassCas(false)} /> : <PatientIntake />}
            </div>
          )}

          {/* Ward Map */}
          {tab === 'ward' && (
            <div style={fullTab}><WardMap /></div>
          )}

          {/* Inventory */}
          {tab === 'inventory' && (
            <div style={fullTab}><InventoryTab /></div>
          )}

          {/* Childrens Tab */}
          {tab === 'childrens' && (
            <div style={fullTab}><ChildrensTab onClose={() => setTab('tasks')} /></div>
          )}

          {showNeuralScan && <NeuralScanReport onClose={() => setShowNeuralScan(false)} />}

          {/* ── SETTINGS PAGE (always mounted — keeps WS alive) ────────────── */}
          <div style={{ ...fullTab, overflowY: 'auto', padding: 0, display: tab === 'settings' ? undefined : 'none' }}>
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* ── Network Identity (profile card at top) ────────── */}
                <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', padding: '20px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    {/* Profile Picture */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div
                        style={{
                          width: 64, height: 64, borderRadius: '50%', overflow: 'hidden',
                          background: 'var(--bg)', border: '2px solid var(--border)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', position: 'relative',
                        }}
                        onClick={() => document.getElementById('profile-pic-input')?.click()}
                        title="Change profile picture"
                      >
                        {localStorage.getItem('eve-mesh-avatar') ? (
                          <img src={localStorage.getItem('eve-mesh-avatar')!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: 28, color: 'var(--text-faint)' }}>👤</span>
                        )}
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>
                          <span style={{ fontSize: 16, color: '#fff' }}>📷</span>
                        </div>
                      </div>
                      <input
                        id="profile-pic-input"
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            const img = new Image();
                            img.onload = () => {
                              const canvas = document.createElement('canvas');
                              const size = 128;
                              canvas.width = size; canvas.height = size;
                              const ctx = canvas.getContext('2d')!;
                              const min = Math.min(img.width, img.height);
                              ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
                              const dataUrl = canvas.toDataURL('image/webp', 0.8);
                              localStorage.setItem('eve-mesh-avatar', dataUrl);
                              window.dispatchEvent(new Event('storage'));
                              // Also upload to API so other members can see it
                              const clientId = localStorage.getItem('eve-mesh-client-id');
                              if (clientId) {
                                canvas.toBlob(blob => {
                                  if (!blob) return;
                                  const fd = new FormData();
                                  fd.append('file', blob, 'avatar.webp');
                                  fetch(resolveUrl(`/api/roster/${clientId}/avatar`), { method: 'POST', body: fd }).catch(() => {});
                                }, 'image/webp', 0.8);
                              }
                              e.target.value = '';
                            };
                            img.src = reader.result as string;
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </div>
                    {/* Identity Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
                        {localStorage.getItem('eve-mesh-name') || 'Not set'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 4, fontWeight: 600, textTransform: 'uppercase' as const, fontSize: 11,
                          background: (localStorage.getItem('eve-mesh-role') || '') === 'leader' ? '#3fb95022' : (localStorage.getItem('eve-mesh-role') || '') === 'medic' ? '#3498db22' : '#44444422',
                          color: (localStorage.getItem('eve-mesh-role') || '') === 'leader' ? '#3fb950' : (localStorage.getItem('eve-mesh-role') || '') === 'medic' ? '#3498db' : '#888',
                          border: '1px solid ' + ((localStorage.getItem('eve-mesh-role') || '') === 'leader' ? '#3fb95033' : (localStorage.getItem('eve-mesh-role') || '') === 'medic' ? '#3498db33' : '#33333355'),
                        }}>{localStorage.getItem('eve-mesh-role') || 'N/A'}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>
                          {localStorage.getItem('eve-mesh-client-id') || 'No ID'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── System Status ────────────────────────────────── */}
                <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', padding: '14px 20px', display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: 'var(--text-dim)' }}>
                  <span>Backend: <strong style={{ color: isNative ? '#3fb950' : '#3498db' }}>{isNative ? '🦀 Rust' : '🐍 Python'}</strong></span>
                  <span style={{ color: 'var(--border)' }}>|</span>
                  <span>Protocol: <strong style={{ color: location.protocol === 'https:' ? '#3fb950' : '#f0a500' }}>{location.protocol === 'https:' ? '🔒 HTTPS' : '⚠ HTTP'}</strong></span>
                  <span style={{ color: 'var(--border)' }}>|</span>
                  <span>Mesh: <strong style={{ color: 'var(--text-muted)' }}>{location.host}</strong></span>
                </div>

                {/* ── Mesh Network Section ──────────────────────────── */}
                <details open style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
                  <summary style={{ padding: '14px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--text)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>🌐</span> {t('app.tab.network')}
                  </summary>
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    <NetworkTab />
                  </div>
                </details>

                {/* ── Medical Reference Section ────────────────────── */}
                <details style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
                  <summary style={{ padding: '14px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--text)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>📚</span> {t('app.tab.reference')}
                  </summary>
                  <div style={{ borderTop: '1px solid var(--border)', display: 'flex', minHeight: 400 }}>
                    <nav style={{ width: 180, borderRight: '1px solid var(--border)', padding: '12px 0', flexShrink: 0 }}>
                      {NAV.map(n => (
                        <div
                          key={n.id}
                          className={`nav-item ${section === n.id ? 'active' : ''}`}
                          onClick={() => setSection(n.id)}
                          style={{ padding: '8px 16px', cursor: 'pointer', fontSize: 12 }}
                        >
                          <span className="nav-dot" />
                          {t(n.labelKey)}
                          {n.count && <span className="nav-count">{n.count}</span>}
                        </div>
                      ))}
                    </nav>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div className="search-bar" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                        <span className="search-label">{t('app.search')}</span>
                        <input
                          className="search-input"
                          type="text"
                          placeholder={t('app.search.placeholder').replace('{section}', section)}
                          value={query}
                          onChange={e => setQuery(e.target.value)}
                          spellCheck={false}
                        />
                        {query && (
                          <span className="search-label" style={{ cursor: 'pointer', color: 'var(--text-dim)' }} onClick={() => setQuery('')}>
                            {t('app.search.clear')}
                          </span>
                        )}
                      </div>
                      <div className="split" style={{ flex: 1 }}>
                        {currentSection.length === 0 ? (
                          <div className="list-pane loading">{t('app.loading')}</div>
                        ) : (
                          <SmallList items={currentSection} query={query} selected={selectedId} onSelect={handleSmallSelect} />
                        )}
                        <div className="detail-pane">
                          <DetailView entity={detail} section={section} />
                        </div>
                      </div>
                    </div>
                  </div>
                </details>


                {/* ── Device Permissions ────────────────────────────── */}
                <details style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
                  <summary style={{ padding: '14px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--text)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>🔐</span> {t('settings.device_permissions')}
                  </summary>
                  <div style={{ borderTop: '1px solid var(--border)', padding: 20 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 16 }}>{t('settings.device_permissions_desc')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[
                        { key: 'audio', label: '🔊 ' + t('settings.audio_playback'), desc: t('settings.audio_desc') },
                        { key: 'mic', label: '🎤 ' + t('settings.microphone'), desc: t('settings.mic_desc') },
                        { key: 'camera', label: '📷 ' + t('settings.camera'), desc: t('settings.camera_desc') },
                      ].map(p => (
                        <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.label}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 16 }}>
                      <button
                        onClick={() => localStorage.removeItem('eve-permissions-granted')}
                        style={{ padding: '6px 14px', background: 'transparent', border: '1px solid #e74c3c55', borderRadius: 6, color: '#e74c3c', fontSize: 12, cursor: 'pointer' }}
                      >{t('settings.reset_perm_gate')}</button>
                    </div>
                  </div>
                </details>

                {/* ── Model Packs ──────────────────────────────────── */}
                <details style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
                  <summary style={{ padding: '14px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--text)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>📦</span> {t('settings.model_packs')}
                  </summary>
                  <div style={{ borderTop: '1px solid var(--border)', padding: 20 }}>
                    <DistributionTab />
                  </div>
                </details>

                {/* ── Language ──────────────────────────────────────── */}
                <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', padding: '14px 20px' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>{t('settings.language')}</div>
                  <select
                    value={lang}
                    onChange={e => changeLang(e.target.value)}
                    style={{
                      background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
                      borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', width: '100%',
                    }}
                  >
                    {LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </div>

                {/* ── Advanced Features ────────────────────────────── */}
                <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', padding: '14px 20px' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 12 }}>Advanced Features</div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Children's Safe Runner Tab</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Enable an infinite runner game with MedGemma voice piping to ease stress during intake.</div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={showChildrensTab} 
                        onChange={(e) => {
                          const val = e.target.checked;
                          setShowChildrensTab(val);
                          localStorage.setItem('eve-childrens-tab', val ? 'true' : 'false');
                          if (!val && tab === 'childrens') setTab('tasks');
                        }} 
                        style={{ width: 18, height: 18, cursor: 'pointer' }}
                      />
                    </label>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 4px' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Neural Diagnostics</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Run system-wide neural and language probes.</div>
                    </div>
                    <button 
                      onClick={() => setShowNeuralScan(true)}
                      style={{ padding: '6px 12px', background: '#8b5cf622', color: '#8b5cf6', border: '1px solid #8b5cf655', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                    >Launch Sweep</button>
                  </div>
                </div>

                {/* ── Family Lookup QR ─────────────────────────────── */}
                <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', padding: '14px 20px' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>{t('settings.family_lookup', 'Family Lookup')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 12 }}>{t('settings.family_lookup_desc', 'Generate a QR code for families to look up patients on their own device')}</div>

                  {/* QR Display Area */}
                  {lookupQR ? (
                    <div style={{ textAlign: 'center', padding: 16, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      {lookupQR.qr_image && <img src={lookupQR.qr_image} alt="Family Lookup QR" style={{ width: 200, height: 200, borderRadius: 8, margin: '0 auto 12px', display: 'block' }} />}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{t('lookup.subtitle', 'Scan to search for patients')}</div>
                      <code style={{ fontSize: 11, color: '#58a6ff', background: '#161b22', padding: '4px 10px', borderRadius: 4 }}>{lookupQR.url}</code>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
                        <button
                          onClick={() => {
                            const w = window.open('', '_blank');
                            if (!w) return;
                            w.document.write(`<html><head><title>Family Lookup QR</title><style>@media print { body { margin: 0; } .no-print { display: none; } }</style></head>
                              <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui;text-align:center">
                                <h1 style="font-size:24px;margin:0 0 8px">📱 Patient Family Lookup</h1>
                                <p style="margin:0 0 20px;color:#555;font-size:14px">Scan to search for your family member</p>
                                ${lookupQR.qr_image ? `<img src="${lookupQR.qr_image}" style="width:280px;height:280px" />` : ''}
                                <p style="margin:16px 0 4px;font-size:13px;color:#888">${lookupQR.url}</p>
                                <button class="no-print" onclick="window.print()" style="margin-top:20px;padding:10px 32px;font-size:14px;cursor:pointer;border:1px solid #ccc;border-radius:6px;background:#f8f8f8">🖨 Print</button>
                              </body></html>`);
                          }}
                          style={{ padding: '6px 14px', fontSize: 11, background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer' }}
                        >🖨 {t('settings.print_qr', 'Print')}</button>
                        <button
                          onClick={() => setLookupQR(null)}
                          style={{ padding: '6px 14px', fontSize: 11, background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-faint)', cursor: 'pointer' }}
                        >✕</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={async () => {
                        try {
                          const data = await api<{ url: string; qr_image: string | null }>('public_qr', '/public/qr');
                          setLookupQR(data);
                        } catch { window.open('/lookup', '_blank'); }
                      }}
                      style={{ padding: '8px 16px', background: '#1a3a1a', color: '#3fb950', border: '1px solid #3fb95055', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, width: '100%' }}
                    >📱 {t('settings.generate_lookup_qr', 'Generate Lookup QR')}</button>
                  )}
                </div>

                {/* ── Legal & Licensing (Footer) ────────────────────── */}
                <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px dashed var(--border)', color: 'var(--text-faint)', fontSize: 11, lineHeight: 1.5, textAlign: 'center' }}>
                  <strong style={{ color: 'var(--text-muted)' }}>Terms of Use & Legal Disclaimer:</strong> The HALT System is an informational coordination tool built for austere environments. It is <strong>NOT</strong> a certified medical device (SaMD) and is not FDA-cleared. By using this software, you acknowledge that all AI-generated guidance and triage categorizations must be verified by a qualified medical professional before clinical application.<br/><br/>
                  Provided "as is", without warranty of any kind. Subject to the <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)' }}>MIT License</a>.
                </div>
              </div>
          </div>

          {/* Footer */}
          <footer style={{
            gridColumn: '1 / -1', textAlign: 'center', padding: '6px 12px',
            fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.5px',
            borderTop: '1px solid var(--border)', opacity: 0.7,
          }}>
            {t('app.footer')}
            <div style={{ marginTop: 4, fontSize: 9, lineHeight: 1.4, opacity: 0.6, maxWidth: 800, margin: '4px auto 0' }}>
              {t('app.disclaimer')}
            </div>
          </footer>
        </div>


        {/* Triage Side Panel — always rendered to preserve chat history */}
        <div className="triage-container" style={showTriage ? undefined : { display: 'none' }}>
          <TriagePanel onClose={() => setShowTriage(false)} />
        </div>


      </div>
    </OnboardingWizard>
  );
}
