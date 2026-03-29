import type { Assessment, Procedure, Drug, Protocol } from '../types';
import { useT } from '../services/i18n';

type Entity = Assessment | Procedure | Drug | Protocol;


function categoryColor(cat: string): string {
    const map: Record<string, string> = {
        'hemorrhage-control': '#e74c3c',
        'hemorrhage': '#e74c3c',
        'head-neck-injury': '#9b59b6',
        'thorax-injury': '#3498db',
        'burn-corrosion': '#e84393',
        'neurological': '#9b59b6',
        'circulatory': '#e67e22',
        'mass-casualty': '#e74c3c',
        'airway': '#3498db',
        'respiration': '#2ecc71',
        'temperature-management': '#1abc9c',
        'hemostatic': '#e74c3c',
        'antibiotic': '#2ecc71',
        'analgesia-anesthesia': '#f39c12',
        'fluid-resuscitation': '#3498db',
        'obstetric': '#e84393',
        'obstetric-eclampsia': '#e84393',
        'sedation-seizure': '#9b59b6',
        'reversal-agent': '#1abc9c',
        'cardiac-emergency': '#e74c3c',
    };
    return map[cat] ?? '#58a6ff';
}

function CatTag({ cat }: { cat: string }) {
    const color = categoryColor(cat);
    return (
        <span className="cat-tag" style={{ color, borderColor: color + '44', background: color + '18' }}>
            {cat}
        </span>
    );
}

function Modifiers({ mod }: { mod: Assessment['modifiers'] }) {
    const { t } = useT();
    if (!mod) return null;
    const entries = Object.entries(mod).filter(([, v]) => v?.note || v?.dose);
    if (!entries.length) return null;
    return (
        <div className="detail-section">
            <div className="detail-section-label">{t('detail.modifiers')}</div>
            {entries.map(([pop, v]) => (
                <div key={pop} className="modifier-box">
                    <div className="modifier-label">{pop}</div>
                    {v?.dose && <div className="modifier-text dose-block" style={{ marginBottom: 6 }}>{v.dose}</div>}
                    {v?.note && <div className="modifier-text">{v.note}</div>}
                </div>
            ))}
        </div>
    );
}


