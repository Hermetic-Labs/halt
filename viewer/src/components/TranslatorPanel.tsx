/**
 * TranslatorPanel — Conversational two-speaker translation chat.
 *
 * Layout:
 *   Sticky header  →  "🌐 Translator" + ✕
 *   Chat area      →  Left speaker / Right speaker message bubbles with 🔊 replay
 *   Bottom bar     →  Language labels (highlighted = active), ⇄ swap, mic button
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useT } from '../services/i18n';
import { useTranslateStream } from '../hooks/useTranslateStream';
import type { TranslateStreamState } from '../hooks/useTranslateStream';

const LANGUAGES: { code: string; name: string }[] = [
    { code: 'en', name: 'English' },
    { code: 'ar', name: 'العربية' },
    { code: 'am', name: 'አማርኛ' },
    { code: 'bn', name: 'বাংলা' },
    { code: 'de', name: 'Deutsch' },
    { code: 'es', name: 'Español' },
    { code: 'fa', name: 'فارسی' },
    { code: 'fr', name: 'Français' },
    { code: 'hi', name: 'हिन्दी' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'pt', name: 'Português' },
    { code: 'ru', name: 'Русский' },
    { code: 'sw', name: 'Kiswahili' },
    { code: 'zh', name: '中文' },
    { code: 'he', name: 'עברית' },
    { code: 'it', name: 'Italiano' },
    { code: 'nl', name: 'Nederlands' },
    { code: 'tr', name: 'Türkçe' },
    { code: 'uk', name: 'Українська' },
    { code: 'ur', name: 'اردو' },
    { code: 'vi', name: 'Tiếng Việt' },
    { code: 'th', name: 'ไทย' },
    { code: 'id', name: 'Bahasa Indonesia' },
    { code: 'pl', name: 'Polski' },
    { code: 'ta', name: 'தமிழ்' },
    { code: 'so', name: 'Soomaali' },
    { code: 'ha', name: 'Hausa' },
    { code: 'ps', name: 'پښتو' },
    { code: 'ku', name: 'Kurdî' },
];

const STATUS_LABELS: Record<TranslateStreamState, string> = {
    idle: '',
    listening: '🎤 Listening...',
    transcribing: '🔍 Transcribing...',
    translating: '🌐 Translating...',
    synthesizing: '🔊 Generating speech...',
    playing: '▶️ Playing...',
    error: '❌ Error',
};

const langName = (code: string) => LANGUAGES.find(l => l.code === code)?.name || code.toUpperCase();

interface ChatMessage {
    id: number;
    side: 'left' | 'right';
    text: string;
    lang: string;
    originalText?: string;  // greyed-out source text shown under translations
    timestamp: number;
}

let _msgId = 0;

export default function TranslatorPanel({ onClose }: { onClose: () => void }) {
    const { t, lang } = useT();
    const [leftLang, setLeftLang] = useState(lang === 'en' ? 'en' : lang);
    const [rightLang, setRightLang] = useState(lang === 'en' ? 'es' : 'en');
    const [activeSide, setActiveSide] = useState<'left' | 'right'>('left');
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [playingId, setPlayingId] = useState<number | null>(null);
    const [autoPlay, setAutoPlay] = useState(true);
    const [streamMic, setStreamMic] = useState(true);
    const autoPlayRef = useRef(true);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const prevResultRef = useRef<string | null>(null);
    const [textInput, setTextInput] = useState('');
    const [textBusy, setTextBusy] = useState(false);
    const [sttBusy, setSttBusy] = useState(false);
    const mediaRecRef2 = useRef<MediaRecorder | null>(null);

    const {
        state,
        result,
        error,
        startRecording,
        stopRecording,
        isRecording,
        isProcessing,
        isPlaying,
    } = useTranslateStream();

    // Auto-scroll to bottom when new messages appear
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages.length]);

    // When a result completes, add messages to chat + auto-play
    useEffect(() => {
        if (!result?.translation || !result?.transcript) return;
        // Deduplicate: only add if this is a new result
        const key = result.transcript + result.translation;
        if (prevResultRef.current === key) return;
        prevResultRef.current = key;

        const speakerSide = activeSide;
        const tgtLang = activeSide === 'left' ? rightLang : leftLang;

        const newMsg: ChatMessage = { id: ++_msgId, side: speakerSide, text: result.translation, lang: tgtLang, originalText: result.transcript, timestamp: Date.now() };
        setChatMessages(prev => [...prev, newMsg]);

        // Auto-play the translation via TTS (if enabled)
        if (autoPlayRef.current) handleReplay(newMsg);
    // activeSide at capture time matters, don't re-run on activeSide change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result?.transcript, result?.translation]);

    const sourceLang = activeSide === 'left' ? leftLang : rightLang;
    const targetLang = activeSide === 'left' ? rightLang : leftLang;

    const handleMicToggle = useCallback(() => {
        if (streamMic) {
            // Stream mode: toggle WebSocket pipeline
            if (isRecording) {
                stopRecording();
            } else if (state === 'idle' || state === 'error') {
                startRecording(targetLang, sourceLang === 'en' ? 'auto' : sourceLang);
            }
        } else {
            // Text mode: toggle STT → fill text box
            if (sttBusy) {
                // Stop recording
                if (mediaRecRef2.current && mediaRecRef2.current.state !== 'inactive') {
                    mediaRecRef2.current.stop();
                }
            } else {
                // Start recording
                setSttBusy(true);
                navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                    let mimeType = '';
                    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
                        if (MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
                    }
                    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
                    mediaRecRef2.current = mr;
                    const chunks: Blob[] = [];
                    mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
                    mr.onstop = async () => {
                        stream.getTracks().forEach(t => t.stop());
                        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
                        const fd = new FormData();
                        fd.append('audio', blob, 'recording.webm');
                        if (sourceLang !== 'en') fd.append('language', sourceLang);
                        try {
                            const r = await fetch('/stt/listen', { method: 'POST', body: fd });
                            if (r.ok) {
                                const d = await r.json();
                                if (d.text) setTextInput(prev => prev ? prev + ' ' + d.text : d.text);
                            }
                        } catch { /* silent */ }
                        setSttBusy(false);
                    };
                    mr.start(250);
                }).catch(() => setSttBusy(false));
            }
        }
    }, [streamMic, state, isRecording, targetLang, sourceLang, startRecording, stopRecording, sttBusy]);

    // Replay a message via TTS
    const handleReplay = useCallback(async (msg: ChatMessage) => {
        setPlayingId(msg.id);
        try {
            const r = await fetch('/tts/synthesize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: msg.text, lang: msg.lang }),
            });
            if (r.ok) {
                const buf = await r.arrayBuffer();
                const ctx = new AudioContext();
                const decoded = await ctx.decodeAudioData(buf);
                const src = ctx.createBufferSource();
                src.buffer = decoded;
                src.connect(ctx.destination);
                src.onended = () => setPlayingId(null);
                src.start();
            } else {
                setPlayingId(null);
            }
        } catch {
            setPlayingId(null);
        }
    }, []);

    // Submit text input → translate → add to chat
    const handleTextSubmit = useCallback(async () => {
        const text = textInput.trim();
        if (!text || textBusy) return;
        setTextBusy(true);
        try {
            const r = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, source: sourceLang, target: targetLang }),
            });
            if (r.ok) {
                const d = await r.json();
                const newMsg: ChatMessage = {
                    id: ++_msgId, side: activeSide,
                    text: d.translated, lang: targetLang,
                    originalText: text, timestamp: Date.now(),
                };
                setChatMessages(prev => [...prev, newMsg]);
                setTextInput('');
                if (autoPlayRef.current) handleReplay(newMsg);
            }
        } catch { /* silent */ }
        setTextBusy(false);
    }, [textInput, textBusy, sourceLang, targetLang, activeSide, handleReplay]);

    const handleSwap = useCallback(() => {
        setActiveSide(s => s === 'left' ? 'right' : 'left');
    }, []);

    const statusText = error || STATUS_LABELS[state];
    const leftName = langName(leftLang);
    const rightName = langName(rightLang);

    return (
        <div style={{
            position: 'absolute', inset: 0, zIndex: 20,
            background: '#080c10',
            display: 'flex', flexDirection: 'column',
        }}>
            {/* ── Header (sticky) ─────────────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                flexShrink: 0,
            }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>
                    {'🌐'} {t('translator.title', 'Translator')}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Stream Mic toggle pill */}
                    <button
                        onClick={() => setStreamMic(s => !s)}
                        title="Stream microphone audio (continuous listening)"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '4px 10px', borderRadius: 12,
                            border: `1px solid ${streamMic ? 'rgba(88,166,255,0.35)' : 'rgba(255,255,255,0.1)'}`,
                            background: streamMic ? 'rgba(88,166,255,0.12)' : 'transparent',
                            color: streamMic ? '#58a6ff' : '#484f58',
                            fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            transition: 'all 0.2s', letterSpacing: '0.02em',
                        }}
                    >
                        <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: streamMic ? '#58a6ff' : '#484f58',
                            transition: 'background 0.2s',
                        }} />
                        Stream
                    </button>
                    {/* Auto Play toggle pill */}
                    <button
                        onClick={() => { setAutoPlay(s => { autoPlayRef.current = !s; return !s; }); }}
                        title="Auto-play translated speech"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '4px 10px', borderRadius: 12,
                            border: `1px solid ${autoPlay ? 'rgba(63,185,80,0.35)' : 'rgba(255,255,255,0.1)'}`,
                            background: autoPlay ? 'rgba(63,185,80,0.12)' : 'transparent',
                            color: autoPlay ? '#3fb950' : '#484f58',
                            fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            transition: 'all 0.2s', letterSpacing: '0.02em',
                        }}
                    >
                        <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: autoPlay ? '#3fb950' : '#484f58',
                            transition: 'background 0.2s',
                        }} />
                        Auto Play
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255,255,255,0.08)', border: 'none',
                            color: '#8b949e', fontSize: 16, padding: '4px 8px',
                            borderRadius: 6, cursor: 'pointer', marginLeft: 4,
                        }}
                    >{'✕'}</button>
                </div>
            </div>

            {/* ── Chat Area (scrollable) ──────────────────────────── */}
            <div style={{
                flex: 1, overflowY: 'auto', padding: '20px 16px',
                display: 'flex', flexDirection: 'column', gap: 6,
            }}>
                {chatMessages.length === 0 && !result?.transcript && (
                    <div style={{
                        flex: 1, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 12,
                        color: '#484f58', textAlign: 'center', padding: 40,
                    }}>
                        <div style={{ fontSize: 48, opacity: 0.3 }}>{'\ud83c\udf10'}</div>
                        <div style={{ fontSize: 15, fontWeight: 500 }}>
                            Turn-based translation
                        </div>
                        <div style={{ fontSize: 12, maxWidth: 300, lineHeight: 1.6 }}>
                            Tap the mic, speak, and the translation will appear.
                            Use the arrow to switch speakers between <span style={{ color: '#58a6ff' }}>{leftName}</span> and <span style={{ color: '#3fb950' }}>{rightName}</span>
                        </div>
                    </div>
                )}

                {chatMessages.map(msg => {
                    const isLeft = msg.side === 'left';
                    const isActive = playingId === msg.id;
                    return (
                        <div
                            key={msg.id}
                            style={{
                                display: 'flex', flexDirection: 'column',
                                alignItems: isLeft ? 'flex-start' : 'flex-end',
                                maxWidth: '85%', alignSelf: isLeft ? 'flex-start' : 'flex-end',
                            }}
                        >
                            {/* Speaker label */}
                            <div style={{
                                fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                                letterSpacing: '0.06em', marginBottom: 3,
                                color: isLeft ? '#58a6ff' : '#3fb950',
                                paddingLeft: isLeft ? 12 : 0,
                                paddingRight: isLeft ? 0 : 12,
                            }}>
                                {t('translator.speaker', '{lang} Speaker').replace('{lang}', langName(isLeft ? leftLang : rightLang))}
                            </div>
                            {/* Bubble */}
                            <div style={{
                                display: 'flex', alignItems: 'flex-end', gap: 6,
                                flexDirection: isLeft ? 'row' : 'row-reverse',
                            }}>
                                <div style={{
                                    padding: '10px 14px',
                                    borderRadius: isLeft ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                                    background: isLeft
                                        ? 'rgba(88,166,255,0.12)'
                                        : 'rgba(63,185,80,0.12)',
                                    border: `1px solid ${isLeft ? 'rgba(88,166,255,0.2)' : 'rgba(63,185,80,0.2)'}`,
                                    color: '#e6edf3',
                                    fontSize: 15, lineHeight: 1.5,
                                    maxWidth: '100%', wordBreak: 'break-word',
                                    direction: ['ar', 'he', 'fa', 'ur', 'ps'].includes(msg.lang) ? 'rtl' : 'ltr',
                                }}>
                                    {msg.text}
                                    {msg.originalText && (
                                        <div style={{
                                            marginTop: 6, paddingTop: 6,
                                            borderTop: `1px solid ${isLeft ? 'rgba(88,166,255,0.12)' : 'rgba(63,185,80,0.12)'}`,
                                            fontSize: 12, color: '#6e7681', fontStyle: 'italic',
                                            direction: ['ar', 'he', 'fa', 'ur', 'ps'].includes(
                                                isLeft ? rightLang : leftLang
                                            ) ? 'rtl' : 'ltr',
                                        }}>
                                            {msg.originalText}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => handleReplay(msg)}
                                    disabled={isActive}
                                    title={t('translator.replay', 'Replay')}
                                    style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        fontSize: 14, padding: 2, flexShrink: 0,
                                        color: isActive ? '#f0c674' : '#8b949e',
                                        opacity: isActive ? 1 : 0.6,
                                        transition: 'all 0.15s',
                                    }}
                                >{isActive ? '🔊' : '▶️'}</button>
                            </div>
                        </div>
                    );
                })}

                {/* Live transcription — only while waiting for translation */}
                {result?.transcript && !result?.translation && state !== 'idle' && (
                    <div style={{
                        alignSelf: activeSide === 'left' ? 'flex-start' : 'flex-end',
                        maxWidth: '85%',
                    }}>
                        <div style={{
                            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.06em', marginBottom: 3,
                            color: activeSide === 'left' ? '#58a6ff' : '#3fb950',
                            paddingLeft: activeSide === 'left' ? 12 : 0,
                            paddingRight: activeSide === 'left' ? 0 : 12,
                            textAlign: activeSide === 'left' ? 'left' : 'right',
                        }}>
                            {t('translator.speaker', '{lang} Speaker').replace('{lang}', langName(sourceLang))}
                        </div>
                        <div style={{
                            padding: '10px 14px',
                            borderRadius: activeSide === 'left' ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                            background: activeSide === 'left'
                                ? 'rgba(88,166,255,0.08)'
                                : 'rgba(63,185,80,0.08)',
                            border: `1px dashed ${activeSide === 'left' ? 'rgba(88,166,255,0.3)' : 'rgba(63,185,80,0.3)'}`,
                            color: '#8b949e',
                            fontSize: 15, lineHeight: 1.5, fontStyle: 'italic',
                        }}>
                            {result.transcript}
                        </div>
                    </div>
                )}

                <div ref={chatEndRef} />
            </div>

            {/* ── Status Bar ──────────────────────────────────────── */}
            {statusText && (
                <div style={{
                    textAlign: 'center', padding: '6px 16px',
                    fontSize: 12, color: state === 'error' ? '#f85149' : '#8b949e',
                    background: 'rgba(255,255,255,0.03)',
                    flexShrink: 0,
                }}>
                    {statusText}
                </div>
            )}

            {/* ── Bottom Controls (sticky) ────────────────────────── */}
            <div style={{
                flexShrink: 0,
                borderTop: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(0,0,0,0.4)',
                padding: '12px 16px 20px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            }}>
                {/* Text input (when stream OFF) — above speaker selectors */}
                {!streamMic && (
                    <div style={{
                        display: 'flex', gap: 8, width: '100%', maxWidth: 500,
                        alignItems: 'flex-end',
                    }}>
                        <textarea
                            value={textInput}
                            onChange={e => setTextInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextSubmit(); } }}
                            placeholder={`Type in ${langName(sourceLang)}...`}
                            disabled={textBusy}
                            rows={1}
                            style={{
                                flex: 1, padding: '10px 14px', borderRadius: 12,
                                background: '#0d1117',
                                border: `1px solid ${activeSide === 'left' ? 'rgba(88,166,255,0.25)' : 'rgba(63,185,80,0.25)'}`,
                                color: '#e6edf3', fontSize: 14,
                                outline: 'none', transition: 'border 0.2s',
                                resize: 'none', overflow: 'hidden',
                                minHeight: 40, maxHeight: 120,
                                lineHeight: '1.4', fontFamily: 'inherit',
                                field_sizing: 'content',
                            } as React.CSSProperties}
                            ref={el => { if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; } }}
                        />
                        <button
                            onClick={handleTextSubmit}
                            disabled={!textInput.trim() || textBusy}
                            style={{
                                width: 40, height: 40, borderRadius: '50%',
                                border: 'none', cursor: 'pointer',
                                background: activeSide === 'left' ? '#58a6ff' : '#3fb950',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                opacity: textInput.trim() ? 1 : 0.4,
                                transition: 'opacity 0.2s',
                                flexShrink: 0, marginBottom: 2,
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        </button>
                    </div>
                )}

                {/* Language selectors with swap */}
                <div style={{
                    display: 'flex', gap: 8, alignItems: 'center',
                    width: '100%', maxWidth: 500,
                }}>
                    {/* Left speaker selector */}
                    <div style={{
                        flex: 1, display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                        <div style={{
                            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                            letterSpacing: '0.08em', textAlign: 'center',
                            color: activeSide === 'left' ? '#58a6ff' : '#484f58',
                            transition: 'color 0.3s',
                        }}>
                            <span style={{
                                display: 'inline-block',
                                animation: activeSide === 'left' ? 'speaker-pulse 1.8s ease-in-out infinite' : 'none',
                            }}>{activeSide === 'left' ? '●' : '○'}</span> {activeSide === 'left' ? 'Speaking' : 'Listening'}
                        </div>
                        <select
                            value={leftLang}
                            onChange={e => setLeftLang(e.target.value)}
                            style={{
                                width: '100%', padding: '8px 10px', borderRadius: 8,
                                background: '#000',
                                color: '#fff',
                                border: activeSide === 'left'
                                    ? '1px solid rgba(88,166,255,0.4)'
                                    : '1px solid rgba(255,255,255,0.1)',
                                fontSize: 13, textAlign: 'center',
                                transition: 'all 0.2s',
                            }}
                        >
                            {LANGUAGES.map(l => (
                                <option key={l.code} value={l.code}>{l.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Direction arrow */}
                    <button
                        onClick={handleSwap}
                        title={t('translator.switch_speaker', 'Switch active speaker')}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: '6px 4px',
                            cursor: 'pointer',
                            color: activeSide === 'left' ? '#58a6ff' : '#3fb950',
                            fontSize: 18, flexShrink: 0,
                            transition: 'color 0.3s',
                            animation: 'speaker-pulse 1.8s ease-in-out infinite',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >{activeSide === 'left' ? '\u2192' : '\u2190'}</button>

                    {/* Right speaker selector */}
                    <div style={{
                        flex: 1, display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                        <div style={{
                            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                            letterSpacing: '0.08em', textAlign: 'center',
                            color: activeSide === 'right' ? '#3fb950' : '#484f58',
                            transition: 'color 0.3s',
                        }}>
                            <span style={{
                                display: 'inline-block',
                                animation: activeSide === 'right' ? 'speaker-pulse 1.8s ease-in-out infinite' : 'none',
                            }}>{activeSide === 'right' ? '●' : '○'}</span> {activeSide === 'right' ? 'Speaking' : 'Listening'}
                        </div>
                        <select
                            value={rightLang}
                            onChange={e => setRightLang(e.target.value)}
                            style={{
                                width: '100%', padding: '8px 10px', borderRadius: 8,
                                background: '#000',
                                color: '#fff',
                                border: activeSide === 'right'
                                    ? '1px solid rgba(63,185,80,0.4)'
                                    : '1px solid rgba(255,255,255,0.1)',
                                fontSize: 13, textAlign: 'center',
                                transition: 'all 0.2s',
                            }}
                        >
                            {LANGUAGES.map(l => (
                                <option key={l.code} value={l.code}>{l.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Mic toggle button — tap to start, tap to stop */}
                <button
                    onClick={handleMicToggle}
                    disabled={isProcessing || isPlaying || (playingId !== null)}
                    style={{
                        width: streamMic ? 56 : 40, height: streamMic ? 56 : 40,
                        borderRadius: '50%',
                        border: 'none',
                        cursor: (isProcessing || isPlaying || playingId !== null) ? 'not-allowed' : 'pointer',
                        background: (isPlaying || playingId !== null)
                            ? '#6e7681'
                            : sttBusy
                                ? '#e74c3c'
                                : isRecording
                                    ? '#e74c3c'
                                    : isProcessing
                                        ? '#f39c12'
                                        : activeSide === 'left' ? '#58a6ff' : '#3fb950',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: (isRecording || sttBusy)
                            ? '0 0 30px rgba(231,76,60,0.4)'
                            : `0 0 16px ${activeSide === 'left' ? 'rgba(88,166,255,0.25)' : 'rgba(63,185,80,0.25)'}`,
                        transition: 'all 0.2s',
                        transform: (isRecording || sttBusy) ? 'scale(1.1)' : 'scale(1)',
                        animation: (isRecording || sttBusy) ? 'pulse-ring 1.5s ease infinite' : 'none',
                        flexShrink: 0,
                    }}
                >
                    {(isPlaying || playingId !== null) ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                    ) : (isRecording || sttBusy) ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                    ) : isProcessing ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>
                    ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>
                    )}
                </button>
            </div>

            {/* Animations */}
            <style>{`
                @keyframes pulse-ring {
                    0% { box-shadow: 0 0 20px rgba(231,76,60,0.3); transform: scale(1.1); }
                    50% { box-shadow: 0 0 40px rgba(231,76,60,0.5); transform: scale(1.15); }
                    100% { box-shadow: 0 0 20px rgba(231,76,60,0.3); transform: scale(1.1); }
                }
                @keyframes speaker-pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(1.3); }
                }
            `}</style>
        </div>
    );
}
