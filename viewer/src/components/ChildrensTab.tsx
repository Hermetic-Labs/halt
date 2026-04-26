import React, { useState, useRef, useEffect } from 'react';
import { MemoryMatch } from './MemoryMatch';
import { CloudHopper } from './CloudHopper';
import { StarCollector } from './StarCollector';
import { BreathingBubble } from './BreathingBubble';
import { isNative, sttListen, translateText } from '../services/api';
import { convertWebmToWav } from '../services/audioUtils';
import { AVAILABLE_LANGS } from '../hooks/useLanguageArray';
import { PERSONAS } from '../constants/personas';
import { useTTS } from '../hooks/useTTS';

interface ChatMessage {
  id: string;
  sender: 'child' | 'model';
  text: string;
}

interface ChildrensTabProps {
  onClose?: () => void;
}

export const ChildrensTab: React.FC<ChildrensTabProps> = ({ onClose }) => {
  const [activeGame, setActiveGame] = useState<'match' | 'hop' | 'star' | 'breathe'>('match');
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'initial', sender: 'model', text: 'Hi there! I am right here with you. Do you want to play a game while we talk?' }
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { speak, stopSpeak } = useTTS();

  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [selectedLang, setSelectedLang] = useState('en');
  
  const [personaMode, setPersonaMode] = useState<'child' | 'adult' | 'professional'>('child');
  const [volume, setVolume] = useState(0.4);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Global Audio control
  useEffect(() => {
    if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.loop = true;
    }
    const audio = audioRef.current;
    
    let src = '';
    if (activeGame === 'hop' || activeGame === 'star') src = '/audio/Music_fx_calm_8_bit_game_loop.wav';
    else if (activeGame === 'match') src = '/audio/Music_fx_calm__puzzel_game_loop.wav';
    else if (activeGame === 'breathe') src = '/audio/Music_fx_calm_meditative.wav';

    const fullSrc = window.location.origin + src;
    if (audio.src !== fullSrc && src !== '') {
        audio.src = src;
        audio.play().catch(() => {});
    }
  }, [activeGame]);

  useEffect(() => {
      if (audioRef.current) {
          audioRef.current.volume = isMuted ? 0 : volume;
      }
  }, [volume, isMuted]);

  useEffect(() => {
      return () => {
          if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.src = '';
          }
      };
  }, []);

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

  // Hold-to-exit state
  const [holdProgress, setHoldProgress] = useState(0);
  const holdIntervalRef = useRef<number | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clean up timers
  useEffect(() => {
    return () => {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    };
  }, []);

  const startHold = () => {
    if (!onClose) return;
    setHoldProgress(0);
    const startTime = Date.now();
    holdIntervalRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / 2000) * 100, 100);
      setHoldProgress(progress);
      if (progress >= 100) {
        if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
        onClose();
      }
    }, 50);
  };

  const endHold = () => {
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    setHoldProgress(0);
  };

  const handleToggleMic = async () => {
    stopSpeak();
    
    if (isRecording) {
      if (mediaRecRef.current) {
        mediaRecRef.current.requestData();
        mediaRecRef.current.stop();
      }
      setIsRecording(false);
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
        if (blob.size === 0) return;

        setIsSending(true);
        const childMsgId = Date.now().toString();
        setMessages(prev => [...prev, { id: childMsgId, sender: 'child', text: '...' }]);

        try {
          let audioPayload = blob;
          let filename = 'recording.webm';
          if (actualMime.includes('webm') || actualMime.includes('opus')) {
            audioPayload = await convertWebmToWav(blob);
            filename = 'recording.wav';
          }
          const fd = new FormData();
          fd.append('audio', audioPayload, filename);
          
          const sttData = await sttListen(fd);
          const txt = (sttData.text || '').trim();
          
          if (!txt) {
            setMessages(prev => prev.filter(m => m.id !== childMsgId));
            setIsSending(false);
            return;
          }

          setMessages(prev => prev.map(m => m.id === childMsgId ? { ...m, text: txt } : m));

          // Translate input if needed
          let englishTxt = txt;
          if (selectedLang !== 'en') {
              try {
                  const td = await translateText(txt, selectedLang, 'en');
                  englishTxt = td.translated || txt;
              } catch { /* fallback */ }
          }

          if (isNative) {
            const { invoke } = await import('@tauri-apps/api/core');
            const { listen } = await import('@tauri-apps/api/event');
            
            let promptStr = '';
            const recent = messages.slice(-4);
            for (const m of recent) {
              if (m.sender === 'child') promptStr += `USER: ${m.text}\n`;
              if (m.sender === 'model') promptStr += `ASSISTANT: ${m.text}\n`;
            }
            promptStr += `USER: ${englishTxt}\nASSISTANT:`;

            const systemStr = personaMode === 'adult' ? PERSONAS.ADULT : personaMode === 'professional' ? PERSONAS.MEDICAL_PROFESSIONAL : PERSONAS.CHILD_UNDER_12;

            let full = '';
            const unlisten = await listen('inference-token', (event: { payload: { done?: boolean; token?: string } }) => {
              const d = event.payload;
              if (d.done) return;
              if (d.token) {
                full += d.token;
                setStreamingText(full);
              }
            });

            await invoke('inference_stream', {
              request: {
                prompt: promptStr,
                system: systemStr,
                max_tokens: 256,
                temperature: 0.7,
                persona: '',
                stream: true,
                model_id: "arliai"
              }
            });
            
            unlisten();
            let finalOutput = full.trim();
            if (selectedLang !== 'en' && finalOutput) {
                try {
                    const td = await translateText(finalOutput, 'en', selectedLang);
                    finalOutput = td.translated || finalOutput;
                } catch { /* fallback */ }
            }

            if (finalOutput) {
              setMessages(prev => [...prev, { id: Date.now().toString() + 'm', sender: 'model', text: finalOutput }]);
              speak(finalOutput, selectedLang);
            }
            setStreamingText('');
          }
        } catch (e) {
          console.error("Chat error:", e);
          setMessages(prev => prev.filter(m => m.id !== childMsgId));
        } finally {
          setIsSending(false);
        }
      };

      mr.start(250);
      setIsRecording(true);
    } catch (e) {
      console.error('Mic error:', e);
    }
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100vh', background: '#000', overflow: 'hidden', margin: 0, padding: 0 }}>
      
      {/* Main Area: Game Selection & Render (Left) */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', background: '#0d1117' }}>
        
        {/* Mode Selector & Volume Header */}
        <div style={{
          height: 48,
          background: 'rgba(0,0,0,0.4)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px'
        }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setPersonaMode('child')} style={{ background: personaMode === 'child' ? '#6366f1' : 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: '0.2s' }}>Teddy Chat</button>
            <button onClick={() => setPersonaMode('adult')} style={{ background: personaMode === 'adult' ? '#10b981' : 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: '0.2s' }}>Adult Support</button>
            <button onClick={() => setPersonaMode('professional')} style={{ background: personaMode === 'professional' ? '#f59e0b' : 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: '0.2s' }}>Professional</button>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={() => setIsMuted(!isMuted)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16 }}>{isMuted ? '🔇' : '🔊'}</button>
            <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(parseFloat(e.target.value))} style={{ width: 80, cursor: 'pointer' }} />
          </div>
        </div>

        {/* Soft Selection Header */}
        <div style={{
          height: 60,
          background: 'rgba(255,255,255,0.03)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
          padding: '0 24px'
        }}>
          {[
            { id: 'match', label: '🧩 Memory Match' },
            { id: 'hop', label: '☁️ Cloud Hopper' },
            { id: 'star', label: '⭐ Star Collector' },
            { id: 'breathe', label: '🫧 Breathing Bubble' }
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setActiveGame(opt.id as 'match' | 'hop' | 'star' | 'breathe')}
              style={{
                background: activeGame === opt.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '20px',
                color: activeGame === opt.id ? '#fff' : 'rgba(255,255,255,0.5)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
                letterSpacing: '1px'
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Active Game Container */}
        <div style={{ flex: 1, position: 'relative' }}>
          {activeGame === 'match' && <MemoryMatch />}
          {activeGame === 'hop' && <CloudHopper />}
          {activeGame === 'star' && <StarCollector />}
          {activeGame === 'breathe' && <BreathingBubble />}
        </div>
      </div>

      {/* Persistent Static Chat Panel (Right) - Twilight Theme */}
      <div className="twilight-chat-panel" style={{
        width: 380,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-10px 0 40px rgba(0,0,0,0.6)',
        zIndex: 50,
        borderLeft: '1px solid rgba(255,255,255,0.05)'
      }}>
        
        {/* Secure Exit Banner */}
        <div 
          onMouseDown={startHold}
          onMouseUp={endHold}
          onMouseLeave={endHold}
          onTouchStart={startHold}
          onTouchEnd={endHold}
          style={{
            position: 'relative',
            height: 36,
            background: 'rgba(0,0,0,0.4)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          {/* Progress fill */}
          <div style={{
            position: 'absolute', top: 0, left: 0, bottom: 0,
            width: `${holdProgress}%`,
            background: 'rgba(239, 68, 68, 0.4)', // Soft red progress
            transition: 'width 0.05s linear'
          }} />
          <div style={{ position: 'relative', zIndex: 2, fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🔒</span> Personnel: Hold to Exit
          </div>
        </div>

        {/* Chat Header */}
        <div style={{
          padding: '20px 20px 16px',
          textAlign: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          position: 'relative'
        }}>
          <h2 style={{ 
            margin: 0, 
            color: '#c7d2fe', // Soft indigo pastel
            fontSize: 22, 
            fontWeight: 800,
            letterSpacing: '1px',
            textShadow: '0 2px 10px rgba(199, 210, 254, 0.2)'
          }}>
            {personaMode === 'adult' ? 'Adult Support 🌱' : personaMode === 'professional' ? 'Professional Decompression ☕' : 'Teddy Chat 🧸'}
          </h2>
          <select 
            className="if-input"
            value={selectedLang}
            onChange={(e) => setSelectedLang(e.target.value)}
            style={{
              position: 'absolute', right: 16, top: 20,
              fontSize: 11, padding: '4px 8px', background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 6
            }}
          >
            {AVAILABLE_LANGS.map(l => (
              <option key={l.code} value={l.code} style={{ background: '#1e1b4b', color: '#fff' }}>{l.label}</option>
            ))}
          </select>
        </div>

        {/* Chat Messages Area */}
        <div style={{
          flex: 1,
          padding: '20px 16px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`twilight-msg ${msg.sender}`}
              style={{
                alignSelf: msg.sender === 'child' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '14px 18px',
                borderRadius: msg.sender === 'child' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                fontSize: 16,
                fontWeight: 500,
                color: msg.sender === 'child' ? '#f8fafc' : '#e0e7ff',
                boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                lineHeight: 1.4,
                border: '1px solid rgba(255,255,255,0.05)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)'
              }}
            >
              {msg.text}
            </div>
          ))}
          {isSending && !streamingText && (
            <div className={`twilight-msg model`} style={{ alignSelf: 'flex-start', padding: '14px 18px', borderRadius: '20px 20px 20px 4px', background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255,255,255,0.05)', color: '#e0e7ff', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              {isModelLoading ? 'Waking up assistant...' : 'Thinking...'}
            </div>
          )}
          {streamingText && (
            <div className={`twilight-msg model`} style={{ alignSelf: 'flex-start', padding: '14px 18px', borderRadius: '20px 20px 20px 4px', background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255,255,255,0.05)', color: '#e0e7ff' }}>
              {streamingText}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Microphone / Input Area */}
        <div style={{
          padding: '24px',
          background: 'rgba(0,0,0,0.2)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <button 
            onClick={handleToggleMic}
            style={{
              width: 80, height: 80, borderRadius: '50%',
              background: isRecording ? 'rgba(239, 68, 68, 0.8)' : 'rgba(16, 185, 129, 0.4)', // Muted glass red/green
              border: '2px solid rgba(255,255,255,0.1)',
              boxShadow: isRecording 
                ? '0 0 0 12px rgba(239, 68, 68, 0.15), 0 8px 24px rgba(0,0,0,0.3)' 
                : '0 8px 24px rgba(0,0,0,0.2)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
              transform: isRecording ? 'scale(1.05)' : 'scale(1)',
              animation: isRecording ? 'pulse-twilight-mic 2s infinite' : 'none',
              backdropFilter: 'blur(4px)',
            }}
          >
            <span style={{ fontSize: 36, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>{isRecording ? '⏹' : '🎤'}</span>
          </button>
        </div>

      </div>

      <style>{`
        /* Twilight Panel Background Animation */
        .twilight-chat-panel {
          background: linear-gradient(135deg, #1e1b4b, #312e81, #1e1b4b);
          background-size: 200% 200%;
          animation: twilight-gradient-move 15s ease infinite;
        }

        @keyframes twilight-gradient-move {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        /* Frosted Glass Text Animation */
        .twilight-msg {
          animation: twilight-fade-in 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }

        .twilight-msg.model {
          background: rgba(255, 255, 255, 0.08); /* Frosted glass */
        }

        .twilight-msg.child {
          background: rgba(99, 102, 241, 0.25); /* Subtle indigo tint */
        }

        @keyframes twilight-fade-in {
          0% { opacity: 0; transform: translateY(15px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes pulse-twilight-mic {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4), 0 8px 24px rgba(0,0,0,0.3); }
          70% { box-shadow: 0 0 0 24px rgba(239, 68, 68, 0), 0 8px 24px rgba(0,0,0,0.3); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0), 0 8px 24px rgba(0,0,0,0.3); }
        }
      `}</style>
    </div>
  );
};
