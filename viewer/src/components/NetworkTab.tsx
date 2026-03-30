/**
 * NetworkTab — Mesh network management for Eve Os: Triage
 * Handles leader/client mode, QR onboarding, live roster, connection health.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

import { useT } from '../services/i18n';

// Module-level ringtone reference for incoming call signaling
let _eveRingtone: HTMLAudioElement | null = null;

/**
 * fireSystemNotification — Show a browser/PWA notification.
 * Prefers ServiceWorker showNotification (works in backgrounded iOS PWAs).
 * Falls back to new Notification() for desktop browsers.
 */
function fireSystemNotification(title: string, body: string, tag: string, urgent = false) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = {
        body,
        tag,
        icon: '/icon-192.svg',
        badge: '/icon-192.svg',
        vibrate: urgent ? [300, 100, 300, 100, 600] : [200, 100, 200],
        requireInteraction: urgent,
        silent: false,
    } as NotificationOptions & { vibrate?: number[]; badge?: string };

    try {
        // Prefer SW showNotification (works in background PWAs on iOS 16.4+)
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(() => {});
        } else {
            const n = new Notification(title, opts);
            n.onclick = () => { window.focus(); n.close(); };
        }
    } catch { /* degrade silently */ }
}

/**
 * composeEmergencyText — Build the spoken announcement from emergency fields.
 * Format: "Alert. [group]. [ward/bed]. [notes]."
 */
function composeEmergencyText(msg: Record<string, unknown>): string {
    const parts: string[] = ['Alert.'];
    if (msg.categories_text) parts.push(`${msg.categories_text}.`);
    if (msg.ward) parts.push(`Ward ${msg.ward}.`);
    if (msg.bed) parts.push(`Bed ${msg.bed}.`);
    if (msg.notes) parts.push(`${msg.notes}.`);
    // Strip emoji / non-latin symbols so Kokoro doesn't choke
    return parts.join(' ').replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * fetchTTSAudio — Synthesize text via Kokoro and return an Audio element.
 * Accepts language code for proper phonemization.
 * Returns null if TTS is unavailable.
 */
async function fetchTTSAudio(text: string, lang = 'en'): Promise<HTMLAudioElement | null> {
    try {
        const res = await fetch('/tts/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice: 'af_heart', rate: 1.0, lang }),
        });
        if (!res.ok) return null;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = 0.9;
        audio.addEventListener('ended', () => URL.revokeObjectURL(url));
        return audio;
    } catch {
        return null;
    }
}

/**
 * translateText — Translate text using the offline NLLB endpoint.
 * Returns the original text on failure.
 */
async function translateText(text: string, target: string): Promise<string> {
    if (target === 'en') return text;
    try {
        const res = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, source: 'en', target }),
        });
        if (res.ok) {
            const data = await res.json();
            return data.translated || text;
        }
    } catch { /* offline — fallback to English */ }
    return text;
}

/**
 * playEmergencySequence — Cadence: 🔊🔊 TTS 🔊🔊 TTS 🔊
 * 2 tones → read message → 2 tones → read message → 1 closing tone
 * Translates the message to the user's set language before speaking.
 */
async function playEmergencySequence(msg: Record<string, unknown>) {
    const englishText = composeEmergencyText(msg);
    const userLang = localStorage.getItem('eve-lang') || 'en';
    const spokenText = await translateText(englishText, userLang);
    const toneSrc = '/data/sounds/triage announcement.wav';
    
    let ttsAudio: HTMLAudioElement | null = null;
    if (msg.audio_b64) {
        ttsAudio = new Audio(`data:audio/wav;base64,${msg.audio_b64}`);
    } else {
        ttsAudio = await fetchTTSAudio(spokenText, userLang) || null;
    }

    const playTone = () => new Promise<void>(resolve => {
        const a = new Audio(toneSrc);
        a.volume = 0.8;
        a.addEventListener('ended', () => resolve(), { once: true });
        a.play().catch(() => resolve());
    });

    const playTTS = async () => {
        if (!ttsAudio) return;
        ttsAudio.currentTime = 0;
        return new Promise<void>(resolve => {
            ttsAudio.addEventListener('ended', () => resolve(), { once: true });
            ttsAudio.play().catch(() => resolve());
        });
    };

    const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    try {
        await playTone();           // tone 1
        await playTone();           // tone 2
        await playTTS();            // TTS read
        await wait(1000);           // pause
        await playTone();           // tone 3
        await playTone();           // tone 4
        await playTTS();            // TTS repeat
        await wait(1000);           // pause
        await playTone();           // closing tone
    } catch { /* degrade silently */ }
}

/**
 * playAnnouncementSequence — Cadence: General_start 🔊 → TTS → General_end 🔊
 * Translates the announcement to the user's set language before speaking.
 */
async function playAnnouncementSequence(msg: Record<string, unknown>) {
    const message = String(msg.message || '');
    const userLang = localStorage.getItem('eve-lang') || 'en';
    const spokenText = await translateText(message, userLang);
    const startSrc = '/data/sounds/General_start.wav';
    const endSrc = '/data/sounds/General_end.wav';
    
    let ttsAudio: HTMLAudioElement | null = null;
    if (msg.audio_b64) {
        ttsAudio = new Audio(`data:audio/wav;base64,${msg.audio_b64}`);
    } else {
        ttsAudio = await fetchTTSAudio(spokenText, userLang) || null;
    }

    const playSound = (src: string) => new Promise<void>(resolve => {
        const a = new Audio(src);
        a.volume = 0.8;
        a.addEventListener('ended', () => resolve(), { once: true });
        a.play().catch(() => resolve());
    });

    const playTTS = async () => {
        if (!ttsAudio) return;
        ttsAudio.currentTime = 0;
        return new Promise<void>(resolve => {
            ttsAudio.addEventListener('ended', () => resolve(), { once: true });
            ttsAudio.play().catch(() => resolve());
        });
    };

    const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    try {
        await playSound(startSrc);  // opening chime
        await playTTS();            // TTS read
        await wait(1000);           // pause
        await playSound(startSrc);  // repeat chime
        await playTTS();            // TTS repeat
        await wait(1000);           // pause
        await playSound(endSrc);    // closing chime
    } catch { /* degrade silently */ }
}
// ── Types ────────────────────────────────────────────────────────────────────

