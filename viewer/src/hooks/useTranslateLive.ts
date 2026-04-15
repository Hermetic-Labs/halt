/**
 * useTranslateLive — Real-time continuous translation hook.
 *
 * Client-side silence detection via AudioContext AnalyserNode.
 * When the user pauses speaking, the accumulated audio segment is sent
 * to the server for processing (Whisper → NLLB → Kokoro TTS).
 *
 * Dual-socket architecture:
 *   INPUT socket  → sends mic audio segments to server
 *   OUTPUT socket → receives transcripts, translations, and TTS WAV
 *
 * Audio playback uses gapless scheduling (nextTime pattern from useTTS).
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { getSharedAudioContext } from './useTTS';
import { isNative, sttListen, translateText, ttsSynthesize } from '../services/api';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LiveSegment {
    segmentId: number;
    transcript: string;
    sourceLang: string;
    translation: string;
    targetLang: string;
    done: boolean;       // true once TTS has finished for this segment
}

export type LiveState = 'idle' | 'listening' | 'processing' | 'connecting' | 'error';

// ── Silence detection config ─────────────────────────────────────────────────

const SILENCE_THRESHOLD = -45;      // dBFS — below this = silence
const SILENCE_DURATION_MS = 800;    // strict VAD wait before cut
const MIN_SPEECH_DURATION_MS = 300; // minimum speech before we'd send a segment
const ANALYSER_INTERVAL_MS = 50;    // how often we check volume

// ── WebSocket URLs ───────────────────────────────────────────────────────────

const proto = () => location.protocol === 'https:' ? 'wss:' : 'ws:';
const INPUT_URL = () => `${proto()}//${location.host}/translate-live/input`;
const OUTPUT_URL = () => `${proto()}//${location.host}/translate-live/output`;

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useTranslateLive() {
    const [state, setState] = useState<LiveState>('idle');
    const [segments, setSegments] = useState<LiveSegment[]>([]);
    const [activeTranscript, setActiveTranscript] = useState('');
    const [error, setError] = useState('');
    const [isPlayingTTS, setIsPlayingTTS] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);

    // Refs for cleanup
    const inputWsRef = useRef<WebSocket | null>(null);
    const outputWsRef = useRef<WebSocket | null>(null);
    const mediaRecRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const keepMicAliveRef = useRef(false);
    const sessionIdRef = useRef('');
    const playingCountRef = useRef(0);
    const isTranslatingRef = useRef(false);
    
    // Toggle for TTS audio (allows user to mute live speech parsing)
    const muteTTSRef = useRef(false);
    const [isMuted, setIsMuted] = useState(false);
    
    const toggleMute = useCallback(() => {
        muteTTSRef.current = !muteTTSRef.current;
        setIsMuted(muteTTSRef.current);
    }, []);

    // TTS playback refs (gapless scheduling from useTTS)
    const playCtxRef = useRef<AudioContext | null>(null);
    const nextTimeRef = useRef<number>(0);

    const startMicRecorder = useCallback(() => {
        if (!streamRef.current) return;
        
        let mimeType = '';
        for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
            if (MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
        }

        const mr = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : {});
        mediaRecRef.current = mr;

        mr.ondataavailable = (e) => {
            if (e.data.size > 0) {
                const inputWs = inputWsRef.current;
                if (!inputWs || inputWs.readyState !== WebSocket.OPEN) return;
                
                const blob = new Blob([e.data], { type: e.data.type });
                blob.arrayBuffer().then(buf => {
                    if (inputWs.readyState === WebSocket.OPEN) {
                        inputWs.send(buf);
                        inputWs.send(JSON.stringify({ type: 'segment' }));
                    }
                });
            }
        };

        try { mr.start(); } catch { /* ignore */ }
    }, []);

    const tryResumeRecording = useCallback(() => {
        if (!isTranslatingRef.current && playingCountRef.current === 0) {
            if (inputWsRef.current?.readyState === WebSocket.OPEN && streamRef.current) {
                // Ensure old instance is cleaned up correctly
                if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
                    mediaRecRef.current.stop();
                }
                // Actively instantiate a new MediaRecorder to guarantee pristine WebM headers
                startMicRecorder();
            }
        }
    }, [startMicRecorder]);

    // ── Gapless WAV playback ─────────────────────────────────────────────────

    const playChunk = useCallback(async (buf: ArrayBuffer) => {
        if (!playCtxRef.current || playCtxRef.current.state === 'closed') {
            playCtxRef.current = getSharedAudioContext();
            nextTimeRef.current = playCtxRef.current.currentTime + 0.15;
        }
        const ctx = playCtxRef.current!;
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

        try {
            const decoded = await ctx.decodeAudioData(buf.slice(0));
            const src = ctx.createBufferSource();
            src.buffer = decoded;
            src.connect(ctx.destination);

            const now = ctx.currentTime;
            if (nextTimeRef.current < now) nextTimeRef.current = now + 0.1;

            playingCountRef.current++;
            setIsPlayingTTS(true);

            src.onended = () => {
                playingCountRef.current--;
                if (playingCountRef.current <= 0) {
                    playingCountRef.current = 0;
                    setIsPlayingTTS(false);
                    tryResumeRecording();
                }
            };

            src.start(nextTimeRef.current);
            nextTimeRef.current += decoded.duration;
        } catch { /* skip invalid chunk */ }
    }, [tryResumeRecording]);

    // ── Send accumulated audio as a segment ──────────────────────────────────

    const flushSegment = useCallback(() => {
        if (!mediaRecRef.current || mediaRecRef.current.state !== 'recording') return;

        // Synchronously lock the mic immediately via VAD flush
        isTranslatingRef.current = true;
        setIsTranslating(true);

        // Triggers the final complete Blob in ondataavailable containing explicit WebM headers
        mediaRecRef.current.stop();
    }, []);

    // ── Silence detection via AnalyserNode ───────────────────────────────────

    const startSilenceDetection = useCallback((stream: MediaStream) => {
        const ctx = getSharedAudioContext();
        audioCtxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);

        const dataArray = new Float32Array(analyser.fftSize);
        let silenceStart = 0;
        let isSpeaking = false;
        let speechStart = 0;

        const check = () => {
            // Echo cancellation & Turn-taking locking
            // If the backend is processing or emitting audio, wait.
            if (playingCountRef.current > 0 || isTranslatingRef.current) {
                isSpeaking = false;
                silenceStart = 0;
                return;
            }

            analyser.getFloatTimeDomainData(dataArray);

            // Calculate RMS → dBFS
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / dataArray.length);
            const dbfs = rms > 0 ? 20 * Math.log10(rms) : -100;

            const now = Date.now();

            if (dbfs > SILENCE_THRESHOLD) {
                // Sound detected
                if (!isSpeaking) {
                    isSpeaking = true;
                    speechStart = now;
                }
                silenceStart = 0;
            } else {
                // Silence
                if (isSpeaking) {
                    if (silenceStart === 0) {
                        silenceStart = now;
                    } else if (now - silenceStart >= SILENCE_DURATION_MS) {
                        // Pause detected — flush if we had enough speech
                        const duration = now - speechStart;
                        if (duration >= MIN_SPEECH_DURATION_MS) {
                            flushSegment();
                        }
                        isSpeaking = false;
                        silenceStart = 0;
                    }
                }
            }
        };

        checkIntervalRef.current = setInterval(check, ANALYSER_INTERVAL_MS);
    }, [flushSegment]);

    // ── Cleanup ──────────────────────────────────────────────────────────────

    const cleanup = useCallback(() => {
        if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current);
            checkIntervalRef.current = null;
        }
        if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
            mediaRecRef.current.stop();
        }
        mediaRecRef.current = null;
        if (streamRef.current && !keepMicAliveRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (audioCtxRef.current) {
            // Do NOT close the shared AudioContext
            audioCtxRef.current = null;
        }
        if (inputWsRef.current && inputWsRef.current.readyState <= 1) {
            inputWsRef.current.close();
        }
        inputWsRef.current = null;
        if (outputWsRef.current && outputWsRef.current.readyState <= 1) {
            outputWsRef.current.close();
        }
        outputWsRef.current = null;
        audioChunksRef.current = [];
        keepMicAliveRef.current = false;
    }, []);

    // ── Start live translation ───────────────────────────────────────────────

    const start = useCallback(async (targetLang: string, sourceLang = 'auto') => {
        // Shield the active hardware stream from the mechanical safety teardown to prevent device locks
        const hotStream = streamRef.current;
        streamRef.current = null;

        cleanup();

        if (hotStream) {
            streamRef.current = hotStream;
        }

        isTranslatingRef.current = false;
        setIsTranslating(false);
        playingCountRef.current = 0;
        setIsPlayingTTS(false);

        setActiveTranscript('');
        setError('');
        setState('connecting');
        const sessionId = crypto.randomUUID();
        sessionIdRef.current = sessionId;

        // ── Native (Tauri) path: VAD + sttListen → translateText → ttsSynthesize chain ──
        if (isNative) {
            try {
                // Get mic
                let stream = streamRef.current;
                if (!stream || stream.getTracks().length === 0 || stream.getTracks()[0].readyState === 'ended') {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    streamRef.current = stream;
                }

                // Start local mic recorder
                let segId = 0;
                let mimeType = '';
                for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
                    if (MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
                }

                const startSegmentRecorder = () => {
                    if (!streamRef.current) return;
                    const mr = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : {});
                    mediaRecRef.current = mr;
                    const chunks: Blob[] = [];

                    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

                    mr.onstop = async () => {
                        const currentSegId = segId++;
                        try {
                            isTranslatingRef.current = true;
                            setIsTranslating(true);

                            // 1. STT
                            const audioBlob = new Blob(chunks, { type: mimeType || 'audio/webm' });
                            const fd = new FormData();
                            fd.append('audio', audioBlob, 'recording.webm');
                            const sttResult = await sttListen(fd);
                            const transcript = sttResult.text || '';
                            const detectedLang = sttResult.language || sourceLang;

                            if (!transcript.trim()) {
                                isTranslatingRef.current = false;
                                setIsTranslating(false);
                                tryResumeRecording();
                                return;
                            }

                            setActiveTranscript(transcript);
                            setSegments(prev => [...prev, {
                                segmentId: currentSegId,
                                transcript,
                                sourceLang: detectedLang,
                                translation: '',
                                targetLang,
                                done: false,
                            }]);

                            // 2. Translate
                            const trResult = await translateText(
                                transcript,
                                detectedLang === 'auto' ? 'en' : detectedLang,
                                targetLang
                            );
                            const translation = trResult.translated || transcript;

                            setSegments(prev => prev.map(s =>
                                s.segmentId === currentSegId
                                    ? { ...s, translation, targetLang }
                                    : s
                            ));

                            // 3. TTS (if not muted)
                            if (!muteTTSRef.current) {
                                const ttsRes = await ttsSynthesize(translation, undefined, 1.0, targetLang);
                                if (ttsRes.ok) {
                                    const ttsData = await ttsRes.json();
                                    if (ttsData.audio_base64) {
                                        const b64 = ttsData.audio_base64.includes(',')
                                            ? ttsData.audio_base64.split(',')[1]
                                            : ttsData.audio_base64;
                                        const bin = atob(b64);
                                        const buf = new Uint8Array(bin.length);
                                        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
                                        await playChunk(buf.buffer);
                                    }
                                }
                            }

                            // Mark segment done
                            setSegments(prev => prev.map(s =>
                                s.segmentId === currentSegId ? { ...s, done: true } : s
                            ));
                            setActiveTranscript('');
                        } catch (err) {
                            setError((err as Error).message);
                        } finally {
                            isTranslatingRef.current = false;
                            setIsTranslating(false);
                            tryResumeRecording();
                        }
                    };

                    try { mr.start(); } catch { /* ignore */ }
                };


                // Start first segment recorder
                startSegmentRecorder();

                // Start silence detection (uses flushSegment which stops MediaRecorder)
                startSilenceDetection(stream);

                setState('listening');
            } catch (err) {
                setError((err as Error).message);
                setState('error');
                cleanup();
            }
            return;
        }

        // ── WebSocket path (browser / dev) ──────────────────────────────────
        try {
            // 1. Open output socket first (so it's ready to receive)
            const outputWs = new WebSocket(OUTPUT_URL());
            outputWsRef.current = outputWs;

            outputWs.binaryType = 'arraybuffer';

            outputWs.onmessage = async (e) => {
                if (e.data instanceof ArrayBuffer) {
                    // TTS WAV chunk — play immediately if not muted
                    if (!muteTTSRef.current) {
                        playChunk(e.data);
                    }
                } else {
                    const msg = JSON.parse(e.data);
                    switch (msg.type) {
                        case 'transcript':
                            setActiveTranscript(msg.text);
                            setSegments(prev => {
                                const existing = prev.find(s => s.segmentId === msg.segment_id);
                                if (existing) {
                                    return prev.map(s => s.segmentId === msg.segment_id
                                        ? { ...s, transcript: msg.text, sourceLang: msg.source_lang }
                                        : s);
                                }
                                return [...prev, {
                                    segmentId: msg.segment_id,
                                    transcript: msg.text,
                                    sourceLang: msg.source_lang,
                                    translation: '',
                                    targetLang: targetLang,
                                    done: false,
                                }];
                            });
                            break;
                        case 'translation':
                            setSegments(prev => prev.map(s =>
                                s.segmentId === msg.segment_id
                                    ? { ...s, translation: msg.text, targetLang: msg.target_lang }
                                    : s
                            ));
                            break;
                        case 'segment_done':
                            setSegments(prev => prev.map(s =>
                                s.segmentId === msg.segment_id
                                    ? { ...s, done: true }
                                    : s
                            ));
                            setActiveTranscript('');
                            isTranslatingRef.current = false;
                            setIsTranslating(false);
                            tryResumeRecording();
                            break;
                        case 'done':
                            setState('idle');
                            cleanup();
                            break;
                        case 'error':
                            setError(msg.error);
                            setState('error');
                            break;
                    }
                }
            };

            outputWs.onerror = () => { setError('Output connection failed'); setState('error'); };

            // Wait for output socket to connect
            await new Promise<void>((resolve, reject) => {
                outputWs.addEventListener('open', () => resolve(), { once: true });
                outputWs.addEventListener('error', () => reject(new Error('Output WS failed')), { once: true });
            });

            // Send output config
            outputWs.send(JSON.stringify({ session_id: sessionId }));

            // 2. Open input socket
            const inputWs = new WebSocket(INPUT_URL());
            inputWsRef.current = inputWs;

            inputWs.onerror = () => { setError('Input connection failed'); setState('error'); };

            await new Promise<void>((resolve, reject) => {
                inputWs.addEventListener('open', () => resolve(), { once: true });
                inputWs.addEventListener('error', () => reject(new Error('Input WS failed')), { once: true });
            });

            // Send input config
            inputWs.send(JSON.stringify({
                session_id: sessionId,
                target_lang: targetLang,
                source_lang: sourceLang,
            }));

            // 3. Start mic (reuse if kept alive)
            let stream = streamRef.current;
            if (!stream || stream.getTracks().length === 0 || stream.getTracks()[0].readyState === 'ended') {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                streamRef.current = stream;
            }

            startMicRecorder();

            // 4. Start silence detection
            startSilenceDetection(stream);

            setState('listening');

        } catch (err) {
            setError((err as Error).message);
            setState('error');
            cleanup();
        }
    }, [cleanup, playChunk, startSilenceDetection, startMicRecorder, tryResumeRecording]);

    // ── Stop live translation ────────────────────────────────────────────────

    const stop = useCallback((keepMicAlive = false) => {
        if (keepMicAlive) {
            keepMicAliveRef.current = true;
        }
        // Flush any remaining audio
        flushSegment();

        // Send end signal
        if (inputWsRef.current && inputWsRef.current.readyState === WebSocket.OPEN) {
            inputWsRef.current.send(JSON.stringify({ type: 'end' }));
        }

        // Stop mic + silence detection (keep sockets open for final results)
        if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current);
            checkIntervalRef.current = null;
        }
        if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
            mediaRecRef.current.stop();
        }
        mediaRecRef.current = null;
        if (streamRef.current && !keepMicAliveRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (audioCtxRef.current) {
            // Do NOT close the shared AudioContext (fixes full app singleton crash)
            audioCtxRef.current = null;
        }

        setState('processing');
    }, [flushSegment]);

    // ── Cancel (hard stop) ───────────────────────────────────────────────────

    const cancel = useCallback(() => {
        cleanup();
        setState('idle');
        setSegments([]);
        setActiveTranscript('');
        setError('');
    }, [cleanup]);

    // ── Unmount cleanup ──────────────────────────────────────────────────────
    
    useEffect(() => {
        return () => {
            cleanup();
        };
    }, [cleanup]);

    return {
        state, segments, activeTranscript, error,
        start, stop, cancel,
        isListening: state !== 'idle' && state !== 'error' && !isPlayingTTS && !isTranslating, 
        isActive: state !== 'idle',
        isMuted, toggleMute
    };
}
