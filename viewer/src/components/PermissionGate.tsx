/**
 * PermissionGate — Requests browser permissions upfront on first load.
 * Handles: audio playback, microphone, camera.
 * Shows a one-time modal if permissions haven't been granted.
 */

import { useState, useEffect, useCallback } from 'react';
import { useT } from '../services/i18n';

const STORAGE_KEY = 'eve-permissions-granted';
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

interface PermissionStatus {
    audio: 'pending' | 'granted' | 'denied';
    mic: 'pending' | 'granted' | 'denied';
    camera: 'pending' | 'granted' | 'denied';
    notifications: 'pending' | 'granted' | 'denied';
}

export default function PermissionGate({ children }: { children: React.ReactNode }) {
    const { t } = useT();
    const [show, setShow] = useState(false);
    const [status, setStatus] = useState<PermissionStatus>({ audio: 'pending', mic: 'pending', camera: 'pending', notifications: 'pending' });
    const [requesting, setRequesting] = useState(false);

    useEffect(() => {
        // Skip if already granted
        if (localStorage.getItem(STORAGE_KEY) === 'true') return;
        // Small delay to let the app render first
        const t = setTimeout(() => setShow(true), 800);
        return () => clearTimeout(t);
    }, []);

    const requestAll = useCallback(async () => {
        setRequesting(true);
        const newStatus: PermissionStatus = { audio: 'pending', mic: 'pending', camera: 'pending', notifications: 'pending' };

        // 1. Audio — play a silent buffer to unlock audio context
        try {
            const ctx = new AudioContext();
            const buffer = ctx.createBuffer(1, 1, 22050);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start();
            await ctx.resume();
            newStatus.audio = 'granted';
        } catch {
            newStatus.audio = 'denied';
        }

        // 2. Microphone
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop()); // release immediately
            newStatus.mic = 'granted';
        } catch {
            newStatus.mic = 'denied';
        }

        // 3. Camera
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(t => t.stop());
            newStatus.camera = 'granted';
        } catch {
            newStatus.camera = 'denied';
        }

        // 4. Notifications — skip on iOS Safari (not supported; use native Capacitor push instead)
        if (!IS_IOS) {
            try {
                if ('Notification' in window) {
                    const perm = await Notification.requestPermission();
                    newStatus.notifications = perm === 'granted' ? 'granted' : 'denied';
                } else {
                    newStatus.notifications = 'denied';
                }
            } catch {
                newStatus.notifications = 'denied';
            }
        } else {
            newStatus.notifications = 'granted'; // Native push handles this on iOS
        }

        // Update UI with all results at once
        setStatus(newStatus);

        // 5. Wake Lock — keep screen/connection alive during triage
        try {
            if ('wakeLock' in navigator) {
                await (navigator as Navigator & { wakeLock: { request: (type: string) => Promise<unknown> } }).wakeLock.request('screen');
            }
        } catch { /* optional — may not be supported */ }
        setRequesting(false);

        // Mark as complete regardless of individual results
        localStorage.setItem(STORAGE_KEY, 'true');

        // Auto-dismiss after a moment
        setTimeout(() => setShow(false), 1500);
    }, []);

    const skip = useCallback(() => {
        localStorage.setItem(STORAGE_KEY, 'true');
        setShow(false);
    }, []);

    if (!show) return <div>{children}</div>;

    const statusIcon = (s: 'pending' | 'granted' | 'denied') =>
        s === 'granted' ? '✓' : s === 'denied' ? 'x' : '--';
    const statusColor = (s: 'pending' | 'granted' | 'denied') =>
        s === 'granted' ? '#3fb950' : s === 'denied' ? '#e74c3c' : 'var(--text-muted)';

    return (
        <>
            {children}
            <div style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
            }}>
                <div style={{
                    background: '#1a1a2e', borderRadius: 16, padding: '32px 36px',
                    maxWidth: 400, width: '90%', textAlign: 'center',
                    border: '1px solid #333', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: 18, color: '#fff' }}>{t('perm.title')}</h3>
                    <p style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>
                        {t('perm.desc')}
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24, textAlign: 'left' }}>
                        {[
                            { label: t('perm.audio'), desc: t('perm.audio_desc') || 'Alarms & announcements', key: 'audio' as const },
                            { label: t('perm.mic'), desc: t('perm.mic_desc') || 'Voice calls & dictation', key: 'mic' as const },
                            { label: t('perm.camera'), desc: t('perm.camera_desc') || 'Video calls', key: 'camera' as const },
                            { label: t('perm.notifications') || '🔔 Notifications', desc: IS_IOS ? 'Handled by native app' : (t('perm.notifications_desc') || 'Emergency alerts when screen is off'), key: 'notifications' as const },
                        ].map(p => (
                            <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#0d0d1a', borderRadius: 8, border: '1px solid #222' }}>
                                <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: statusColor(status[p.key]), border: `2px solid ${statusColor(status[p.key])}` }}>
                                    {statusIcon(status[p.key])}
                                </span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>{p.label}</div>
                                    <div style={{ fontSize: 11, color: '#666' }}>{p.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={skip} style={{ flex: 1, padding: '10px 16px', background: 'transparent', border: '1px solid #444', borderRadius: 8, color: '#888', fontSize: 13, cursor: 'pointer' }}>
                            {t('perm.skip')}
                        </button>
                        <button onClick={requestAll} disabled={requesting} style={{ flex: 2, padding: '10px 16px', background: requesting ? '#222' : '#0d1f0d', border: `1px solid ${requesting ? '#444' : '#3fb950'}`, borderRadius: 8, color: requesting ? '#666' : '#3fb950', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                            {requesting ? t('perm.requesting') : t('perm.grant')}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