interface MeshClient {
    client_id: string;
    name: string;
    role: string;
    connected_at: number;
    last_ping: number;
    stale: boolean;
    online: boolean;
}



interface RosterMember {
    id: string;
    name: string;
    role: string;
    skills: string[];
    status: string;
    assigned_task: string;
    joined_at: string;
    notes: string;
    avatar_url?: string;
}


type NetworkMode = 'setup' | 'confirming' | 'leader' | 'client';

const SKILL_OPTIONS = [
    'First Aid', 'CPR', 'IV Lines', 'Splinting', 'Airway', 'Sutures',
    'Triage', 'Medication', 'Wound Care', 'Childbirth', 'Vitals',
    'Radio/Comms', 'Translation', 'Logistics', 'Security', 'Search & Rescue',
];

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE = '';  // relative — same origin, single port 7778
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;  // same host — Vite proxies /ws
const PING_INTERVAL = 5000;
const POLL_INTERVAL = 3000;
const RECONNECT_DELAY = 5000; // 5s between reconnect attempts
const MAX_RECONNECT = 50;     // max attempts before giving up

// Module-level refs — survive component unmount (tab switch on mobile)
let _wsRef: WebSocket | null = null;
let _pingInterval: number | null = null;
let _reconnectTimeout: ReturnType<typeof setTimeout> | null = null;  // eslint-disable-line prefer-const
let _reconnectTimer: number | null = null;
let _reconnectAttempts = 0;



// ── Component ────────────────────────────────────────────────────────────────

