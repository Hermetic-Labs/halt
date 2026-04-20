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
import { translateText, ttsSynthesize, sttListen } from '../services/api';
import { useTranslateStream } from '../hooks/useTranslateStream';
import type { TranslateStreamState } from '../hooks/useTranslateStream';
import { useTranslateLive } from '../hooks/useTranslateLive';

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

import { convertWebmToWav } from '../services/audioUtils';

// Status labels are resolved at render time via t() — see statusLabels below

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
    
    // Natively resolves the selected language code into the medic's current UI language string
    // e.g. If system is English, 'ar' -> "Arabic". If system is Chinese, 'ar' -> "阿拉伯语"
    const getReadableName = useCallback((code: string) => {
        try {
            const locale = (lang && lang.trim()) ? lang : (navigator.language || 'en');
            return new Intl.DisplayNames([locale], { type: 'language' }).of(code) || code.toUpperCase();
        } catch {
            return code.toUpperCase();
        }
    }, [lang]);

    const leftLang = LANGUAGES.find(l => l.code === lang?.split('-')[0])?.code || 'en';
    const [rightLang, setRightLang] = useState(leftLang === 'en' ? 'es' : 'en');
    const [activeSide, setActiveSide] = useState<'left' | 'right'>('left');
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [playingId, setPlayingId] = useState<number | null>(null);
    const [autoPlay, setAutoPlay] = useState(true);
    const [streamMic, setStreamMic] = useState(true);
    const [speakMode, setSpeakMode] = useState(false);
    const [isHoverMic, setIsHoverMic] = useState(false);
    const autoPlayRef = useRef(true);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const prevResultRef = useRef<string | null>(null);
    const swapRestartRef = useRef(false);
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

    const live = useTranslateLive();

    // Auto-scroll to bottom when new messages or live segments appear
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages.length, live.segments.length, result?.transcript, live.isTranslating]);

    // When a result completes, add messages to chat + auto-play
    useEffect(() => {
        if (!result?.translation || !result?.transcript) return;
        // Deduplicate: only add if this is a new result
        const key = result.transcript + result.translation;
        if (prevResultRef.current === key) return;
        prevResultRef.current = key;
        // Derive speaker side strictly from result context to prevent Swap-Bug
        let speakerSide = activeSide;
        if (result.targetLang === leftLang) {
            speakerSide = 'right';
        } else if (result.targetLang === rightLang) {
            speakerSide = 'left';
        }

        const newMsg: ChatMessage = { id: ++_msgId, side: speakerSide, text: result.translation, lang: result.targetLang, originalText: result.transcript, timestamp: Date.now() };
        setChatMessages(prev => [...prev, newMsg]);

        // autoPlay is natively handled by gapless `playBufferedAudio` in useTranslateStream.
        // We do NOT call `handleReplay(newMsg)` here to prevent the overlap and double-lock echo bug.
    // activeSide at capture time matters, don't re-run on activeSide change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result?.transcript, result?.translation]);

    const sourceLang = activeSide === 'left' ? leftLang : rightLang;
    const targetLang = activeSide === 'left' ? rightLang : leftLang;

    const handleMicToggle = useCallback(() => {
        if (speakMode) {
            // Speak mode: toggle continuous live translation
            if (live.isListening) {
                live.stop();
            } else if (!live.isActive || live.state === 'error') {
                live.start(targetLang, sourceLang === 'en' ? 'auto' : sourceLang);
            }
            return;
        }
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
                        
                        // Check empty/corrupt chunks
                        if (blob.size < 100) {
                            console.warn(`[Manual STT] Chunk too small (${blob.size} bytes). Dropping to avoid decoder crash.`);
                            setSttBusy(false);
                            return;
                        }
                        
                        // Visual feedback handled automatically by 'sttBusy' pulsing waveform
                        try {
                            setSttBusy(false);
                            setTextBusy(true);
                            const wavBlob = await convertWebmToWav(blob);
                            const fd = new FormData();
                            fd.append('audio', wavBlob, 'recording.wav');
                            if (sourceLang !== 'en') fd.append('language', sourceLang);
                            
                            const sttStartTime = Date.now();
                            console.log(`[Manual STT] Sending ${wavBlob.size} bytes (WAV) to native STT handler...`);
                            const d = await sttListen(fd);
                            console.log(`[Manual STT] Result (${Date.now() - sttStartTime}ms):`, d);
                            
                            if (d.text && d.text.trim().length > 0) {
                                // Standard Non-Stream Mode: Populate textbox
                                const transcription = d.text.trim();
                                setTextInput(prev => prev ? prev + ' ' + transcription : transcription);
                            } else {
                                console.warn(`[Manual STT] Whisper dropped! Payload size: ${wavBlob.size} | API Response:`, d);
                            }
                        } catch (err) {
                            console.error('[Manual STT] ❌ Pipeline Exception:', err);
                        } finally {
                            setSttBusy(false);
                            setTextBusy(false);
                        }
                    };
                    mr.start(250);
                }).catch(() => setSttBusy(false));
            }
        }
    }, [speakMode, live, streamMic, state, isRecording, targetLang, sourceLang, startRecording, stopRecording, sttBusy]);

    // Replay a message via TTS
    const handleReplay = useCallback(async (msg: ChatMessage) => {
        setPlayingId(msg.id);
        try {
            const r = await ttsSynthesize(msg.text, undefined, undefined, msg.lang);
            if (r.ok) {
                const data = await r.json();
                const audio = new Audio(data.audio_base64);
                audio.onended = () => { setPlayingId(null); };
                audio.play().catch(() => setPlayingId(null));
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
            const d = await translateText(text, sourceLang, targetLang);
            const newMsg: ChatMessage = {
                id: ++_msgId, side: activeSide,
                text: d.translated, lang: targetLang,
                originalText: text, timestamp: Date.now(),
            };
            setChatMessages(prev => [...prev, newMsg]);
            setTextInput('');
            if (autoPlayRef.current) handleReplay(newMsg);
        } catch (err) {
            console.error('[Manual Translate] ❌ Pipeline Exception:', err);
            setTextInput(prev => `${prev ? prev + '\n' : ''}[ERROR: ${(err as Error).message}]`);
        }
        setTextBusy(false);
    }, [textInput, textBusy, sourceLang, targetLang, activeSide, handleReplay]);

    const handleSwap = useCallback(() => {
        if (speakMode && live.isActive) {
            live.stop(true);
            swapRestartRef.current = true;
        } else if (streamMic && isRecording) {
            stopRecording(true);
            swapRestartRef.current = true;
        }
        setActiveSide(s => s === 'left' ? 'right' : 'left');
    }, [speakMode, live, streamMic, isRecording, stopRecording]);

    // Handle seamless mid-session proxy reconnection
    useEffect(() => {
        if (swapRestartRef.current) {
            if (speakMode && live.state === 'idle') {
                swapRestartRef.current = false;
                live.start(targetLang, sourceLang === 'en' ? 'auto' : sourceLang);
            } else if (streamMic && state === 'idle') {
                swapRestartRef.current = false;
                startRecording(targetLang, sourceLang === 'en' ? 'auto' : sourceLang);
            }
        }
    }, [live.state, state, speakMode, streamMic, targetLang, sourceLang, live, startRecording]);

    const statusLabels: Record<TranslateStreamState, string> = {
        idle: '',
        listening: '🎤 ' + t('translator.status_listening', 'Listening...'),
        transcribing: '🔍 ' + t('translator.status_transcribing', 'Transcribing...'),
        translating: '🌐 ' + t('translator.status_translating', 'Translating...'),
        synthesizing: '🔊 ' + t('translator.status_synthesizing', 'Generating speech...'),
        playing: '▶️ ' + t('translator.playing', 'Playing...'),
        error: '❌ ' + t('translator.status_error', 'Error'),
    };
    const liveStatusText = live.error
        || (live.isListening ? '🎤 ' + t('translator.status_listening_live', 'Listening (live)...')
            : live.state === 'processing' ? '⚡ ' + t('translator.status_processing', 'Processing...')
            : '');
    const statusText = speakMode ? liveStatusText : (error || statusLabels[state]);
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
                    {/* Speak toggle pill (live continuous mode) */}
                    <button
                        onClick={() => {
                            if (!speakMode) {
                                if (isRecording) stopRecording(false);
                                setStreamMic(false);
                                setSpeakMode(true);
                            } else {
                                if (live.isActive) live.stop();
                                setSpeakMode(false);
                            }
                        }}
                        title="Speak continuously — auto-detects pauses and translates each phrase"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '4px 10px', borderRadius: 12,
                            border: `1px solid ${speakMode ? 'rgba(210,168,60,0.4)' : 'rgba(255,255,255,0.1)'}`,
                            background: speakMode ? 'rgba(210,168,60,0.12)' : 'transparent',
                            color: speakMode ? '#d2a83c' : '#484f58',
                            fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            transition: 'all 0.2s', letterSpacing: '0.02em',
                        }}
                    >
                        <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: speakMode ? '#d2a83c' : '#484f58',
                            transition: 'background 0.2s',
                        }} />
                        {t('translator.speak_mode', 'Speak')}
                    </button>
                    {/* Stream Mic toggle pill */}
                    <button
                        onClick={() => {
                            if (!streamMic) {
                                if (live.isActive) live.stop();
                                setSpeakMode(false);
                                setStreamMic(true);
                            } else {
                                if (isRecording) stopRecording(false);
                                setStreamMic(false);
                            }
                        }}
                        title="Stream microphone audio (record full statement)"
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
                        {t('translator.stream_mode', 'Stream')}
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
                        {t('translator.auto_play', 'Auto Play')}
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
                            {t('translator.turn_based', 'Turn-based translation')}
                        </div>
                        <div style={{ fontSize: 12, maxWidth: 300, lineHeight: 1.6 }}>
                            {t('translator.empty_hint', 'Tap the mic, speak, and the translation will appear. Use the arrow to switch speakers between {left} and {right}').split('{left}').map((part, i) => i === 0 ? part : <><span key='l' style={{ color: '#58a6ff' }}>{leftName}</span>{part}</>).flatMap((part, i) => typeof part === 'string' ? part.split('{right}').map((p2, j) => j === 0 ? p2 : <><span key={`r${i}${j}`} style={{ color: '#3fb950' }}>{rightName}</span>{p2}</>) : part)}
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
                                    {/* Line segment and original text stripped natively */}
                                </div>
                                <button
                                    onClick={() => handleReplay(msg)}
                                    disabled={isActive}
                                    title={t('translator.replay', 'Replay')}
                                    style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        padding: 2, flexShrink: 0,
                                        color: isActive ? '#f0c674' : '#8b949e',
                                        opacity: isActive ? 1 : 0.6,
                                        transition: 'all 0.15s',
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        fontWeight: 600, fontSize: 13,
                                    }}
                                >
                                    <span>{isActive ? '🔊' : '▶️'}</span>
                                    <span>{isActive ? t('translator.playing', 'Playing') : t('translator.speak', 'Speak')}</span>
                                </button>
                            </div>
                        </div>
                    );
                })}

                {/* Live transcription — only while waiting for translation (Stream mode) */}
                {!speakMode && result?.transcript && !result?.translation && state !== 'idle' && (
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

                {/* Live segments — Speak mode */}
                {speakMode && live.segments.map(seg => (
                    <div
                        key={seg.segmentId}
                        style={{
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'flex-start',
                            maxWidth: '85%', alignSelf: 'flex-start',
                        }}
                    >
                        <div style={{
                            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.06em', marginBottom: 3,
                            color: '#d2a83c',
                            paddingLeft: 12,
                        }}>
                            ⚡ {t('translator.live_segment', 'Live · Segment {id}').replace('{id}', String(seg.segmentId))}
                        </div>
                        <div style={{
                            padding: '10px 14px',
                            borderRadius: '4px 16px 16px 16px',
                            background: seg.done
                                ? 'rgba(88,166,255,0.12)'
                                : 'rgba(210,168,60,0.08)',
                            border: seg.done
                                ? '1px solid rgba(88,166,255,0.2)'
                                : '1px dashed rgba(210,168,60,0.3)',
                            color: '#e6edf3',
                            fontSize: 15, lineHeight: 1.5,
                            maxWidth: '100%', wordBreak: 'break-word',
                            transition: 'all 0.3s',
                        }}>
                            {seg.translation || '...'}
                            {/* Live segment divider and original text stripped natively */}
                        </div>
                    </div>
                ))}
                
                {/* Stream processing indicator */}
                {speakMode && live.isTranslating && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 14px', borderRadius: 16,
                        background: 'rgba(255,255,255,0.05)',
                        border: `1px solid rgba(255,255,255,0.1)`,
                        alignSelf: activeSide === 'left' ? 'flex-start' : 'flex-end',
                        maxWidth: '85%',
                    }}>
                        <div style={{
                            width: 14, height: 14, border: '2px solid rgba(255,255,255,0.2)',
                            borderTop: `2px solid ${activeSide === 'left' ? '#58a6ff' : '#3fb950'}`,
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                        }} />
                        <span style={{ fontSize: 13, color: '#8b949e', fontStyle: 'italic' }}>
                            {t('translator.processing_stream', 'Processing...')}
                        </span>
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
                position: 'relative',
            }}>
                {/* Text input (when stream OFF) — above speaker selectors */}
                {/* Text input (when stream OFF) or Waveform (when active) */}
                {(!streamMic && !speakMode) ? (
                    <div style={{
                        display: 'flex', gap: 8, width: '100%', maxWidth: 500,
                        alignItems: 'flex-end',
                    }}>
                        <textarea
                            value={textInput}
                            onChange={e => setTextInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextSubmit(); } }}
                            placeholder={t('translator.type_in', 'Type in {lang}...').replace('{lang}', langName(sourceLang))}
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
                ) : (
                    <div style={{
                        display: 'flex', gap: 4, height: 30, alignItems: 'center', justifyContent: 'center',
                        width: '100%', maxWidth: 200, marginBottom: 6, marginTop: 4,
                    }}>
                        {[...Array(16)].map((_, i) => (
                            <div key={i} style={{
                                width: 3,
                                height: (live.isListening || (isRecording && streamMic)) ? '100%' : '15%',
                                background: (live.isListening || (isRecording && streamMic))
                                    ? (activeSide === 'left' ? '#58a6ff' : '#3fb950')
                                    : (isProcessing || sttBusy) ? '#f39c12' : '#30363d',
                                borderRadius: 2,
                                transition: 'all 0.3s ease',
                                animation: (live.isListening || (isRecording && streamMic))
                                    ? `waveform-bounce ${0.4 + (i % 3) * 0.15}s ease-in-out ${i * 0.05}s infinite alternate`
                                    : (isProcessing || sttBusy)
                                        ? `waveform-pulse 1s ease-in-out ${i * 0.1}s infinite alternate`
                                        : 'none',
                                opacity: (live.isListening || (isRecording && streamMic)) ? 1 : (isProcessing || sttBusy) ? 0.8 : 0.4,
                            }} />
                        ))}
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
                            }}>{activeSide === 'left' ? '●' : '○'}</span> {activeSide === 'left' ? t('translator.speaking', 'SPEAKING') : t('translator.listening', 'LISTENING')}
                        </div>
                        <div
                            style={{
                                width: '100%', padding: '8px 10px', borderRadius: 8,
                                background: 'rgba(255,255,255,0.03)',
                                color: '#8b949e',
                                border: activeSide === 'left'
                                    ? '1px solid rgba(88,166,255,0.2)'
                                    : '1px solid rgba(255,255,255,0.05)',
                                fontSize: 13, textAlign: 'center',
                                transition: 'all 0.2s',
                                userSelect: 'none',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                            title={t('translator.system_locked', 'Language locked to global system locale')}
                        >
                            {langName(leftLang)} (System)
                        </div>
                        <div style={{ fontSize: 10, color: '#8b949e', textAlign: 'center', opacity: 0.8, marginTop: 2 }}>
                            {getReadableName(leftLang)}
                        </div>
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
                            }}>{activeSide === 'right' ? '●' : '○'}</span> {activeSide === 'right' ? t('translator.speaking', 'SPEAKING') : t('translator.listening', 'LISTENING')}
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
                        <div style={{ fontSize: 10, color: '#8b949e', textAlign: 'center', opacity: 0.8, marginTop: 2 }}>
                            {getReadableName(rightLang)}
                        </div>
                    </div>
                </div>

                {/* Mic toggle button & Checkbox Container */}
                <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    {/* Mic toggle button — tap to start, tap to stop */}
                    <button
                        onClick={handleMicToggle}
                        onMouseEnter={() => setIsHoverMic(true)}
                        onMouseLeave={() => setIsHoverMic(false)}
                        disabled={!speakMode && (isProcessing || isPlaying || (playingId !== null))}
                        style={{
                            width: (streamMic || speakMode) ? 56 : 40, height: (streamMic || speakMode) ? 56 : 40,
                            borderRadius: '50%',
                            border: 'none',
                            cursor: (!speakMode && (isProcessing || isPlaying || playingId !== null)) ? 'not-allowed' : 'pointer',
                            background: speakMode
                                ? (live.isListening ? '#e74c3c' : live.isActive ? '#f39c12' : '#d2a83c')
                                : (isPlaying || playingId !== null)
                                    ? '#6e7681'
                                    : (isRecording || sttBusy)
                                        ? '#e74c3c'
                                        : (isProcessing || textBusy)
                                            ? '#f39c12'
                                            : activeSide === 'left' ? '#58a6ff' : '#3fb950',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: (isRecording || sttBusy || live.isListening)
                                ? '0 0 30px rgba(231,76,60,0.4)'
                                : speakMode
                                    ? '0 0 16px rgba(210,168,60,0.3)'
                                    : `0 0 16px ${activeSide === 'left' ? 'rgba(88,166,255,0.25)' : 'rgba(63,185,80,0.25)'}`,
                            transition: 'all 0.2s',
                            transform: (isRecording || sttBusy || live.isListening) ? 'scale(1.1)' : 'scale(1)',
                            animation: (isRecording || sttBusy || live.isListening) ? 'pulse-ring 1.5s ease infinite' : 'none',
                            flexShrink: 0,
                        }}
                    >
                        {(isPlaying || playingId !== null) ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                        ) : (isRecording || sttBusy || (speakMode && live.isActive && isHoverMic)) ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                        ) : (isProcessing || textBusy) ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>
                        )}
                    </button>
                </div>
            </div>

            {/* Animations */}
            <style>{`
                @keyframes pulse-ring {
                    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(231,76,60,0.4); }
                    70% { transform: scale(1.1); box-shadow: 0 0 0 10px rgba(231,76,60,0); }
                    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(231,76,60,0); }
                }
                @keyframes speaker-pulse {
                    0% { transform: scale(1); opacity: 0.8; }
                    50% { transform: scale(1.2); opacity: 1; }
                    100% { transform: scale(1); opacity: 0.8; }
                }
                @keyframes waveform-bounce {
                    0% { height: 15%; }
                    100% { height: 100%; }
                }
                @keyframes waveform-pulse {
                    0% { height: 15%; background: #f39c12; }
                    100% { height: 40%; background: #e67e22; }
                }
                .stream-typing::after {
                    content: '...';
                    animation: dots 1.5s steps(4, end) infinite;
                }
                @keyframes dots {
                    0%, 20% { color: rgba(0,0,0,0); text-shadow: .25em 0 0 rgba(0,0,0,0), .5em 0 0 rgba(0,0,0,0); }
                    40% { color: inherit; text-shadow: .25em 0 0 rgba(0,0,0,0), .5em 0 0 rgba(0,0,0,0); }
                    60% { text-shadow: .25em 0 0 inherit, .5em 0 0 rgba(0,0,0,0); }
                    80%, 100% { text-shadow: .25em 0 0 inherit, .5em 0 0 inherit; }
                }
            `}</style>
        </div>
    );
}
