import { useState, useRef, useEffect } from 'react';
import { useT } from '../services/i18n';
import { useTTS } from '../hooks/useTTS';
import TranslatorPanel from './TranslatorPanel';
import { isNative, translateText, translateBatch, sttListen } from '../services/api';
import { convertWebmToWav } from '../services/audioUtils';
import './TriagePanel.css';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    image?: string;
}

interface SavedThread {
    id: string;
    title: string;
    messages: Message[];
    timestamp: number;
}

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


export default function TriagePanel({ onClose }: { onClose: () => void }) {
    const { t, lang } = useT();
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [pendingImage, setPendingImage] = useState<string | null>(null);
    const [deepAnalysis, setDeepAnalysis] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Thread state
    const [showThreadList, setShowThreadList] = useState(false);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [threads, setThreads] = useState<SavedThread[]>(loadThreads);

    // Translator overlay
    const [showTranslator, setShowTranslator] = useState(false);

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

    const [isRecording, setIsRecording] = useState(false);
    const [, setSttStatus] = useState('\u25cf ready');
    const [isSending, setIsSending] = useState(false);
    const [streamingText, setStreamingText] = useState('');

    // Translation state
    const [triageTranslations, setTriageTranslations] = useState<Record<string, string>>({});
    const [isTriageTranslating, setIsTriageTranslating] = useState(false);
    const triageTranslatingRef = useRef(false);
    const [isModelLoading, setIsModelLoading] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const mediaRecRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingText]);

    // Poll model loading status
    useEffect(() => {
        let timer: number;
        if (isSending && !streamingText) {
            timer = window.setInterval(async () => {
                if (isNative) {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const status = await invoke<{ loading: boolean }>('inference_queue_status').catch(() => null);
                    if (status) setIsModelLoading(status.loading);
                }
            }, 500);
        } else {
            setIsModelLoading(false);
        }
        return () => window.clearInterval(timer);
    }, [isSending, streamingText]);

    // ── Auto-translate assistant messages ─────────────────────────────────────
    const prevTriageLangRef = useRef(lang);

    useEffect(() => {
        if (prevTriageLangRef.current !== lang) {
            prevTriageLangRef.current = lang;
            triageTranslatingRef.current = false;
            Object.keys(triageTranslationCache).forEach(k => delete triageTranslationCache[k]);
            setTriageTranslations({});
            setIsTriageTranslating(false);
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

        if (triageTranslatingRef.current) return;

        const targetLang = lang;
        triageTranslatingRef.current = true;
        queueMicrotask(() => setIsTriageTranslating(true));
        (async () => {
            try {
                const data = await translateBatch(
                    untranslated.map(m => m.content),
                    'en',
                    targetLang,
                );
                if (prevTriageLangRef.current === targetLang) {
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


    // ── TTS Logic (via shared hook) ───────────────────────────────────────────

    const { speak: ttsSpeak, stopSpeak: ttsStop, isSpeaking: ttsActive } = useTTS();
    const [playingMsgIndex, setPlayingMsgIndex] = useState<number | null>(null);
    const speakingMsgRef = useRef<number | null>(null);

    // Sync hook's isSpeaking -> playingMsgIndex
    useEffect(() => {
        if (!ttsActive && playingMsgIndex !== null) {
            setPlayingMsgIndex(null);
            speakingMsgRef.current = null;
        }
    }, [ttsActive, playingMsgIndex]);

    const stopSpeak = () => {
        ttsStop();
        setPlayingMsgIndex(null);
        speakingMsgRef.current = null;
    };

    const speak = (text: string, msgIndex: number, overrideLang?: string) => {
        setPlayingMsgIndex(msgIndex);
        speakingMsgRef.current = msgIndex;
        const speechLang = overrideLang || lang;
        ttsSpeak(text, speechLang);
    };

    // ── Rendering Helpers ──────────────────────────────────────────────────────

    const renderMd = (text: string) => {
        const elements: React.ReactNode[] = [];

        // Extract <context> -> collapsible system card
        const contextBlocks: string[] = [];
        let working = text.replace(/<context>([\s\S]*?)<\/context>/gi, (_, content) => {
            contextBlocks.push(content.trim());
            return '';
        });

        // Reformat leaked special tokens as turn separators
        working = working
            .replace(/<start_of_turn>\s*user\s*\n?/gi, '\n---\n**YOU:**\n')
            .replace(/<start_of_turn>\s*model\s*\n?/gi, '\n---\n**TRIAGE AI:**\n')
            .replace(/<end_of_turn>/gi, '')
            .replace(/<\/?bos>/gi, '')
            .replace(/<\/?eos>/gi, '')
            .trim();

        if (contextBlocks.length > 0) {
            elements.push(
                <details key="ctx-0" className="triage-context-card">
                    <summary>System Directive</summary>
                    <div className="triage-context-content">{contextBlocks.join('\n')}</div>
                </details>
            );
        }

        // Split on "Response:" -- before is reasoning
        const respIdx = working.search(/\bResponse:\s*/i);
        let reasoning = '';
        let mainContent = working;
        if (respIdx >= 0) {
            reasoning = working.slice(0, respIdx).trim();
            mainContent = working.slice(respIdx).replace(/^Response:\s*/i, '').trim();
        }

        // Handle <think>/<thought> tags
        mainContent = mainContent.replace(/<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>/gi, (_, content) => {
            reasoning = (reasoning + '\n' + content).trim();
            return '';
        }).trim();

        // Handle unclosed <think>/<thought> tags while streaming
        mainContent = mainContent.replace(/<(?:think|thought)>([\s\S]*)$/gi, (_, content) => {
            reasoning = (reasoning + '\n' + content).trim();
            return '';
        }).trim();

        if (reasoning) {
            reasoning = reasoning.replace(/^Query:\s*.*$/gm, '').trim();
        }
        if (reasoning) {
            elements.push(
                <details key="think-0" className="triage-thought-bubble">
                    <summary>{'\ud83e\udde0'} Reasoning</summary>
                    <div className="triage-thought-content">{reasoning}</div>
                </details>
            );
        }

        // Full markdown rendering
        if (mainContent) {
            let md = mainContent.replace(/(?<!\n)\s+(\d+)\.\s/g, '\n$1. ');
            md = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
                `<pre class="triage-code"><code>${code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></pre>`
            );
            md = md.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
                const rows = tableBlock.trim().split('\n').filter(r => r.trim());
                if (rows.length < 2) return tableBlock;
                const dataRows = rows.filter(r => !/^\|[\s\-:|]+\|$/.test(r));
                const headerCells = dataRows[0]?.split('|').filter(c => c.trim()) || [];
                const bodyRows = dataRows.slice(1);
                let html = '<table class="triage-table"><thead><tr>';
                headerCells.forEach(c => { html += `<th>${c.trim()}</th>`; });
                html += '</tr></thead><tbody>';
                bodyRows.forEach(row => {
                    const cells = row.split('|').filter(c => c.trim());
                    html += '<tr>';
                    cells.forEach(c => { html += `<td>${c.trim()}</td>`; });
                    html += '</tr>';
                });
                html += '</tbody></table>';
                return html;
            });
            md = md.replace(/^#### +(.+)$/gm, '<h4 class="triage-h4">$1</h4>');
            md = md.replace(/^### +(.+)$/gm, '<h3 class="triage-h3">$1</h3>');
            md = md.replace(/^## +(.+)$/gm, '<h2 class="triage-h2">$1</h2>');
            md = md.replace(/^# +(.+)$/gm, '<h1 class="triage-h1">$1</h1>');
            md = md.replace(/^---+$/gm, '<hr class="triage-hr"/>');
            md = md.replace(/^> +(.+)$/gm, '<blockquote class="triage-bq">$1</blockquote>');
            md = md.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
            md = md.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            md = md.replace(/\*(?!\*)(.+?)(?<!\*)\*/g, '<em>$1</em>');
            md = md.replace(/`([^`]+)`/g, '<code class="triage-inline-code">$1</code>');
            // Bullet items: * or - or bullet char -> styled list item with green arrow
            md = md.replace(/^[*\-\u2022] +\*\*(.+?)\*\*:\s*(.+)$/gm, '<div class="triage-label-card"><span class="triage-label-tag">$1</span><span class="triage-label-body">$2</span></div>');
            md = md.replace(/^[*\-\u2022] +(.+)$/gm, '<div class="triage-bullet">$1</div>');
            md = md.replace(/^(\d+)\.\s+(.+)$/gm, '<div class="triage-step"><span class="triage-step-num">$1</span><span class="triage-step-body">$2</span></div>');
            // Label lines ending with colon (e.g. "Clinical Significance:") -> break after
            md = md.replace(/^(\*\*[^*]+\*\*):\s*/gm, '<br/><strong class="triage-section-label">$1</strong>:<br/>');
            md = md.replace(/\n(?!<)/g, '<br/>');
            elements.push(
                <div key="md-main" className="triage-md-content" dangerouslySetInnerHTML={{ __html: md }} />
            );
        }
        return elements;
    };

    // ── Image handling ────────────────────────────────────────────────────────

    const processImageFile = (file: File) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = () => {
            img.onload = () => {
                const MAX = 512;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) {
                    const scale = MAX / Math.max(w, h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0, w, h);
                setPendingImage(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith('image/')) processImageFile(file);
        e.target.value = '';
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = Array.from(e.clipboardData.items);
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) processImageFile(file);
                return;
            }
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) processImageFile(file);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    // ── Actions ───────────────────────────────────────────────────────────────

    const handleSend = async () => {
        const txt = input.trim();
        if (!txt && !pendingImage) return;

        const imageToSend = pendingImage;
        setInput('');
        setPendingImage(null);
        setIsSending(true);

        // If user is non-English, translate input to English for the LLM
        let englishTxt = txt;
        if (lang !== 'en') {
            try {
                const td = await translateText(txt, lang, 'en');
                englishTxt = td.translated || txt;
            } catch { /* fallback to original */ }
        }

        const newHist = [...messages, { role: 'user', content: txt || t('triage.image_sent', 'Analyze this image'), image: imageToSend || undefined } as Message];
        setMessages(newHist);

        // Inject persona
        const payloadHist = [...newHist];
        const lastIdx = payloadHist.length - 1;
        if (lastIdx >= 0) {
            const persona = deepAnalysis
                ? `<context>\nYou are a field medic AI in a survival kit. Think step-by-step. Provide detailed clinical reasoning, differential diagnosis, relevant anatomy, and supporting evidence. Structure your response with headers and bullet points. NO disclaimers, NO suggestions to see a doctor, NO hedging. After your analysis, give a clear final assessment.\n</context>`
                : `<context>\nYou are a field medic AI in a survival kit. Give direct, actionable clinical information only. NO disclaimers, NO suggestions to see a doctor, NO hedging.\n</context>`;
            payloadHist[lastIdx] = {
                role: 'user',
                content: `${persona}\n\nQuery: ${englishTxt}`
            };
        }

        try {
            if (isNative) {
                const { invoke } = await import('@tauri-apps/api/core');
                const { listen } = await import('@tauri-apps/api/event');
                
                let promptStr = '';
                for (const m of payloadHist) {
                    if (m.role === 'user') promptStr += `USER: ${m.content}\n`;
                    if (m.role === 'assistant') promptStr += `ASSISTANT: ${m.content}\n`;
                }
                promptStr += "ASSISTANT:";

                const systemStr = deepAnalysis 
                    ? "You are a field medic AI in a survival kit. Think step-by-step. Provide detailed clinical reasoning, differential diagnosis, relevant anatomy, and supporting evidence. Structure your response with headers and bullet points. NO disclaimers, NO suggestions to see a doctor, NO hedging. After your analysis, give a clear final assessment."
                    : "You are a field medic AI in a survival kit. Give direct, actionable clinical information only. NO disclaimers, NO suggestions to see a doctor, NO hedging.";

                let full = '';
                const unlisten = await listen('inference-token', (event: { payload: { done?: boolean; token?: string } }) => {
                    const d = event.payload;
                    if (d.done) {
                        return;
                    }
                    if (d.token) {
                        full += d.token;
                        setStreamingText(full);
                    }
                });

                await invoke('inference_stream', {
                    request: {
                        prompt: promptStr,
                        system: systemStr,
                        max_tokens: deepAnalysis ? 4096 : 2048,
                        temperature: deepAnalysis ? 0.4 : 0.7,
                        persona: '',
                        stream: true,
                        image_b64: imageToSend || undefined,
                        model_id: "medgemma"
                    }
                });
                
                unlisten();

                if (!full.trim()) {
                    setMessages(prev => [...prev, { role: 'assistant', content: t('triage.empty_response', 'The AI model did not return a response. This can happen when the model is still loading or the request was too complex. Please try again.') }]);
                } else {
                    setMessages(prev => [...prev, { role: 'assistant', content: full }]);
                }
                setStreamingText('');
            } else {
                const r = await fetch('/inference/stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: payloadHist,
                        image: imageToSend || undefined,
                        max_tokens: deepAnalysis ? 4096 : 2048,
                        temperature: deepAnalysis ? 0.4 : 0.7,
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
                                setStreamingText(`In queue (position ${d.position})${d.active_user ? ` -- ${d.active_user} is generating...` : '...'}`);
                            } else if (d.type === 'token') {
                                full += d.token;
                                setStreamingText(full);
                            }
                        } catch { /* incomplete json chunk */ }
                    }
                }

                if (!full.trim()) {
                    setMessages(prev => [...prev, { role: 'assistant', content: t('triage.empty_response', 'The AI model did not return a response. This can happen when the model is still loading or the request was too complex. Please try again.') }]);
                } else {
                    setMessages(prev => [...prev, { role: 'assistant', content: full }]);
                }
                setStreamingText('');
            }

        } catch (e) {
            const errMsg = (e as Error).message || 'Unknown error';
            setMessages(prev => [...prev, { role: 'assistant', content: `[Error] ${t('triage.error_prefix', 'Error')}: ${errMsg}` }]);
            setStreamingText('');
        } finally {
            setIsSending(false);
        }
    };

    const handleMic = async () => {
        if (isRecording) {
            if (mediaRecRef.current) {
                mediaRecRef.current.requestData();
                mediaRecRef.current.stop();
            }
            setIsRecording(false);
            setSttStatus('transcribing...');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

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

                const actualMime = mr.mimeType || mimeType || 'audio/webm';
                const blob = new Blob(audioChunksRef.current, { type: actualMime });

                if (blob.size === 0) {
                    console.warn('[STT] Empty recording blob');
                    setSttStatus('no audio captured');
                    setTimeout(() => setSttStatus('ready'), 3000);
                    return;
                }

                const ext = actualMime.includes('mp4') ? '.mp4'
                          : actualMime.includes('ogg') ? '.ogg'
                          : actualMime.includes('aac') ? '.aac'
                          : '.webm';

                try {
                    let audioPayload = blob;
                    let filename = `recording${ext}`;
                    
                    if (actualMime.includes('webm') || actualMime.includes('opus')) {
                        audioPayload = await convertWebmToWav(blob);
                        filename = 'recording.wav';
                    }

                    const fd = new FormData();
                    fd.append('audio', audioPayload, filename);
                    
                    const d = await sttListen(fd);
                    const txt = (d.text || '').trim();
                    if (txt) {
                        setInput(prev => prev ? prev + ' ' + txt : txt);
                    } else {
                        console.warn('[STT] Server returned empty text', d);
                        setSttStatus('no speech detected');
                        setTimeout(() => setSttStatus('ready'), 3000);
                        return;
                    }
                    setSttStatus(`transcribed (${d.language || 'auto'})`);
                    setTimeout(() => setSttStatus('ready'), 3000);
                } catch (e) {
                    console.error('[STT] Fetch failed:', e);
                    setSttStatus(`STT failed: ${(e as Error).message}`);
                    setTimeout(() => setSttStatus('\u25cf ready'), 4000);
                }
            };

            mr.start(250);
            setIsRecording(true);
            setSttStatus('recording...');
        } catch (e) {
            console.error('[STT] Mic error:', e);
            setSttStatus(`Mic error: ${(e as Error).message}`);
            setTimeout(() => setSttStatus('ready'), 3000);
        }
    };


    return (
        <div className="triage-panel" onDrop={handleDrop} onDragOver={handleDragOver}>
            <header className="triage-header">
                {/* Thread list toggle */}
                <button
                    className="triage-close-btn"
                    onClick={() => setShowThreadList(s => !s)}
                    title={t('triage.chat_history', 'Chat history')}
                    style={{ fontSize: 13, fontWeight: 600, padding: '0 8px' }}
                >Threads</button>

                {/* Translator launch button */}
                <button
                    className="triage-close-btn"
                    onClick={() => setShowTranslator(true)}
                    title={t('triage.translator', 'Translator')}
                    style={{ fontSize: 13, fontWeight: 600, padding: '0 8px' }}
                >Translate</button>

                {/* Deep Analysis toggle */}
                <div
                    className="triage-toggle-wrap"
                    title="Deep Analysis: extended reasoning with differential diagnosis"
                    onClick={() => setDeepAnalysis(prev => !prev)}
                >
                    <span className={`triage-pill ${deepAnalysis ? 'on' : ''}`} />
                    <span>{deepAnalysis ? 'Deep' : 'Quick'}</span>
                </div>

                <div style={{ flex: 1 }} />

                {messages.length > 0 && (
                    <button
                        className="triage-close-btn"
                        onClick={() => {
                            if (!window.confirm(t('triage.clear_confirm', 'Clear this conversation?'))) return;
                            setMessages([]);
                            setActiveThreadId(null);
                            setStreamingText('');
                            setTriageTranslations({});
                            Object.keys(triageTranslationCache).forEach(k => delete triageTranslationCache[k]);
                        }}
                        title={t('triage.clear_chat', 'Clear chat')}
                        style={{ fontSize: 13, fontWeight: 600, padding: '0 8px' }}
                    >Clear</button>
                )}

                <button className="triage-close-btn" style={{ fontWeight: 600 }} onClick={onClose}>X</button>
            </header>

            {/* Translator overlay */}
            {showTranslator && (
                <TranslatorPanel onClose={() => setShowTranslator(false)} />
            )}

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
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>History</span>
                            <button
                                onClick={newThread}
                                style={{ padding: '4px 10px', fontSize: 11, background: '#3fb95022', border: '1px solid #3fb95044', borderRadius: 4, color: '#3fb950', cursor: 'pointer', fontWeight: 600 }}
                            >+ {t('triage.new_btn', 'New')}</button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {threads.length === 0 ? (
                                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>{t('triage.no_saved', 'No saved chats yet')}</div>
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
                                            {th.messages.length} msgs - {new Date(th.timestamp).toLocaleDateString()}
                                        </span>
                                        <button
                                            onClick={e => { e.stopPropagation(); deleteThread(th.id); }}
                                            style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, opacity: 0.5, padding: '0 4px', fontWeight: 600 }}
                                        >X</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div onClick={() => setShowThreadList(false)} style={{ flex: 1, background: '#0008' }} />
                </div>
            )}

            {/* ── Chat ──────────────────────────────────────────────── */}
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
                        {m.image && (
                            <img src={m.image} alt="Attached" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, marginBottom: 8, display: 'block', border: '1px solid var(--border)' }} />
                        )}
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
                                {playingMsgIndex === i ? 'Stop' : 'Speak'}
                            </button>
                        )}
                    </div>
                </div>
            ))}

                {/* Processing indicator */}
                {isSending && !streamingText && (
                    <div className="triage-row assistant">
                        <div className="triage-lbl">TRIAGE AI</div>
                        <div className="triage-bubble assistant" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                                width: 16, height: 16, borderRadius: '50%',
                                border: '2px solid #39d35344',
                                borderTopColor: '#39d353',
                                animation: 'spin 0.8s linear infinite',
                                flexShrink: 0
                            }} />
                            <span style={{ color: '#4d6077', fontSize: 12 }}>{t('triage.processing', 'Processing...')}</span>
                        </div>
                    </div>
                )}
                {streamingText && (
                    <div className="triage-row assistant">
                        <div className="triage-lbl">TRIAGE AI</div>
                        <div className="triage-bubble assistant" style={{ position: 'relative' }}>
                            {renderMd(streamingText)}
                            <button
                                onClick={async () => {
                                    if (isNative) {
                                        const { invoke } = await import('@tauri-apps/api/core');
                                        await invoke('inference_stop');
                                    }
                                    // Soft local break to detach UI instantly
                                    setIsSending(false);
                                }}
                                style={{
                                    position: 'absolute', bottom: -32, right: 0,
                                    background: 'rgba(255, 70, 70, 0.08)', color: '#e74c3c',
                                    border: '1px solid rgba(231, 76, 60, 0.3)', borderRadius: 16,
                                    padding: '4px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <span style={{ fontSize: 13, fontWeight: 800 }}>[ ]</span> Stop Generation
                            </button>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <footer className="triage-footer">
                {pendingImage && (
                    <div className="triage-image-preview">
                        <img src={pendingImage} alt="Preview" />
                        <button className="triage-image-remove" onClick={() => setPendingImage(null)} title="Remove image" style={{ fontWeight: 600 }}>X</button>
                    </div>
                )}
                <div className="triage-input-row">
                    <button
                        className={`triage-mic-btn ${isRecording ? 'rec' : ''} triage-mic-desktop-only`}
                        onClick={handleMic}
                        title={t('triage.voice_input', 'Voice input')}
                        style={{ fontWeight: 600, fontSize: 12 }}
                    >
                        {isRecording ? 'Stop' : 'Mic'}
                    </button>
                    <button
                        className={`triage-attach-btn ${pendingImage ? 'active' : ''}`}
                        onClick={() => fileInputRef.current?.click()}
                        title={t('triage.attach_image', 'Attach photo')}
                    >+</button>
                    <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleImageSelect} />
                    <textarea
                        className="triage-textarea"
                        rows={2}
                        placeholder={t('triage.chat_placeholder', 'Ask anything clinical...')}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                        }}
                    />
                    <button
                        className="triage-send-btn"
                        onClick={handleSend}
                        disabled={(!input.trim() && !pendingImage) || isSending}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                        {isSending && isModelLoading ? (
                            <>
                                <div style={{ width: 12, height: 12, border: '2px solid #fff4', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                Loading...
                            </>
                        ) : 'Send'}
                    </button>
                </div>
            </footer>
        </div>
    );
}