function AssessmentDetail({ item }: { item: Assessment }) {
    const { t } = useT();
    return (
        <>
            <div className="detail-header">
                <div className="detail-title">{item.name}</div>
                <CatTag cat={item.category} />
            </div>
            <div className="detail-section">
                <div className="detail-section-label">{t('detail.description')}</div>
                <div className="detail-text">{item.description}</div>
            </div>
            {item.instructions && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.instructions')}</div>
                    <div className="detail-text">{item.instructions}</div>
                </div>
            )}
            {item.scoring && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.scoring')}</div>
                    {item.scoring.map((domain, i) => (
                        <div key={i} style={{ marginBottom: 16 }}>
                            {domain.domain && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>{domain.domain}</div>}
                            {domain.options && (
                                <table className="score-table">
                                    <thead><tr><th>Score</th><th>Level</th></tr></thead>
                                    <tbody>
                                        {domain.options.map(o => (
                                            <tr key={o.score ?? o.code}>
                                                <td><span className="score-num">{o.score ?? o.code}</span></td>
                                                <td>{o.label}{o.description && <span style={{ color: 'var(--text-dim)' }}> — {o.description}</span>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            {/* For hemorrhage class or SALT rows */}
                            {domain.class && (
                                <table className="score-table">
                                    <tbody>
                                        <tr>
                                            <td><span className="score-num">Class {domain.class}</span></td>
                                            <td>{domain.blood_loss_ml} mL ({domain.blood_loss_pct})</td>
                                            <td>HR: {domain.hr}</td>
                                            <td>{domain.treatment}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {item.interpretation && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.interpretation')}</div>
                    <table className="score-table">
                        <thead><tr><th>Score</th><th>Interpretation</th></tr></thead>
                        <tbody>
                            {item.interpretation.map((row, i) => (
                                <tr key={i}>
                                    <td><span className="score-num">{row.range ? `${row.range[0]}--${row.range[1]}` : row.code}</span></td>
                                    <td>{row.label ?? row.triage}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {item.categories && (
                <div className="detail-section">
                    <div className="detail-section-label">Categories</div>
                    <table className="score-table">
                        <thead><tr><th>Color</th><th>Label</th><th>Description</th></tr></thead>
                        <tbody>
                            {item.categories.map((c, i) => (
                                <tr key={i}>
                                    <td><span className="score-num" style={{ textTransform: 'capitalize' }}>{c.color}</span></td>
                                    <td style={{ fontWeight: 600 }}>{c.label}</td>
                                    <td style={{ color: 'var(--text-dim)' }}>{c.description}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <Modifiers mod={item.modifiers} />
            {item.source && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 24 }}>{t('detail.source')}: {item.source}</div>}
        </>
    );
}


function ProcedureDetail({ item }: { item: Procedure }) {
    const { t } = useT();
    return (
        <>
            <div className="detail-header">
                <div className="detail-title">{item.name}</div>
                <CatTag cat={item.category} />
                {item.skill_level && <span className="tag" style={{ marginLeft: 8, fontSize: 10 }}>{item.skill_level}</span>}
                {item.time_estimate && <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 12 }}>{item.time_estimate}</span>}
            </div>
            <div className="detail-section">
                <div className="detail-section-label">{t('detail.description')}</div>
                <div className="detail-text">{item.description}</div>
            </div>
            {!!item.equipment?.length && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.equipment')}</div>
                    <div className="tag-list">
                        {item.equipment.map(e => <span key={e} className="tag">{e}</span>)}
                    </div>
                </div>
            )}
            {!!item.warnings?.length && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.warnings')}</div>
                    <div className="tag-list" style={{ flexDirection: 'column' }}>
                        {item.warnings.map(w => <span key={w} className="tag warning">{w}</span>)}
                    </div>
                </div>
            )}
            {!!item.steps?.length && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.steps')}</div>
                    <ol className="steps-list">
                        {item.steps.map((s, i) => (
                            <li key={i}>{s}</li>
                        ))}
                    </ol>
                </div>
            )}
            <Modifiers mod={item.modifiers} />
            {item.source && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 24 }}>{t('detail.source')}: {item.source}</div>}
        </>
    );
}

function DrugDetail({ item }: { item: Drug }) {
    const { t } = useT();
    return (
        <>
            <div className="detail-header">
                <div className="detail-title">{item.name}</div>
                <CatTag cat={item.category} />
                {item.rxnorm && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 8 }}>RxNorm: {item.rxnorm}</span>}
            </div>
            {Array.isArray(item.brand_names) && item.brand_names.length > 0 && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.brand_names')}</div>
                    <div className="tag-list">
                        {item.brand_names.map(b => <span key={b} className="tag">{b}</span>)}
                    </div>
                </div>
            )}
            {item.description && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.indications')}</div>
                    <div className="detail-text">{item.description}</div>
                </div>
            )}
            {item.dose && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.dose')}</div>
                    <div className="dose-block">{item.dose}</div>
                </div>
            )}
            {!!item.route?.length && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.route')}</div>
                    <div className="tag-list">
                        {item.route.map(r => <span key={r} className="tag">{r}</span>)}
                    </div>
                </div>
            )}
            {item.window && (
                <div className="detail-section">
                    <div className="detail-section-label">Time Window</div>
                    <span className="tag warning">{item.window}</span>
                </div>
            )}
            {!!item.contraindications?.filter(Boolean).length && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.contraindications')}</div>
                    <div className="detail-text" style={{ color: 'var(--text-dim)' }}>{item.contraindications![0]}</div>
                </div>
            )}
            {!!item.warnings?.filter(Boolean).length && (
                <div className="detail-section">
                    <div className="detail-section-label">{t('detail.warnings')}</div>
                    <div className="detail-text" style={{ color: '#f0a500' }}>{item.warnings![0]}</div>
                </div>
            )}
            <Modifiers mod={item.modifiers} />
            {item.source && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 24 }}>{t('detail.source')}: {item.source}</div>}
        </>
    );
}

function ProtocolDetail({ item }: { item: Protocol }) {
    const { t } = useT();
    return (
        <>
            <div className="detail-header">
                <div className="detail-title">{item.name}</div>
            </div>
            <div className="detail-section">
                <div className="detail-section-label">{t('detail.description')}</div>
                <div className="detail-text">{item.description}</div>
            </div>
            {item.source && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 24 }}>{t('detail.source')}: {item.source}</div>}
        </>
    );
}

export default function DetailView({ entity, section }: {
    entity: Entity | null;
    section: string;
}) {
    const { t } = useT();
    if (!entity) {
        return <div className="detail-empty">{t('detail.select_entry')}</div>;
    }

    if (section === 'assessments') return <AssessmentDetail item={entity as Assessment} />;
    if (section === 'procedures') return <ProcedureDetail item={entity as Procedure} />;
    if (section === 'pharmacology') return <DrugDetail item={entity as Drug} />;
    if (section === 'protocols') return <ProtocolDetail item={entity as Protocol} />;
    return <ProcedureDetail item={entity as Procedure} />;
}
