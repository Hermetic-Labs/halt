import { useState, useRef, useCallback, useEffect } from 'react';
import { sttListen, translateText } from '../services/api';
import { convertWebmToWav } from '../services/audioUtils';

export type LiveCallState = 'idle' | 'recording' | 'processing' | 'error';

export function useTranslateLiveCall() {
    const [state, setState] = useState<LiveCallState>('idle');
    const [error, setError] = useState('');
    
    const mediaRecRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    const cleanup = useCallback(() => {
        if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
            mediaRecRef.current.stop();
        }
        mediaRecRef.current = null;
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        audioChunksRef.current = [];
    }, []);

    const startRecording = useCallback(async () => {
        cleanup();
        setError('');
        setState('recording');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            let mimeType = '';
            for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
                if (MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
            }

            const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
            mediaRecRef.current = mr;
            audioChunksRef.current = [];

            mr.ondataavailable = (e) => { 
                if (e.data.size > 0) audioChunksRef.current.push(e.data); 
            };

            mr.start();
        } catch (err) {
            setError((err as Error).message);
            setState('error');
            cleanup();
        }
    }, [cleanup]);

    const stopAndTranslate = useCallback((
        targetLang: string, 
        sourceLang: string = 'auto',
        onTranslationComplete: (translatedText: string, lang: string) => void
    ) => {
        const mr = mediaRecRef.current;
        if (!mr || mr.state === 'inactive') return;

        setState('processing');

        // Overwrite onstop to process the final blob
        mr.onstop = async () => {
            const chunks = audioChunksRef.current;
            const mimeType = mr.mimeType || 'audio/webm';
            
            try {
                const audioBlob = new Blob(chunks, { type: mimeType });
                
                if (audioBlob.size < 100) {
                    console.warn('[PTT] Audio blob too small. Dropping.');
                    setState('idle');
                    return;
                }

                const wavBlob = await convertWebmToWav(audioBlob);
                const fd = new FormData();
                fd.append('audio', wavBlob, 'recording.wav');
                if (sourceLang && sourceLang !== 'auto') {
                    fd.append('language', sourceLang);
                }

                // 1. STT
                const sttResult = await sttListen(fd);
                const transcript = sttResult.text || '';
                const detectedLang = sttResult.language || sourceLang;

                if (!transcript.trim()) {
                    console.warn('[PTT] Empty transcript. Dropping.');
                    setState('idle');
                    return;
                }

                // 2. Translate only if needed
                let translation = transcript;
                if (detectedLang !== targetLang) {
                    const trResult = await translateText(
                        transcript,
                        detectedLang === 'auto' ? 'en' : detectedLang,
                        targetLang
                    );
                    translation = trResult.translated || transcript;
                }

                // Fire callback with the result to push across DataChannel
                onTranslationComplete(translation, targetLang);
                
                setState('idle');
            } catch (err) {
                console.error('[PTT] Translation Error:', err);
                setError((err as Error).message);
                setState('error');
            } finally {
                cleanup();
            }
        };

        // Stop recorder to trigger onstop
        mr.stop();

    }, [cleanup]);

    useEffect(() => cleanup, [cleanup]);

    return {
        state,
        error,
        startRecording,
        stopAndTranslate
    };
}
