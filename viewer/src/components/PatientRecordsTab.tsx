import { useState, useEffect } from 'react';
import * as store from '../services/PatientStore';
import type { PatientSummary, PatientRecord, WardConfig } from '../types';
import PatientRawView from './PatientRecords/PatientRawView';
import { useT } from '../services/i18n';

export default function PatientRecordsTab() {
    const { t } = useT();
    const [patients, setPatients] = useState<PatientSummary[]>([]);
    const [wards, setWards] = useState<WardConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDoc, setSelectedDoc] = useState<PatientRecord | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const [data, wardData] = await Promise.all([
                    store.listPatients(),
                    store.listWards()
                ]);
                setPatients(data);
                setWards(wardData);
            } catch (e) {
                console.error("Failed to fetch historical patient records:", e);
            } finally {
                setLoading(false);
            }
        };

        load();
        const interval = setInterval(load, 5000); // passive poll
        return () => clearInterval(interval);
    }, []);

    if (loading && patients.length === 0) {
        return (
            <div className="ward-connect">
                <div className="loading">{t("records.loading")}</div>
            </div>
        );
    }

    return (
        <div style={{ gridColumn: '1 / -1', padding: 32, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ margin: '0 0 8px 0', fontSize: 24 }}>{t("records.title")}</h1>
                <div style={{ color: 'var(--text-muted)' }}>{t("records.subtitle")}</div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface2)', zIndex: 10 }}>
                        <tr>
                            <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>{t("records.col_id")}</th>
                            <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>{t("records.col_name")}</th>
                            <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>{t("records.col_status")}</th>
                            <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>{t("records.col_triage")}</th>
                            <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>{t("records.col_admitted")}</th>
                            <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>{t("records.col_mechanism")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {patients.map(p => {
                            const dateStr = p.admittedAt ? new Date(p.admittedAt).toLocaleString() : '--';

                            return (
                                <tr
                                    key={p.id}
                                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.2s' }}
                                    onClick={async () => {
                                        try {
                                            const fullRecord = await store.getPatient(p.id);
                                            setSelectedDoc(fullRecord);
                                        } catch (e) {
                                            console.error("Failed to load full record:", e);
                                            alert("Could not pull full patient JSON.");
                                        }
                                    }}
                                    title={t("records.click_details")}
                                >
                                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-dim)' }}>
                                        {p.id.replace('PAT-', '')}
                                    </td>
                                    <td style={{ padding: '12px 16px', fontWeight: 500 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-faint)' }}>👤</div>
                                            {p.name || 'John Doe'}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px 16px' }}>
                                        <span style={{
                                            display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 12, textTransform: 'capitalize',
                                            background: p.status === 'discharged' ? '#ffffff22' : p.status === 'critical' ? '#e74c3c33' : '#3fb95033',
                                            color: p.status === 'discharged' ? 'var(--text-muted)' : p.status === 'critical' ? '#e74c3c' : '#3fb950'
                                        }}>
                                            {p.status}
                                        </span>
                                    </td>
                                    <td style={{ padding: '12px 16px' }}>
                                        <span className={`item-priority p-${p.priority}`}>{p.priority}</span>
                                    </td>
                                    <td style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>{dateStr}</td>
                                    <td style={{ padding: '12px 16px', color: 'var(--text-dim)' }}>{p.mechanism || '--'}</td>
                                </tr>
                            );
                        })}
                        {patients.length === 0 && (
                            <tr>
                                <td colSpan={6} style={{ padding: 48, textAlign: 'center', color: 'var(--text-faint)' }}>
                                    No patient records found in the database.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {selectedDoc && (
                <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '800px', background: 'var(--bg)', boxShadow: '-4px 0 24px rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
                    <PatientRawView
                        record={selectedDoc}
                        wards={wards}
                        onClose={() => setSelectedDoc(null)}
                    />
                </div>
            )}
        </div>
    );
}
