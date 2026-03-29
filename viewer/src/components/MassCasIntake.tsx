import { useState, useRef, useEffect, useCallback } from 'react';
import * as patientStore from '../services/PatientStore';
import { useT } from '../services/i18n';
import type { WardConfig } from '../types';

// ── Mass Casualty Rapid Intake ──────────────────────────────────────
//  3-tap: Priority → Ward/Room → Save.  Name/details can be added later.

const PRIORITIES = [
    { key: 'T1', labelKey: 'mascas.immediate', color: '#e74c3c', descKey: 'mascas.life_threatening' },
    { key: 'T2', labelKey: 'mascas.delayed', color: '#f0a500', descKey: 'mascas.serious_stable' },
    { key: 'T3', labelKey: 'mascas.minimal', color: '#3fb950', descKey: 'mascas.walking_wounded' },
    { key: 'T4', labelKey: 'mascas.expectant', color: '#8b949e', descKey: 'mascas.unlikely_survive' },
] as const;

export default function MassCasIntake({ onExit }: { onExit: () => void }) {
    const { t } = useT();
    const [wards, setWards] = useState<WardConfig[]>([]);
    const [wardId, setWardId] = useState('ward-1');
    const [priority, setPriority] = useState<'T1' | 'T2' | 'T3' | 'T4'>('T1');
    const [name, setName] = useState('');
    const [note, setNote] = useState('');
    const [counter, setCounter] = useState(1);
    const [saved, setSaved] = useState<{ id: string; name: string; pri: string }[]>([]);
    const [saving, setSaving] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);

    // Load wards
    useEffect(() => {
        patientStore.listWards().then(setWards).catch(() => { });
    }, []);

    // Auto-focus name field
    useEffect(() => { nameRef.current?.focus(); }, [counter]);

    const pad = (n: number) => String(n).padStart(3, '0');

    const handleSave = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            const patientId = patientStore.generatePatientId();
            const displayName = name.trim() || `MASS-${pad(counter)}`;
            const now = new Date().toISOString();

            const record = {
                id: patientId,
                name: displayName,
                age: 0,
                ageUnit: 'years' as const,
                sex: 'U' as const,
                weight: 70,
                pregnant: false,
                allergies: [] as string[],
                admittedAt: now,
                injuryTime: now,
                mechanism: 'Mass Casualty Event',
                regions: [] as string[],
                wardId,
                roomNumber: '',
                status: 'active' as const,
                triage: { priority, priorityLabel: t(PRIORITIES.find(p => p.key === priority)?.labelKey || ''), hemoClass: '--', gcsCat: '--' },
                initialVitals: { hr: 0, sbp: 0, rr: 0, spo2: 0, gcs: 0, temp: 0, pain: 0 },
                plan: { march: [], drugs: [], rx: [], recovery: [], escalate: [] },
                events: note.trim() ? [{
                    id: `EVT-${Date.now()}`,
                    timestamp: now,
                    type: 'note' as const,
                    summary: note.trim(),
                }] : [],
                notes: note.trim(),
                attachmentNames: [] as string[],
                nextOfKin: '',
                spokenLanguage: 'Unknown',
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await patientStore.createPatient(record as any);
            setSaved(prev => [{ id: patientId, name: displayName, pri: priority }, ...prev]);
            setCounter(c => c + 1);
            setName('');
            setNote('');
            setPriority('T1');
        } catch (err) {
            console.error('[MassCas] Save failed:', err);
        } finally {
            setSaving(false);
        }
    }, [saving, name, counter, wardId, priority, note, t]);

    // Enter to save
    const handleKey = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    }, [handleSave]);

    return (
        <div style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 22, color: '#e74c3c' }}>{t('mascas.title')}</h2>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-dim)', fontSize: 13 }}>
                        {t('mascas.subtitle')}
                    </p>
                </div>
                <button
                    onClick={onExit}
                    style={{ padding: '6px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
                >
                    {t('mascas.full_intake')}
                </button>
            </div>

            {/* Priority Selection */}
            <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{t('mascas.priority')}</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 6 }}>
                    {PRIORITIES.map(p => (
                        <button
                            key={p.key}
                            onClick={() => setPriority(p.key)}
                            style={{
                                padding: '12px 8px',
                                background: priority === p.key ? p.color : 'var(--surface2)',
                                border: `2px solid ${priority === p.key ? p.color : 'var(--border)'}`,
                                borderRadius: 8,
                                color: priority === p.key ? '#fff' : 'var(--text)',
                                cursor: 'pointer',
                                transition: 'all 0.15s',
                                fontWeight: priority === p.key ? 700 : 400,
                                fontSize: 14,
                                textAlign: 'center',
                            }}
                        >
                            <div style={{ fontSize: 18, fontWeight: 700 }}>{p.key}</div>
                            <div style={{ fontSize: 11, opacity: 0.8 }}>{t(p.labelKey)}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Name + Ward */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                    <label style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{t('mascas.name')}</label>
                    <input
                        ref={nameRef}
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder={`MASS-${pad(counter)}`}
                        style={{ width: '100%', padding: '10px 12px', marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 15, fontFamily: 'var(--font-mono)' }}
                    />
                </div>
                <div>
                    <label style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{t('mascas.ward')}</label>
                    <select
                        value={wardId}
                        onChange={e => setWardId(e.target.value)}
                        style={{ width: '100%', padding: '10px 8px', marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 14 }}
                    >
                        {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                </div>
            </div>

            {/* Quick note */}
            <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{t('mascas.quick_note')}</label>
                <input
                    type="text"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder={t('mascas.note_placeholder')}
                    style={{ width: '100%', padding: '8px 12px', marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13 }}
                />
            </div>

            {/* Save */}
            <button
                onClick={handleSave}
                disabled={saving}
                style={{
                    width: '100%', padding: '14px 0', background: PRIORITIES.find(p => p.key === priority)?.color || '#58a6ff',
                    border: 'none', borderRadius: 8, color: '#fff', fontSize: 16, fontWeight: 700,
                    cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1, transition: 'opacity 0.2s',
                }}
            >
                {saving ? t('mascas.saving') : t('mascas.save_as', { name: name.trim() || `MASS-${pad(counter)}`, priority })}
            </button>

            {/* Recent saves */}
            {saved.length > 0 && (
                <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, marginBottom: 6 }}>
                        {t('mascas.logged')} ({saved.length})
                    </div>
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {saved.map((s, i) => (
                            <div key={i} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '6px 10px', background: i % 2 === 0 ? 'var(--surface)' : 'transparent',
                                borderRadius: 4, fontSize: 13,
                            }}>
                                <span>{s.name}</span>
                                <span style={{
                                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                                    color: '#fff',
                                    background: PRIORITIES.find(p => p.key === s.pri)?.color || '#58a6ff',
                                }}>{s.pri}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
