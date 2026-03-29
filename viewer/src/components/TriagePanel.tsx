import { useState, useRef, useEffect, useCallback } from 'react';
import { useT } from '../services/i18n';
import './TriagePanel.css'; // We'll put the Triage scoped CSS here

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface SavedThread {
    id: string;
    title: string;
    messages: Message[];
    timestamp: number;
}

type PanelTab = 'chat' | 'translate';

// Thread localStorage helpers
const THREADS_KEY = 'eve-triage-threads';
const loadThreads = (): SavedThread[] => {
    try { return JSON.parse(localStorage.getItem(THREADS_KEY) || '[]'); } catch { return []; }
};
const saveThreads = (threads: SavedThread[]) => {
    try { localStorage.setItem(THREADS_KEY, JSON.stringify(threads.slice(-50))); } catch { /* full */ }
};

// Translation cache for triage panel (keyed by content hash)
const triageTranslationCache: Record<string, string> = {};

// All supported languages — matches /public/locales/*.json
const TRANSLATE_LANGS: [string, string][] = [
    ['en','English'],['am','Amharic'],['ar','Arabic'],['bn','Bengali'],['de','German'],
    ['es','Spanish'],['fa','Persian'],['fr','French'],['ha','Hausa'],['he','Hebrew'],
    ['hi','Hindi'],['id','Indonesian'],['ig','Igbo'],['it','Italian'],['ja','Japanese'],
    ['jw','Javanese'],['km','Khmer'],['ko','Korean'],['ku','Kurdish'],['la','Latin'],
    ['mg','Malagasy'],['mr','Marathi'],['my','Burmese'],['nl','Dutch'],['pl','Polish'],
    ['ps','Pashto'],['pt','Portuguese'],['ru','Russian'],['so','Somali'],['sw','Swahili'],
    ['ta','Tamil'],['te','Telugu'],['th','Thai'],['tl','Filipino'],['tr','Turkish'],
    ['uk','Ukrainian'],['ur','Urdu'],['vi','Vietnamese'],['xh','Xhosa'],['yo','Yoruba'],
    ['zh','Chinese'],['zu','Zulu'],
];



