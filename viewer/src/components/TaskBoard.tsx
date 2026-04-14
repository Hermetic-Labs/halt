/**
 * TaskBoard — Standalone task management board for Eve Os: Triage
 * Airport-style flip board with escalation timers, reassignment, and sound alerts.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useT } from '../services/i18n';
import { normalizeToEnglish } from '../services/i18nDynamic';
import { useLanguageArray, AVAILABLE_LANGS } from '../hooks/useLanguageArray';
import { api, apiMutate } from '../services/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface MeshTask {
    id: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    assignee_id: string;
    assignee_name: string;
    created_by: string;
    created_at: string;
    updated_at: string;
    due_hint: string;
    category: string;
    escalate_at?: string;
}

interface RosterMember {
    id: string;
    name: string;
    role: string;
    status: string;
    avatar_url?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 3000;
const PRIORITY_COLOR: Record<string, string> = { critical: '#e74c3c', urgent: '#f0a500', normal: '#3498db', low: '#888' };
const STATUS_KEY: Record<string, string> = { open: 'tasks.status_open', assigned: 'tasks.status_assigned', in_progress: 'tasks.status_in_progress', done: 'tasks.status_done' };
const ESCALATION_OPTIONS = [
    { label: 'tasks.no_escalation', value: '' },
    { label: 'tasks.escalation_5m', value: '5' },
    { label: 'tasks.escalation_15m', value: '15' },
    { label: 'tasks.escalation_30m', value: '30' },
    { label: 'tasks.escalation_1h', value: '60' },
    { label: 'tasks.escalation_2h', value: '120' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

// timeAgo is kept English-safe — translated at call site

function escalationRemaining(escalateAt?: string): { text: string; critical: boolean } | null {
    if (!escalateAt) return null;
    const diff = new Date(escalateAt).getTime() - Date.now();
    if (diff <= 0) return { text: 'OVERDUE', critical: true };
    const mins = Math.ceil(diff / 60000);
    if (mins < 60) return { text: `${mins}m left`, critical: mins <= 5 };
    return { text: `${Math.floor(mins / 60)}h ${mins % 60}m left`, critical: false };
}

function playSound(sound: 'alert' | 'announcement') {
    try {
        const map: Record<string, string> = {
            alert: '/data/sounds/message alert.wav',
            announcement: '/data/sounds/triage announcement.wav',
        };
        const audio = new Audio(map[sound]);
        audio.volume = 0.3;
        audio.play().catch(() => { });
    } catch { /* no audio support */ }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TaskBoard() {
    const { t: tr, lang: userLang } = useT();
    const { langs: activeLangs, toggleLang } = useLanguageArray();
    const userName = localStorage.getItem('eve-mesh-name') || 'Unknown';

    const [tasks, setTasks] = useState<MeshTask[]>([]);
    const [roster, setRoster] = useState<RosterMember[]>([]);
    const [showAddTask, setShowAddTask] = useState(false);
    const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'normal', category: '', due_hint: '', escalate_minutes: '' });
    const [reassigning, setReassigning] = useState<string | null>(null);
    const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
    const [alertSent, setAlertSent] = useState<string | null>(null);
    const [showEmergency, setShowEmergency] = useState(false);
    const [wards, setWards] = useState<{ id: string; name: string }[]>([]);
    const [emergencyForm, setEmergencyForm] = useState({ ward: '', bed: '', categories: [] as string[], notes: '' });
    const [showAnnouncement, setShowAnnouncement] = useState(false);
    const [announcementMsg, setAnnouncementMsg] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const abortCtlRef = useRef<AbortController | null>(null);
    const prevTaskCountRef = useRef(0);

    // ── Fetch ────────────────────────────────────────────────────────────────

    const fetchTasks = useCallback(async () => {
        try {
            const data = await api<MeshTask[]>('list_tasks', '/tasks');
            // Detect new tasks for animation
            if (data.length > prevTaskCountRef.current && prevTaskCountRef.current > 0) {
                const existingIds = new Set(tasks.map(t => t.id));
                const newIds = data.filter(t => !existingIds.has(t.id)).map(t => t.id);
                if (newIds.length > 0) {
                    setAnimatingIds(new Set(newIds));
                    playSound('alert');
                    setTimeout(() => setAnimatingIds(new Set()), 800);
                }
            }
            prevTaskCountRef.current = data.length;
            setTasks(data);
        } catch { /* offline */ }
    }, [tasks]);

    const fetchRoster = useCallback(async () => {
        try {
            const data = await api<RosterMember[]>('list_roster', '/roster');
            setRoster(data);
        } catch { /* offline */ }
    }, []);

    useEffect(() => {
        fetchTasks();
        fetchRoster();
        api<{ id: string; name: string }[]>('list_wards', '/wards').then(setWards).catch(() => { });
        const poll = setInterval(() => { fetchTasks(); fetchRoster(); }, POLL_INTERVAL);
        return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Actions ──────────────────────────────────────────────────────────────

    const addTask = async () => {
        if (!newTask.title.trim()) return;
        const body: Record<string, string> = {
            title: newTask.title,
            description: newTask.description,
            priority: newTask.priority,
            category: newTask.category,
            due_hint: newTask.due_hint,
            created_by: userName,
        };
        // Add escalation timestamp if set
        if (newTask.escalate_minutes) {
            const mins = parseInt(newTask.escalate_minutes);
            body.escalate_at = new Date(Date.now() + mins * 60000).toISOString();
        }
        try {
            await apiMutate('create_task', '/tasks', body, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            playSound('announcement');
            fetchTasks();
            setNewTask({ title: '', description: '', priority: 'normal', category: '', due_hint: '', escalate_minutes: '' });
            setShowAddTask(false);
        } catch { /* offline */ }
    };

    const claimTask = async (taskId: string) => {
        try {
            await apiMutate('claim_task', `/tasks/${taskId}/claim?member_name=${encodeURIComponent(userName)}`, { task_id: taskId, member_name: userName }, { method: 'POST' });
            fetchTasks();
        } catch { /* offline */ }
    };

    const updateTaskStatus = async (task: MeshTask, newStatus: string) => {
        try {
            const updated = { ...task, status: newStatus };
            await apiMutate('update_task', `/tasks/${task.id}`, { task_id: task.id, task: updated }, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated),
            });
            fetchTasks();
        } catch { /* offline */ }
    };

    const reassignTask = async (task: MeshTask, memberName: string) => {
        try {
            const updated = { ...task, assignee_name: memberName, status: 'assigned' };
            await apiMutate('update_task', `/tasks/${task.id}`, { task_id: task.id, task: updated }, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated),
            });
            setReassigning(null);
            fetchTasks();
        } catch { /* offline */ }
    };

    const deleteTask = async (id: string) => {
        try {
            await apiMutate('delete_task', `/tasks/${id}`, { task_id: id }, { method: 'DELETE' });
            fetchTasks();
        } catch { /* offline */ }
    };

    const sendAlert = async (targetName: string, message: string, priority = 'normal') => {
        try {
            const payload = {
                target_name: targetName,
                message,
                sender_name: userName,
                priority,
                sound: priority === 'critical' ? 'announcement' : 'alert',
            };
            await apiMutate('mesh_alert', '/mesh/alert', payload, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            setAlertSent(targetName || 'all');
            setTimeout(() => setAlertSent(null), 2000);
        } catch { /* offline */ }
    };

    const sendEmergency = async () => {
        setIsGenerating(true);
        const ac = new AbortController();
        abortCtlRef.current = ac;
        try {
            // Compose canonical English text
            const catText = emergencyForm.categories.map(c => c.replace('_', ' ').toUpperCase()).join(', ');
            let wardBed = emergencyForm.ward ? ` — Ward: ${emergencyForm.ward}` : '';
            if (emergencyForm.bed) wardBed += ` Bed: ${emergencyForm.bed}`;
            const rawText = emergencyForm.notes
                ? `Emergency. ${catText}${wardBed}. ${emergencyForm.notes}`
                : `Emergency. ${catText}${wardBed}`;

            // Normalize to English if sender is non-English
            const { english: englishText } = userLang !== 'en'
                ? await normalizeToEnglish(rawText, userLang)
                : { english: rawText };

            if (ac.signal.aborted) return;

            // Translate to active languages only (not all 41)
            const translations: Record<string, string> = {};
            const ttsSegments: { text: string; lang: string }[] = [
                { text: `Alert. ${englishText}`, lang: 'en' },
            ];
            const targetLangs = activeLangs.filter(l => l !== 'en');
            if (targetLangs.length > 0) {
                const results = await Promise.all(
                    targetLangs.map(lang =>
                        fetch('/api/translate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: englishText, source: 'en', target: lang }),
                        }).then(r => r.ok ? r.json() : null).catch(() => null)
                    )
                );
                for (let i = 0; i < targetLangs.length; i++) {
                    const lang = targetLangs[i];
                    const translated = results[i]?.translated || results[i]?.text;
                    if (translated) {
                        translations[lang] = translated;
                        ttsSegments.push({ text: translated, lang });
                    }
                }
            }

            if (ac.signal.aborted) return;

            // Generate multi-language stitched audio (one blob, all languages)
            let audio_b64 = '';
            try {
                const ttsRes = await fetch('/tts/synthesize-multi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ segments: ttsSegments, rate: 1.0 }),
                });
                if (ttsRes.ok) {
                    const blob = await ttsRes.blob();
                    const buf = await blob.arrayBuffer();
                    const bytes = new Uint8Array(buf);
                    let binary = '';
                    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                    audio_b64 = btoa(binary);
                }
            } catch { /* TTS unavailable — broadcast text only */ }

            // Broadcast text + audio + translations
            const emergencyPayload = {
                ward: emergencyForm.ward,
                bed: emergencyForm.bed,
                categories: emergencyForm.categories,
                sender_name: userName,
                notes: emergencyForm.notes,
                audio_b64,
                translations,
            };
            await apiMutate('mesh_emergency', '/mesh/emergency', emergencyPayload, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(emergencyPayload),
            });

            setShowEmergency(false);
            setEmergencyForm({ ward: '', bed: '', categories: [], notes: '' });
        } catch {
            // Cancelled or network error
        } finally {
            setIsGenerating(false);
            abortCtlRef.current = null;
        }
    };

    const toggleCategory = (cat: string) => {
        setEmergencyForm(f => ({
            ...f,
            categories: f.categories.includes(cat)
                ? f.categories.filter(c => c !== cat)
                : [...f.categories, cat],
        }));
    };

    const sendAnnouncement = async () => {
        if (!announcementMsg.trim()) return;
        setIsGenerating(true);
        const ac = new AbortController();
        abortCtlRef.current = ac;
        try {
            const rawText = announcementMsg.trim();

            // Normalize to English if sender is non-English
            const { english: englishText } = userLang !== 'en'
                ? await normalizeToEnglish(rawText, userLang)
                : { english: rawText };

            if (ac.signal.aborted) return;

            // Translate to active languages only (scoped, not all 41)
            const translations: Record<string, string> = {};
            const ttsSegments: { text: string; lang: string }[] = [
                { text: `Attention. ${englishText}`, lang: 'en' },
            ];
            const targetLangs = activeLangs.filter(l => l !== 'en');
            if (targetLangs.length > 0) {
                const results = await Promise.all(
                    targetLangs.map(lang =>
                        fetch('/api/translate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: englishText, source: 'en', target: lang }),
                        }).then(r => r.ok ? r.json() : null).catch(() => null)
                    )
                );
                for (let i = 0; i < targetLangs.length; i++) {
                    const lang = targetLangs[i];
                    const translated = results[i]?.translated || results[i]?.text;
                    if (translated) {
                        translations[lang] = translated;
                        ttsSegments.push({ text: translated, lang });
                    }
                }
            }

            if (ac.signal.aborted) return;

            // Generate multi-language stitched audio (one blob, all languages)
            let audio_b64 = '';
            try {
                const ttsRes = await fetch('/tts/synthesize-multi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ segments: ttsSegments, rate: 1.0 }),
                });
                if (ttsRes.ok) {
                    const blob = await ttsRes.blob();
                    const buf = await blob.arrayBuffer();
                    const bytes = new Uint8Array(buf);
                    let binary = '';
                    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                    audio_b64 = btoa(binary);
                }
            } catch { /* TTS unavailable — broadcast text only */ }

            // Broadcast text + audio + translations
            const announcementPayload = {
                message: englishText,
                sender_name: userName,
                audio_b64,
                translations,
            };
            await apiMutate('mesh_announcement', '/mesh/announcement', announcementPayload, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(announcementPayload),
            });

            setShowAnnouncement(false);
            setAnnouncementMsg('');
        } catch {
            // Cancelled or network error
        } finally {
            setIsGenerating(false);
            abortCtlRef.current = null;
        }
    };

    // ── Derived ──────────────────────────────────────────────────────────────

    const activeTasks = tasks.filter(t => t.status !== 'done');
    const doneTasks = tasks.filter(t => t.status === 'done');
    const criticalCount = activeTasks.filter(t => t.priority === 'critical').length;
    const availableMembers = roster.filter(m => m.status === 'connected');

    // ── Render ───────────────────────────────────────────────────────────────

    const renderTaskCard = (t: MeshTask) => {
        const esc = escalationRemaining(t.escalate_at);
        const isNew = animatingIds.has(t.id);
        const isDone = t.status === 'done';

        return (
            <div key={t.id}
                style={{
                    background: 'var(--surface)',
                    borderRadius: 8,
                    padding: '14px 18px',
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${PRIORITY_COLOR[t.priority] || '#666'}`,
                    opacity: isDone ? 0.4 : 1,
                    transition: 'all 0.4s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    transform: isNew ? 'translateY(0)' : undefined,
                    animation: isNew ? 'slideIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' : isDone ? 'slideOut 0.3s ease' : undefined,
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14, textDecoration: isDone ? 'line-through' : 'none' }}>{t.title}</span>
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 700, textTransform: 'uppercase', background: `${PRIORITY_COLOR[t.priority]}22`, color: PRIORITY_COLOR[t.priority] }}>{tr(`tasks.${t.priority}`) || t.priority}</span>
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 600, textTransform: 'uppercase', background: t.status === 'open' ? '#3fb95022' : t.status === 'in_progress' ? '#3498db22' : 'var(--surface2)', color: t.status === 'open' ? '#3fb950' : t.status === 'in_progress' ? '#3498db' : 'var(--text-muted)' }}>{tr(STATUS_KEY[t.status] || '') || t.status}</span>
                            {t.category && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{t.category}</span>}
                        </div>
                        {t.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{t.description}</div>}

                        {/* Escalation timer */}
                        {esc && !isDone && (
                            <div style={{ fontSize: 11, fontWeight: 700, color: esc.critical ? '#e74c3c' : '#f0a500', marginBottom: 4, animation: esc.critical ? 'pulse 1s ease-in-out infinite' : undefined }}>
                                {tr('tasks.escalation')} {esc.text}
                            </div>
                        )}

                        <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            {t.assignee_name && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{tr('tasks.assigned_label')} {(() => { const rm = roster.find(r => r.name.toLowerCase() === t.assignee_name.toLowerCase()); return rm?.avatar_url ? <img src={rm.avatar_url} alt="" style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', verticalAlign: 'middle' }} /> : null; })()}<strong style={{ color: 'var(--text-muted)' }}>{t.assignee_name}</strong></span>}
                            {t.due_hint && <span>{tr('tasks.due_label')} {t.due_hint}</span>}
                            {t.created_by && <span>{tr('tasks.by')} {t.created_by}</span>}
                            {t.created_at && <span>{(() => { const diff = Date.now() - new Date(t.created_at).getTime(); const mins = Math.floor(diff / 60000); if (mins < 1) return tr('tasks.time_just_now'); if (mins < 60) return tr('tasks.time_m_ago').replace('{n}', String(mins)); const hrs = Math.floor(mins / 60); if (hrs < 24) return tr('tasks.time_hm_ago').replace('{h}', String(hrs)).replace('{m}', String(mins % 60)); return tr('tasks.time_d_ago').replace('{d}', String(Math.floor(hrs / 24))); })()}</span>}
                        </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 12, alignItems: 'flex-end' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                            {t.status === 'open' && (
                                <button onClick={() => claimTask(t.id)} style={{ padding: '4px 10px', background: '#3fb95022', border: '1px solid #3fb95044', borderRadius: 4, color: '#3fb950', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{tr('tasks.claim')}</button>
                            )}
                            {(t.status === 'assigned' || t.status === 'in_progress') && (
                                <button onClick={() => updateTaskStatus(t, t.status === 'assigned' ? 'in_progress' : 'done')} style={{ padding: '4px 10px', background: t.status === 'assigned' ? '#3498db22' : '#3fb95022', border: `1px solid ${t.status === 'assigned' ? '#3498db44' : '#3fb95044'}`, borderRadius: 4, color: t.status === 'assigned' ? '#3498db' : '#3fb950', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                                    {t.status === 'assigned' ? tr('tasks.in_progress') : tr('tasks.done')}
                                </button>
                            )}
                            {!isDone && (
                                <button onClick={() => setReassigning(reassigning === t.id ? null : t.id)} style={{ padding: '4px 8px', background: reassigning === t.id ? '#f0a50022' : 'transparent', border: `1px solid ${reassigning === t.id ? '#f0a50044' : '#44444466'}`, borderRadius: 4, color: reassigning === t.id ? '#f0a500' : '#888', fontSize: 11, cursor: 'pointer' }}>{tr('tasks.reassign')}</button>
                            )}
                            {!isDone && (
                                <button onClick={() => sendAlert(t.assignee_name || '', `Task: ${t.title}`, t.priority)} title={t.assignee_name ? `Alert ${t.assignee_name}` : 'Alert all'} style={{ padding: '4px 8px', background: alertSent === (t.assignee_name || 'all') ? '#f0a50033' : 'transparent', border: '1px solid #44444466', borderRadius: 4, color: alertSent === (t.assignee_name || 'all') ? '#f0a500' : '#888', fontSize: 13, cursor: 'pointer', transition: 'all 0.3s' }}>🔔</button>
                            )}
                            <button onClick={() => deleteTask(t.id)} style={{ padding: '4px 8px', background: 'transparent', border: '1px solid #44444466', borderRadius: 4, color: '#888', fontSize: 11, cursor: 'pointer' }}>x</button>
                        </div>

                        {/* Reassignment dropdown */}
                        {reassigning === t.id && (
                            <select
                                className="if-input"
                                style={{ fontSize: 11, padding: '4px 8px', marginTop: 4, minWidth: 140 }}
                                value=""
                                onChange={e => { if (e.target.value) reassignTask(t, e.target.value); }}
                            >
                                <option value="">{tr('tasks.assign_to', 'Assign to...')}</option>
                                {availableMembers.map(m => (
                                    <option key={m.id} value={m.name}>{m.name} ({m.role})</option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
            {/* CSS for animations */}
            <style>{`
                @keyframes slideIn {
                    from { opacity: 0; transform: translateY(-30px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes slideOut {
                    from { opacity: 1; transform: translateY(0); }
                    to { opacity: 0.4; transform: translateY(10px); }
                }
            `}</style>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{tr('tasks.title')}</h2>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                        {criticalCount > 0 && <span style={{ color: '#e74c3c', fontWeight: 600 }}>{criticalCount} {tr('tasks.critical').toUpperCase()}</span>}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setShowAnnouncement(true)} style={{ padding: '8px 14px', background: '#f0a50022', border: '1px solid #f0a500', borderRadius: 8, color: '#f0a500', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>📢 {tr('tasks.announce')}</button>
                    <button onClick={() => setShowEmergency(true)} style={{ padding: '8px 14px', background: '#e74c3c22', border: '1px solid #e74c3c', borderRadius: 8, color: '#e74c3c', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>🚨 {tr('tasks.emergency')}</button>
                    <button onClick={() => setShowAddTask(!showAddTask)} style={{ padding: '8px 16px', background: showAddTask ? '#333' : '#0d1f0d', border: `1px solid ${showAddTask ? '#555' : '#3fb950'}`, borderRadius: 8, color: showAddTask ? '#888' : '#3fb950', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                        {showAddTask ? tr('tasks.cancel') : '+ ' + tr('tasks.add')}
                    </button>
                </div>
            </div>

            {/* Add Task Form */}
            {showAddTask && (
                <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input className="if-input" value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} placeholder={tr('tasks.title_placeholder')} style={{ fontSize: 14 }} />
                    <input className="if-input" value={newTask.description} onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))} placeholder={tr('tasks.desc_placeholder')} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <select className="if-input" value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))} style={{ flex: 1 }}>
                            <option value="low">{tr('tasks.low')}</option>
                            <option value="normal">{tr('tasks.normal')}</option>
                            <option value="urgent">{tr('tasks.urgent')}</option>
                            <option value="critical">{tr('tasks.critical')}</option>
                        </select>
                        <select className="if-input" value={newTask.category} onChange={e => setNewTask(p => ({ ...p, category: e.target.value }))} style={{ flex: 1 }}>
                            <option value="">{tr('tasks.category_placeholder')}</option>
                            <option value="medical">{tr('tasks.cat_medical')}</option>
                            <option value="logistics">{tr('tasks.cat_logistics')}</option>
                            <option value="security">{tr('tasks.cat_security')}</option>
                            <option value="comms">{tr('tasks.cat_comms')}</option>
                            <option value="supply">{tr('tasks.cat_supply')}</option>
                            <option value="medication">{tr('tasks.cat_medication')}</option>
                        </select>
                        <select className="if-input" value={newTask.escalate_minutes} onChange={e => setNewTask(p => ({ ...p, escalate_minutes: e.target.value }))} style={{ flex: 1 }}>
                            {ESCALATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{tr(o.label)}</option>)}
                        </select>
                        <input className="if-input" value={newTask.due_hint} onChange={e => setNewTask(p => ({ ...p, due_hint: e.target.value }))} placeholder={tr('tasks.due_placeholder')} style={{ flex: 1 }} />
                    </div>
                    <button onClick={addTask} disabled={!newTask.title.trim()} style={{ padding: '10px 20px', background: '#3fb950', border: 'none', borderRadius: 6, color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: newTask.title.trim() ? 1 : 0.4, alignSelf: 'flex-start' }}>{tr('tasks.create')}</button>
                </div>
            )}

            {/* Task List */}
            <div style={{ flex: 1, padding: '16px 24px', overflowY: 'auto' }}>
                {activeTasks.length === 0 && doneTasks.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-faint)', fontSize: 14 }}>
                        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>{tr('tasks.title').toUpperCase()}</div>
                        <div>{tr('tasks.no_tasks')}</div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* Active tasks first, sorted by priority */}
                        {activeTasks
                            .sort((a, b) => {
                                const pOrder: Record<string, number> = { critical: 0, urgent: 1, normal: 2, low: 3 };
                                return (pOrder[a.priority] ?? 2) - (pOrder[b.priority] ?? 2);
                            })
                            .map(renderTaskCard)}

                        {/* Completed tasks at bottom */}
                        {doneTasks.length > 0 && (
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>{tr('tasks.completed', 'Completed')} ({doneTasks.length})</div>
                                {doneTasks.slice(0, 5).map(renderTaskCard)}
                                {doneTasks.length > 5 && (
                                    <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', padding: 8 }}>
                                        +{doneTasks.length - 5} more completed
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Emergency Modal */}
            {showEmergency && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
                    <div style={{ background: '#1a0a0a', borderRadius: 16, padding: '28px 32px', maxWidth: 480, width: '92%', border: '2px solid #e74c3c', boxShadow: '0 0 60px rgba(231,76,60,0.3)' }}>
                        <h3 style={{ margin: '0 0 4px', fontSize: 18, color: '#e74c3c', fontWeight: 700 }}>🚨 {tr('tasks.emergency_broadcast')}</h3>
                        <p style={{ color: '#888', fontSize: 12, marginBottom: 20 }}>{tr('tasks.emergency_desc')}</p>

                        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                            <select className="if-input" value={emergencyForm.ward} onChange={e => setEmergencyForm(f => ({ ...f, ward: e.target.value }))} style={{ flex: 1 }}>
                                <option value="">{tr('tasks.select_ward')}</option>
                                {wards.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                            </select>
                            <input className="if-input" placeholder={tr('tasks.bed_placeholder')} value={emergencyForm.bed} onChange={e => setEmergencyForm(f => ({ ...f, bed: e.target.value }))} style={{ width: 80 }} />
                        </div>

                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>{tr('tasks.response_required')}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                            {[
                                { id: 'all_hands', label: tr('tasks.all_hands') },
                                { id: 'expediters', label: tr('tasks.expediters') },
                                { id: 'inventory', label: tr('tasks.inventory_supply') },
                                { id: 'bed_assist', label: tr('tasks.bed_assist') },
                                { id: 'doctors', label: tr('tasks.all_doctors') },
                                { id: 'intake', label: tr('tasks.intake_processing') },
                                { id: 'volunteers', label: tr('tasks.volunteers') },
                            ].map(c => (
                                <label key={c.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                                    background: emergencyForm.categories.includes(c.id) ? '#e74c3c22' : '#111',
                                    border: `1px solid ${emergencyForm.categories.includes(c.id) ? '#e74c3c' : '#333'}`,
                                    borderRadius: 6, cursor: 'pointer', fontSize: 12,
                                    color: emergencyForm.categories.includes(c.id) ? '#e74c3c' : '#888',
                                    fontWeight: emergencyForm.categories.includes(c.id) ? 600 : 400,
                                }}>
                                    <input type="checkbox" checked={emergencyForm.categories.includes(c.id)} onChange={() => toggleCategory(c.id)} style={{ display: 'none' }} />
                                    {emergencyForm.categories.includes(c.id) ? '✓' : '○'} {c.label}
                                </label>
                            ))}
                        </div>

                        <input className="if-input" placeholder={tr('tasks.notes_placeholder')} value={emergencyForm.notes} onChange={e => setEmergencyForm(f => ({ ...f, notes: e.target.value }))} style={{ marginBottom: 12 }} />

                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>{tr('tasks.broadcast_languages', 'Broadcast Languages')}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
                            {AVAILABLE_LANGS.map(l => (
                                <button key={l.code} onClick={() => toggleLang(l.code)} style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4, border: `1px solid ${activeLangs.includes(l.code) ? '#e74c3c' : '#333'}`, background: activeLangs.includes(l.code) ? '#e74c3c22' : '#111', color: activeLangs.includes(l.code) ? '#e74c3c' : '#666', cursor: 'pointer', fontWeight: activeLangs.includes(l.code) ? 600 : 400 }}>{l.label}</button>
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => { abortCtlRef.current?.abort(); setShowEmergency(false); }} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid #444', borderRadius: 8, color: '#888', fontSize: 13, cursor: 'pointer' }}>{tr('tasks.cancel')}</button>
                            <button onClick={sendEmergency} disabled={emergencyForm.categories.length === 0 || isGenerating} style={{ flex: 2, padding: '10px', background: isGenerating ? '#333' : '#e74c3c', border: 'none', borderRadius: 8, color: isGenerating ? '#e74c3c' : '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: emergencyForm.categories.length > 0 ? 1 : 0.4 }}>{isGenerating ? tr('tasks.generating') : tr('tasks.broadcast_emergency')}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Announcement Modal */}
            {showAnnouncement && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
                    <div style={{ background: '#1a1a0a', borderRadius: 16, padding: '28px 32px', maxWidth: 480, width: '92%', border: '2px solid #f0a500', boxShadow: '0 0 60px rgba(240,165,0,0.3)' }}>
                        <h3 style={{ margin: '0 0 4px', fontSize: 18, color: '#f0a500', fontWeight: 700 }}>📢 {tr('tasks.announce_title')}</h3>
                        <p style={{ color: '#888', fontSize: 12, marginBottom: 20 }}>{tr('tasks.announce_desc')}</p>

                        <textarea
                            className="if-input"
                            placeholder={tr('tasks.announce_placeholder')}
                            value={announcementMsg}
                            onChange={e => setAnnouncementMsg(e.target.value)}
                            rows={3}
                            style={{ marginBottom: 12, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                        />

                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>{tr('tasks.broadcast_languages', 'Broadcast Languages')}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
                            {AVAILABLE_LANGS.map(l => (
                                <button key={l.code} onClick={() => toggleLang(l.code)} style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4, border: `1px solid ${activeLangs.includes(l.code) ? '#f0a500' : '#333'}`, background: activeLangs.includes(l.code) ? '#f0a50022' : '#111', color: activeLangs.includes(l.code) ? '#f0a500' : '#666', cursor: 'pointer', fontWeight: activeLangs.includes(l.code) ? 600 : 400 }}>{l.label}</button>
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => { abortCtlRef.current?.abort(); setShowAnnouncement(false); setAnnouncementMsg(''); }} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid #444', borderRadius: 8, color: '#888', fontSize: 13, cursor: 'pointer' }}>{tr('tasks.cancel')}</button>
                            <button onClick={sendAnnouncement} disabled={!announcementMsg.trim() || isGenerating} style={{ flex: 2, padding: '10px', background: isGenerating ? '#333' : '#f0a500', border: 'none', borderRadius: 8, color: isGenerating ? '#f0a500' : '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: announcementMsg.trim() ? 1 : 0.4 }}>{isGenerating ? tr('tasks.generating') : tr('tasks.broadcast_announcement')}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
