import { useState, useEffect, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { PatientRecord, PatientSummary, PatientEvent, WardConfig } from '../types';
import * as store from '../services/PatientStore';
import { useT } from '../services/i18n';
import { normalizeToEnglish, precomputeAllLocales, flushPatientTranslations, hydratePatientTranslations, hasPatientTranslations, pt } from '../services/i18nDynamic';
import { rebuildPlanFromRecord } from '../services/planEngine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<string, string> = {
    T1: '#e74c3c', T2: '#f0a500', T3: '#3fb950', T4: '#8b949e', '--': '#58a6ff',
};
const STATUS_COLOR: Record<string, string> = {
    active: '#f0a500', stable: '#3fb950', critical: '#e74c3c',
    transferred: '#8b949e', discharged: '#58a6ff',
};
const pc = (p: string) => PRIORITY_COLOR[p] ?? '#58a6ff';

// ─── Log Form ────────────────────────────────────────────────────────────────

type LogType = 'vitals' | 'medication' | 'note';
const LOG_FIELD_KEYS: Record<LogType, { key: string; tKey: string }[]> = {
    vitals: [
        { key: 'HR', tKey: 'ward.log_field_hr' }, { key: 'SBP', tKey: 'ward.log_field_sbp' },
        { key: 'RR', tKey: 'ward.log_field_rr' }, { key: 'SpO2', tKey: 'ward.log_field_spo2' },
        { key: 'GCS', tKey: 'ward.log_field_gcs' }, { key: 'Temp(C)', tKey: 'ward.log_field_temp' },
        { key: 'Pain', tKey: 'ward.log_field_pain' },
    ],
    medication: [
        { key: 'Drug', tKey: 'ward.log_field_drug' }, { key: 'Dose', tKey: 'ward.log_field_dose' },
        { key: 'Route', tKey: 'ward.log_field_route' }, { key: 'Given by', tKey: 'ward.log_field_given_by' },
    ],
    note: [{ key: 'Note', tKey: 'ward.log_field_note' }],
};