export default function TriagePanel({ onClose }: { onClose: () => void }) {
    const { t, lang } = useT();
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [voices, setVoices] = useState<{ id: string, name: string, language: string[], gender: string[] }[]>([]);
    const [selectedVoice, setSelectedVoice] = useState('af_heart');

    // Panel tab + thread state
    const [panelTab, setPanelTab] = useState<PanelTab>('chat');
    const [showThreadList, setShowThreadList] = useState(false);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [threads, setThreads] = useState<SavedThread[]>(loadThreads);


    // Translate tab state
    const [translateInput, setTranslateInput] = useState('');
    const [translateOutput, setTranslateOutput] = useState('');
    const [translateFrom, setTranslateFrom] = useState('en');
    const [translateTo, setTranslateTo] = useState('es');
    const [translating, setTranslating] = useState(false);

    // Auto-save thread when messages change
    useEffect(() => {
        if (messages.length === 0) return;
        const id = activeThreadId || `thread-${Date.now()}`;
        if (!activeThreadId) setActiveThreadId(id);
        const title = messages[0]?.content.slice(0, 50) || 'New Chat';
        setThreads(prev => {
            const without = prev.filter(th => th.id !== id);
            const updated = [...without, { id, title, messages, timestamp: Date.now() }];
            saveThreads(updated);
            return updated;
        });
    }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

    const loadThread = (thread: SavedThread) => {
        setMessages(thread.messages);
        setActiveThreadId(thread.id);
        setShowThreadList(false);
    };
    const deleteThread = (id: string) => {
        if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
        setThreads(prev => {
            const updated = prev.filter(th => th.id !== id);
            saveThreads(updated);
            return updated;
        });
        if (activeThreadId === id) { setMessages([]); setActiveThreadId(null); }
    };
    const newThread = () => {
        setMessages([]); setActiveThreadId(null);
        setShowThreadList(false);
    };

    const handleTranslate = async () => {
        if (!translateInput.trim()) return;
        setTranslating(true);
        setTranslateOutput('');
        const textToTranslate = translateInput.trim();
        setTranslateInput('');
        try {
            const r = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: textToTranslate, source: translateFrom, target: translateTo }),
            });
            if (r.ok) {
                const d = await r.json();
                const translated = d.translated || textToTranslate;
                setTranslateOutput(translated);
                // Auto-play through Kokoro TTS — pass the explicitly translated target language
                queueMicrotask(() => speak(translated, -1, translateTo));
            }
        } catch { setTranslateOutput('Translation unavailable offline'); }
        setTranslating(false);
    };

    const [isRecording, setIsRecording] = useState(false);
    const [, setSttStatus] = useState('● ready');
    const [isSending, setIsSending] = useState(false);
    const [streamingText, setStreamingText] = useState('');

    // Translation state
    const [triageTranslations, setTriageTranslations] = useState<Record<string, string>>({});
    const [isTriageTranslating, setIsTriageTranslating] = useState(false);
    const triageTranslatingRef = useRef(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const mediaRecRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    // TTS State
    const wsSpeakRef = useRef<WebSocket | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const nextTimeRef = useRef<number>(0);
    const ttsQueueRef = useRef<{text: string, lang: string}[]>([]);
    const [playingMsgIndex, setPlayingMsgIndex] = useState<number | null>(null);
    const speakingMsgRef = useRef<number | null>(null);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingText]);

    // ── Auto-translate assistant messages ─────────────────────────────────────
    const prevTriageLangRef = useRef(lang);

    useEffect(() => {
        // Detect language change — clear cache and reset.
        if (prevTriageLangRef.current !== lang) {
            prevTriageLangRef.current = lang;
            triageTranslatingRef.current = false;
            Object.keys(triageTranslationCache).forEach(k => delete triageTranslationCache[k]);
            setTriageTranslations({});
            setIsTriageTranslating(false);
            // Fall through — don't return, translate immediately below
        }

        if (lang === 'en' || messages.length === 0) return;

        const assistantMsgs = messages.filter(m =>
            m.role === 'assistant' && !m.content.startsWith('[IMG') && m.content.trim()
        );
        const untranslated = assistantMsgs.filter(m => !triageTranslationCache[m.content]);

        if (untranslated.length === 0) {
            const cached: Record<string, string> = {};
            for (const m of assistantMsgs) {
                if (triageTranslationCache[m.content]) cached[m.content] = triageTranslationCache[m.content];
            }
            if (Object.keys(cached).length > 0) queueMicrotask(() => setTriageTranslations(prev => ({ ...prev, ...cached })));
            return;
        }

        // Skip if already translating this exact batch
        if (triageTranslatingRef.current) return;

        const targetLang = lang;
        triageTranslatingRef.current = true;
        queueMicrotask(() => setIsTriageTranslating(true));
        (async () => {
            try {
                const res = await fetch('/api/translate/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        texts: untranslated.map(m => m.content),
                        source: 'en',
                        target: targetLang,
                    }),
                });
                if (res.ok && prevTriageLangRef.current === targetLang) {
                    const data = await res.json();
                    const newT: Record<string, string> = {};
                    untranslated.forEach((m, i) => {
                        triageTranslationCache[m.content] = data.translations[i];
                        newT[m.content] = data.translations[i];
                    });
                    setTriageTranslations(prev => ({ ...prev, ...newT }));
                }
            } catch { /* bridge offline */ }
            triageTranslatingRef.current = false;
            setIsTriageTranslating(false);
        })();
    }, [messages, lang]);

    // Init Health and Models
    const fetchHealth = useCallback(async () => {
        try {
            await fetch('/tts/health').catch(() => null);
        } catch (e) { console.error('Triage health check error', e); }
    }, []);

    const fetchVoices = useCallback(async () => {
        try {
            const vr = await fetch('/tts/voices');
            if (vr.ok) {
                const vd = await vr.json();
                setVoices(vd.voices || []);
            }
        } catch { /* optional feature */ }
    }, []);

    useEffect(() => {
        fetchHealth();
        fetchVoices();
        const inv = setInterval(fetchHealth, 20000);
        return () => clearInterval(inv);
    }, [fetchHealth, fetchVoices]);


    // ── TTS Logic ─────────────────────────────────────────────────────────────

    const lastSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const pendingChunksRef = useRef<number>(0);

    const playChunk = async (buf: ArrayBuffer) => {
        if (!audioCtxRef.current) return;
        if (audioCtxRef.current.state === 'suspended') {
            await audioCtxRef.current.resume().catch(() => { });
        }
        try {
            const dec = await audioCtxRef.current.decodeAudioData(buf);
            const src = audioCtxRef.current.createBufferSource();
            src.buffer = dec;
            src.connect(audioCtxRef.current.destination);

            const now = audioCtxRef.current.currentTime;
            if (nextTimeRef.current < now) {
                nextTimeRef.current = now + 0.15;
            }

            src.start(nextTimeRef.current);
            nextTimeRef.current += dec.duration;
            lastSourceRef.current = src;
        } catch { /* invalid chunk */ }
    };

    const ensureTtsWs = useCallback(() => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new window.AudioContext();
            nextTimeRef.current = audioCtxRef.current.currentTime + 0.1;
        }

        if (wsSpeakRef.current && wsSpeakRef.current.readyState === WebSocket.OPEN) return wsSpeakRef.current;
        if (wsSpeakRef.current && wsSpeakRef.current.readyState === WebSocket.CONNECTING) return wsSpeakRef.current;

        const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/tts/ws`;
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        wsSpeakRef.current = ws;

        ws.onopen = () => {
            ttsQueueRef.current.forEach(q => ws.send(JSON.stringify({ text: q.text, voice: selectedVoice, speed: 1.0, lang: q.lang })));
            ttsQueueRef.current = [];
        };
        ws.onmessage = async (e) => {
            if (e.data instanceof ArrayBuffer) {
                playChunk(e.data);
            } else {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'done') {
                        // Decrement pending counter — only finalize on the LAST chunk
                        pendingChunksRef.current = Math.max(0, pendingChunksRef.current - 1);
                        if (pendingChunksRef.current === 0) {
                            // All chunks generated — attach onended to last audio source
                            if (lastSourceRef.current) {
                                lastSourceRef.current.onended = () => {
                                    setPlayingMsgIndex(null);
                                    lastSourceRef.current = null;
                                };
                            } else {
                                setPlayingMsgIndex(null);
                            }
                        }
                    }
                } catch {
                    // Ignore non-JSON signals 
                }
            }
        };
        ws.onerror = () => { setPlayingMsgIndex(null); };
        ws.onclose = () => { wsSpeakRef.current = null; setPlayingMsgIndex(null); };
        return ws;
    }, [selectedVoice]);

    useEffect(() => {
        // Pre-warm socket on mount
        ensureTtsWs();
        return () => {
            if (wsSpeakRef.current) { wsSpeakRef.current.close(); }
            if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => { /* ignore */ }); }
        };
    }, [ensureTtsWs]);

    const stripMd = (text: string) => {
        return text
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/#{1,6}\s+/g, '')
            .replace(/`(.+?)`/g, '$1')
            .replace(/[*_#`]/g, '')
            .replace(/^\d+\.\s+/gm, '')           // numbered list prefixes
            .replace(/^[-•]\s+/gm, '')            // bullet markers
            .replace(/\n{2,}/g, '\n')              // collapse multi-newlines
            .replace(/[ \t]{2,}/g, ' ')             // collapse multi-spaces
            .trim();
    };

    const stopSpeak = () => {
        if (audioCtxRef.current) {
            try { audioCtxRef.current.close(); } catch { /* ignore audio error */ }
            audioCtxRef.current = null;
        }
        if (wsSpeakRef.current) {
            try { wsSpeakRef.current.close(); } catch { /* ignore */ }
            wsSpeakRef.current = null;
        }
        ttsQueueRef.current = [];
        lastSourceRef.current = null;
        pendingChunksRef.current = 0;
        setPlayingMsgIndex(null);
    };

    const speak = (text: string, msgIndex: number, overrideLang?: string) => {
        // Clean up previous audio — detach handlers first to prevent onclose from resetting state
        if (wsSpeakRef.current) {
            wsSpeakRef.current.onclose = null;
            wsSpeakRef.current.onerror = null;
            wsSpeakRef.current.onmessage = null;
            try { wsSpeakRef.current.close(); } catch { /* ignore */ }
            wsSpeakRef.current = null;
        }
        if (audioCtxRef.current) {
            try { audioCtxRef.current.close(); } catch { /* ignore */ }
            audioCtxRef.current = null;
        }
        ttsQueueRef.current = [];

        // Show Stop immediately
        setPlayingMsgIndex(msgIndex);
        speakingMsgRef.current = msgIndex;

        // Create fresh audio context
        audioCtxRef.current = new window.AudioContext();
        nextTimeRef.current = audioCtxRef.current.currentTime + 0.1;
        if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => { });
        }

        const cleanText = stripMd(text);
        if (!cleanText) { setPlayingMsgIndex(null); return; }


        // Filter whitespace-only chunks and split text into clean sentences
        const chunks = cleanText.match(/[^.!?\n]+[.!?\n]+/g) || [cleanText];
        const validChunks = chunks.map(c => c.trim()).filter(c => c.length > 0);

        // Ensure WS is alive
        const ws = ensureTtsWs();

        // Track how many chunks are pending so we know when the last 'done' arrives
        pendingChunksRef.current = validChunks.length;

        const speechLang = overrideLang || lang;

        if (ws.readyState === WebSocket.OPEN) {
            validChunks.forEach(c => ws.send(JSON.stringify({ text: c, voice: selectedVoice, speed: 1.0, lang: speechLang })));
        } else {
            validChunks.forEach(c => ttsQueueRef.current.push({ text: c, lang: speechLang }));
        }
    };

    // ── Rendering Helpers ──────────────────────────────────────────────────────

    const renderMd = (text: string) => {
        // Reformat numbered steps that run together on one line (common after translation)
        // Insert newline before "2. ", "3. ", etc. (but not "1." since it's the start)
        const formatted = text.replace(/(?<!\n)\s+(\d+)\.\s/g, '\n$1. ');

        const parts = formatted.split(/(\*\*[^*]+\*\*)/g);
        return parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                const label = part.slice(2, -2);
                return <strong key={i}>{label}</strong>;
            }

            let htmlStr = part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            htmlStr = htmlStr.replace(/\*(?!\*)(.+?)(?<!\*)\*/g, '<em>$1</em>');
            htmlStr = htmlStr.replace(/^[*\-•] +(.+)$/gm, '<li>$1</li>');
            // Format numbered lists as list items
            htmlStr = htmlStr.replace(/^(\d+)\.\s+(.+)$/gm, '<li><strong>$1.</strong> $2</li>');
            htmlStr = htmlStr.replace(/\n/g, '<br/>');

            return <span key={i} dangerouslySetInnerHTML={{ __html: htmlStr }} />;
        });
    };

    // ── Actions ───────────────────────────────────────────────────────────────


    const handleSend = async () => {
        const txt = input.trim();
        if (!txt) return;

        setInput('');
        setIsSending(true);


        // If user is non-English, translate input to English for the LLM
        let englishTxt = txt;
        if (lang !== 'en') {
            try {
                const tr = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: txt, source: lang, target: 'en' }),
                });
                if (tr.ok) {
                    const td = await tr.json();
                    englishTxt = td.translated || txt;
                }
            } catch { /* fallback to original */ }
        }

        const newHist = [...messages, { role: 'user', content: txt } as Message];
        setMessages(newHist);

        // Inject persona — use English translation for LLM
        const payloadHist = [...newHist];
        const lastIdx = payloadHist.length - 1;
        if (lastIdx >= 0) {
            payloadHist[lastIdx] = {
                role: 'user',
                content: `<context>\nYou are a field medic AI in a survival kit. Give direct, actionable clinical information only. NO disclaimers, NO suggestions to see a doctor, NO hedging.\n</context>\n\nQuery: ${englishTxt}`
            };
        }

        try {
            const r = await fetch('/inference/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: payloadHist,
                    max_tokens: 512,
                    temperature: 0.7,
                    user_name: localStorage.getItem('eve-mesh-name') || '',
                }),
            });
            if (!r.ok) throw new Error(`${r.statusText}`);

            if (!r.body) throw new Error("No body");
            const reader = r.body.getReader();
            const dec = new TextDecoder();
            let full = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                for (const line of dec.decode(value).split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const d = JSON.parse(line.slice(6));
                        if (d.type === 'queued') {
                            setStreamingText(`⏳ In queue (position ${d.position})${d.active_user ? ` — ${d.active_user} is generating…` : '…'}`);
                        } else if (d.type === 'token') {
                            full += d.token;
                            setStreamingText(full);
                        }
                    } catch { /* incomplete json chunk */ }
                }
            }

            setMessages(prev => [...prev, { role: 'assistant', content: full }]);
            setStreamingText('');

        } catch (e) {
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${(e as Error).message}` }]);
            setStreamingText('');
        } finally {
            setIsSending(false);
        }
    };

    const handleMic = async () => {
        if (isRecording) {
            if (mediaRecRef.current) {
                mediaRecRef.current.requestData();   // flush any buffered data
                mediaRecRef.current.stop();
            }
            setIsRecording(false);
            setSttStatus('● transcribing…');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Pick best supported MIME — Safari needs mp4/aac, Chrome/Firefox use webm
            let mimeType = '';
            for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac']) {
                if (MediaRecorder.isTypeSupported(mime)) { mimeType = mime; break; }
            }

            const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
            mediaRecRef.current = mr;
            audioChunksRef.current = [];

            mr.ondataavailable = e => {
                if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            mr.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());

                // Build blob from collected chunks
                const actualMime = mr.mimeType || mimeType || 'audio/webm';
                const blob = new Blob(audioChunksRef.current, { type: actualMime });

                if (blob.size === 0) {
                    console.warn('[STT] Empty recording blob — no audio captured');
                    setSttStatus('● no audio captured');
                    setTimeout(() => setSttStatus('● ready'), 3000);
                    return;
                }

                // Match filename extension to actual MIME
                const ext = actualMime.includes('mp4') ? '.mp4'
                          : actualMime.includes('ogg') ? '.ogg'
                          : actualMime.includes('aac') ? '.aac'
                          : '.webm';

                const fd = new FormData();
                fd.append('audio', blob, `recording${ext}`);
                try {
                    const r = await fetch('/stt/listen', { method: 'POST', body: fd });
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    const d = await r.json();
                    const txt = (d.text || '').trim();
                    if (txt) {
                        // Route to whichever input is active
                        if (panelTab === 'translate') {
                            setTranslateInput(prev => prev ? prev + ' ' + txt : txt);
                        } else {
                            setInput(prev => prev ? prev + ' ' + txt : txt);
                        }
                    } else {
                        console.warn('[STT] Server returned empty text', d);
                        setSttStatus('● no speech detected');
                        setTimeout(() => setSttStatus('● ready'), 3000);
                        return;
                    }
                    setSttStatus(`● transcribed (${d.language || 'auto'})`);
                    setTimeout(() => setSttStatus('● ready'), 3000);
                } catch (e) {
                    console.error('[STT] Fetch failed:', e);
                    setSttStatus(`STT failed: ${(e as Error).message}`);
                    setTimeout(() => setSttStatus('● ready'), 4000);
                }
            };

            // Start with timeslice to get periodic chunks (more reliable on mobile)
            mr.start(250);
            setIsRecording(true);
            setSttStatus('● recording…');
        } catch (e) {
            console.error('[STT] Mic error:', e);
            setSttStatus(`Mic error: ${(e as Error).message}`);
            setTimeout(() => setSttStatus('● ready'), 3000);
        }
    };


    return (
        <div className="triage-panel">
            <header className="triage-header">
                {/* Thread list toggle */}
                <button
                    className="triage-close-btn"
                    onClick={() => setShowThreadList(s => !s)}
                    title="Chat history"
                    style={{ fontSize: 14 }}
                >☰</button>

                {/* Tab bar */}
                <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 6, padding: 2 }}>
                    {(['chat', 'translate'] as PanelTab[]).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setPanelTab(tab)}
                            style={{
                                padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                                background: panelTab === tab ? '#3fb95022' : 'transparent',
                                color: panelTab === tab ? '#3fb950' : 'var(--text-faint)',
                            }}
                        >{tab === 'chat' ? '💬 Chat' : '🌐 Translate'}</button>
                    ))}
                </div>

                <div style={{ flex: 1 }} />

                {panelTab === 'chat' && (
                        <select className="triage-select triage-voice-select" value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)}>
                            {voices.length > 0 ? voices.map(v => (
                                <option key={v.id} value={v.id}>{v.name} ({v.language[0]}{v.gender[0]})</option>
                            )) : <option value="af_heart">Heart (US-F)</option>}
                        </select>
                )}

                <button className="triage-close-btn" onClick={onClose}>×</button>
            </header>

            {/* Thread History Sidebar */}
            {showThreadList && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 20, display: 'flex',
                }}>
                    <div style={{
                        width: '100%', maxWidth: 280, background: 'var(--bg)',
                        borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
                        overflow: 'hidden',
                    }}>
                        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>📚 Chat History</span>
                            <button
                                onClick={newThread}
                                style={{ padding: '4px 10px', fontSize: 11, background: '#3fb95022', border: '1px solid #3fb95044', borderRadius: 4, color: '#3fb950', cursor: 'pointer', fontWeight: 600 }}
                            >+ New</button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {threads.length === 0 ? (
                                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No saved chats yet</div>
                            ) : [...threads].reverse().map(th => (
                                <div
                                    key={th.id}
                                    onClick={() => loadThread(th)}
                                    style={{
                                        padding: '10px 14px', cursor: 'pointer',
                                        borderBottom: '1px solid var(--border)',
                                        background: activeThreadId === th.id ? 'var(--surface)' : 'transparent',
                                        borderLeft: activeThreadId === th.id ? '3px solid #3fb950' : '3px solid transparent',
                                    }}
                                >
                                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {th.title}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                        <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                                            {th.messages.length} msgs · {new Date(th.timestamp).toLocaleDateString()}
                                        </span>
                                        <button
                                            onClick={e => { e.stopPropagation(); deleteThread(th.id); }}
                                            style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, opacity: 0.5, padding: '0 4px' }}
                                        >×</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div onClick={() => setShowThreadList(false)} style={{ flex: 1, background: '#0008' }} />
                </div>
            )}

            {/* ── Translate Tab ─────────────────────────────────────────── */}
            {panelTab === 'translate' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 12, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                            className="triage-select"
                            value={translateFrom}
                            onChange={e => setTranslateFrom(e.target.value)}
                            style={{ flex: 1 }}
                        >
                            {TRANSLATE_LANGS.map(([c,n]) => (
                                <option key={c} value={c}>{n}</option>
                            ))}
                        </select>
                        <button
                            onClick={() => { setTranslateFrom(translateTo); setTranslateTo(translateFrom); setTranslateOutput(''); }}
                            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14 }}
                        >⇄</button>
                        <select
                            className="triage-select"
                            value={translateTo}
                            onChange={e => setTranslateTo(e.target.value)}
                            style={{ flex: 1 }}
                        >
                            {TRANSLATE_LANGS.map(([c,n]) => (
                                <option key={c} value={c}>{n}</option>
                            ))}
                        </select>
                    </div>
                    <textarea
                        className="triage-textarea"
                        rows={4}
                        placeholder="Enter text to translate..."
                        value={translateInput}
                        onChange={e => setTranslateInput(e.target.value)}
                        style={{ resize: 'vertical' }}
                    />
                    <button
                        onClick={handleTranslate}
                        disabled={!translateInput.trim() || translating}
                        className="triage-send-btn"
                        style={{ alignSelf: 'flex-end' }}
                    >{translating ? 'Translating...' : '🌐 Translate'}</button>
                    {translateOutput && (
                        <div>
                            <div style={{
                                padding: 14, background: 'var(--surface)', borderRadius: 8,
                                border: '1px solid var(--border)', fontSize: 14, lineHeight: 1.5,
                                color: 'var(--text)', whiteSpace: 'pre-wrap',
                            }}>{translateOutput}</div>
                            <button
                                onClick={() => {
                                    if (playingMsgIndex === -1) { stopSpeak(); }
                                    else { speak(translateOutput, -1, translateTo); }
                                }}
                                className={`triage-play-btn ${playingMsgIndex === -1 ? 'playing' : ''}`}
                                style={{ marginTop: 8 }}
                            >{playingMsgIndex === -1 ? '◼ Stop' : '▶ Speak again'}</button>
                            <button
                                onClick={() => { stopSpeak(); setTranslateOutput(''); }}
                                className="triage-play-btn"
                                style={{ marginTop: 8, marginLeft: 8 }}
                            >✕ Clear</button>
                        </div>
                    )}
                </div>
            )}

            {/* ── Chat Tab ──────────────────────────────────────────────── */}
            {panelTab === 'chat' && (

            <div className="triage-messages">
                {isTriageTranslating && (
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        padding: '8px 16px', borderBottom: '1px solid var(--border)',
                        background: 'rgba(80, 200, 120, 0.06)',
                    }}>
                        <div style={{
                            width: 14, height: 14, border: '2px solid #50C87844',
                            borderTop: '2px solid #50C878', borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                        }} />
                        <span style={{ fontSize: 11, color: '#50C878', fontWeight: 500, letterSpacing: '0.04em' }}>
                            {t('comms.translating') || 'Translating...'}
                        </span>
                    </div>
                )}
                {messages.map((m, i) => (
                <div key={i} className={`triage-row ${m.role}`}>
                    <div className="triage-lbl">{m.role === 'user' ? 'YOU' : 'TRIAGE AI'}</div>
                    <div className={`triage-bubble ${m.role}`}>
                        {lang !== 'en' && m.role === 'assistant' && triageTranslations[m.content] ? (
                            <>
                                {renderMd(triageTranslations[m.content])}
                                <details style={{ marginTop: 6 }}>
                                    <summary style={{ fontSize: 10, color: 'var(--text-faint)', cursor: 'pointer' }}>Original (English)</summary>
                                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4, fontStyle: 'italic', borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                                        {renderMd(m.content)}
                                    </div>
                                </details>
                            </>
                        ) : (
                            renderMd(m.content)
                        )}
                        {m.role === 'assistant' && (
                            <button
                                className={`triage-play-btn ${playingMsgIndex === i ? 'playing' : ''}`}
                                onClick={() => {
                                    const textToSpeak = lang !== 'en' && triageTranslations[m.content]
                                        ? triageTranslations[m.content] : m.content;
                                    if (playingMsgIndex === i) { stopSpeak(); } else { speak(textToSpeak, i); }
                                }}
                                style={{ marginTop: 8 }}
                                disabled={playingMsgIndex !== null && playingMsgIndex !== i}
                            >
                                {playingMsgIndex === i ? '◼ Stop' : '▶ Speak'}
                            </button>
                        )}
                    </div>
                </div>
            ))}

                {streamingText && (
                    <div className="triage-row assistant">
                        <div className="triage-lbl">TRIAGE AI</div>
                        <div className="triage-bubble assistant">
                            {renderMd(streamingText)}
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
            )}

            <footer className="triage-footer">
                <div className="triage-input-row">
                    <button
                        className={`triage-mic-btn ${isRecording ? 'rec' : ''}`}
                        onClick={handleMic}
                        title="Voice input"
                    >
                        {isRecording ? '⏹' : '🎙'}
                    </button>
                    {panelTab === 'chat' && (
                        <>
                            <textarea
                                className="triage-textarea"
                                rows={2}
                                placeholder="Ask anything clinical…"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                                }}
                            />
                            <button
                                className="triage-send-btn"
                                onClick={handleSend}
                                disabled={!input.trim() || isSending}
                            >
                                Send
                            </button>
                        </>
                    )}
                    {panelTab === 'translate' && (
                        <span style={{ fontSize: 11, color: 'var(--text-faint)', flex: 1 }}>
                            {isRecording ? '● Recording…' : 'Tap mic to dictate into translate box'}
                        </span>
                    )}
                </div>
            </footer>
        </div>
    );
}
