/**
 * OnboardingWizard — Unified first-run experience.
 *
 * Three steps in sequence:
 *   1. Legal   — MIT license + responsible use acknowledgment
 *   2. Permissions — mic, camera, audio, notifications (existing PermissionGate logic)
 *   3. Ready   — Model health check (polls /health until green)
 *
 * Persists completion via localStorage. Skips entirely on subsequent launches.
 * Reset via refresh.bat which wipes the Tauri WebView cache.
 */

import { useState, useEffect, useCallback } from 'react';

const EULA_KEY = 'halt-eula-accepted';
const PERMS_KEY = 'eve-permissions-granted';

const IS_INSECURE = window.location.protocol === 'http:' && window.location.hostname !== 'localhost';

type PermState = 'pending' | 'granted' | 'denied' | 'deferred';
interface PermStatus { audio: PermState; mic: PermState; camera: PermState; }

// ─── Styles ─────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(6, 8, 12, 0.96)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
};

const card: React.CSSProperties = {
  background: '#0d1117', borderRadius: 16, padding: '36px 40px',
  maxWidth: 520, width: '94%', border: '1px solid #21262d',
  boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
};

const stepDot = (active: boolean, done: boolean): React.CSSProperties => ({
  width: 10, height: 10, borderRadius: '50%',
  background: done ? '#3fb950' : active ? '#58a6ff' : '#30363d',
  transition: 'all 0.3s',
  boxShadow: active ? '0 0 8px rgba(88,166,255,0.5)' : 'none',
});

const btnPrimary: React.CSSProperties = {
  padding: '12px 24px', background: '#0d1f0d', border: '1px solid #3fb950',
  borderRadius: 8, color: '#3fb950', fontSize: 14, fontWeight: 600,
  cursor: 'pointer', transition: 'all 0.2s', flex: 2,
};

const btnSecondary: React.CSSProperties = {
  padding: '12px 24px', background: 'transparent', border: '1px solid #30363d',
  borderRadius: 8, color: '#6e7681', fontSize: 13, cursor: 'pointer',
  transition: 'all 0.2s', flex: 1,
};

// ─── Component ──────────────────────────────────────────────────────

export default function OnboardingWizard({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<'legal' | 'permissions' | 'ready' | 'done'>('done');

  // Check completion on mount
  useEffect(() => {
    const eulaOk = localStorage.getItem(EULA_KEY) === 'true';
    const permsOk = localStorage.getItem(PERMS_KEY) === 'true';
    if (!eulaOk) setStep('legal');
    else if (!permsOk) setStep('permissions');
    else setStep('done');
  }, []);

  if (step === 'done') return <>{children}</>;

  return (
    <>
      {children}
      <div style={overlay}>
        <div style={card}>
          {/* Step indicator */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
            <div style={stepDot(step === 'legal', step !== 'legal')} />
            <div style={stepDot(step === 'permissions', step === 'ready')} />
            <div style={stepDot(step === 'ready', false)} />
          </div>

          {step === 'legal' && (
            <LegalStep onAccept={() => {
              localStorage.setItem(EULA_KEY, 'true');
              if (localStorage.getItem(PERMS_KEY) === 'true') setStep('done');
              else setStep('permissions');
            }} />
          )}

          {step === 'permissions' && (
            <PermissionsStep onComplete={() => {
              localStorage.setItem(PERMS_KEY, 'true');
              setStep('done');
            }} />
          )}
        </div>
      </div>
    </>
  );
}


// ═══════════════════════════════════════════════════════════════════
// Step 1 — Legal
// ═══════════════════════════════════════════════════════════════════

function LegalStep({ onAccept }: { onAccept: () => void }) {
  const [scrolled, setScrolled] = useState(false);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      setScrolled(true);
    }
  }, []);

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 28, marginBottom: 4 }}>⚕</div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e6edf3', letterSpacing: '-0.02em' }}>
          License &amp; Responsible Use
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6e7681' }}>
          Please review before proceeding
        </p>
      </div>

      <div
        onScroll={handleScroll}
        style={{
          maxHeight: 320, overflowY: 'auto', padding: '16px 20px',
          background: '#161b22', borderRadius: 10, border: '1px solid #21262d',
          fontSize: 12, lineHeight: 1.7, color: '#8b949e',
          marginBottom: 20, scrollBehavior: 'smooth',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, color: '#e6edf3', marginBottom: 12 }}>
          HALT — Hermetic Anonymous Local Triage
        </div>

        <div style={{ fontWeight: 600, color: '#c9d1d9', marginBottom: 6, fontSize: 13 }}>
          Open Source License
        </div>
        <p style={{ margin: '0 0 14px' }}>
          Copyright © 2026 Hermetic Labs LLC. This software is released under the{' '}
          <strong style={{ color: '#58a6ff' }}>MIT License</strong>. You are free to use,
          copy, modify, merge, publish, distribute, sublicense, and/or sell copies of this
          software, subject to the following conditions: the above copyright notice and this
          permission notice shall be included in all copies or substantial portions of the
          Software.
        </p>

        <div style={{ fontWeight: 600, color: '#c9d1d9', marginBottom: 6, fontSize: 13 }}>
          Intended Use
        </div>
        <p style={{ margin: '0 0 14px' }}>
          HALT is designed exclusively for <strong style={{ color: '#c9d1d9' }}>humanitarian medical triage</strong> in
          disaster relief, conflict zones, and resource-limited settings. It is intended to assist
          trained medical personnel in patient intake, triage prioritization, and field communication.
        </p>

        <div style={{
          background: '#1c1206', border: '1px solid #f0a50033', borderRadius: 8,
          padding: '12px 14px', marginBottom: 14,
        }}>
          <div style={{ fontWeight: 600, color: '#f0a500', marginBottom: 4, fontSize: 12 }}>
            ⚠ Responsible Use Notice
          </div>
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6 }}>
            This software must not be used for military targeting, weapons guidance, surveillance
            of protected persons, or any application that violates the Geneva Conventions or
            International Humanitarian Law. HALT processes sensitive medical data — all data
            remains on-device and is encrypted at rest. Operators are responsible for ensuring
            compliance with applicable medical privacy regulations in their jurisdiction.
          </p>
        </div>

        <div style={{ fontWeight: 600, color: '#c9d1d9', marginBottom: 6, fontSize: 13 }}>
          Medical Disclaimer
        </div>
        <p style={{ margin: '0 0 14px' }}>
          HALT is a <strong style={{ color: '#c9d1d9' }}>decision-support tool</strong>, not a
          medical device. AI-generated suggestions (triage priority, differential diagnosis, drug
          interactions) are advisory only and must be validated by qualified medical personnel.
          The developers accept no liability for clinical decisions made using this software.
        </p>

        <div style={{ fontWeight: 600, color: '#c9d1d9', marginBottom: 6, fontSize: 13 }}>
          No Warranty
        </div>
        <p style={{ margin: 0 }}>
          THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
          INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
          PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
          HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY.
        </p>
      </div>

      {!scrolled && (
        <div style={{ textAlign: 'center', fontSize: 11, color: '#484f58', marginBottom: 12 }}>
          ↓ Scroll to review the full agreement
        </div>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={onAccept}
          disabled={!scrolled}
          style={{
            ...btnPrimary, width: '100%', flex: 'unset',
            opacity: scrolled ? 1 : 0.35,
            cursor: scrolled ? 'pointer' : 'not-allowed',
          }}
        >
          I Understand &amp; Accept
        </button>
      </div>
    </>
  );
}


