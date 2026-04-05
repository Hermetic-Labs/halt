import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import * as patientStore from '../services/PatientStore';
import type { InventoryItem, WardConfig } from '../types';
import { useT } from '../services/i18n';
import { normalizeToEnglish, precomputeAllLocales } from '../services/i18nDynamic';
import { buildPlan, kg, isPed, hemoClass } from '../services/planEngine';
import type { PatientData, Plan, Priority } from '../services/planEngine';

// ─── Local Types ────────────────────────────────────────────────────────────

type AllergyKey = string;
type Mechanism = 'penetrating' | 'blunt' | 'medical' | 'environmental' | 'obstetric';
interface AttachmentFile { name: string; type: string; size: number; url: string; isImage: boolean; }

// ─── Local Helpers ──────────────────────────────────────────────────────────

const now = () => { const d = new Date(); const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const r1 = (n: number) => Math.round(n * 10) / 10;

const INITIAL: PatientData = {
    name: '', age: '', ageUnit: 'years', sex: 'U', weight: '', weightUnit: 'kg',
    pregnant: false, allergies: [],
    injuryTime: now(), mechanism: '', regions: [],
    hr: '', sbp: '', rr: '', spo2: '', gcs: '', temp: '', tempUnit: 'C', pain: 0,
    bleeding: 'none', airway: 'patent', breathing: 'normal',
    tensionPneumo: false, openChest: false, suspectedSpinal: false, hypothermiaSigns: false,
    wardId: '', roomNumber: '', notes: '', attachments: [],
    nextOfKin: '', spokenLanguage: 'English',
};

const REGION_KEYS = ['region.head', 'region.neck', 'region.chest_l', 'region.chest_r', 'region.abdomen', 'region.back', 'region.pelvis', 'region.l_arm', 'region.r_arm', 'region.l_leg', 'region.r_leg'];
const REGIONS = ['Head', 'Neck', 'Chest L', 'Chest R', 'Abdomen', 'Back', 'Pelvis', 'L-Arm', 'R-Arm', 'L-Leg', 'R-Leg'];
const ALLERGIES: { key: AllergyKey; tKey: string }[] = [
    { key: 'penicillin', tKey: 'allergy.penicillin' }, { key: 'sulfa', tKey: 'allergy.sulfa' },
    { key: 'fluoroquinolone', tKey: 'allergy.fluoroquinolone' }, { key: 'nsaid', tKey: 'allergy.nsaid' },
    { key: 'opioid', tKey: 'allergy.opioid' },
];
const MECHS: { id: Mechanism; label: string }[] = [
    { id: 'penetrating', label: 'intake.penetrating' }, { id: 'blunt', label: 'intake.blunt' },
    { id: 'medical', label: 'intake.medical_emergency' }, { id: 'environmental', label: 'intake.environmental' },
    { id: 'obstetric', label: 'intake.obstetric' },
];



// ─── Sub-components ────────────────────────────────────────────────────────

type Setter = React.Dispatch<React.SetStateAction<PatientData>>;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
    return (
        <div className="if-field">
            <label className="if-label">{label}</label>
            {children}
            {hint && <span className="if-hint">{hint}</span>}
        </div>
    );
}

function Toggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
    return (
        <div className="if-toggle-group">
            {options.map(o => (
                <button key={o.v} className={`if-toggle ${value === o.v ? 'active' : ''}`} onClick={() => onChange(o.v)}>{o.label}</button>
            ))}
        </div>
    );
}

function Sev({ label, color }: { label: string; color: string }) {
    return <span className="if-sev" style={{ background: color + '22', color, borderColor: color + '66' }}>{label}</span>;
}