export default function NetworkTab() {
    const { t } = useT();
    // ── QR join detection (runs BEFORE any state init) ────────────────────────
    // Check both current URL and a flag we set pre-React (see index.html inline script)
    const urlParams = new URLSearchParams(window.location.search);
    const qrName = urlParams.get('name') || '';
    const qrRole = urlParams.get('role') || '';
    const isQRJoin = !!(qrName && qrRole);

    // ── Force reset on QR scan ───────────────────────────────────────────────
    // If QR params are present, nuke ALL cached identity so the user always
    // sees the setup screen with the new identity — even on PWA re-entry.
    const [qrHandled] = useState(() => {
        if (isQRJoin) {
            // Disconnect any existing WS before resetting
            if (_wsRef) { _wsRef.close(); _wsRef = null; }
            if (_pingInterval) { clearInterval(_pingInterval); _pingInterval = null; }
            if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
            _reconnectAttempts = 0;
            // Wipe ALL cached identity — not just mode
            localStorage.setItem('eve-mesh-mode', 'client');
            localStorage.removeItem('eve-mesh-name');
            localStorage.removeItem('eve-mesh-role');
            localStorage.removeItem('eve-mesh-client-id');
            // Set the NEW identity from QR params immediately
            localStorage.setItem('eve-mesh-name', qrName);
            localStorage.setItem('eve-mesh-role', qrRole);
            // Generate a fresh client ID for this join
            const freshId = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            localStorage.setItem('eve-mesh-client-id', freshId);
            // URL params are cleaned AFTER React reads them (in a useEffect below)
            return freshId;
        }
        return null;
    });

    // Clean URL params after mount so App.tsx can read them for tab auto-switch
    useEffect(() => {
        if (isQRJoin) {
            window.history.replaceState({}, '', window.location.pathname);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // run once on mount

    // ── Safety net: detect QR join that happened before React mounted ─────────
    // (e.g. PWA service worker served cached page, component was already alive)
    const [qrBootName] = useState(() => {
        // Check if a pre-React script stashed QR data (set in index.html)
        const stashed = sessionStorage.getItem('eve-qr-join');
        if (stashed) {
            sessionStorage.removeItem('eve-qr-join');
            try {
                const { name, role } = JSON.parse(stashed);
                if (name && role) {
                    localStorage.setItem('eve-mesh-mode', 'client');
                    localStorage.removeItem('eve-mesh-name');
                    localStorage.removeItem('eve-mesh-role');
                    localStorage.removeItem('eve-mesh-client-id');
                    localStorage.setItem('eve-mesh-name', name);
                    localStorage.setItem('eve-mesh-role', role);
                    const freshId = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
                    localStorage.setItem('eve-mesh-client-id', freshId);
                    return name;
                }
            } catch { /* bad JSON */ }
        }
        return null;
    });
    const effectiveQRJoin = isQRJoin || !!qrBootName;

    // Core state
    const [mode, setMode] = useState<NetworkMode>(() => {
        // QR scan → skip setup entirely, go straight to confirming animation
        if (effectiveQRJoin) return 'confirming';
        const saved = localStorage.getItem('eve-mesh-mode');
        return (saved as NetworkMode) || 'setup';
    });
    const [clientId] = useState(() => {
        if (qrHandled) return qrHandled;
        const saved = localStorage.getItem('eve-mesh-client-id');
        if (saved) return saved;
        const id = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        localStorage.setItem('eve-mesh-client-id', id);
        return id;
    });
    const [userName, setUserName] = useState(() => localStorage.getItem('eve-mesh-name') || '');
    const [userRole, setUserRole] = useState(() => localStorage.getItem('eve-mesh-role') || 'responder');
    // Target mode for after confirmation — QR joins are always clients
    const [pendingMode, setPendingMode] = useState<'leader' | 'client'>(effectiveQRJoin ? 'client' : 'client');
    // Roster state
    const [roster, setRoster] = useState<RosterMember[]>([]);
    const [showAddMember, setShowAddMember] = useState(false);
    const [newMember, setNewMember] = useState({ name: '', role: 'responder' });
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

    // Sub-tab removed — status and roster shown side by side

    const [reconnecting, setReconnecting] = useState(false);

    // Connection state
    const [connected, setConnected] = useState(false);
    const [clients, setClients] = useState<MeshClient[]>([]);


    const [leaderName, setLeaderName] = useState<string>('');

    // QR state
    const [showQR, setShowQR] = useState(false);
    const [qrData, setQrData] = useState<{ qr_image: string | null; app_url: string } | null>(null);
    const [qrMemberName, setQrMemberName] = useState('');
    const [qrMemberRole, setQrMemberRole] = useState('');
    const prevClientCountRef = useRef(0);

    // Poll ref (component-level — stops on unmount, which is fine)
    const pollRef = useRef<number | null>(null);

    // ── Persist mode ─────────────────────────────────────────────────────────

    useEffect(() => {
        if (mode !== 'setup') localStorage.setItem('eve-mesh-mode', mode);
    }, [mode]);

    // ── Startup roster sync: ensure this device is registered ──────────────
    useEffect(() => {
        if (mode === 'setup' || mode === 'confirming' || mode === 'leader') return; // leaders don't belong in the roster
        const name = localStorage.getItem('eve-mesh-name');
        const role = localStorage.getItem('eve-mesh-role');
        if (!name || !clientId) return;
        // Check if already in roster
        fetch(`${API_BASE}/api/roster`).then(r => r.json()).then((list: RosterMember[]) => {
            if (list.some(m => m.id === clientId)) return; // already there
            // Register self
            return fetch(`${API_BASE}/api/roster`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: clientId, name, role: role || 'responder', skills: [], status: 'online', assigned_task: '', notes: '' }),
            }).then(() => {
                // Push avatar if exists
                const av = localStorage.getItem('eve-mesh-avatar');
                if (av) {
                    fetch(av).then(r => r.blob()).then(blob => {
                        const fd = new FormData();
                        fd.append('file', blob, 'avatar.webp');
                        fetch(`${API_BASE}/api/roster/${clientId}/avatar`, { method: 'POST', body: fd }).catch(() => {});
                    }).catch(() => {});
                }
            });
        }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    // Inject glow animation CSS (used by incoming call banners)
    useEffect(() => {
        const id = 'eve-mesh-pulse-css';
        if (!document.getElementById(id)) {
            const style = document.createElement('style');
            style.id = id;
            style.textContent = `@keyframes pulse { 0%, 100% { box-shadow: 0 0 8px rgba(63,185,80,0.3); } 50% { box-shadow: 0 0 24px rgba(63,185,80,0.8); } }`;
            document.head.appendChild(style);
        }
    }, []);

    // ── API Fetches ──────────────────────────────────────────────────────────

    const fetchClients = useCallback(async () => {
        try {
            const r = await fetch(`${API_BASE}/api/mesh/clients`);
            if (r.ok) setClients(await r.json());
        } catch { /* offline */ }
    }, []);

    const fetchQR = useCallback(async (memberName = '', memberRole = '') => {
        try {
            const params = new URLSearchParams();
            if (memberName) params.set('name', memberName);
            if (memberRole) params.set('role', memberRole);
            const r = await fetch(`${API_BASE}/api/mesh/qr?${params.toString()}`);
            if (r.ok) {
                const data = await r.json();
                setQrData(data);
                setQrMemberName(memberName);
                setQrMemberRole(memberRole);
                setShowQR(true);
            }
        } catch { /* offline */ }
    }, []);

    const fetchRoster = useCallback(async () => {
        try {
            const r = await fetch(`${API_BASE}/api/roster`);
            if (r.ok) setRoster(await r.json());
        } catch { /* offline */ }
    }, []);


    // ── Roster Actions ───────────────────────────────────────────────────────

    const addMember = async () => {
        if (!newMember.name.trim()) return;
        try {
            const r = await fetch(`${API_BASE}/api/roster`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newMember.name, role: newMember.role, skills: selectedSkills }),
            });
            if (r.ok) {
                const addedName = newMember.name;
                const addedRole = newMember.role;
                fetchRoster();
                setNewMember({ name: '', role: 'responder' });
                setSelectedSkills([]);
                setShowAddMember(false);
                // Auto-show QR with the member's name/role pre-filled
                fetchQR(addedName, addedRole);
            }
        } catch { /* offline */ }
    };

    const removeMember = async (id: string) => {
        try {
            await fetch(`${API_BASE}/api/roster/${id}`, { method: 'DELETE' });
            fetchRoster();
        } catch { /* offline */ }
    };


    // ── WebSocket Connection ─────────────────────────────────────────────────

    const connectWS = useCallback(() => {
        if (_wsRef?.readyState === WebSocket.OPEN) return;
        const ws = new WebSocket(`${WS_BASE}/ws/${clientId}`);
        _wsRef = ws;

        ws.onopen = () => {
            setConnected(true);
            _reconnectAttempts = 0; // reset on successful connect
            setReconnecting(false);
            ws.send(JSON.stringify({ type: 'set_name', name: userName || 'Volunteer', role: userRole }));
            _pingInterval = window.setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, PING_INTERVAL);
        };

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'sync' || msg.type === 'pong') {
                    // keep-alive ack
                } else if (msg.type === 'client_joined' || msg.type === 'client_left') {
                    fetchClients();
                } else if (msg.type === 'leader_heartbeat') {
                    if (msg.leader_name) { setLeaderName(msg.leader_name); localStorage.setItem('eve-mesh-leader', msg.leader_name); }
                } else if (msg.type === 'new_leader') {
                    if (msg.leader_name) { setLeaderName(msg.leader_name); localStorage.setItem('eve-mesh-leader', msg.leader_name); }
                    fetchClients();
                    fetchRoster();
                } else if (msg.type === 'emergency') {
                    // Emergency — alarm on ALL devices
                    fireSystemNotification(
                        '🚨 EMERGENCY',
                        `${msg.categories_text || 'General Emergency'}${msg.ward ? ' — Ward: ' + msg.ward : ''}${msg.notes ? ' | ' + msg.notes : ''}`,
                        'eve-emergency',
                        true,
                    );
                    // Full-screen emergency banner (stays until audio sequence finishes)
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(231,76,60,0.15);display:flex;align-items:center;justify-content:center;';
                    const banner = document.createElement('div');
                    banner.style.cssText = 'background:#e74c3c;color:#fff;padding:24px 40px;border-radius:16px;font-size:16px;font-weight:700;text-align:center;box-shadow:0 0 80px rgba(231,76,60,0.6);max-width:90%;position:relative;min-width:320px;';
                    const ward = msg.ward ? ` — Ward: ${msg.ward}` : '';
                    const bed = msg.bed ? ` Bed: ${msg.bed}` : '';
                    const catText = msg.categories_text || 'General Emergency';
                    const notesText = msg.notes ? `<br/>${msg.notes}` : '';
                    const senderText = msg.sender_name ? `<br/>— ${msg.sender_name}` : '';
                    const bodyHTML = `<span style="font-size:13px;font-weight:400;opacity:0.9">${catText}${notesText}${senderText}</span>`;
                    banner.innerHTML = `🚨 EMERGENCY${ward}${bed}<br/>${bodyHTML}`;
                    // Close button
                    const closeBtn = document.createElement('button');
                    closeBtn.textContent = '×';
                    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:none;border:none;color:#fff;font-size:22px;cursor:pointer;opacity:0.7;line-height:1;padding:0 4px;';
                    closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
                    closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.7'; };
                    const dismissOverlay = () => { overlay.style.opacity = '0'; overlay.style.transition = 'opacity 0.6s'; setTimeout(() => overlay.remove(), 700); };
                    closeBtn.onclick = (e) => { e.stopPropagation(); dismissOverlay(); };
                    banner.appendChild(closeBtn);

                    // Translate loader bar (same pattern as CommsPanel/TriagePanel)
                    const userLang = localStorage.getItem('eve-lang') || 'en';
                    const translateBar = document.createElement('div');
                    if (userLang !== 'en') {
                        translateBar.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 16px;margin-top:12px;border-radius:8px;background:rgba(80,200,120,0.15);';
                        translateBar.innerHTML = '<div style="width:14px;height:14px;border:2px solid #50C87844;border-top:2px solid #50C878;border-radius:50%;animation:spin 0.8s linear infinite"></div><span style="font-size:11px;color:#50C878;font-weight:500;letter-spacing:0.04em">Translating...</span>';
                        banner.appendChild(translateBar);
                    }

                    overlay.appendChild(banner);
                    document.body.appendChild(overlay);

                    // Translate the card text if non-English
                    if (userLang !== 'en') {
                        const textsToTranslate = [
                            'EMERGENCY',
                            ward ? `Ward: ${msg.ward}` : '',
                            bed ? `Bed: ${msg.bed}` : '',
                            String(catText),
                            msg.notes ? String(msg.notes) : '',
                        ].filter(Boolean);

                        fetch('/api/translate/batch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ texts: textsToTranslate, source: 'en', target: userLang }),
                        }).then(r => r.ok ? r.json() : null).then(data => {
                            if (!data || !overlay.parentNode) return;
                            const tr = data.translations as string[];
                            // Map translated texts back (same order as textsToTranslate, which was filtered)
                            let idx = 0;
                            const tEmergency = tr[idx++] || 'EMERGENCY';
                            const tWard = ward ? ` — ${tr[idx++]}` : '';
                            const tBed = bed ? ` ${tr[idx++]}` : '';
                            const tCat = tr[idx++] || String(catText);
                            const tNotes = msg.notes ? `<br/>${tr[idx++]}` : '';
                            const tBody = `<span style="font-size:13px;font-weight:400;opacity:0.9">${tCat}${tNotes}${senderText}</span>`;
                            // Swap in translated text (keep close button)
                            banner.innerHTML = `🚨 ${tEmergency}${tWard}${tBed}<br/>${tBody}`;
                            banner.appendChild(closeBtn); // re-append close button
                            // Remove translate bar
                            if (translateBar.parentNode) translateBar.remove();
                        }).catch(() => {
                            // Translation failed — just remove the loader, keep English
                            if (translateBar.parentNode) translateBar.remove();
                        });
                    }

                    // Cadence: 🔊🔊 TTS 🔊🔊 TTS 🔊 — auto-dismiss when done
                    playEmergencySequence(msg).then(() => {
                        // Only dismiss if overlay is still in the DOM (user didn't close it)
                        if (overlay.parentNode) dismissOverlay();
                    });
                } else if (msg.type === 'announcement') {
                    // General Announcement — yellow overlay on ALL devices
                    fireSystemNotification(
                        '📢 Announcement',
                        String(msg.message || ''),
                        'eve-announcement',
                    );
                    const aOverlay = document.createElement('div');
                    aOverlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(240,165,0,0.1);display:flex;align-items:center;justify-content:center;';
                    const aBanner = document.createElement('div');
                    aBanner.style.cssText = 'background:#f0a500;color:#000;padding:24px 40px;border-radius:16px;font-size:16px;font-weight:700;text-align:center;box-shadow:0 0 80px rgba(240,165,0,0.5);max-width:90%;position:relative;min-width:320px;';
                    const senderLine = msg.sender_name ? `<br/><span style="font-size:11px;font-weight:400;opacity:0.7">— ${msg.sender_name}</span>` : '';
                    aBanner.innerHTML = `📢 ANNOUNCEMENT<br/><span style="font-size:14px;font-weight:500">${msg.message || ''}</span>${senderLine}`;
                    // Close button
                    const aCloseBtn = document.createElement('button');
                    aCloseBtn.textContent = '×';
                    aCloseBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:none;border:none;color:#000;font-size:22px;cursor:pointer;opacity:0.5;line-height:1;padding:0 4px;';
                    aCloseBtn.onmouseenter = () => { aCloseBtn.style.opacity = '0.8'; };
                    aCloseBtn.onmouseleave = () => { aCloseBtn.style.opacity = '0.5'; };
                    const dismissAOverlay = () => { aOverlay.style.opacity = '0'; aOverlay.style.transition = 'opacity 0.6s'; setTimeout(() => aOverlay.remove(), 700); };
                    aCloseBtn.onclick = (ev) => { ev.stopPropagation(); dismissAOverlay(); };
                    aBanner.appendChild(aCloseBtn);

                    // Translate loader + translation
                    const aUserLang = localStorage.getItem('eve-lang') || 'en';
                    const aTranslateBar = document.createElement('div');
                    if (aUserLang !== 'en') {
                        aTranslateBar.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 16px;margin-top:12px;border-radius:8px;background:rgba(80,200,120,0.15);';
                        aTranslateBar.innerHTML = '<div style="width:14px;height:14px;border:2px solid #50C87844;border-top:2px solid #50C878;border-radius:50%;animation:spin 0.8s linear infinite"></div><span style="font-size:11px;color:#50C878;font-weight:500;letter-spacing:0.04em">Translating...</span>';
                        aBanner.appendChild(aTranslateBar);
                    }

                    aOverlay.appendChild(aBanner);
                    document.body.appendChild(aOverlay);

                    // Translate card text
                    if (aUserLang !== 'en' && msg.message) {
                        fetch('/api/translate/batch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ texts: ['ANNOUNCEMENT', String(msg.message)], source: 'en', target: aUserLang }),
                        }).then(r => r.ok ? r.json() : null).then(data => {
                            if (!data || !aOverlay.parentNode) return;
                            const tr = data.translations as string[];
                            aBanner.innerHTML = `📢 ${tr[0] || 'ANNOUNCEMENT'}<br/><span style="font-size:14px;font-weight:500">${tr[1] || msg.message}</span>${senderLine}`;
                            aBanner.appendChild(aCloseBtn);
                            if (aTranslateBar.parentNode) aTranslateBar.remove();
                        }).catch(() => {
                            if (aTranslateBar.parentNode) aTranslateBar.remove();
                        });
                    }

                    // Cadence: General_start → TTS → General_end — auto-dismiss when done
                    playAnnouncementSequence(msg).then(() => {
                        if (aOverlay.parentNode) dismissAOverlay();
                    });
                } else if (msg.type === 'broadcast_audio') {
                    // Server-synthesized TTS audio — play immediately on all devices
                    try {
                        const audio = new Audio(`data:audio/wav;base64,${msg.audio_b64}`);
                        audio.volume = 1.0;
                        audio.play().catch(() => {});
                    } catch { /* no audio support */ }
                } else if (msg.type === 'alert') {
                    const myName = localStorage.getItem('eve-mesh-name') || '';
                    const myMode = localStorage.getItem('eve-mesh-mode') || '';
                    const isLeader = myMode === 'leader';
                    const isForMe = !msg.target_name || msg.target_name.toLowerCase().trim() === myName.toLowerCase().trim();
                    if (isForMe || isLeader) {
                        try {
                            const audio = new Audio('/data/sounds/message alert.wav');
                            audio.volume = 0.5;
                            audio.play().catch(() => { });
                        } catch { /* no audio */ }
                        const banner = document.createElement('div');
                        banner.style.cssText = `position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:10000;background:${msg.priority === 'critical' ? '#e74c3c' : msg.priority === 'urgent' ? '#f0a500' : '#3fb950'};color:#000;padding:14px 28px;border-radius:12px;font-size:14px;font-weight:600;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);animation:slideIn 0.4s ease;max-width:90%;`;
                        banner.innerHTML = `<strong>ALERT${msg.sender_name ? ' from ' + msg.sender_name : ''}${msg.target_name ? ' → ' + msg.target_name : ''}</strong><br/>${msg.message}`;
                        document.body.appendChild(banner);
                        setTimeout(() => { banner.style.opacity = '0'; banner.style.transition = 'opacity 0.5s'; setTimeout(() => banner.remove(), 600); }, 6000);
                    }
                } else if (msg.type === 'new_task_notify') {
                    // Softer tone for new tasks — ALL devices
                    try {
                        const audio = new Audio('/data/sounds/message alert.wav');
                        audio.volume = 0.25;
                        audio.play().catch(() => { });
                    } catch { /* no audio */ }
                } else if (msg.type === 'chat') {
                    // Chat notification — soft ping
                    const myName = localStorage.getItem('eve-mesh-name') || '';
                    const isForMe = !msg.target_name || msg.target_name.toLowerCase().trim() === myName.toLowerCase().trim();
                    const isFromMe = msg.sender_name?.toLowerCase().trim() === myName.toLowerCase().trim();
                    if (isForMe && !isFromMe) {
                        try {
                            const audio = new Audio('/data/sounds/message alert.wav');
                            audio.volume = 0.15;
                            audio.play().catch(() => { });
                        } catch { /* no audio */ }
                    }
                } else if (['call_request', 'call_accept', 'call_reject', 'call_end',
                            'webrtc_offer', 'webrtc_answer', 'webrtc_ice'].includes(msg.type)) {
                    // Dispatch to CommsPanel for state management
                    // call_request is handled by DOM banner below; webrtc_* go straight to CommsPanel
                    if (msg.type !== 'call_request') {
                        window.dispatchEvent(new CustomEvent('eve-call-signal', { detail: msg }));
                    }

                    if (msg.type === 'call_request') {
                        // ── Global incoming call ringtone + banner (works on any tab) ──
                        // Ringtone
                        const _ring = new Audio('/data/sounds/ringtone.wav');
                        _ring.volume = 0.6;
                        _ring.loop = true;
                        _ring.play().catch(() => { });
                        _eveRingtone = _ring;

                        // DOM-injected incoming call banner
                        const overlay = document.createElement('div');
                        overlay.id = 'eve-incoming-call';
                        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10002;display:flex;justify-content:space-between;align-items:center;padding:16px 24px;background:linear-gradient(135deg,#0d2d0d,#1a3a1a);border-bottom:3px solid #3fb950;box-shadow:0 4px 24px rgba(63,185,80,0.3);';
                        const callTypeLabel = msg.call_type === 'video' ? 'Video' : 'Voice';
                        const icon = msg.call_type === 'video' ? 'ðŸ“¹' : 'ðŸ“ž';
                        overlay.innerHTML = `
                            <div style="display:flex;align-items:center;gap:12px">
                                <span style="font-size:28px">${icon}</span>
                                <div>
                                    <div style="font-size:15px;font-weight:700;color:#e6edf3">Incoming ${callTypeLabel} Call</div>
                                    <div style="font-size:12px;color:#8b949e">from <span style="color:#3fb950;font-weight:600">${msg.caller_name || 'Unknown'}</span> (${msg.caller_role || 'responder'})</div>
                                </div>
                            </div>
                            <div style="display:flex;gap:8px">
                                <button id="eve-call-accept" style="padding:10px 24px;background:#3fb950;border:none;border-radius:8px;color:#000;font-size:14px;font-weight:700;cursor:pointer">Accept</button>
                                <button id="eve-call-reject" style="padding:10px 24px;background:#e74c3c;border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer">Reject</button>
                            </div>`;
                        document.body.appendChild(overlay);

                        // Accept → stop ring, remove banner, switch to Comms tab, dispatch accept
                        document.getElementById('eve-call-accept')?.addEventListener('click', () => {
                            if (_eveRingtone) { _eveRingtone.pause(); _eveRingtone = null; }
                            overlay.remove();
                            // Navigate to Comms tab by clicking it
                            const commsBtn = document.querySelector('.tab-btn:nth-child(2)') as HTMLElement;
                            if (commsBtn) commsBtn.click();
                            window.dispatchEvent(new CustomEvent('eve-call-signal', { detail: { ...msg, type: 'call_accept_local' } }));
                        });

                        // Reject → stop ring, remove banner, send reject signal
                        document.getElementById('eve-call-reject')?.addEventListener('click', () => {
                            if (_eveRingtone) { _eveRingtone.pause(); _eveRingtone = null; }
                            overlay.remove();
                            window.dispatchEvent(new CustomEvent('eve-call-send', {
                                detail: {
                                    type: 'call_reject', target_name: msg.caller_name,
                                    caller_name: localStorage.getItem('eve-mesh-name') || '',
                                    caller_role: localStorage.getItem('eve-mesh-role') || '',
                                    call_type: msg.call_type,
                                }
                            }));
                        });
                    } else if (msg.type === 'call_end' || msg.type === 'call_reject') {
                        // Clean up ringtone + banner if they exist
                        if (_eveRingtone) { _eveRingtone.pause(); _eveRingtone = null; }
                        document.getElementById('eve-incoming-call')?.remove();
                    }
                }
            } catch { /* ignore */ }
        };

        ws.onclose = () => {
            setConnected(false);
            if (_pingInterval) clearInterval(_pingInterval);
            // Auto-reconnect with 5s delay
            if (_reconnectAttempts < MAX_RECONNECT) {
                _reconnectAttempts++;
                setReconnecting(true);
                console.log(`[Mesh] Reconnecting (${_reconnectAttempts}/${MAX_RECONNECT})...`);
                _reconnectTimer = window.setTimeout(() => { connectWS(); }, RECONNECT_DELAY);
            } else {
                setReconnecting(false);
            }
        };

        ws.onerror = () => {
            setConnected(false);
            // onclose will fire after this and handle reconnect
        };

        // (eve-call-send listener is handled in a separate persistent useEffect below)
    }, [clientId, userName, userRole, fetchClients, fetchRoster]);

    const disconnectWS = useCallback(() => {
        _reconnectAttempts = MAX_RECONNECT; // prevent auto-reconnect on manual disconnect
        if (_pingInterval) clearInterval(_pingInterval);
        if (_reconnectTimeout) clearTimeout(_reconnectTimeout);
        if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
        if (_wsRef) {
            _wsRef.close();
            _wsRef = null;
        }
        setConnected(false);
        // Reset attempts after disconnect so future manual connects can retry
        setTimeout(() => { _reconnectAttempts = 0; }, 100);
    }, []);

    // ── Persistent call signal relay ─────────────────────────────────────────
    // Single listener that uses the module-level _wsRef so it survives reconnects
    useEffect(() => {
        const callSendHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (_wsRef && _wsRef.readyState === WebSocket.OPEN) {
                _wsRef.send(JSON.stringify(detail));
            }
        };
        window.addEventListener('eve-call-send', callSendHandler);
        return () => window.removeEventListener('eve-call-send', callSendHandler);
    }, []);



    // ── Start/Stop based on mode ─────────────────────────────────────────────

    useEffect(() => {
        if (mode === 'leader' || mode === 'client') {
            connectWS();
            fetchClients();
            fetchRoster();
            pollRef.current = window.setInterval(() => {
                fetchClients();
                fetchRoster();
            }, POLL_INTERVAL);
        }
        return () => {
            // Only stop polling on unmount — WS stays alive across tab switches
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [mode, connectWS, fetchClients, fetchRoster]);

    // ── Auto-close QR when a new client joins (avoids stale closure in WS handler) ──
    useEffect(() => {
        if (showQR && clients.length > prevClientCountRef.current && prevClientCountRef.current > 0) {
            setShowQR(false);
        }
        prevClientCountRef.current = clients.length;
    }, [clients.length, showQR]);

    // ── Activate / Disconnect ────────────────────────────────────────────────

    const handleActivate = (asLeader = false) => {
        if (!userName.trim()) return;
        const cid = localStorage.getItem('eve-mesh-client-id') || `node-${Date.now().toString(36)}`;
        localStorage.setItem('eve-mesh-name', userName);
        localStorage.setItem('eve-mesh-role', userRole);
        localStorage.setItem('eve-mesh-client-id', cid);
        // Network mode determined by which button was clicked, not role dropdown
        const targetMode = asLeader ? 'leader' : 'client';
        setPendingMode(targetMode);

        // Only clients register in the roster — the leader manages it, not in it
        if (!asLeader) {
            fetch(`${API_BASE}/api/roster`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: cid, name: userName, role: userRole, skills: [], status: 'online', assigned_task: '', notes: '' }),
            }).then(() => {
                // Re-upload avatar from localStorage if one exists
                const av = localStorage.getItem('eve-mesh-avatar');
                if (av) {
                    fetch(av).then(r => r.blob()).then(blob => {
                        const fd = new FormData();
                        fd.append('file', blob, 'avatar.webp');
                        fetch(`${API_BASE}/api/roster/${cid}/avatar`, { method: 'POST', body: fd }).catch(() => {});
                    }).catch(() => {});
                }
            }).catch(() => {});
        }

        if (asLeader) {
            // Leaders create the network — skip "Connecting..." and go straight to leader mode
            setMode('leader');
            localStorage.setItem('eve-mesh-mode', 'leader');
            connectWS();
            fetchClients();
            fetchRoster();
        } else {
            // Clients are joining an existing network — show confirming animation
            setMode('confirming');
        }
    };

    // ── Confirming → Final mode transition ────────────────────────────────────
    useEffect(() => {
        if (mode !== 'confirming') return;
        // Connect WS and start polling while confirming
        connectWS();
        fetchClients();
        fetchRoster();
        // After a brief confirmation display, transition to final mode
        const timer = setTimeout(() => {
            setMode(pendingMode);
            localStorage.setItem('eve-mesh-mode', pendingMode);
        }, 2000);
        return () => clearTimeout(timer);
    }, [mode, pendingMode, connectWS, fetchClients, fetchRoster]);

    const handleDisconnect = () => {
        disconnectWS();
        localStorage.removeItem('eve-mesh-mode');
        setMode('setup');
        setClients([]);
    };

    // ── Render: Confirming Mode ──────────────────────────────────────────────

    if (mode === 'confirming') {
        const roleColor = pendingMode === 'leader' ? '#3fb950' : userRole === 'medic' ? '#3498db' : '#888';
        return (
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
                <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
                    <div style={{ margin: '0 auto 24px', textAlign: 'center' }}>
                        <img src="/logos/halt.png" alt="HALT" style={{ width: 200, height: 200, objectFit: 'contain' }} />
                    </div>

                    {/* Connection spinner → checkmark */}
                    <div style={{ width: 64, height: 64, margin: '0 auto 20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, background: connected ? '#3fb95022' : '#f0a50022', border: `2px solid ${connected ? '#3fb950' : '#f0a500'}`, transition: 'all 0.4s' }}>
                        {connected ? '✓' : '⟳'}
                    </div>

                    <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>
                        {connected ? t('network.connected_label') : 'Connecting...'}
                    </h2>

                    <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 16 }}>
                        <div style={{ padding: '10px 20px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{t('network.name_label')}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{userName}</div>
                        </div>
                        <div style={{ padding: '10px 20px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{t('network.role')}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: roleColor, textTransform: 'uppercase' }}>{userRole}</div>
                        </div>
                    </div>

                    <div style={{ marginTop: 24, fontSize: 12, color: 'var(--text-faint)' }}>
                        {pendingMode === 'leader' ? t('network.activate_desc') : t('network.join_desc')}
                    </div>
                </div>
            </div>
        );
    }

    // ── Render: Setup Mode ───────────────────────────────────────────────────

    if (mode === 'setup') {
        return (
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
                <div style={{ width: '100%', maxWidth: 480 }}>
                    <div style={{ textAlign: 'center', marginBottom: 40 }}>
                        <div style={{ margin: '0 auto 16px', textAlign: 'center' }}><img src="/logos/halt.png" alt="HALT" style={{ width: 240, height: 240, objectFit: 'contain' }} /></div>
                        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Created by Hermetic Labs LLC</h2>
                        <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>{t('network.airgapped')}</p>
                    </div>

                    {/* Identity fields — shared by both paths */}
                    <div style={{ marginBottom: 24 }}>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{t('network.your_name')}</label>
                        <input className="if-input" value={userName} onChange={e => setUserName(e.target.value)} placeholder={t('network.name_placeholder')} style={{ width: '100%', fontSize: 16, padding: '12px 16px' }} />
                    </div>
                    <div style={{ marginBottom: 32 }}>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{t('network.role')}</label>
                        <select className="if-input" value={userRole} onChange={e => setUserRole(e.target.value)} style={{ width: '100%', fontSize: 14, padding: '10px 16px' }}>
                            <option value="responder">{t('network.responder')}</option>
                            <option value="medic">{t('network.medic')}</option>
                        </select>
                    </div>

                    {/* Two distinct paths */}
                    <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                        {/* Start Network (Leader) */}
                        <button
                            onClick={() => handleActivate(true)}
                            disabled={!userName.trim()}
                            style={{
                                flex: 1, padding: '20px 16px', background: '#0d1f0d',
                                border: '2px solid #3fb950', borderRadius: 12, color: '#3fb950',
                                cursor: userName.trim() ? 'pointer' : 'not-allowed',
                                opacity: userName.trim() ? 1 : 0.4,
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                                transition: 'all 0.2s',
                            }}
                        >
                            <span style={{ fontSize: 24 }}>📡</span>
                            <span style={{ fontSize: 14, fontWeight: 700 }}>Start Network</span>
                            <span style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'center' }}>Create a new mesh as the leader</span>
                        </button>

                        {/* Join Nearby (Client) */}
                        <button
                            onClick={() => handleActivate(false)}
                            disabled={!userName.trim()}
                            style={{
                                flex: 1, padding: '20px 16px', background: '#0d1a2d',
                                border: '2px solid #3498db', borderRadius: 12, color: '#3498db',
                                cursor: userName.trim() ? 'pointer' : 'not-allowed',
                                opacity: userName.trim() ? 1 : 0.4,
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                                transition: 'all 0.2s',
                            }}
                        >
                            <span style={{ fontSize: 24 }}>🔄</span>
                            <span style={{ fontSize: 14, fontWeight: 700 }}>Reconnect</span>
                            <span style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'center' }}>Rejoin an existing mesh</span>
                        </button>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: 'var(--text-faint)' }}>{t('network.footer')}</div>
                </div>
            </div>
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    const activeClients = clients.filter(c => c.online && !c.stale);

    // Enrich roster with live WebSocket connection status
    const activeClientNames = new Set(activeClients.map(c => c.name.toLowerCase().trim()));
    const enrichedRoster = roster
        .filter(m => {
            // Leaders don't belong in the roster — filter out the current user if they're the leader
            if (mode === 'leader' && m.name.toLowerCase().trim() === userName.toLowerCase().trim()) return false;
            return true;
        })
        .map(m => {
            const isLive = activeClientNames.has(m.name.toLowerCase().trim());
            return { ...m, status: isLive ? 'connected' : (m.status === 'connected' ? 'offline' : m.status) };
        });

    // ── Render: Active Network ───────────────────────────────────────────────

    return (
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

            {/* Top Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{t('network.mesh')}</h2>
                    <div style={{ fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#3fb950' : reconnecting ? '#f0a500' : '#e74c3c', display: 'inline-block', animation: reconnecting ? 'pulse 1s infinite' : 'none' }} />
                        <span style={{ color: connected ? '#3fb950' : reconnecting ? '#f0a500' : '#e74c3c' }}>{connected ? t('network.connected_label') : reconnecting ? `${t('network.reconnecting')} (${_reconnectAttempts}/${MAX_RECONNECT})` : t('network.offline_label')}</span>
                        <span style={{ color: 'var(--text-faint)' }}>/ {mode.toUpperCase()} / {userName}</span>
                        {leaderName && mode === 'client' && <span style={{ color: 'var(--text-muted)' }}>/ {t('network.leader_label')} {leaderName}</span>}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="if-toggle" onClick={handleDisconnect} style={{ color: '#e74c3c', borderColor: '#e74c3c55' }}>{t("network.disconnect")}</button>
                </div>
            </div>





            {/* Single unified content area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>



                {/* ── TEAM ROSTER — Single source of truth ──────────────────── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Team Roster ({enrichedRoster.filter(m => m.status === 'connected').length} online / {enrichedRoster.length} total)
                    </span>
                    <button className="if-toggle" onClick={() => setShowAddMember(!showAddMember)} style={{ background: '#0d1f0d', color: '#3fb950', border: '1px solid #3fb95055', fontSize: 11, padding: '4px 12px' }}>
                        {showAddMember ? t('inv.cancel') : t('network.add_member')}
                    </button>
                </div>

                {showAddMember && (
                    <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 16, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <input className="if-input" value={newMember.name} onChange={e => setNewMember(p => ({ ...p, name: e.target.value }))} placeholder={t('network.name_placeholder')} style={{ width: '100%' }} />
                        <select className="if-input" value={newMember.role} onChange={e => setNewMember(p => ({ ...p, role: e.target.value }))} style={{ width: '100%' }}>
                            <option value="responder">{t('network.responder')}</option>
                            <option value="medic">{t('network.medic')}</option>
                        </select>
                        <div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{t('network.skills')}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {SKILL_OPTIONS.map(skill => {
                                    const active = selectedSkills.includes(skill);
                                    return (
                                        <button key={skill} onClick={() => setSelectedSkills(prev => active ? prev.filter(s => s !== skill) : [...prev, skill])} style={{
                                            padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer', fontWeight: 600, border: active ? '1px solid #3fb950' : '1px solid var(--border)',
                                            background: active ? '#3fb95022' : 'var(--bg)', color: active ? '#3fb950' : 'var(--text-muted)', transition: 'all 0.15s',
                                        }}>{skill}</button>
                                    );
                                })}
                            </div>
                        </div>
                        <button onClick={() => { addMember(); if (newMember.name.trim()) fetchQR(newMember.name, newMember.role); }} disabled={!newMember.name.trim()} style={{ padding: '10px 16px', background: '#3fb950', border: 'none', borderRadius: 6, color: '#000', fontWeight: 600, cursor: 'pointer', opacity: newMember.name.trim() ? 1 : 0.4, fontSize: 13 }}>{t('network.add_roster_qr')}</button>
                    </div>
                )}

                {/* Roster List */}
                {enrichedRoster.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-faint)', fontSize: 13 }}>{t('network.no_roster')}</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {enrichedRoster.map(m => {
                            const isPending = m.status === 'pending';
                            const isConnected = m.status === 'connected';
                            const isOffline = m.status === 'offline';
                            const dotColor = isConnected ? '#3fb950' : isPending ? '#f0a500' : '#e74c3c';
                            const statusText = isPending ? t('network.waiting_scan') : isConnected ? t('network.connected_label') : isOffline ? t('network.offline_label') : m.status.toUpperCase();
                            return (
                                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--surface)', borderRadius: 6, border: `1px solid ${isPending ? '#f0a50033' : isConnected ? '#3fb95033' : 'var(--border)'}`, opacity: isPending ? 0.7 : 1, transition: 'opacity 0.3s, border-color 0.3s' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {m.avatar_url ? (
                                                <img src={m.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }} />
                                            ) : (
                                                <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--text-faint)' }}>👤</span>
                                            )}
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, display: 'inline-block', ...(isPending ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}) }} />
                                            <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{m.name}</span>
                                            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, fontWeight: 600, textTransform: 'uppercase', background: m.role === 'leader' ? '#3fb95022' : m.role === 'medic' ? '#3498db22' : '#44444422', color: m.role === 'leader' ? '#3fb950' : m.role === 'medic' ? '#3498db' : '#888' }}>{m.role}</span>
                                            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, fontWeight: 600, textTransform: 'uppercase', background: `${dotColor}15`, color: dotColor }}>{statusText}</span>
                                        </div>
                                        {m.skills.length > 0 && (
                                            <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                                                {m.skills.map(s => <span key={s} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{s}</span>)}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <button onClick={() => fetchQR(m.name, m.role)} style={{ background: '#3fb95015', border: '1px solid #3fb95044', color: '#3fb950', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>QR</button>
                                        <button onClick={() => removeMember(m.id)} style={{ background: 'transparent', border: '1px solid #44444466', color: '#888', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>{t('network.remove')}</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* QR Modal */}
            {showQR && qrData && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowQR(false)}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', width: '90%', maxWidth: 360, boxSizing: 'border-box' }}>
                        <h3 style={{ color: '#000', margin: '0 0 8px', fontSize: 18 }}>{qrMemberName ? `${t('network.qr_for')} ${qrMemberName}` : t('network.join_network')}</h3>
                        <p style={{ color: '#666', fontSize: 12, marginBottom: 16 }}>{qrMemberName ? `${t('network.role')}: ${qrMemberRole.toUpperCase()} — ${t('network.qr_role_scan')}` : t('network.scan_join')}</p>
                        {qrData.qr_image ? (
                            <img src={qrData.qr_image} alt="Join QR Code" style={{ width: 220, height: 220, margin: '0 auto 16px', display: 'block' }} />
                        ) : (
                            <div style={{ width: 220, height: 220, background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', borderRadius: 8, color: '#999' }}>{t('network.qr_unavailable')}</div>
                        )}
                        <div style={{ fontSize: 12, color: '#666', marginTop: 8, wordBreak: 'break-all' }}><strong>URL:</strong> {qrData.app_url}</div>
                        <button onClick={() => setShowQR(false)} style={{ marginTop: 20, width: '100%', padding: 12, background: '#222', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>{t('network.close')}</button>
                    </div>
                </div>
            )}
        </div>
    );
}
