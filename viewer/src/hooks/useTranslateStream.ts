/**
 * useTranslateStream.ts — Real-time translation pipeline hook.
 *
 * Flow: Mic → WebSocket → Faster Whisper STT → NLLB → Kokoro TTS → Buffered Playback
 *
 * Text (transcript + translation) displays immediately.
 * Audio buffers and plays only when the full message is synthesized.
 */
import { useState, useRef, useCallback } from 'react';

export type TranslateStreamState =
    | 'idle'
    | 'listening'    // mic recording
    | 'transcribing' // whisper processing
    | 'translating'  // NLLB processing
    | 'synthesizing'  // Kokoro generating
    | 'playing'      // audio playback
    | 'error';

export interface TranslateResult {
    transcript: string;
    sourceLang: string;
    translation: string;
    targetLang: string;
    english: string;
}

const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/translate-stream/ws`;

/**
 * Decode + stitch + play WAV chunks through AudioContext.
 * Standalone function — no hook dependency needed.
 */
async function playBufferedAudio(chunks: ArrayBuffer[], ctx: AudioContext): Promise<void> {
    const decoded: AudioBuffer[] = [];
    for (const chunk of chunks) {
        try {
            const ab = await ctx.decodeAudioData(chunk.slice(0));  // slice to avoid detached buffer
            decoded.push(ab);
        } catch (e) {
            console.warn('[TranslateStream] Failed to decode audio chunk:', e);
        }
    }
    if (decoded.length === 0) return;

    // Stitch into single buffer
    const totalLength = decoded.reduce((sum, buf) => sum + buf.length, 0);
    const sampleRate = decoded[0].sampleRate;
    const combined = ctx.createBuffer(1, totalLength, sampleRate);
    const channel = combined.getChannelData(0);

    let offset = 0;
    for (const buf of decoded) {
        channel.set(buf.getChannelData(0), offset);
        offset += buf.length;
    }

    // Play
    const source = ctx.createBufferSource();
    source.buffer = combined;
    source.connect(ctx.destination);

    return new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
    });
}

export function useTranslateStream() {
    const [state, setState] = useState<TranslateStreamState>('idle');
    const [result, setResult] = useState<TranslateResult | null>(null);
    const [error, setError] = useState<string>('');

    const wsRef = useRef<WebSocket | null>(null);
    const mediaRecRef = useRef<MediaRecorder | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);

    const cleanup = useCallback(() => {
        if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
            mediaRecRef.current.stop();
            mediaRecRef.current.stream.getTracks().forEach(t => t.stop());
        }
        mediaRecRef.current = null;
        if (wsRef.current && wsRef.current.readyState <= 1) {
            wsRef.current.close();
        }
        wsRef.current = null;
    }, []);

    /**
     * Start recording. Call with target language.
     */
    const startRecording = useCallback(async (targetLang: string, sourceLang = 'auto', speed = 1.0) => {
        cleanup();
        setResult(null);
        setError('');

        try {
            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;
            const wavChunks: ArrayBuffer[] = [];

            ws.onopen = () => {
                ws.send(JSON.stringify({ target_lang: targetLang, source_lang: sourceLang, speed }));
            };

            ws.onmessage = async (e) => {
                if (e.data instanceof Blob) {
                    const ab = await e.data.arrayBuffer();
                    wavChunks.push(ab);
                } else {
                    const msg = JSON.parse(e.data);
                    switch (msg.type) {
                        case 'status':
                            if (msg.status === 'transcribing') setState('transcribing');
                            else if (msg.status === 'translating') setState('translating');
                            else if (msg.status === 'synthesizing') setState('synthesizing');
                            break;
                        case 'transcript':
                            setResult(prev => ({
                                transcript: msg.text,
                                sourceLang: msg.source_lang,
                                translation: prev?.translation || '',
                                targetLang: prev?.targetLang || targetLang,
                                english: prev?.english || '',
                            }));
                            break;
                        case 'translation':
                            setResult(prev => ({
                                transcript: prev?.transcript || '',
                                sourceLang: prev?.sourceLang || '',
                                translation: msg.text,
                                targetLang: msg.target_lang,
                                english: msg.english || '',
                            }));
                            break;
                        case 'done':
                            if (wavChunks.length > 0) {
                                setState('playing');
                                if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
                                await playBufferedAudio(wavChunks, audioCtxRef.current);
                            }
                            setState('idle');
                            ws.close();
                            break;
                        case 'error':
                            setError(msg.error);
                            setState('error');
                            ws.close();
                            break;
                    }
                }
            };

            ws.onerror = () => {
                setError('WebSocket connection failed');
                setState('error');
            };

            ws.onclose = () => {
                setState(prev => prev === 'error' ? 'error' : prev === 'playing' ? 'playing' : 'idle');
            };

            // Wait for WS to open
            await new Promise<void>((resolve, reject) => {
                ws.addEventListener('open', () => resolve(), { once: true });
                ws.addEventListener('error', () => reject(new Error('WS connect failed')), { once: true });
            });

            // Start mic
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            let mimeType = '';
            for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
                if (MediaRecorder.isTypeSupported(mime)) { mimeType = mime; break; }
            }

            const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
            mediaRecRef.current = mr;

            mr.ondataavailable = (e) => {
                if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                    ws.send(e.data);
                }
            };

            mr.start(250);
            setState('listening');

        } catch (err) {
            setError((err as Error).message);
            setState('error');
            cleanup();
        }
    }, [cleanup]);

    const stopRecording = useCallback(() => {
        if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
            mediaRecRef.current.stop();
            mediaRecRef.current.stream.getTracks().forEach(t => t.stop());
        }
        mediaRecRef.current = null;

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'end' }));
        }

        setState('transcribing');
    }, []);

    const cancel = useCallback(() => {
        cleanup();
        setState('idle');
        setResult(null);
        setError('');
    }, [cleanup]);

    return {
        state,
        result,
        error,
        startRecording,
        stopRecording,
        cancel,
        isRecording: state === 'listening',
        isProcessing: ['transcribing', 'translating', 'synthesizing'].includes(state),
        isPlaying: state === 'playing',
    };
}