function Step1({ d, s }: { d: PatientData; s: Setter }) {
    const { t } = useT();
    const ped = isPed(d);
    return (
        <div className="if-step">
            <div className="if-section-label">{t('intake.demographics')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
                {/* Row 1: Photo + Name */}
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                    {/* Photo picker */}
                    <div style={{ flexShrink: 0 }}>
                        <input type="file" accept="image/*" capture="environment" id="patient-photo-input" style={{ display: 'none' }}
                            onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) s(p => ({ ...p, photoFile: file, photoPreview: URL.createObjectURL(file) }));
                            }} />
                        <label htmlFor="patient-photo-input" style={{
                            width: 72, height: 72, borderRadius: '50%', border: '2px dashed var(--border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                            overflow: 'hidden', background: 'var(--surface2)', transition: 'border-color 0.2s',
                        }}>
                            {d.photoPreview
                                ? <img src={d.photoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <span style={{ fontSize: 28, opacity: 0.4 }}>📷</span>
                            }
                        </label>
                    </div>
                    <div style={{ flex: 1 }}>
                    <Field label={t("intake.patient_name")}>
                        <input className="if-input" style={{ width: '100%' }}
                            type="text" placeholder={t("intake.name_placeholder")} value={d.name}
                            onChange={e => s(p => ({ ...p, name: e.target.value }))} />
                    </Field>
                    </div>
                </div>
                {/* Row 2: Age + Sex */}
                <Field label={t("intake.age")}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="if-input" style={{ width: 80 }} type="number" min={0} placeholder="--" value={d.age}
                            onChange={e => s(prev => ({ ...prev, age: e.target.value }))} />
                        <Toggle value={d.ageUnit} onChange={v => s(p => ({ ...p, ageUnit: v }))}
                            options={[{ v: 'years', label: t('unit.yr') }, { v: 'months', label: t('unit.mo') }]} />
                        {ped && <Sev label={t('intake.pediatric')} color="#3498db" />}
                    </div>
                </Field>
                <Field label={t("intake.sex")}>
                    <Toggle value={d.sex} onChange={v => s(p => ({ ...p, sex: v, pregnant: v !== 'F' ? false : p.pregnant }))}
                        options={[{ v: 'M', label: t('intake.male') }, { v: 'F', label: t('intake.female') }, { v: 'U', label: t('intake.unknown') }]} />
                </Field>
                {/* Row 3: Weight + Pregnant */}
                <Field label={t('intake.weight')} hint={t("intake.weight_hint")}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="if-input" style={{ width: 80 }} type="number" min={0} placeholder="--" value={d.weight}
                            onChange={e => s(p => ({ ...p, weight: e.target.value }))} />
                        <Toggle value={d.weightUnit} onChange={v => s(p => ({ ...p, weightUnit: v }))}
                            options={[{ v: 'kg', label: t('unit.kg') }, { v: 'lbs', label: t('unit.lbs') }]} />
                        {d.weight && <span className="if-hint" style={{ alignSelf: 'center' }}>{r1(kg(d))} kg</span>}
                    </div>
                </Field>
                {d.sex === 'F' ? (
                    <Field label={t("intake.pregnant")}>
                        <Toggle value={d.pregnant ? 'yes' : 'no'} onChange={v => s(p => ({ ...p, pregnant: v === 'yes' }))}
                            options={[{ v: 'no', label: t('intake.no') }, { v: 'yes', label: t('intake.yes') }]} />
                    </Field>
                ) : <div />}
                {/* Row 4: Next of Kin + Language */}
                <Field label={t("intake.nok")}>
                    <input className="if-input" style={{ width: '100%' }}
                        type="text" placeholder={t("intake.nok_placeholder")}
                        value={d.nextOfKin}
                        onChange={e => s(p => ({ ...p, nextOfKin: e.target.value }))} />
                </Field>
                <Field label={t("intake.language")}>
                    <select className="if-input" style={{ width: '100%', padding: '12px' }}
                        value={d.spokenLanguage}
                        onChange={e => s(p => ({ ...p, spokenLanguage: e.target.value }))}>
                        {['English', 'Arabic', 'Bengali', 'German', 'Spanish', 'French', 'Hebrew', 'Hindi', 'Indonesian', 'Italian', 'Japanese', 'Korean', 'Latin', 'Dutch', 'Polish', 'Portuguese', 'Russian', 'Swahili', 'Thai', 'Tagalog', 'Turkish', 'Urdu', 'Vietnamese', 'Chinese', 'Amharic', 'Hausa', 'Igbo', 'Javanese', 'Kurdish', 'Malagasy', 'Marathi', 'Burmese', 'Pashto', 'Somali', 'Tamil', 'Telugu', 'Ukrainian', 'Yoruba', 'Zulu', 'Xhosa', 'Persian (Farsi/Dari)', 'Khmer'].map(lang => (
                            <option key={lang} value={lang}>{t(`lang.${lang}`)}</option>
                        ))}
                    </select>
                </Field>
                {/* Row 5: Allergies (full width) */}
                <div style={{ gridColumn: '1 / -1' }}>
                    <Field label={t("intake.allergies")} hint={t('intake.select_all')}>
                        <div className="if-toggle-group" style={{ flexWrap: 'wrap' }}>
                            {ALLERGIES.map(a => (
                                <button key={a.key}
                                    className={`if-toggle ${d.allergies.includes(a.key) ? 'active danger' : ''}`}
                                    onClick={() => s(p => ({
                                        ...p,
                                        allergies: p.allergies.includes(a.key) ? p.allergies.filter(x => x !== a.key) : [...p.allergies, a.key]
                                    }))}>
                                    {t(a.tKey)}
                                </button>
                            ))}
                            <button className={`if-toggle ${d.allergies.length === 0 ? 'active' : ''}`}
                                onClick={() => s(p => ({ ...p, allergies: [] }))}>{t("intake.none_known")}</button>
                        </div>
                        {/* Custom allergy input */}
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                            <input className="if-input" style={{ flex: 1, minWidth: 120 }}
                                placeholder={t('intake.custom_allergy_placeholder', 'Type allergy and press Enter')}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                        const val = (e.target as HTMLInputElement).value.trim();
                                        s(p => ({ ...p, allergies: p.allergies.includes(val) ? p.allergies : [...p.allergies, val] }));
                                        (e.target as HTMLInputElement).value = '';
                                    }
                                }} />
                        </div>
                        {/* Show custom allergy chips */}
                        {d.allergies.filter(a => !ALLERGIES.some(p => p.key === a)).length > 0 && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                {d.allergies.filter(a => !ALLERGIES.some(p => p.key === a)).map(custom => (
                                    <span key={custom} className="if-toggle active danger" style={{ cursor: 'pointer', fontSize: 12 }}
                                        onClick={() => s(p => ({ ...p, allergies: p.allergies.filter(x => x !== custom) }))}>
                                        {custom} ×
                                    </span>
                                ))}
                            </div>
                        )}
                    </Field>
                </div>
            </div>
        </div>
    );
}

