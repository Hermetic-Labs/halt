/**
 * useTTS — Shared WebSocket streaming TTS hook.
 *
 * Extracted from TriagePanel's proven implementation.  Provides:
 *   - Persistent WebSocket to /tts/ws  (auto-reconnects)
 *   - Gapless AudioContext chunk scheduling (nextTime pattern)
 *   - Queue position awareness for badge UI
 *   - Automatic native voice selection per language (Kokoro voice map)
 *
 * Usage:
 *   const { speak, stopSpeak, isSpeaking, queuePosition } = useTTS();
 *   speak("Hello world", "en");
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { isNative } from '../services/api';

// Kokoro native voice map — must match backend KOKORO_VOICE_MAP
const KOKORO_VOICE_MAP: Record<string, string> = {
    en: 'af_heart',
    es: 'ef_dora',
    fr: 'ff_siwis',
    hi: 'hf_alpha',
    it: 'if_sara',
    pt: 'pf_dora',
    zh: 'zf_xiaobei',
};

/** Pick the correct voice for a language (mirrors backend _pick_voice) */
function pickVoice(lang: string): string {
    return KOKORO_VOICE_MAP[lang] || KOKORO_VOICE_MAP['en'];
}

// Global shared AudioContext to prevent driver exclusivity locks with WebRTC
export let globalAudioCtx: AudioContext | null = null;
export function getSharedAudioContext() {
    if (!globalAudioCtx || globalAudioCtx.state === 'closed') {
        globalAudioCtx = new window.AudioContext();
    }
    return globalAudioCtx;
}

export function useTTS() {
    const wsRef = useRef<WebSocket | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const nextTimeRef = useRef<number>(0);
    const lastSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const pendingChunksRef = useRef<number>(0);
    const ttsQueueRef = useRef<{ text: string; lang: string }[]>([]);

    const [isSpeaking, setIsSpeaking] = useState(false);
    const [queuePosition, setQueuePosition] = useState<number | null>(null);

    // ── Audio chunk playback (gapless scheduling) ────────────────────────────

    const playChunk = useCallback(async (buf: ArrayBuffer) => {
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
    }, []);

    // ── WebSocket connection ─────────────────────────────────────────────────

    const ensureWs = useCallback(() => {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = getSharedAudioContext();
            nextTimeRef.current = audioCtxRef.current.currentTime + 0.1;
        }

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return wsRef.current;
        if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) return wsRef.current;

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${window.location.host}/tts/ws`);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
            // Flush any queued messages
            ttsQueueRef.current.forEach(q =>
                ws.send(JSON.stringify({ text: q.text, voice: pickVoice(q.lang), speed: 1.0, lang: q.lang }))
            );
            ttsQueueRef.current = [];
        };

        ws.onmessage = async (e) => {
            if (e.data instanceof ArrayBuffer) {
                playChunk(e.data);
            } else {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'queued') {
                        setQueuePosition(msg.position);
                    } else if (msg.type === 'done') {
                        setQueuePosition(null);
                        pendingChunksRef.current = Math.max(0, pendingChunksRef.current - 1);
                        if (pendingChunksRef.current === 0) {
                            if (lastSourceRef.current) {
                                lastSourceRef.current.onended = () => {
                                    setIsSpeaking(false);
                                    lastSourceRef.current = null;
                                };
                            } else {
                                setIsSpeaking(false);
                            }
                        }
                    }
                } catch { /* ignore non-JSON */ }
            }
        };

        ws.onerror = () => { setIsSpeaking(false); setQueuePosition(null); };
        ws.onclose = () => { wsRef.current = null; setIsSpeaking(false); setQueuePosition(null); };

        return ws;
    }, [playChunk]);

    // ── Pre-warm on mount, cleanup on unmount ────────────────────────────────

    useEffect(() => {
        ensureWs();
        return () => {
            if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
            // Do NOT close the shared AudioContext to prevent WebRTC hardware lock loss
            audioCtxRef.current = null;
        };
    }, [ensureWs]);

    // ── Public API ───────────────────────────────────────────────────────────

    const stopSpeak = useCallback(() => {
        if (audioCtxRef.current) {
            // Do NOT close the shared AudioContext
            audioCtxRef.current = null;
        }
        if (wsRef.current) {
            wsRef.current.onclose = null; // prevent onclose from resetting state prematurely
            try { wsRef.current.close(); } catch { /* ignore */ }
            wsRef.current = null;
        }
        ttsQueueRef.current = [];
        lastSourceRef.current = null;
        pendingChunksRef.current = 0;
        setIsSpeaking(false);
        setQueuePosition(null);
    }, []);

    const speak = useCallback((text: string, lang: string = 'en') => {
        // Clean up previous session
        if (wsRef.current) {
            wsRef.current.onclose = null;
            wsRef.current.onerror = null;
            wsRef.current.onmessage = null;
            try { wsRef.current.close(); } catch { /* ignore */ }
            wsRef.current = null;
        }
        if (audioCtxRef.current) {
            // Do NOT close the shared AudioContext
            audioCtxRef.current = null;
        }
        ttsQueueRef.current = [];

        setIsSpeaking(true);
        setQueuePosition(null);

        // Reuse shared audio context
        audioCtxRef.current = getSharedAudioContext();
        nextTimeRef.current = audioCtxRef.current.currentTime + 0.1;
        if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => { });
        }

        // Strip markdown and split into sentence chunks
        const clean = text
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/#{1,6}\s+/g, '')
            .replace(/`(.+?)`/g, '$1')
            .replace(/[*_#`]/g, '')
            .replace(/^\d+\.\s+/gm, '')
            .replace(/^[-•]\s+/gm, '')
            .replace(/\n{2,}/g, '\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();

        if (!clean) { setIsSpeaking(false); return; }

        const chunks = clean.match(/[^.!?\n]+[.!?\n]+/g) || [clean];
        const validChunks = chunks.map(c => c.trim()).filter(c => c.length > 0);
        const voice = pickVoice(lang);

        if (isNative) {
            pendingChunksRef.current = validChunks.length;
            (async () => {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    for (const c of validChunks) {
                        if (!audioCtxRef.current) break;
                        try {
                            const res = await invoke<{ audio_base64?: string }>('tts_synthesize', { request: { text: c, voice, speed: 1.0, lang } });
                            if (!audioCtxRef.current) break;
                            if (res && res.audio_base64) {
                                const b64 = res.audio_base64.split(',')[1];
                                const buf = await fetch(`data:audio/wav;base64,${b64}`).then(r => r.arrayBuffer());
                                await playChunk(buf);
                            }
                        } catch (e) {
                            console.error('[TTS native error]', e);
                        }
                        pendingChunksRef.current = Math.max(0, pendingChunksRef.current - 1);
                    }
                } finally {
                    if (audioCtxRef.current && pendingChunksRef.current === 0) {
                        if (lastSourceRef.current) {
                            lastSourceRef.current.onended = () => {
                                setIsSpeaking(false);
                                lastSourceRef.current = null;
                            };
                        } else {
                            setIsSpeaking(false);
                        }
                    }
                }
            })();
            return;
        }

        const ws = ensureWs();
        pendingChunksRef.current = validChunks.length;

        if (ws.readyState === WebSocket.OPEN) {
            validChunks.forEach(c => ws.send(JSON.stringify({ text: c, voice, speed: 1.0, lang })));
        } else {
            validChunks.forEach(c => ttsQueueRef.current.push({ text: c, lang }));
        }
    }, [ensureWs, playChunk]);

    return { speak, stopSpeak, isSpeaking, queuePosition, pickVoice };
}