function LogForm({ type, onSubmit, onCancel }: {
    type: LogType;
    onSubmit: (e: Omit<PatientEvent, 'id' | 'timestamp'>) => void;
    onCancel: () => void;
}) {
    const { t } = useT();
    const [vals, setVals] = useState<Record<string, string>>({});
    const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setVals(p => ({ ...p, [k]: e.target.value }));

    const submit = () => {
        const summary =
            type === 'vitals' ? Object.entries(vals).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' | ') :
                type === 'medication' ? `${vals.Drug || 'Drug'} ${vals.Dose || ''} ${vals.Route || ''}`.trim() :
                    vals.Note || '';
        if (!summary) return;
        onSubmit({ type, summary, data: vals });
    };

    return (
        <div className="ward-log-form">
            <div className="if-section-label" style={{ marginBottom: 10 }}>{t(`ward.log_type_${type}`)}</div>
            {LOG_FIELD_KEYS[type].map(f => (
                <div key={f.key} className="if-field" style={{ marginBottom: 8 }}>
                    <label className="if-label">{t(f.tKey)}</label>
                    {f.key === 'Note'
                        ? <textarea className="if-textarea" rows={3} value={vals[f.key] ?? ''}
                            onChange={set(f.key)} />
                        : <input className="if-input" style={{ width: '100%' }} value={vals[f.key] ?? ''}
                            onChange={set(f.key)} />}
                </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="intake-next-btn" style={{ flex: 1 }} onClick={submit}>{t("ward.save")}</button>
                <button className="intake-back-btn" onClick={onCancel}>{t("ward.cancel")}</button>
            </div>
        </div>
    );
}



// ─── Patient Panel ────────────────────────────────────────────────────────────

export function PatientPanel({ summary, wards, activeWardId, onClose, onUpdated }: {
    summary: PatientSummary;
    wards: WardConfig[];
    activeWardId: string;
    onClose: () => void;
    onUpdated: (record: PatientRecord) => void;
}) {
    const { t, lang } = useT();
    const [record, setRecord] = useState<PatientRecord | null>(null);
    const [logForm, setLogForm] = useState<LogType | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        store.getPatient(summary.id).then(setRecord).catch(() => { });
    }, [summary.id]);

    // Hydrate per-patient translation cache from archived record data
    // If no archived i18n AND lang isn't English, re-translate via NLLB
    useEffect(() => {
        if (!record) return;
        if (record.i18n && !hasPatientTranslations(record.id)) {
            hydratePatientTranslations(record.id, record.i18n);
        }
        // If no cached translations yet and we're not in English, precompute
        if (lang !== 'en' && !hasPatientTranslations(record.id)) {
            const texts: string[] = [];
            if (record.name) texts.push(record.name);
            if (record.notes) texts.push(record.notes);
            if (record.wardId) {
                const w = wards.find(x => x.id === record.wardId);
                if (w?.name) texts.push(w.name);
            }
            for (const evt of record.events || []) {
                if (evt.summary) texts.push(evt.summary);
            }
            for (const rx of record.plan?.rx || []) {
                if (rx) texts.push(rx);
            }
            for (const rec of record.plan?.recovery || []) {
                if (rec) texts.push(rec);
            }
            if (texts.length > 0) {
                precomputeAllLocales(texts, record.id).catch(() => { /* NLLB offline */ });
            }
        }
    }, [record, lang, wards]);

    // Export with spinner
    const [exporting, setExporting] = useState(false);
    const handleExport = async () => {
        setExporting(true);
        try {
            const res = await fetch(`/api/patients/${summary.id}/export?lang=${lang}`);
            const html = await res.text();
            const blob = new Blob([html], { type: 'text/html' });
            window.open(URL.createObjectURL(blob), '_blank');
        } catch { /* offline */ }
        setExporting(false);
    };



    const handleAddEvent = async (evt: Omit<PatientEvent, 'id' | 'timestamp'>) => {
        if (!record) return;
        setSaving(true);
        try {
            // Normalize event summary to English if non-English
            let finalSummary = evt.summary;
            if (lang !== 'en' && evt.summary.trim()) {
                const { english } = await normalizeToEnglish(evt.summary, lang);
                finalSummary = english;
                // Precompute in background
                precomputeAllLocales([english], record.id).catch(() => { /* non-fatal */ });
            }
            const full: PatientEvent = {
                id: store.generateEventId(),
                timestamp: new Date().toISOString(),
                ...evt,
                summary: finalSummary,
            };
            const updated = await store.addEvent(record.id, full);
            setRecord(updated);
            onUpdated(updated);

            // Auto-schedule next vitals check based on triage priority
            if (evt.type === 'vitals' && record) {
                const priorityIntervals: Record<string, number> = {
                    'T1': 5, 'T2': 10, 'T3': 15, 'T4': 30
                };
                const prio = record.triage?.priority || 'T3';
                const intervalMin = priorityIntervals[prio] || 15;
                const nextCheck = new Date();
                nextCheck.setMinutes(nextCheck.getMinutes() + intervalMin);
                try {
                    fetch('/api/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            title: 'Vitals check: ' + (record.name || record.id),
                            description: intervalMin + 'min vitals recheck - Priority ' + prio,
                            priority: prio === 'T1' ? 'critical' : prio === 'T2' ? 'urgent' : 'normal',
                            category: 'vitals',
                            due_hint: nextCheck.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            created_by: localStorage.getItem('eve-mesh-name') || 'System',
                            escalate_at: nextCheck.toISOString(),
                        }),
                    }).catch(() => { });
                } catch { /* offline */ }
            }

            setLogForm(null);
        } catch (e) {
            alert('Failed to save event: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setSaving(false);
        }
    };

    const handleStatus = async (status: string) => {
        if (!record) return;
        await store.updateStatus(record.id, status);
        const updated = { ...record, status: status as PatientRecord['status'] };
        setRecord(updated);
        onUpdated(updated);
    };

    const handleMovePatient = async (newWardId: string, newRoom: string) => {
        if (!record) return;
        setSaving(true);
        try {
            const updated = await store.updatePatient(record.id, {
                ...record,
                wardId: newWardId,
                roomNumber: newRoom
            });
            setRecord(updated);
            onUpdated(updated);
        } catch (e) {
            alert('Failed to move patient: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setSaving(false);
        }
    };

    const prio = summary.priority;
    const color = pc(prio);

    // RX Checklist State
    const [checkedRx, setCheckedRx] = useState<Set<number>>(new Set());
    const [nextRoundTime, setNextRoundTime] = useState<Date | null>(null);
    const [timeRemaining, setTimeRemaining] = useState<string>('');

    // Panel UI State
    const [activeTab, setActiveTab] = useState<'overview' | 'vitals' | 'medication' | 'treatment' | 'events'>('overview');
    const [showWardChange, setShowWardChange] = useState(false);
    const [showDischarge, setShowDischarge] = useState(false);
    const [dischargeNotes, setDischargeNotes] = useState('');

    // Tourniquet Timer State
    const [tqTimers, setTqTimers] = useState<{ site: string; appliedAt: number }[]>([]);
    const [tqCountdowns, setTqCountdowns] = useState<string[]>([]);
    const [tqAddSite, setTqAddSite] = useState('');

    // Timer Tick
    useEffect(() => {
        if (!nextRoundTime) {
            setTimeRemaining('');
            return;
        }
        const interval = setInterval(() => {
            const now = new Date();
            const diff = nextRoundTime.getTime() - now.getTime();
            if (diff <= 0) {
                setTimeRemaining(t('ward.due_now'));
                clearInterval(interval);
            } else {
                const mins = Math.floor(diff / 60000);
                const secs = Math.floor((diff % 60000) / 1000);
                setTimeRemaining(`${mins}:${secs.toString().padStart(2, '0')}`);
            }
        }, 1000);
        return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nextRoundTime]);

    // Tourniquet Timer Tick (2hr = 7200000ms)
    useEffect(() => {
        if (tqTimers.length === 0) { setTqCountdowns([]); return; }
        const tick = () => {
            const now = Date.now();
            setTqCountdowns(tqTimers.map(t => {
                const elapsed = now - t.appliedAt;
                const remaining = 7200000 - elapsed;
                if (remaining <= 0) return 'OVERDUE';
                const m = Math.floor(remaining / 60000);
                const s = Math.floor((remaining % 60000) / 1000);
                return `${m}:${String(s).padStart(2, '0')}`;
            }));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [tqTimers]);

    const handleApplyTQ = () => {
        const site = tqAddSite.trim() || 'Unspecified';
        setTqTimers(prev => [...prev, { site, appliedAt: Date.now() }]);
        setTqAddSite('');
        if (record) {
            handleAddEvent({ type: 'procedure', summary: `TQ Applied - ${site}`, data: { site, appliedAt: new Date().toISOString() } });
        }
    };

    const handleReleaseTQ = (index: number) => {
        const t = tqTimers[index];
        if (record && t) {
            const elapsed = Math.round((Date.now() - t.appliedAt) / 60000);
            handleAddEvent({ type: 'procedure', summary: `TQ Released - ${t.site} (${elapsed} min)`, data: { site: t.site, releasedAt: new Date().toISOString(), durationMin: elapsed } });
        }
        setTqTimers(prev => prev.filter((_, i) => i !== index));
    };

    const handleCheckRx = (index: number) => {
        setCheckedRx(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    const handleCompleteRxRound = () => {
        if (!record) return;
        // Log as event
        const medsGiven = Array.from(checkedRx).map(i => record.plan.rx[i]).join(' | ');
        handleAddEvent({
            type: 'medication',
            summary: `Administered scheduled meds: ${medsGiven}`
        });

        setCheckedRx(new Set());
        // Next round in 4 hours
        const next = new Date();
        next.setHours(next.getHours() + 4);
        setNextRoundTime(next);

        // Auto-create next-dose task in global task board
        try {
            fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: `Next dose: ${record.name || record.id}`,
                    description: `Administer scheduled meds: ${medsGiven}`,
                    priority: 'normal',
                    category: 'medication',
                    due_hint: next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    created_by: localStorage.getItem('eve-mesh-name') || 'System',
                    escalate_at: next.toISOString(),
                }),
            }).catch(() => { });
        } catch { /* offline — sync queue will handle it */ }
    };

    // Prepare Vitals Data for Graph
    const vitalsData = useMemo(() => {
        if (!record) return [];
        const data = [];

        // Add initial vitals
        if (record.initialVitals) {
            data.push({
                time: new Date(record.admittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                hr: record.initialVitals.hr || null,
                sbp: record.initialVitals.sbp || null
            });
        }

        // Add logged vitals
        const vitalEvents = record.events.filter(e => e.type === 'vitals').sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        for (const evt of vitalEvents) {
            // Very naive parser for graphing - assumes the summary contains "HR 90, SBP 120" etc.
            const hrMatch = evt.summary.match(/HR[\s:]*(\d+)/i);
            const sbpMatch = evt.summary.match(/SBP[\s:]*(\d+)/i);
            if (hrMatch || sbpMatch) {
                data.push({
                    time: new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    hr: hrMatch ? parseInt(hrMatch[1]) : null,
                    sbp: sbpMatch ? parseInt(sbpMatch[1]) : null
                });
            }
        }
        return data;
    }, [record]);

    return (
        <div className="ward-panel" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 800, background: 'var(--bg)', boxShadow: '-4px 0 24px rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                            <div style={{ width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--surface2)', border: '2px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {record?.attachmentNames?.some((n: string) => /^photo\./i.test(n))
                                    ? <img src={`/api/patients/${summary.id}/attachments/${record!.attachmentNames.find((n: string) => /^photo\./i.test(n))}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    : record?.attachmentNames?.some((n: string) => /\.(jpg|jpeg|png|webp|gif)$/i.test(n))
                                        ? <img src={`/api/patients/${summary.id}/attachments/${record!.attachmentNames.find((n: string) => /\.(jpg|jpeg|png|webp|gif)$/i.test(n))}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <span style={{ fontSize: 20, color: 'var(--text-faint)' }}>👤</span>
                                }
                            </div>
                            <h2 style={{ margin: 0, fontSize: 20, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pt(summary.id, lang, summary.name || '') || t('ward.unknown_patient')}</h2>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 12, padding: '3px 6px', background: 'var(--surface2)', borderRadius: 4, flexShrink: 0 }}>
                                {summary.id}
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: 12, color: 'var(--text-dim)', fontSize: 13, flexWrap: 'wrap' }}>
                            <span>{t('ward.ward_label')}: {pt(summary.id, lang, wards.find(w => w.id === (record?.wardId || summary.wardId || activeWardId))?.name || '') || t('ward.unassigned')}</span>
                            <span>{t('ward.room_label')}: {record?.roomNumber || summary.roomNumber || t('ward.none')}</span>
                            <button
                                onClick={() => setShowWardChange(!showWardChange)}
                                style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}
                            >
                                {showWardChange ? t('ward.cancel') : t('ward.change_ward')}
                            </button>
                        </div>
                        {showWardChange && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                                <select
                                    className="if-input"
                                    style={{ padding: '2px 4px', fontSize: 12, width: 110, background: 'var(--surface)', border: '1px solid var(--border)' }}
                                    value={record?.wardId || summary.wardId || activeWardId}
                                    onChange={(e) => { handleMovePatient(e.target.value, ''); setShowWardChange(false); }}
                                    disabled={!record}
                                >
                                    {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                                <select
                                    className="if-input"
                                    style={{ padding: '2px 4px', fontSize: 12, width: 70, background: 'var(--surface)', border: '1px solid var(--border)' }}
                                    value={record?.roomNumber || summary.roomNumber || ''}
                                    onChange={(e) => { handleMovePatient(record?.wardId || summary.wardId || activeWardId, e.target.value); setShowWardChange(false); }}
                                    disabled={!record}
                                >
                                    <option value="">{t("ward.unassigned")}</option>
                                    {wards.find(w => w.id === (record?.wardId || summary.wardId || activeWardId))?.rooms.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexShrink: 0 }}>
                        <button onClick={handleExport} disabled={exporting} style={{ fontSize: 12, padding: '4px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: exporting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} title="Print-ready patient export">
                            {exporting ? <><div style={{ width: 12, height: 12, border: '2px solid #50C87844', borderTop: '2px solid #50C878', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />{t('ward.translating')}</> : <>📄 {t('ward.export')}</>}
                        </button>
                        <button onClick={onClose} style={{ fontSize: 22, padding: '2px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1, fontWeight: 700 }} title="Back">←</button>
                    </div>
                </div>
            </div>

            {!record ? (
                <div className="ward-panel-body"><div className="loading">{t('app.loading')}</div></div>
            ) : (
                <div className="ward-panel-body" style={{ background: 'var(--bg)' }}>
                    {/* Priority + status */}
                    <div className="ward-info-row">
                        <div className="ward-priority-badge" style={{ color, borderColor: color + '55', background: color + '15' }}>
                            {prio} — {t(`ward.priority_${prio.toLowerCase().replace('--','none')}`, record.triage?.priorityLabel || '')}
                        </div>
                        <div className="ward-status-pill" style={{ background: STATUS_COLOR[record.status] + '22', color: STATUS_COLOR[record.status], border: `1px solid ${STATUS_COLOR[record.status]}55` }}>
                            {t(`ward.status_${record.status}`)}
                        </div>
                    </div>

                    {/* Actions (Always Visible at Top) */}
                    <div className="ward-section-label" style={{ marginTop: 16 }}>{t("ward.patient_status")}</div>
                    <div className="ward-actions">
                        <button className={`if-toggle ${logForm === 'note' ? 'active' : ''}`}
                            onClick={() => setLogForm(logForm === 'note' ? null : 'note')}>
                            {t('ward.add_note')}
                        </button>
                        <select className="if-input ward-status-select" value={record.status}
                            onChange={e => handleStatus(e.target.value)}>
                            {['active', 'stable', 'critical', 'transferred', 'discharged'].map(s => (
                                <option key={s} value={s}>{t(`ward.status_${s}`)}</option>
                            ))}
                        </select>
                        {record.status !== 'discharged' && (
                            <button
                                className="if-toggle"
                                style={{ background: '#1a3a1a', color: '#3fb950', border: '1px solid #3fb95055' }}
                                onClick={() => setShowDischarge(!showDischarge)}
                            >
                                {t('ward.discharge_patient')}
                            </button>
                        )}
                    </div>

                    {showDischarge && (
                        <div style={{ marginTop: 12, padding: 16, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>{t("ward.discharge_notes")}</div>
                            <textarea
                                className="if-textarea"
                                rows={4}
                                placeholder={t('ward.discharge_placeholder')}
                                value={dischargeNotes}
                                onChange={e => setDischargeNotes(e.target.value)}
                                style={{ width: '100%', marginBottom: 12 }}
                            />
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                <button className="if-toggle" onClick={() => { setShowDischarge(false); setDischargeNotes(''); }}>{t("ward.cancel")}</button>
                                <button
                                    className="intake-next-btn"
                                    style={{ background: '#1a4a1a', color: '#3fb950' }}
                                    onClick={async () => {
                                        if (!record) return;
                                        setSaving(true);
                                        try {
                                            // Normalize discharge notes to English
                                            let finalDischargeNotes = dischargeNotes;
                                            if (lang !== 'en' && dischargeNotes.trim()) {
                                                const { english } = await normalizeToEnglish(dischargeNotes, lang);
                                                finalDischargeNotes = english;
                                            }
                                            // Log discharge event with notes
                                            await handleAddEvent({
                                                type: 'status_change',
                                                summary: `Patient discharged.${finalDischargeNotes ? ' Notes: ' + finalDischargeNotes : ''}`
                                            });
                                            // Flush per-patient translations and archive
                                            const archivedI18n = flushPatientTranslations(record.id);
                                            // Update status, clear ward/room, archive translations
                                            const updated = await store.updatePatient(record.id, {
                                                ...record,
                                                status: 'discharged',
                                                wardId: '',
                                                roomNumber: '',
                                                ...(archivedI18n ? { i18n: archivedI18n } : {}),
                                            });
                                            setRecord(updated);
                                            onUpdated(updated);
                                            setShowDischarge(false);
                                            setDischargeNotes('');
                                            onClose();
                                        } catch (e) {
                                            alert('Discharge failed: ' + (e instanceof Error ? e.message : String(e)));
                                        } finally {
                                            setSaving(false);
                                        }
                                    }}
                                    disabled={saving}
                                >
                                    {saving ? t('ward.processing') : t('ward.confirm_discharge')}
                                </button>
                            </div>
                        </div>
                    )}

                    {saving && <div className="if-hint" style={{ marginTop: 8 }}>{t('ward.saving')}</div>}
                    {logForm === 'note' && <div style={{ marginTop: 8 }}><LogForm type="note" onSubmit={handleAddEvent} onCancel={() => setLogForm(null)} /></div>}


                    {/* Local Tab Navigation */}
                    <div className="tab-bar" style={{ margin: '12px 0 8px 0', paddingBottom: 8, borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} style={{ padding: '4px 6px', fontSize: 12 }} onClick={() => setActiveTab('overview')}>{t("ward.overview")}</button>
                        <button className={`tab-btn ${activeTab === 'vitals' ? 'active' : ''}`} style={{ padding: '4px 6px', fontSize: 12 }} onClick={() => setActiveTab('vitals')}>{t("ward.vitals")}</button>
                        <button className={`tab-btn ${activeTab === 'medication' ? 'active' : ''}`} style={{ padding: '4px 6px', fontSize: 12 }} onClick={() => setActiveTab('medication')}>{t("ward.medication")}</button>
                        <button className={`tab-btn ${activeTab === 'treatment' ? 'active' : ''}`} style={{ padding: '4px 6px', fontSize: 12 }} onClick={() => setActiveTab('treatment')}>{t("ward.treatment_plan")}</button>
                        <button className={`tab-btn ${activeTab === 'events' ? 'active' : ''}`} style={{ padding: '4px 6px', fontSize: 12 }} onClick={() => setActiveTab('events')}>{t('ward.events_tab')} ({record.events?.length ?? 0})</button>
                    </div>



                    {/* ─── Overview Tab ─── */}
                    {activeTab === 'overview' && (
                        <>
                            {/* Tourniquet Timers */}
                            <div style={{ marginBottom: 16 }}>
                                <h3 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    {t('ward.tq_timers')}
                                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>{t('ward.tq_limit')}</span>
                                </h3>
                                {tqTimers.map((tq, i) => {
                                    const cd = tqCountdowns[i] || '';
                                    const overdue = cd === 'OVERDUE';
                                    const remaining = 7200000 - (Date.now() - tq.appliedAt);
                                    const warn = remaining > 0 && remaining < 900000;
                                    return (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', marginBottom: 6, borderRadius: 6, background: overdue ? 'rgba(231,76,60,0.2)' : warn ? 'rgba(240,165,0,0.15)' : 'var(--surface2)', border: `1px solid ${overdue ? '#e74c3c' : warn ? '#f0a500' : 'var(--border)'}` }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 14 }}>{tq.site}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('ward.tq_applied')}: {new Date(tq.appliedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: overdue ? '#e74c3c' : warn ? '#f0a500' : '#3fb950' }}>{overdue ? t('ward.overdue') : cd}</span>
                                                <button onClick={() => handleReleaseTQ(i)} style={{ padding: '4px 10px', background: '#58a6ff', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{t("ward.release")}</button>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                    <input type="text" value={tqAddSite} onChange={e => setTqAddSite(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleApplyTQ(); }} placeholder={t('ward.tq_site_placeholder')} style={{ flex: 1, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 13 }} />
                                    <button onClick={handleApplyTQ} style={{ padding: '6px 12px', background: '#e74c3c', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{t("ward.apply_tq")}</button>
                                </div>
                            </div>

                            {/* Demographics */}
                            <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{t("ward.patient_details")}</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16, fontSize: 14, marginBottom: 16 }}>
                                <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t("ward.age")}</div><div>{record.age} {record.ageUnit === 'months' ? t('ward.unit_months') : t('ward.unit_years')}</div></div>
                                <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t("ward.sex")}</div><div>{record.sex}</div></div>
                                <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t("ward.weight")}</div><div>{record.weight} {t('ward.unit_kg')}</div></div>
                                <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t("ward.admitted")}</div><div>{new Date(record.admittedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</div></div>
                                <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t("ward.mechanism")}</div><div>{record.mechanism || '—'}</div></div>
                                <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t("ward.injury_time")}</div><div>{record.injuryTime || '—'}</div></div>
                                <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t("ward.language")}</div><div>{record.spokenLanguage || '—'}</div></div>
                                <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t("ward.next_of_kin")}</div><div>{record.nextOfKin || '—'}</div></div>
                            </div>
                            {record.pregnant && <div className="ward-info-chip warning" style={{ marginBottom: 12 }}>{t("ward.pregnant")}</div>}
                            {record.allergies.length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                    <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>{t("ward.allergies")}</div>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        {record.allergies.map(a => <span key={a} className="ward-info-chip danger">{a}</span>)}
                                    </div>
                                </div>
                            )}

                            {/* Recovery notes */}
                            {(() => {
                                const lp = rebuildPlanFromRecord(record, t);
                                return lp.recovery?.length > 0 ? (
                                    <div style={{ marginTop: 16 }}>
                                        <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{t("ward.recovery_notes")}</h3>
                                        {lp.recovery.map((r, i) => (
                                            <div key={i} className="if-plan-line">{r}</div>
                                        ))}
                                    </div>
                                ) : null;
                            })()}

                            {/* Notes */}
                            {record.notes && (
                                <div style={{ marginTop: 16 }}>
                                    <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{t("ward.notes")}</h3>
                                    <div className="ward-notes">{pt(record.id, lang, record.notes || '')}</div>
                                </div>
                            )}

                            {/* Attachments */}
                            {record.attachmentNames?.length > 0 && (
                                <div style={{ marginTop: 16 }}>
                                    <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{t("ward.attachments")}</h3>
                                    <div className="ward-attachments">
                                        {record.attachmentNames.map(name => {
                                            const url = store.attachmentUrl(record.id, name);
                                            const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
                                            return isImg
                                                ? <a key={name} href={url} target="_blank" rel="noreferrer">
                                                    <img src={url} alt={name} className="ward-attach-thumb" />
                                                </a>
                                                : <a key={name} href={url} target="_blank" rel="noreferrer" className="ward-attach-file">{name}</a>;
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* ─── Treatment Plan Tab ─── */}
                    {activeTab === 'treatment' && (
                        <>
                            <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{t("ward.treatment_plan")}</h3>
                            {(() => {
                                const livePlan = rebuildPlanFromRecord(record, t);
                                return (
                                    <>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
                                        <div>
                                            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>{t("ward.march_protocol")}</div>
                                            {livePlan.march?.length ? (
                                                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                    {livePlan.march.map((m, i) => (
                                                        <li key={i}><strong style={{ color: 'var(--text)' }}>{m.phase.toUpperCase()} - {m.label}:</strong> {m.actions.join(', ')}</li>
                                                    ))}
                                                </ul>
                                            ) : <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>{t("ward.none")}</span>}
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>{t('ward.medications_rx')}</div>
                                            {livePlan.rx?.length ? (
                                                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                    {livePlan.rx.map((rx, i) => <li key={i}>{rx}</li>)}
                                                </ul>
                                            ) : <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>{t("ward.none")}</span>}
                                        </div>
                                    </div>
                                    {livePlan.recovery?.length > 0 && (
                                        <div style={{ marginTop: 24 }}>
                                            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>{t("ward.recovery_notes")}</div>
                                            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {livePlan.recovery.map((r, i) => <li key={i}>{r}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                    </>
                                );
                            })()}
                        </>
                    )}

                    {/* ─── Vitals Tab ─── */}
                    {activeTab === 'vitals' && (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                                <button className={`if-toggle ${logForm === 'vitals' ? 'active' : ''}`}
                                    onClick={() => setLogForm(logForm === 'vitals' ? null : 'vitals')}>
                                    {t('ward.log_vitals')}
                                </button>
                            </div>
                            {logForm === 'vitals' && <div style={{ marginBottom: 16 }}><LogForm type="vitals" onSubmit={handleAddEvent} onCancel={() => setLogForm(null)} /></div>}

                            {record.initialVitals && (
                                <>
                                    <div className="ward-section-label">{t("ward.initial_vitals")}</div>
                                    <div className="ward-vitals-row">
                                        {Object.entries(record.initialVitals).filter(([, v]) => v > 0).map(([k, v]) => {
                                            const vitalLabelKey = `ward.vital_${k}`;
                                            return (
                                                <div key={k} className="ward-vital-chip">
                                                    <div className="ward-vital-label">{t(vitalLabelKey, k.toUpperCase())}</div>
                                                    <div className="ward-vital-val">{v}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}

                            {/* Vitals Graph */}
                            {vitalsData.length > 0 && (
                                <div style={{ marginTop: 16, marginBottom: 16, height: 400, background: 'var(--surface2)', borderRadius: 8, padding: '16px 16px 0 0' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={vitalsData} style={{ cursor: 'default' }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                            <XAxis dataKey="time" stroke="#888" fontSize={11} />
                                            <YAxis stroke="#888" fontSize={11} domain={['auto', 'auto']} />
                                            <Tooltip contentStyle={{ background: '#111', border: '1px solid #333' }} />
                                            <Legend wrapperStyle={{ fontSize: 11 }} />
                                            <Line type="monotone" dataKey="hr" stroke="#e74c3c" strokeWidth={2} name={t('ward.chart_heart_rate')} dot={{ r: 4 }} connectNulls />
                                            <Line type="monotone" dataKey="sbp" stroke="#3498db" strokeWidth={2} name={t('ward.chart_systolic_bp')} dot={{ r: 4 }} connectNulls />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </>
                    )}

                    {/* ─── Medication Tab ─── */}
                    {activeTab === 'medication' && (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                                <button className={`if-toggle ${logForm === 'medication' ? 'active' : ''}`}
                                    onClick={() => setLogForm(logForm === 'medication' ? null : 'medication')}>
                                    {t('ward.log_medication')}
                                </button>
                            </div>
                            {logForm === 'medication' && <div style={{ marginBottom: 16 }}><LogForm type="medication" onSubmit={handleAddEvent} onCancel={() => setLogForm(null)} /></div>}

                            {(() => {
                                const lp = rebuildPlanFromRecord(record, t);
                                return lp.rx?.length > 0 ? (
                                <div style={{ marginTop: 8 }}>
                                    <div className="ward-section-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>{t("ward.rx_regimen")}</span>
                                        {timeRemaining && <span style={{ color: timeRemaining === t('ward.due_now') ? '#e74c3c' : '#f0a500', fontSize: 12 }}>{t('ward.next_due')}: {timeRemaining}</span>}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {lp.rx.map((r, i) => (
                                            <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={checkedRx.has(i)}
                                                    onChange={() => handleCheckRx(i)}
                                                    style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--accent)' }}
                                                />
                                                <span style={{ fontSize: 13, lineHeight: 1.4, color: checkedRx.has(i) ? 'var(--text-faint)' : 'var(--text)', textDecoration: checkedRx.has(i) ? 'line-through' : 'none' }}>
                                                    {r}
                                                </span>
                                            </label>
                                        ))}
                                        {checkedRx.size === lp.rx.length && (
                                            <button
                                                style={{ marginTop: 8, padding: '6px 12px', background: '#3fb950', color: '#000', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }}
                                                onClick={handleCompleteRxRound}
                                            >
                                                {t('ward.log_admin_restart')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="if-hint" style={{ marginTop: 16 }}>{t('ward.no_rx_plan')}</div>
                            );
                            })()}
                        </>
                    )}

                    {/* ─── Events Tab ─── */}
                    {activeTab === 'events' && (
                        <>
                            <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{t("ward.event_history")}</h3>
                            <div style={{ overflowY: 'auto' }}>
                                {!record.events?.length
                                    ? <div className="if-hint">{t("ward.no_events")}</div>
                                    : record.events.slice().reverse().map(evt => (
                                        <div key={evt.id} className="ward-event">
                                            <div className="ward-event-time">{new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                            <div className={`ward-event-type ward-event-type-${evt.type.toLowerCase()}`}>{t('event.' + evt.type)}</div>
                                            <div className="ward-event-summary">{pt(record.id, lang, evt.summary)}</div>
                                        </div>
                                    ))}
                            </div>
                        </>
                    )}

                    {/* Actions Spacer Removed */}
                </div>
            )}
        </div>
    );
}

// ─── Ward Settings ─────────────────────────────────────────────────────────────

function WardSettings({ config, isNew, onClose, onSave, onDelete }: {
    config: WardConfig;
    isNew: boolean;
    onClose: () => void;
    onSave: (c: WardConfig) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}) {
    const { t, lang } = useT();
    const [id] = useState(config.id);
    const [name, setName] = useState(config.name);
    const [cols, setCols] = useState(config.columns);
    const [rooms, setRooms] = useState(config.rooms.join(', '));
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            // Normalize ward name to English if entered in another language
            let finalName = name;
            if (lang !== 'en' && name.trim()) {
                const { english } = await normalizeToEnglish(name, lang);
                finalName = english;
            }
            await onSave({
                id,
                name: finalName,
                columns: cols,
                rooms: rooms.split(',').map(s => s.trim()).filter(Boolean)
            });
            onClose();
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) {
            setConfirmDelete(true);
            return;
        }
        setDeleting(true);
        try {
            await onDelete(id);
            onClose();
        } finally {
            setDeleting(false);
            setConfirmDelete(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--surface)', padding: 24, borderRadius: 12, width: 400, border: '1px solid var(--border)' }}>
                <h3 style={{ marginBottom: 16 }}>{t("ward.config")}</h3>
                <div className="if-field">
                    <label className="if-label">{t("ward.ward_name")}</label>
                    <input className="if-input" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="if-field">
                    <label className="if-label">{t("ward.grid_columns")}</label>
                    <input className="if-input" type="number" min="1" max="10" value={cols} onChange={e => setCols(parseInt(e.target.value) || 1)} />
                </div>
                <div className="if-field">
                    <label className="if-label">{t('ward.rooms_label')}</label>
                    <textarea className="if-textarea" rows={4} value={rooms} onChange={e => setRooms(e.target.value)} />
                    <span className="if-hint">{t('ward.rooms_hint')}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end', alignItems: 'center' }}>
                    {!isNew && id !== 'ward-1' && (
                        <button
                            className="if-toggle"
                            style={{
                                color: confirmDelete ? '#fff' : '#e74c3c',
                                background: confirmDelete ? '#e74c3c' : 'transparent',
                                borderColor: '#e74c3c33',
                                marginRight: 'auto'
                            }}
                            onClick={handleDelete}
                            disabled={deleting || saving}
                            onMouseLeave={() => setConfirmDelete(false)}
                        >
                            {deleting ? t('ward.deleting') : confirmDelete ? t('ward.confirm_delete_ward') : t('ward.delete_ward')}
                        </button>
                    )}
                    <button className="if-toggle" onClick={onClose} disabled={saving || deleting}>{t("ward.cancel")}</button>
                    <button className="intake-next-btn" onClick={handleSave} disabled={saving || deleting}>{saving ? t('ward.saving') : t('ward.save')}</button>
                </div>
            </div>
        </div>
    );
}

// ─── Ward Map ────────────────────────────────────────────────────────────────

export default function WardMap() {
    const { t, lang } = useT();
    const [patients, setPatients] = useState<PatientSummary[]>([]);
    const [wards, setWards] = useState<WardConfig[]>([]);
    const [config, setConfig] = useState<WardConfig | null>(null);
    const [selected, setSelected] = useState<PatientSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [apiOk, setApiOk] = useState<boolean | null>(null);
    const [editingWard, setEditingWard] = useState<WardConfig | null>(null);

    const loadWards = useCallback(async (selectId?: string) => {
        try {
            const list = await store.listWards();
            setWards(list);
            setConfig(prev => {
                if (list.length === 0) return null;
                const targetId = selectId || prev?.id;
                const target = targetId ? list.find(w => w.id === targetId) : null;
                return target || list[0];
            });
        } catch (e) {
            console.error('Failed to load wards:', e);
        }
    }, []);

    const load = useCallback(async () => {
        try {
            const pts = await store.listPatients();
            setPatients(pts);
            await loadWards();
            setApiOk(true);
        } catch {
            setApiOk(false);
        }
    }, [loadWards]);

    useEffect(() => {
        let active = true;
        const init = async () => {
            await load();
            if (active) setLoading(false);
        };
        init();
        const idx = setInterval(load, 1000); // poll every 1s
        return () => {
            active = false;
            clearInterval(idx);
        };
    }, [load]);

    const occupant = useCallback((room: string) =>
        patients.find(p => p.roomNumber === room && !['transferred', 'discharged'].includes(p.status)),
        [patients]
    );

    const onUpdated = useCallback((updated: PatientRecord) => {
        setPatients(prev => prev.map(p =>
            p.id === updated.id ? { ...p, status: updated.status } : p
        ));
    }, []);

    if (apiOk === false) {
        return (
            <div className="ward-connect">
                <div className="ward-connect-title">{t("ward.api_offline")}</div>
                <p className="ward-connect-desc">
                    The FastAPI backend is not running.<br />
                    Start it with: <code>d:\Temp\Medic Info\api\start_api.bat</code>
                </p>
                <button className="intake-next-btn" onClick={load}>{t("ward.retry")}</button>
            </div>
        );
    }

    if (loading) {
        return <div className="ward-connect"><div className="loading">{t('ward.loading')}</div></div>;
    }

    if (!config) {
        return (
            <div className="ward-connect">
                <div className="ward-connect-title">{t('ward.no_wards')}</div>
                <p className="ward-connect-desc" style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
                    {t('ward.no_wards_desc')}
                </p>
                <button className="intake-next-btn" onClick={() => {
                    setEditingWard({ id: `ward-${Date.now()}`, name: t('ward.new_ward'), columns: 4, rooms: [] });
                }}>{t('ward.add_ward')}</button>
                {editingWard && (
                    <WardSettings
                        config={editingWard}
                        isNew={true}
                        onClose={() => { setEditingWard(null); loadWards(); }}
                        onSave={async (c) => {
                            const saved = await store.saveWardConfig(c);
                            setConfig(saved);
                            await loadWards(saved.id);
                            setEditingWard(null);
                        }}
                        onDelete={async (id) => {
                            await store.deleteWard(id);
                            await loadWards();
                            setEditingWard(null);
                        }}
                    />
                )}
            </div>
        );
    }

    const active = patients.filter(p => !['transferred', 'discharged'].includes(p.status));

    return (
        <div className="ward-layout">
            <div className="ward-main">
                <div className="ward-header">
                    <div className="ward-name">
                        <select
                            className="if-input"
                            style={{ fontSize: 20, fontWeight: 700, background: 'transparent', border: 'none', padding: '0 8px 0 0', cursor: 'pointer', appearance: 'auto', outline: 'none' }}
                            value={config.id}
                            onChange={e => {
                                const w = wards.find(x => x.id === e.target.value);
                                if (w) setConfig(w);
                            }}
                        >
                            {wards.map(w => (
                                <option key={w.id} value={w.id} style={{ fontSize: 14, background: 'var(--surface)' }}>{pt(config.id, lang, w.name)}</option>
                            ))}
                        </select>
                    </div>
                    <div className="ward-controls">
                        <span className="if-hint">{active.length} {active.length !== 1 ? t('ward.active_patients') : t('ward.active_patient')}</span>
                        <button className="if-toggle" onClick={() => {
                            if (!config) return;
                            const w = window.open('', '_blank');
                            if (!w) return;
                            const wardName = pt(config.id, lang, config.name) || config.name;
                            const roomsLabel = t('ward.rooms_count', 'rooms');
                            const printLabel = t('ward.print_all_labels', 'Print All Labels');
                            const roomLabels = config.rooms.map(r =>
                                `<div style="page-break-after:always;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">
                                    <div>
                                        <div style="font-size:14px;color:#888;margin-bottom:8px;letter-spacing:2px">${wardName}</div>
                                        <div style="font-size:120px;font-weight:900;letter-spacing:4px">${r}</div>
                                    </div>
                                </div>`
                            ).join('');
                            w.document.write(`<html><head><title>${wardName} — Labels</title>
                                <style>
                                    * { margin:0; padding:0; box-sizing:border-box; }
                                    body { font-family: system-ui, -apple-system, sans-serif; color: #111; }
                                    @media print { .no-print { display:none; } }
                                </style></head><body>
                                <div style="page-break-after:always;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">
                                    <div>
                                        <div style="font-size:160px;font-weight:900;letter-spacing:6px">${wardName}</div>
                                        <div style="font-size:20px;color:#888;margin-top:16px">${config.rooms.length} ${roomsLabel}</div>
                                    </div>
                                </div>
                                ${roomLabels}
                                <div class="no-print" style="position:fixed;bottom:20px;right:20px;display:flex;gap:8px">
                                    <button onclick="window.print()" style="padding:12px 28px;font-size:16px;cursor:pointer;border:1px solid #ccc;border-radius:8px;background:#f8f8f8">🖨 ${printLabel}</button>
                                </div>
                            </body></html>`);
                        }}>🏷️ {t('ward.print_labels', 'Print Labels')}</button>
                        <button className="if-toggle" onClick={async () => {
                            try {
                                const res = await fetch(`/api/reports/shift?lang=${lang}`);
                                const html = await res.text();
                                const blob = new Blob([html], { type: 'text/html' });
                                window.open(URL.createObjectURL(blob), '_blank');
                            } catch { /* API offline */ }
                        }}>🖨️ {t('ward.shift_report')}</button>
                        <button className="if-toggle" onClick={() => {
                            setEditingWard({ id: `ward-${Date.now()}`, name: t('ward.new_ward'), columns: 4, rooms: [] });
                        }}>{t('ward.add_ward')}</button>
                        <button className="if-toggle" onClick={() => { if (config) setEditingWard(config); }}>⚙️ {t('ward.configure_ward')}</button>
                    </div>
                </div>

                <div className="ward-legend">
                    {([['T1', t('ward.legend_immediate'), '#e74c3c'], ['T2', t('ward.legend_delayed'), '#f0a500'], ['T3', t('ward.legend_minimal'), '#3fb950'], ['--', t('ward.legend_empty'), '#3d4f63']] as [string, string, string][]).map(([p, label, c]) => (
                        <div key={p} className="ward-legend-item">
                            <div className="ward-legend-dot" style={{ background: c }} />
                            <span>{label}</span>
                        </div>
                    ))}
                </div>

                <div className="ward-grid" style={{ gridTemplateColumns: `repeat(${config.columns}, 1fr)` }}>
                    {config.rooms.map(room => {
                        const occ = occupant(room);
                        const color = occ ? pc(occ.priority) : 'transparent';
                        const isSelected = selected?.roomNumber === room;
                        return (
                            <div key={room}
                                className={`ward-cell ${occ ? 'occupied' : ''} ${isSelected ? 'selected' : ''}`}
                                style={{ '--room-color': color } as React.CSSProperties}
                                onClick={() => {
                                    if (isSelected) { setSelected(null); return; }
                                    setSelected(occ ?? { roomNumber: room } as PatientSummary);
                                }}>
                                <div className="ward-room-num">{room}</div>
                                {occ ? (
                                    <>
                                        <div className="ward-patient-name">{pt(occ.id, lang, occ.name) || t('ward.unknown')}</div>
                                        <div className="ward-patient-meta">{occ.age}{occ.sex}</div>
                                        <div className="ward-priority-badge" style={{ color, borderColor: color + '66', background: color + '15', fontSize: 10, padding: '1px 6px' }}>
                                            {occ.priority}
                                        </div>
                                        <div className="ward-status-dot" style={{ background: STATUS_COLOR[occ.status] ?? '#888' }} />
                                    </>
                                ) : (
                                    <div className="ward-available">{t("ward.available")}</div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Unassigned / Overflow Section */}
                {(() => {
                    const unassigned = patients.filter(
                        p => p.wardId === config.id
                            && !['transferred', 'discharged'].includes(p.status)
                            && (!p.roomNumber || !config.rooms.includes(p.roomNumber))
                    );

                    if (unassigned.length === 0) return null;

                    return (
                        <div style={{ marginTop: 32 }}>
                            <div className="ward-section-label" style={{ marginBottom: 12, color: '#e74c3c' }}>
                                {t('ward.unassigned_overflow')} ({unassigned.length})
                            </div>
                            <div className="ward-grid" style={{ gridTemplateColumns: `repeat(${config.columns}, 1fr)` }}>
                                {unassigned.map(occ => {
                                    const color = pc(occ.priority);
                                    const isSelected = selected?.id === occ.id;
                                    return (
                                        <div key={occ.id}
                                            className={`ward-cell occupied ${isSelected ? 'selected' : ''}`}
                                            style={{ '--room-color': color, borderStyle: 'dashed' } as React.CSSProperties}
                                            onClick={() => {
                                                if (isSelected) { setSelected(null); return; }
                                                setSelected(occ);
                                            }}>
                                            <div className="ward-room-num" style={{ color: '#e74c3c' }}>{t("ward.no_bed")}</div>
                                            <div className="ward-patient-name">{pt(occ.id, lang, occ.name) || t('ward.unknown')}</div>
                                            <div className="ward-patient-meta">{occ.age}{occ.sex}</div>
                                            <div className="ward-priority-badge" style={{ color, borderColor: color + '66', background: color + '15', fontSize: 10, padding: '1px 6px' }}>
                                                {occ.priority}
                                            </div>
                                            <div className="ward-status-dot" style={{ background: STATUS_COLOR[occ.status] ?? '#888' }} />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

            </div>

            {selected?.id && config && (
                <>
                    {/* Backdrop — click to close patient details */}
                    <div
                        style={{ position: 'fixed', inset: 0, zIndex: 99, cursor: 'default' }}
                        onClick={() => setSelected(null)}
                    />
                    <PatientPanel
                        summary={selected}
                        wards={wards}
                        activeWardId={config.id}
                        onClose={() => setSelected(null)}
                        onUpdated={onUpdated}
                    />
                </>
            )}

            {editingWard && (
                <WardSettings
                    config={editingWard}
                    isNew={!wards.some(w => w.id === editingWard.id)}
                    onClose={() => {
                        setEditingWard(null);
                        loadWards();
                    }}
                    onSave={async (c) => {
                        const saved = await store.saveWardConfig(c);
                        setConfig(saved);
                        await loadWards(saved.id);
                        setEditingWard(null);
                    }}
                    onDelete={async (id) => {
                        await store.deleteWard(id);
                        await loadWards();
                        setEditingWard(null);
                    }}
                />
            )}
        </div>
    );
}