function Step2({ d, s }: { d: PatientData; s: Setter }) {
    const { t } = useT();
    return (
        <div className="if-step">
            <div className="if-section-label">{t('intake.situation')}</div>
            <div className="if-row">
                <Field label={t("intake.injury_time")} hint={t("intake.injury_time_hint")}>
                    <input className="if-input" style={{ width: 220 }} type="datetime-local" value={d.injuryTime}
                        onChange={e => s(p => ({ ...p, injuryTime: e.target.value }))} />
                </Field>
            </div>
            <Field label={t("intake.mechanism")}>
                <div className="if-toggle-group" style={{ flexWrap: 'wrap' }}>
                    {MECHS.map(m => (
                        <button key={m.id} className={`if-toggle ${d.mechanism === m.id ? 'active' : ''}`}
                            onClick={() => s(p => ({ ...p, mechanism: p.mechanism === m.id ? '' : m.id }))}>
                            {t(m.label)}
                        </button>
                    ))}
                </div>
            </Field>
            <Field label={t("intake.body_regions")} hint={t('intake.select_all')}>
                <div className="if-region-grid">
                    {REGIONS.map((r, ri) => (
                        <button key={r} className={`if-toggle ${d.regions.includes(r) ? 'active' : ''}`}
                            onClick={() => s(p => ({ ...p, regions: p.regions.includes(r) ? p.regions.filter(x => x !== r) : [...p.regions, r] }))}>
                            {t(REGION_KEYS[ri])}
                        </button>
                    ))}
                </div>
            </Field>
        </div>
    );
}

function Step3({ d, s }: { d: PatientData; s: Setter }) {
    const { t } = useT();
    const hr = parseInt(d.hr) || 0, sbp = parseInt(d.sbp) || 0;
    const rr = parseInt(d.rr) || 0, spo2 = parseInt(d.spo2) || 99;
    const gcs = parseInt(d.gcs) || 0;
    const si = sbp > 0 && hr > 0 ? r1(hr / sbp) : null;
    const hc = hr && sbp ? hemoClass(hr, sbp, rr, gcs) : null;

    const hcColor: Record<string, string> = { 'I': '#3fb950', 'II': '#f0a500', 'III': '#e74c3c', 'IV': '#ff0000' };
    const siColor = si === null ? '' : si < 0.6 ? '#3fb950' : si < 1.0 ? '#f0a500' : si < 1.4 ? '#e74c3c' : '#ff0000';

    return (
        <div className="if-step">
            <div className="if-section-label">{t('intake.vitals')}</div>
            <div className="if-vitals-grid">
                <Field label={t('vitals.hr')}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="if-input" style={{ width: 80 }} type="number" placeholder="--" value={d.hr}
                            onChange={e => s(p => ({ ...p, hr: e.target.value }))} />
                        {hr > 0 && <Sev label={hr > 120 ? t('intake.tachy') : hr < 60 ? t('intake.brady') : t('intake.normal')} color={hr > 120 || hr < 60 ? '#e74c3c' : '#3fb950'} />}
                    </div>
                </Field>
                <Field label={t('vitals.sbp')}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="if-input" style={{ width: 80 }} type="number" placeholder="--" value={d.sbp}
                            onChange={e => s(p => ({ ...p, sbp: e.target.value }))} />
                        {sbp > 0 && <Sev label={sbp < 90 ? t('intake.hypotensive') : sbp < 120 ? t('intake.normal') : t('intake.elevated')} color={sbp < 90 ? '#e74c3c' : '#3fb950'} />}
                    </div>
                </Field>
                <Field label={t('vitals.rr')}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="if-input" style={{ width: 80 }} type="number" placeholder="--" value={d.rr}
                            onChange={e => s(p => ({ ...p, rr: e.target.value }))} />
                        {rr > 0 && <Sev label={rr > 30 ? t('intake.severe') : rr > 20 ? t('intake.elevated') : t('intake.normal')} color={rr > 30 ? '#e74c3c' : rr > 20 ? '#f0a500' : '#3fb950'} />}
                    </div>
                </Field>
                <Field label={t('vitals.spo2')}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="if-input" style={{ width: 80 }} type="number" min={0} max={100} placeholder="--" value={d.spo2}
                            onChange={e => s(p => ({ ...p, spo2: e.target.value }))} />
                        {parseInt(d.spo2) > 0 && <Sev label={spo2 < 90 ? t('intake.critical') : spo2 < 94 ? t('intake.low') : t('intake.normal')} color={spo2 < 90 ? '#e74c3c' : spo2 < 94 ? '#f0a500' : '#3fb950'} />}
                    </div>
                </Field>
                <Field label={t('vitals.gcs')}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="if-input" style={{ width: 80 }} type="number" min={3} max={15} placeholder="--" value={d.gcs}
                            onChange={e => s(p => ({ ...p, gcs: e.target.value }))} />
                        {gcs >= 3 && <Sev label={gcs >= 13 ? t('intake.mild') : gcs >= 9 ? t('intake.moderate') : t('intake.severe')} color={gcs >= 13 ? '#3fb950' : gcs >= 9 ? '#f0a500' : '#e74c3c'} />}
                    </div>
                </Field>
                <Field label={t('vitals.temp')}>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input className="if-input" style={{ width: 80 }} type="number" step={0.1} placeholder="--" value={d.temp}
                            onChange={e => s(p => ({ ...p, temp: e.target.value }))} />
                        <Toggle value={d.tempUnit} onChange={v => s(p => ({ ...p, tempUnit: v }))}
                            options={[{ v: 'C', label: t('unit.c') }, { v: 'F', label: t('unit.f') }]} />
                    </div>
                </Field>
            </div>

            <div className="if-derived" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
                {si !== null && <Sev label={`${t('intake.shock_index')} ${si}`} color={siColor} />}
                {hc && <Sev label={`${t('intake.hemorrhage_class')} ${hc}`} color={hcColor[hc] ?? '#3fb950'} />}
            </div>

            <Field label={t('vitals.pain')}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <input type="range" min={0} max={10} value={d.pain}
                        onChange={e => s(p => ({ ...p, pain: parseInt(e.target.value) }))}
                        style={{ width: 200, accentColor: d.pain >= 7 ? '#e74c3c' : d.pain >= 4 ? '#f0a500' : '#3fb950' }} />
                    <Sev label={`${d.pain}/10 ${d.pain >= 7 ? `-- ${t('intake.pain_severe')}` : d.pain >= 4 ? `-- ${t('intake.pain_moderate')}` : `-- ${t('intake.pain_mild')}`}`}
                        color={d.pain >= 7 ? '#e74c3c' : d.pain >= 4 ? '#f0a500' : '#3fb950'} />
                </div>
            </Field>
        </div>
    );
}