// ═══════════════════════════════════════════════════════════════════
// Step 2 — Permissions
// ═══════════════════════════════════════════════════════════════════

function PermissionsStep({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<PermStatus>({
    audio: 'pending', mic: 'pending', camera: 'pending',
  });
  const [requesting, setRequesting] = useState(false);

  const requestAll = useCallback(async () => {
    setRequesting(true);
    const s: PermStatus = { audio: 'pending', mic: 'pending', camera: 'pending' };

    // Audio context unlock
    try {
      const ctx = new AudioContext();
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination); src.start();
      ctx.resume().catch(() => {});
      s.audio = 'granted';
    } catch { s.audio = 'denied'; }

    // Microphone
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
      ]);
      (stream as MediaStream).getTracks().forEach(t => t.stop());
      s.mic = 'granted';
    } catch { s.mic = IS_INSECURE ? 'deferred' : 'denied'; }

    // Camera
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ video: true }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
      ]);
      (stream as MediaStream).getTracks().forEach(t => t.stop());
      s.camera = 'granted';
    } catch { s.camera = IS_INSECURE ? 'deferred' : 'denied'; }


    try {
      if ('wakeLock' in navigator) {
        await (navigator as Navigator & { wakeLock: { request: (t: string) => Promise<unknown> } }).wakeLock.request('screen');
      }
    } catch { /* optional */ }

    setStatus(s);
    setRequesting(false);
    setTimeout(onComplete, 1200);
  }, [onComplete]);

  const icon = (s: PermState) => s === 'granted' ? '✓' : s === 'denied' ? '✕' : s === 'deferred' ? '⏳' : '—';
  const color = (s: PermState) => s === 'granted' ? '#3fb950' : s === 'denied' ? '#e74c3c' : s === 'deferred' ? '#f0a500' : '#484f58';

  const perms = [
    { key: 'audio' as const, label: '🔊 Audio Playback', desc: 'Alarms, TTS announcements, and alerts' },
    { key: 'mic' as const, label: '🎙 Microphone', desc: 'Voice dictation and translation' },
    { key: 'camera' as const, label: '📷 Camera', desc: 'Wound photography and video calls' },
  ];

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 28, marginBottom: 4 }}>🔐</div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e6edf3', letterSpacing: '-0.02em' }}>
          Device Permissions
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6e7681' }}>
          HALT needs access to these features for field operations
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {perms.map(p => (
          <div key={p.key} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            background: '#161b22', borderRadius: 10, border: '1px solid #21262d',
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
              color: color(status[p.key]), border: `2px solid ${color(status[p.key])}`,
              transition: 'all 0.3s',
            }}>
              {icon(status[p.key])}
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#c9d1d9' }}>{p.label}</div>
              <div style={{ fontSize: 11, color: '#6e7681' }}>{p.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={() => onComplete()} style={btnSecondary}>Skip</button>
        <button onClick={requestAll} disabled={requesting} style={{
          ...btnPrimary,
          opacity: requesting ? 0.5 : 1,
          cursor: requesting ? 'wait' : 'pointer',
        }}>
          {requesting ? 'Requesting…' : 'Grant All Permissions'}
        </button>
      </div>
    </>
  );
}
