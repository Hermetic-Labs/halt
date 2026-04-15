import { useState, useEffect, useRef } from 'react';
import type { PatientRecord, WardConfig } from '../../types';
import { useT } from '../../services/i18n';
import { translateBatch } from '../../services/api';

const rawTranslationCache: Record<string, string> = {};

export default function PatientRawView({ record, wards, onClose }: { record: PatientRecord, wards: WardConfig[], onClose: () => void }) {
    const { t, lang } = useT();
    const [translations, setTranslations] = useState<Record<string, string>>({});
    const [isTranslating, setIsTranslating] = useState(false);
    const translatingRef = useRef(false);
    const prevLangRef = useRef(lang);

    // ── Reset translation cache when language changes ──
    useEffect(() => {
        prevLangRef.current = lang;
        translatingRef.current = false;
        Object.keys(rawTranslationCache).forEach(k => delete rawTranslationCache[k]);
        queueMicrotask(() => { setTranslations({}); setIsTranslating(false); });
    }, [lang]);

    // ── Live-translate dynamic content when lang ≠ English ──
    useEffect(() => {
        if (lang === 'en' || translatingRef.current || !record) return;

        // Collect translatable content from entire detail card
        const items: { id: string; text: string }[] = [];
        (record.events || []).forEach(ev => {
            if (ev.summary.trim() && !rawTranslationCache[ev.id]) items.push({ id: ev.id, text: ev.summary });
        });
        (record.plan?.march || []).forEach((m, i) => {
            const lid = `march-${i}-label`;
            const aid = `march-${i}-actions`;
            if (m.label?.trim() && !rawTranslationCache[lid]) items.push({ id: lid, text: m.label });
            const actionsText = m.actions?.join(', ');
            if (actionsText?.trim() && !rawTranslationCache[aid]) items.push({ id: aid, text: actionsText });
        });
        (record.plan?.rx || []).forEach((r, i) => {
            const rid = `rx-${i}`;
            if (r.trim() && !rawTranslationCache[rid]) items.push({ id: rid, text: r });
        });

        if (items.length === 0) return;

        const targetLang = lang;
        translatingRef.current = true;
        (async () => {
            setIsTranslating(true);
            try {
                const data = await translateBatch(items.map(i => i.text), 'en', targetLang);
                if (prevLangRef.current === targetLang) {
                    const newT: Record<string, string> = {};
                    items.forEach((item, idx) => {
                        rawTranslationCache[item.id] = data.translations[idx];
                        newT[item.id] = data.translations[idx];
                    });
                    setTranslations(newT);
                }
            } catch { /* offline — show originals */ }
            translatingRef.current = false;
            setIsTranslating(false);
        })();
    }, [record, lang]);

    if (!record) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
            <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                            <div style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--surface2)', border: '2px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {record.attachmentNames?.some((n: string) => /^photo\./i.test(n)) ? <img src={`/api/patients/${record.id}/attachments/${record.attachmentNames.find((n: string) => /^photo\./i.test(n))}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 22, color: 'var(--text-faint)' }}>👤</span>}
                            </div>
                            <h2 style={{ margin: 0, fontSize: 24 }}>{record.name || t("raw.unknown")}</h2>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 13, padding: '4px 8px', background: 'var(--surface2)', borderRadius: 4 }}>
                                {record.id}
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: 16, color: 'var(--text-dim)', fontSize: 14 }}>
                            <span>{t('raw.age')} {record.age || '--'}</span>
                            <span>{t('raw.sex')} {record.sex || '--'}</span>
                            <span>{t('raw.status')} <span style={{ textTransform: 'capitalize', color: 'var(--text)' }}>{record.status}</span></span>
                            <span>{t('raw.priority')} <span style={{ color: 'var(--text)' }}>{record.triage?.priority || '--'}</span></span>
                        </div>
                    </div>
                    <button className="icon-btn" onClick={onClose} style={{ fontSize: 28, padding: 4, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
                    <button onClick={() => window.open(`/api/patients/${record.id}/export?lang=${lang}`, '_blank')} style={{ padding: '6px 14px', background: '#0d1f0d', border: '1px solid #3fb950', borderRadius: 6, color: '#3fb950', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>📄 {t("raw.export")}</button>
                </div>
            </div>

            {/* Translation loading indicator */}
            {isTranslating && (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '8px 16px', borderBottom: '1px solid var(--border)',
                    background: 'rgba(80, 200, 120, 0.06)',
                }}>
                    <div style={{
                        width: 14, height: 14, border: '2px solid #50C87844',
                        borderTop: '2px solid #50C878', borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }} />
                    <span style={{ fontSize: 11, color: '#50C878', fontWeight: 500, letterSpacing: '0.04em' }}>
                        {t('ward.translating') || 'Translating...'}
                    </span>
                </div>
            )}

            <div style={{ flex: 1, padding: 32, overflowY: 'auto', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 40 }}>
                {/* Admission */}
                <section>
                    <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{t("raw.admission")}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, fontSize: 14 }}>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t('raw.admitted')}</div><div>{record.admittedAt ? new Date(record.admittedAt).toLocaleString() : '--'}</div></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t('raw.mechanism')}</div><div>{record.mechanism || '--'}</div></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t('raw.ward_assignment')}</div><div>{record.wardId ? (wards.find(w => w.id === record.wardId)?.name || record.wardId) : t('raw.unassigned')}</div></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t('raw.room_bed')}</div><div>{record.roomNumber || t('raw.none')}</div></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t('raw.weight')}</div><div>{record.weight ? `${record.weight} kg` : '--'}</div></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t('raw.language')}</div><div>{record.spokenLanguage || '--'}</div></div>
                        <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t('raw.next_of_kin')}</div><div>{record.nextOfKin || '--'}</div></div>
                    </div>
                </section>

                {/* Plan */}
                <section>
                    <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{t('raw.treatment_plan')}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
                        <div>
                            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>{t('raw.march_protocol')}</div>
                            {record.plan?.march?.length ? (
                                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {record.plan.march.map((m, i) => (
                                        <li key={i}><strong style={{ color: 'var(--text)' }}>{m.phase.toUpperCase()} - {translations[`march-${i}-label`] || m.label}:</strong> {translations[`march-${i}-actions`] || m.actions.join(', ')}</li>
                                    ))}
                                </ul>
                            ) : <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>{t('raw.none')}</span>}
                        </div>
                        <div>
                            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>{t('raw.medications')}</div>
                            {record.plan?.rx?.length ? (
                                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {record.plan.rx.map((rx, i) => <li key={i}>{translations[`rx-${i}`] || rx}</li>)}
                                </ul>
                            ) : <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>{t('raw.none')}</span>}
                        </div>
                    </div>
                </section>

                {/* Vitals */}
                <section>
                    <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{t('raw.initial_vitals')}</h3>
                    {record.initialVitals ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 16, fontSize: 14 }}>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>HR</div><div>{record.initialVitals.hr || '--'}</div></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>SBP</div><div>{record.initialVitals.sbp || '--'}</div></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>RR</div><div>{record.initialVitals.rr || '--'}</div></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>SpO2</div><div>{record.initialVitals.spo2 ? `${record.initialVitals.spo2}%` : '--'}</div></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>GCS</div><div>{record.initialVitals.gcs || '--'}</div></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Temp</div><div>{record.initialVitals.temp ? `${record.initialVitals.temp}°C` : '--'}</div></div>
                            <div><div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Pain</div><div>{record.initialVitals.pain ? `${record.initialVitals.pain}/10` : '--'}</div></div>
                        </div>
                    ) : (
                        <div style={{ color: 'var(--text-faint)', fontSize: 14 }}>{t('raw.no_vitals')}</div>
                    )}
                </section>

                {/* Events */}
                <section>
                    <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{t('raw.timeline')}</h3>
                    {record.events?.length ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {record.events.slice().reverse().map(ev => (
                                <div key={ev.id} style={{ fontSize: 14, background: 'var(--surface)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
                                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                                        <span style={{ fontWeight: 600, textTransform: 'capitalize', color: 'var(--text)', background: 'var(--surface2)', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{t('event.' + ev.type)}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{new Date(ev.timestamp).toLocaleString()}</span>
                                    </div>
                                    <div style={{ color: 'var(--text-dim)', lineHeight: 1.5 }}>{translations[ev.id] || ev.summary}</div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ color: 'var(--text-faint)', fontSize: 14 }}>{t('raw.no_events')}</div>
                    )}
                </section>
            </div>
        </div>
    );
}