function Step4({ d, s }: { d: PatientData; s: Setter }) {
    const { t } = useT();
    const set = (key: keyof PatientData) => (v: string) => s(p => ({ ...p, [key]: v }));
    const tog = (key: keyof PatientData) => () => s(p => ({ ...p, [key]: !p[key as keyof PatientData] }));
    return (
        <div className="if-step">
            <div className="if-section-label">{t('intake.findings')}</div>
            <Field label={t("intake.bleeding")}>
                <Toggle value={d.bleeding} onChange={set('bleeding')}
                    options={[{ v: 'none', label: t('intake.none') }, { v: 'controlled', label: t('intake.controlled') }, { v: 'uncontrolled', label: t('intake.uncontrolled') }]} />
            </Field>
            <Field label={t("intake.airway")}>
                <Toggle value={d.airway} onChange={set('airway')}
                    options={[{ v: 'patent', label: t('intake.patent') }, { v: 'compromised', label: t('intake.compromised') }, { v: 'obstructed', label: t('intake.obstructed') }]} />
            </Field>
            <Field label={t("intake.breathing")}>
                <Toggle value={d.breathing} onChange={set('breathing')}
                    options={[{ v: 'normal', label: t('intake.normal') }, { v: 'labored', label: t('intake.labored') }, { v: 'diminished-one', label: t('intake.diminished') }, { v: 'absent', label: t('intake.absent') }]} />
            </Field>
            <div className="if-findings-grid">
                {[
                    { key: 'tensionPneumo' as const, label: t('intake.tension_pneumo') },
                    { key: 'openChest' as const, label: t('intake.open_chest') },
                    { key: 'suspectedSpinal' as const, label: t('intake.spinal') },
                    { key: 'hypothermiaSigns' as const, label: t('intake.hypothermia') },
                ].map(({ key, label }) => (
                    <button key={key} className={`if-toggle finding ${d[key] ? 'active danger' : ''}`} onClick={tog(key)}>
                        <span className={`if-finding-dot ${d[key] ? 'on' : ''}`} />
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function PlanOutput({ plan, d }: { plan: Plan; d: PatientData }) {
    const { t } = useT();
    const pColor: Record<Priority, string> = { T1: '#ff4d4d', T2: '#f0a500', T3: '#3fb950', T4: '#8b949e' };
    const phaseLabel: Record<string, string> = { M: 'M', A: 'A', R: 'R', C: 'C', H: 'H' };
    const phaseDesc: Record<string, string> = { M: t('plan.massive_hemorrhage'), A: t('plan.airway'), R: t('plan.respiration'), C: t('plan.circulation'), H: t('plan.hypothermia') };

    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [consumed, setConsumed] = useState(false);
    const [consuming, setConsuming] = useState(false);

    useEffect(() => {
        patientStore.getInventory().then(setInventory).catch(console.error);
    }, []);

    const requiredSupplies = useMemo(() => {
        const req: { id: string; qty: number; reason: string }[] = [];
        if (plan.drugs.some(x => x.name.includes("TXA"))) req.push({ id: 'inv-txa', qty: 1, reason: 'TXA Administration' });
        if (plan.drugs.some(x => x.name.includes("Ketamine"))) req.push({ id: 'inv-ketamine', qty: 1, reason: 'Ketamine Protocol' });
        if (d.bleeding !== 'none') req.push({ id: 'inv-gauze', qty: 2, reason: 'Wound Packing / Bleeding Control' });
        if (d.bleeding === 'uncontrolled' && d.regions.some(r => r.includes('Arm') || r.includes('Leg'))) req.push({ id: 'inv-tourniquet', qty: 1, reason: 'Extremity Hemorrhage' });
        if (plan.hemoClass === 'III' || plan.hemoClass === 'IV') req.push({ id: 'inv-iv-fluid', qty: 1, reason: 'Fluid Resuscitation' });
        if (d.tensionPneumo || d.openChest) req.push({ id: 'inv-chest-seal', qty: 1, reason: 'Chest Wound' });
        return req;
    }, [plan, d]);

    const handleConsume = async () => {
        if (consumed || consuming) return;
        setConsuming(true);
        try {
            for (const req of requiredSupplies) {
                await patientStore.consumeInventory(req.id, req.qty);
            }
            const updated = await patientStore.getInventory();
            setInventory(updated);
            setConsumed(true);
        } catch (e) {
            console.error('Failed to consume supplies', e);
        } finally {
            setConsuming(false);
        }
    };

    return (
        <div className="if-plan">
            <div className="if-plan-header">
                <div className="if-plan-patient">
                    {d.age && `${d.age}${d.ageUnit === 'months' ? 'mo' : 'yr'} `}
                    {d.sex !== 'U' ? d.sex : ''}{d.pregnant ? ` ${t('intake.pregnant_label')}` : ''}
                    {d.weight && ` ${r1(kg(d))}kg`}
                    {d.mechanism && ` -- ${t(MECHS.find(m => m.id === d.mechanism)?.label ?? d.mechanism)}`}
                </div>
                <div className="if-plan-time">{t('intake.injury_label')} {d.injuryTime || '--'}</div>
                <div className="if-priority" style={{ background: pColor[plan.priority] + '22', color: pColor[plan.priority], borderColor: pColor[plan.priority] + '55' }}>
                    {plan.priority} — {plan.priorityLabel}
                </div>
                <div className="if-plan-meta">
                    {plan.si !== null && <span>{t('intake.shock_index')} {plan.si}</span>}
                    {plan.hemoClass !== '--' && <span>{t('intake.hemorrhage_class')} {plan.hemoClass}</span>}
                    <span>GCS: {plan.gcsCat}</span>
                </div>
                {plan.txaDeadline && (
                    <div className="if-txa-warning">{t('plan.txa_window', { time: plan.txaDeadline || '' })}</div>
                )}
            </div>

            <div className="if-plan-section">
                <div className="if-plan-section-title">{t('plan.immediate_march')}</div>
                {plan.march.map(m => (
                    <div key={m.phase} className="if-march-item">
                        <div className="if-march-phase">[{phaseLabel[m.phase]}]</div>
                        <div>
                            <div className="if-march-desc">{phaseDesc[m.phase]}</div>
                            {m.actions.map((a, i) => <div key={i} className="if-march-action">{a}</div>)}
                        </div>
                    </div>
                ))}
            </div>

            {plan.urgent.length > 0 && (
                <div className="if-plan-section">
                    <div className="if-plan-section-title">{t('plan.urgent_section')}</div>
                    {plan.urgent.map((u, i) => <div key={i} className="if-plan-line">{u}</div>)}
                </div>
            )}

            {plan.drugs.length > 0 && (
                <div className="if-plan-section">
                    <div className="if-plan-section-title">{t('plan.rx_regimen')}</div>
                    {plan.drugs.map((drug, i) => (
                        <div key={i} className="if-drug-card">
                            <div className="if-drug-name">{drug.name}</div>
                            <div className="if-drug-details">
                                <span>{t('plan.dose')} {drug.dose}</span>
                                <span>{t('plan.route')} {drug.route}</span>
                                <span>{t('plan.timing')} {drug.timing}</span>
                            </div>
                            <div className="if-drug-regimen">{drug.regimen}</div>
                            {drug.warning && <div className="if-drug-warning">{drug.warning}</div>}
                        </div>
                    ))}
                </div>
            )}

            {plan.rx.length > 0 && (
                <div className="if-plan-section">
                    <div className="if-plan-section-title">{t('plan.full_rx')}</div>
                    {plan.rx.map((r, i) => <div key={i} className="if-plan-line">{r}</div>)}
                </div>
            )}

            <div className="if-plan-section">
                <div className="if-plan-section-title">{t('plan.monitoring')}</div>
                {plan.monitoring.map((m, i) => <div key={i} className="if-plan-line">{m}</div>)}
            </div>

            <div className="if-plan-section">
                <div className="if-plan-section-title">{t('plan.recovery')}</div>
                {plan.recovery.map((r, i) => <div key={i} className="if-plan-line">{r}</div>)}
            </div>

            <div className="if-plan-section escalate">
                <div className="if-plan-section-title">{t('plan.escalate_if')}</div>
                {plan.escalate.map((e, i) => <div key={i} className="if-plan-line">{e}</div>)}
            </div>

            {requiredSupplies.length > 0 && (
                <div className="if-plan-section">
                    <div className="if-plan-section-title">{t('intake.required_supplies')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {requiredSupplies.map((req, i) => {
                            const invItem = inventory.find(inv => inv.id === req.id);
                            const currentQty = invItem?.quantity || 0;
                            const isLow = currentQty < req.qty;
                            return (
                                <div key={i} style={{ background: 'var(--surface)', padding: 12, borderRadius: 6, border: `1px solid ${isLow ? '#e74c3c' : 'var(--border)'}` }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                        <div style={{ fontWeight: 600 }}>{req.qty}x {invItem?.name || req.id}</div>
                                        <div style={{ color: isLow ? '#e74c3c' : 'var(--text-dim)', fontWeight: isLow ? 700 : 400 }}>
                                            {t('intake.stock')} {currentQty}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('intake.reason')} {req.reason}</div>
                                    {isLow && invItem?.alternatives && (
                                        <div style={{ marginTop: 8, fontSize: 12, color: '#e74c3c', borderTop: '1px solid #e74c3c33', paddingTop: 8 }}>
                                            <strong>{t('intake.critical_low')}</strong>
                                            <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
                                                {invItem.alternatives.map((alt, j) => <li key={j}>{alt}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <button
                        style={{ marginTop: 16, width: '100%', padding: '12px', borderRadius: 4, border: 'none', background: consumed ? '#3fb950' : 'var(--primary)', color: 'black', fontWeight: 600, cursor: consumed ? 'default' : 'pointer', opacity: (consumed || consuming || inventory.length === 0) ? 0.7 : 1 }}
                        onClick={handleConsume}
                        disabled={consumed || consuming || inventory.length === 0}
                    >
                        {consumed ? t('intake.supplies_consumed') : consuming ? t('intake.consuming') : t('intake.consume_supplies')}
                    </button>
                </div>
            )}

            <div style={{ marginTop: 20, color: 'var(--text-faint)', fontSize: 11 }}>
                {d.allergies.length > 0 && <div>{t('plan.allergy_alert', { allergies: d.allergies.join(', ').toUpperCase() })}</div>}
                {isPed(d) && <div>{t('plan.pediatric_alert', { weight: String(r1(kg(d))) })}</div>}
                {d.pregnant && <div>{t('plan.pregnant_alert')}</div>}
            </div>
        </div>
    );
}

function Step6({ d, s }: { d: PatientData; s: Setter }) {
    const { t } = useT();
    const fileRef = useRef<HTMLInputElement>(null);
    const [wards, setWards] = useState<WardConfig[]>([]);

    useEffect(() => {
        patientStore.listWards().then(data => {
            setWards(data);
            if (data.length > 0 && !d.wardId) {
                s(p => ({ ...p, wardId: data[0].id, roomNumber: data[0].rooms[0] || '' }));
            }
        }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleFiles = useCallback((files: FileList | null) => {
        if (!files) return;
        Array.from(files).forEach(file => {
            const isImage = file.type.startsWith('image/');
            const url = URL.createObjectURL(file);
            s(p => ({
                ...p,
                attachments: [...p.attachments, { name: file.name, type: file.type, size: file.size, url, isImage }]
            }));
        });
    }, [s]);

    const removeAttachment = (i: number) => {
        s(p => { URL.revokeObjectURL(p.attachments[i].url); return { ...p, attachments: p.attachments.filter((_, j) => j !== i) }; });
    };

    const [dragging, setDragging] = useState(false);

    return (
        <div className="if-step">
            <div className="if-section-label">{t('intake.assignment')}</div>

            <Field label={t("intake.ward_bed")}>
                <div style={{ display: 'flex', gap: 12 }}>
                    <select
                        className="if-input" style={{ flex: 1, padding: '12px' }}
                        value={d.wardId}
                        onChange={e => {
                            const wId = e.target.value;
                            const ward = wards.find(w => w.id === wId);
                            s(p => ({ ...p, wardId: wId, roomNumber: ward?.rooms[0] || '' }));
                        }}
                    >
                        <option value="" disabled>{t('intake.select_ward')}</option>
                        {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>

                    <select
                        className="if-input" style={{ flex: 1, padding: '12px' }}
                        value={d.roomNumber}
                        onChange={e => s(p => ({ ...p, roomNumber: e.target.value }))}
                        disabled={!d.wardId}
                    >
                        <option value="" disabled>{t('intake.select_bed')}</option>
                        {wards.find(w => w.id === d.wardId)?.rooms.map(r => (
                            <option key={r} value={r}>{r}</option>
                        ))}
                    </select>
                </div>
            </Field>

            <Field label={t("intake.notes")}>
                <textarea className="if-textarea" rows={4} placeholder={t("intake.notes_placeholder")}
                    value={d.notes} onChange={e => s(p => ({ ...p, notes: e.target.value }))} />
            </Field>

            <Field label={t("intake.family_lookup", "Family Lookup")}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                    <input
                        type="checkbox"
                        checked={d.publicOptIn || false}
                        onChange={e => s(p => ({ ...p, publicOptIn: e.target.checked }))}
                        style={{ width: 18, height: 18, accentColor: '#3fb950' }}
                    />
                    {t("intake.family_lookup_desc", "Allow family members to search for this patient on the local network (name, ward, and bed only — no medical data)")}
                </label>
            </Field>

            <Field label={t("intake.attachments")}>
                <div
                    className={`if-dropzone ${dragging ? 'dragging' : ''}`}
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
                    onClick={() => fileRef.current?.click()}
                >
                    <span>{t('intake.drop_files')}</span>
                    <span className="if-hint">{t('intake.file_types')}</span>
                    <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt"
                        style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
                </div>

                {d.attachments.length > 0 && (
                    <div className="if-attachments">
                        {d.attachments.map((f, i) => (
                            <div key={i} className="if-attachment">
                                {f.isImage
                                    ? <img src={f.url} alt={f.name} className="if-thumb" />
                                    : <div className="if-file-icon">{t('intake.file_label')}</div>}
                                <div className="if-attachment-info">
                                    <div className="if-attachment-name">{f.name}</div>
                                    <div className="if-hint">{(f.size / 1024).toFixed(1)} KB</div>
                                </div>
                                <button className="if-remove-btn" onClick={() => removeAttachment(i)}>x</button>
                            </div>
                        ))}
                    </div>
                )}
            </Field>
        </div>
    );
}

// --- Main Component ---

// Step labels are translated in the render below
const STEP_KEYS = ['intake.step_patient', 'intake.step_situation', 'intake.step_vitals', 'intake.step_findings', 'intake.step_plan', 'intake.step_assign'];

export default function PatientIntake() {
    const { t, tEn, lang } = useT();
    const [step, setStep] = useState(0);
    const [data, setData] = useState<PatientData>(INITIAL);
    const [finalized, setFinalized] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [savedId, setSavedId] = useState<string | null>(null);

    const plan = useMemo(() => buildPlan(data, t), [data, t]);

    const reset = useCallback(() => {
        setData({ ...INITIAL, injuryTime: now() });
        setStep(0); setFinalized(false); setSaveError(null); setSavedId(null);
    }, []);

    const handleFinalize = useCallback(async () => {
        setSaving(true); setSaveError(null);
        try {
            const id = patientStore.generatePatientId();

            // Normalize user-typed text to English if non-English
            let finalNotes = data.notes;
            const textsToPrecompute: string[] = [];

            if (lang !== 'en' && data.notes.trim()) {
                const { english } = await normalizeToEnglish(data.notes, lang);
                finalNotes = english;
                textsToPrecompute.push(english);
            }

            // Normalize custom allergy names (non-preset ones)
            const presetKeys = ['penicillin', 'sulfa', 'fluoroquinolone', 'nsaid', 'opioid'];
            const finalAllergies = [...data.allergies];
            if (lang !== 'en') {
                for (let i = 0; i < finalAllergies.length; i++) {
                    if (!presetKeys.includes(finalAllergies[i])) {
                        const { english } = await normalizeToEnglish(finalAllergies[i], lang);
                        textsToPrecompute.push(english);
                        finalAllergies[i] = english;
                    }
                }
            }

            // Rebuild plan in English for storage (canonical language)
            const enPlan = buildPlan(data, tEn);

            // Names are proper nouns — never translate them
            const finalName = data.name.trim() || 'Unknown';

            const record = {
                id,
                name: finalName,
                age: parseFloat(data.age) || 0,
                ageUnit: data.ageUnit,
                sex: data.sex,
                weight: r1(kg(data)),
                pregnant: data.pregnant,
                allergies: finalAllergies,
                admittedAt: new Date().toISOString(),
                injuryTime: data.injuryTime,
                mechanism: data.mechanism,
                regions: data.regions,
                wardId: data.wardId,
                roomNumber: data.roomNumber,
                status: 'active' as const,
                triage: { priority: enPlan.priority, priorityLabel: enPlan.priorityLabel, hemoClass: enPlan.hemoClass, gcsCat: enPlan.gcsCat },
                initialVitals: { hr: parseInt(data.hr) || 0, sbp: parseInt(data.sbp) || 0, rr: parseInt(data.rr) || 0, spo2: parseInt(data.spo2) || 0, gcs: parseInt(data.gcs) || 0, temp: parseFloat(data.temp) || 0, pain: data.pain },
                plan: { march: enPlan.march, drugs: enPlan.drugs, rx: enPlan.rx, recovery: enPlan.recovery, escalate: enPlan.escalate },
                events: [] as import('../types').PatientEvent[],
                notes: finalNotes,
                attachmentNames: (() => {
                    let firstImage = true;
                    return data.attachments.map((a: AttachmentFile) => {
                        if (firstImage && a.isImage) {
                            firstImage = false;
                            const ext = a.name.split('.').pop() || 'jpg';
                            return `photo.${ext}`;
                        }
                        return a.name;
                    });
                })(),
                nextOfKin: data.nextOfKin,
                spokenLanguage: data.spokenLanguage,
                findings: {
                    bleeding: data.bleeding, airway: data.airway, breathing: data.breathing,
                    tensionPneumo: data.tensionPneumo, openChest: data.openChest,
                    suspectedSpinal: data.suspectedSpinal, hypothermiaSigns: data.hypothermiaSigns,
                },
                publicOptIn: data.publicOptIn || false,
            };
            const saved = await patientStore.createPatient(record);
            let photoSet = false;
            for (const att of data.attachments) {
                try {
                    const blob = await fetch(att.url).then(r => r.blob());
                    // Rename first image to 'photo.ext' so ward map shows it as profile pic
                    let uploadName = att.name;
                    if (!photoSet && att.isImage) {
                        const ext = att.name.split('.').pop() || 'jpg';
                        uploadName = `photo.${ext}`;
                        photoSet = true;
                    }
                    await patientStore.uploadAttachment(saved.id, new File([blob], uploadName, { type: att.type }));
                } catch { /* non-fatal */ }
            }

            // Precompute user-generated text (notes, allergies) to all locales in background
            if (textsToPrecompute.length > 0) {
                precomputeAllLocales(textsToPrecompute, saved.id).catch(() => { /* non-fatal */ });
            }

            setSavedId(saved.id);
            setFinalized(true);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Save failed - is the API running on port 7778?');
        } finally {
            setSaving(false);
        }
    }, [data, lang, tEn]);

    return (
        <div className="intake-wrapper">
            <div className="intake-steps">
                {STEP_KEYS.map((key, i) => (
                    <div key={i} className={`intake-step ${i === step ? 'active' : i < step ? 'done' : ''}`}
                        onClick={() => i < step && setStep(i)}>
                        <div className="intake-step-num">{i < step ? '✓' : i + 1}</div>
                        <div className="intake-step-label">{t(key)}</div>
                        {i < STEP_KEYS.length - 1 && <div className="intake-step-line" />}
                    </div>
                ))}
            </div>
            <div className="intake-body">
                {step === 0 && <Step1 d={data} s={setData} />}
                {step === 1 && <Step2 d={data} s={setData} />}
                {step === 2 && <Step3 d={data} s={setData} />}
                {step === 3 && <Step4 d={data} s={setData} />}
                {step === 4 && <PlanOutput plan={plan} d={data} />}
                {step === 5 && (
                    <>
                        <Step6 d={data} s={setData} />
                        {saveError && <div className="if-drug-warning" style={{ marginTop: 16 }}>{saveError}</div>}
                        {finalized && savedId && (
                            <div className="if-finalized" style={{ marginTop: 20 }}>
                                <div style={{ color: '#3fb950', fontWeight: 600, marginBottom: 8 }}>{t('intake.record_saved')}</div>
                                <div className="if-hint">ID: {savedId}</div>
                                <div className="if-hint">{t('intake.bed_label', 'Bed')} {data.roomNumber || t('intake.unknown')}</div>
                                <button className="intake-next-btn" style={{ marginTop: 12, background: 'var(--surface2)', color: 'var(--text)' }} onClick={reset}>{t('intake.new_patient')}</button>
                            </div>
                        )}
                    </>
                )}
            </div>
            {!finalized && (
                <div className="intake-nav">
                    <button className="intake-back-btn" onClick={() => setStep(s => Math.max(0, s - 1))} style={{ visibility: step > 0 ? 'visible' : 'hidden' }}>{t('intake.back')}</button>
                    <div style={{ flex: 1, textAlign: 'center', color: 'var(--text-faint)', fontSize: 11 }}>{t('intake.step_label')} {step + 1} {t('intake.step_of')} {STEP_KEYS.length}</div>
                    {step < STEP_KEYS.length - 1
                        ? <button className="intake-next-btn" onClick={() => setStep(s => Math.min(STEP_KEYS.length - 1, s + 1))}>{step === 3 ? t('intake.generate_plan') : t('intake.next')}</button>
                        : <button className="intake-next-btn" style={{ background: '#1a4a1a', color: '#3fb950', minWidth: 140 }} onClick={handleFinalize} disabled={saving}>{saving ? t('inv.saving') : t('intake.finalize')}</button>
                    }
                </div>
            )}
        </div>
    );
}
