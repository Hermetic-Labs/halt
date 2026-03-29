/**
 * planEngine.ts — Treatment plan generator (MARCH protocol rules engine)
 *
 * Extracted so both PatientIntake and WardMap can call buildPlan/rebuildPlanFromRecord.
 * Every string uses t() keys from bp.* — so plan text switches language statically.
 */

import type { PatientRecord } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

type AllergyKey = 'penicillin' | 'sulfa' | 'fluoroquinolone' | 'nsaid' | 'opioid' | string;
type Mechanism = 'penetrating' | 'blunt' | 'medical' | 'environmental' | 'obstetric';
type BleedingStatus = 'none' | 'controlled' | 'uncontrolled';
type AirwayStatus = 'patent' | 'compromised' | 'obstructed';
type BreathingStatus = 'normal' | 'labored' | 'diminished-one' | 'absent';
export type HemoClass = 'I' | 'II' | 'III' | 'IV' | '--';
export type Priority = 'T1' | 'T2' | 'T3' | 'T4';

export interface DrugOrder { name: string; dose: string; route: string; timing: string; regimen: string; warning?: string; }
interface MarchItem { phase: 'M' | 'A' | 'R' | 'C' | 'H'; label: string; actions: string[]; }

export interface PatientData {
    name: string;
    age: string; ageUnit: 'years' | 'months';
    sex: 'M' | 'F' | 'U'; weight: string; weightUnit: 'kg' | 'lbs';
    pregnant: boolean; allergies: string[];
    injuryTime: string; mechanism: Mechanism | ''; regions: string[];
    hr: string; sbp: string; rr: string; spo2: string;
    gcs: string; temp: string; tempUnit: 'C' | 'F'; pain: number;
    bleeding: BleedingStatus; airway: AirwayStatus; breathing: BreathingStatus;
    tensionPneumo: boolean; openChest: boolean; suspectedSpinal: boolean; hypothermiaSigns: boolean;
    wardId: string; roomNumber: string; notes: string;
    attachments: Array<{ name: string; type: string; size: number; url: string; isImage: boolean }>;
    nextOfKin: string; spokenLanguage: string;
    // Intake-only fields (not persisted to patient record)
    photoPreview?: string;
    photoFile?: File;
    publicOptIn?: boolean;
}

export interface Plan {
    priority: Priority; priorityLabel: string;
    si: number | null; hemoClass: HemoClass; gcsCat: string;
    march: MarchItem[]; urgent: string[]; drugs: DrugOrder[];
    monitoring: string[]; rx: string[]; recovery: string[];
    escalate: string[]; txaDeadline?: string;
}

export type TFunc = (key: string, paramsOrFallback?: string | Record<string, string>) => string;

// ── Helpers ──────────────────────────────────────────────────────────────────

export const kg = (d: PatientData) => { const w = parseFloat(d.weight) || 70; return d.weightUnit === 'lbs' ? w * 0.4536 : w; };
export const isPed = (d: PatientData) => { const a = parseFloat(d.age); return d.ageUnit === 'months' ? a < 144 : a < 12 || kg(d) < 40; };
const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);
const hasA = (d: PatientData, k: AllergyKey) => d.allergies.includes(k);
const timeAdd = (t: string, mins: number) => {
    const [h, m] = t.split(':').map(Number);
    const tot = h * 60 + m + mins;
    return `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
};
export const hemoClass = (hr: number, sbp: number, rr: number, gcs: number): HemoClass => {
    if (!hr || !sbp) return '--';
    if (hr >= 140 || sbp < 70 || gcs <= 8) return 'IV';
    if (hr >= 120 || sbp < 90 || rr >= 30) return 'III';
    if (hr >= 100 || rr >= 20) return 'II';
    return 'I';
};

// ── Build Plan ───────────────────────────────────────────────────────────────

export function buildPlan(d: PatientData, t: TFunc): Plan {
    const w = kg(d); const ped = isPed(d);
    const hr = parseInt(d.hr) || 0, sbp = parseInt(d.sbp) || 0;
    const rr = parseInt(d.rr) || 0, spo2 = parseInt(d.spo2) || 99;
    const gcs = parseInt(d.gcs) || 15;
    const si = sbp > 0 && hr > 0 ? r1(hr / sbp) : null;
    const hc: HemoClass = d.bleeding === 'none' ? '--' : hemoClass(hr, sbp, rr, gcs);
    const gcsCat = gcs >= 13 ? t('bp.gcs_mild') : gcs >= 9 ? t('bp.gcs_moderate') : gcs >= 3 ? t('bp.gcs_severe') : t('bp.gcs_unknown');

    let priority: Priority = 'T3', priorityLabel = t('bp.minimal');
    if (d.airway === 'obstructed' || hc === 'IV' || spo2 < 85 || gcs <= 8 || (d.tensionPneumo && hr > 0)) {
        priority = 'T1'; priorityLabel = t('bp.immediate');
    } else if (hc === 'III' || (spo2 >= 85 && spo2 < 93) || gcs <= 12 || d.airway === 'compromised' || d.openChest || d.bleeding === 'uncontrolled') {
        priority = 'T2'; priorityLabel = t('bp.delayed');
    } else if (hc === 'I' || hc === 'II') {
        priority = 'T3'; priorityLabel = t('bp.minimal_stable');
    }
    if (gcs === 3 && hr === 0) { priority = 'T4'; priorityLabel = t('bp.expectant'); }

    const txaOk = (hc === 'II' || hc === 'III' || hc === 'IV') && d.bleeding !== 'none';
    const txaDeadline = txaOk && d.injuryTime ? timeAdd(d.injuryTime, 180) : undefined;

    // MARCH
    const march: MarchItem[] = [];

    const extrem = d.regions.some(r => r.includes('Arm') || r.includes('Leg'));
    const mA: string[] = [];
    if (d.bleeding === 'uncontrolled') {
        mA.push(extrem ? t('bp.m_tourniquet') : t('bp.m_pack_wound'));
        if (txaOk) {
            const dose = ped ? `${Math.min(r0(15 * w), 1000)}mg` : '1g';
            mA.push(t('bp.m_txa_push', { dose, deadline: txaDeadline || '' }));
        }
    } else if (d.bleeding === 'controlled') {
        mA.push(t('bp.m_controlled'));
        if (txaOk) mA.push(t('bp.m_txa_controlled', { time: d.injuryTime || t('bp.unknown'), deadline: txaDeadline || '+3hr' }));
    } else {
        mA.push(t('bp.m_no_hemorrhage'));
    }
    march.push({ phase: 'M', label: t('bp.phase_m'), actions: mA });

    const aA: string[] = [];
    if (d.airway === 'obstructed') {
        aA.push(t('bp.a_obstructed'));
        aA.push(t('bp.a_cric'));
    } else if (d.airway === 'compromised') {
        aA.push(t('bp.a_npa'));
    } else {
        aA.push(t('bp.a_patent'));
    }
    if (gcs <= 8) aA.push(t('bp.a_gcs_low'));
    march.push({ phase: 'A', label: t('bp.phase_a'), actions: aA });

    const rA: string[] = [];
    if (d.breathing === 'absent') {
        rA.push(t('bp.r_absent'));
    } else if (d.tensionPneumo) {
        rA.push(t('bp.r_tension'));
        rA.push(t('bp.r_tension_repeat'));
    } else if (d.openChest) {
        rA.push(t('bp.r_open_chest'));
        rA.push(t('bp.r_open_chest_monitor'));
    } else if (d.breathing === 'diminished-one') {
        rA.push(t('bp.r_diminished', { spo2: String(spo2) }));
    } else {
        rA.push(t('bp.r_effective', { spo2: String(spo2 || '--') }));
    }
    march.push({ phase: 'R', label: t('bp.phase_r'), actions: rA });

    const cA: string[] = [];
    if (hc === 'III' || hc === 'IV') {
        cA.push(t('bp.c_severe'));
        if (si !== null) cA.push(t('bp.c_shock_index', { si: String(si), sev: si > 1.4 ? t('bp.severe_tag') : si > 1.0 ? t('bp.moderate_tag') : '' }));
    } else if (hc === 'II') {
        cA.push(t('bp.c_moderate'));
    } else {
        cA.push(t('bp.c_stable'));
    }
    march.push({ phase: 'C', label: t('bp.phase_c'), actions: cA });

    const hA: string[] = [];
    if (d.hypothermiaSigns) {
        hA.push(t('bp.h_active'));
        hA.push(t('bp.h_gentle'));
    } else {
        hA.push(t('bp.h_prevent'));
    }
    march.push({ phase: 'H', label: t('bp.phase_h'), actions: hA });

    // Urgent adjuncts
    const urgent: string[] = [];

    if ((d.bleeding !== 'none' || d.regions.length > 0)) {
        if (!hasA(d, 'penicillin')) {
            if (hc === 'III' || hc === 'IV') {
                const dose = ped ? `${Math.min(r0(30 * w), 2000)}mg` : '2g';
                urgent.push(t('bp.u_cefazolin', { dose }));
            } else {
                const dose = ped ? `${r0(25 * w)}mg` : '500mg';
                urgent.push(t('bp.u_amoxicillin', { dose }));
            }
        } else if (d.pregnant) {
            urgent.push(t('bp.u_amox_pregnant'));
        } else {
            urgent.push(t('bp.u_doxycycline'));
        }
    }

    if (d.pain >= 4) {
        const kIV = r1(0.2 * w), kIM = r1(0.5 * w);
        urgent.push(t('bp.u_ketamine', { kIV: String(kIV), kIM: String(kIM) }));
        const ondDose = ped ? `${r1(0.1 * w)}mg` : '4mg';
        urgent.push(t('bp.u_ondansetron', { dose: ondDose }));
    }

    if (d.suspectedSpinal) urgent.push(t('bp.u_spinal'));
    if (d.pregnant) {
        urgent.push(t('bp.u_lateral'));
        if (d.bleeding !== 'none') urgent.push(t('bp.u_oxytocin'));
    }

    // Drugs
    const drugs: DrugOrder[] = [];
    if (txaOk) {
        const dose = ped ? `${Math.min(r0(15 * w), 1000)}mg` : '1g';
        drugs.push({
            name: t('bp.drug_txa_name'),
            dose,
            route: 'IV/IO',
            timing: txaDeadline ? t('bp.drug_txa_timing_deadline', { deadline: txaDeadline }) : t('bp.drug_txa_timing_now'),
            regimen: t('bp.drug_txa_regimen', { dose }),
            warning: t('bp.drug_txa_warning', { deadline: txaDeadline || '+3hr' }),
        });
    }
    if (d.pain >= 4) {
        const ivD = `${r1(0.2 * w)}mg`, imD = `${r1(0.5 * w)}mg`;
        drugs.push({
            name: t('bp.drug_ketamine_name'),
            dose: `${ivD} IV / ${imD} IM`,
            route: 'IV / IM',
            timing: t('bp.drug_ketamine_timing'),
            regimen: t('bp.drug_ketamine_regimen', { dose: ivD }),
            warning: t('bp.drug_ketamine_warning'),
        });
        const ondDose = ped ? `${r1(0.1 * w)}mg` : '4mg';
        drugs.push({
            name: t('bp.drug_ondansetron_name'),
            dose: ondDose,
            route: 'IV / ODT',
            timing: t('bp.drug_ondansetron_timing'),
            regimen: t('bp.drug_ondansetron_regimen', { dose: ondDose }),
        });
    }

    // Monitoring
    const freq = priority === 'T1' ? '5' : priority === 'T2' ? '10' : '15';
    const monitoring = [
        t('bp.mon_vitals', { freq }),
        t('bp.mon_gcs'),
        d.bleeding !== 'none' ? t('bp.mon_dressings') : t('bp.mon_internal'),
        t('bp.mon_urine'),
        t('bp.mon_temp'),
    ];
    if (txaOk) monitoring.push(t('bp.mon_txa', { deadline: txaDeadline ? timeAdd(txaDeadline, 0) : t('bp.end_of_care') }));
    if (d.tensionPneumo) monitoring.push(t('bp.mon_decomp'));

    // RX
    const rx: string[] = [];
    let rxNum = 1;
    if (txaOk) { const dose = ped ? Math.min(r0(15 * w), 1000) + 'mg' : '1g'; rx.push(t('bp.rx_txa', { n: String(rxNum++), dose })); }
    if (!hasA(d, 'penicillin') && (hc === 'III' || hc === 'IV')) {
        const dose = ped ? Math.min(r0(30 * w), 2000) + 'mg' : '2g';
        rx.push(t('bp.rx_cefazolin', { n: String(rxNum++), dose }));
    } else if (!hasA(d, 'penicillin')) {
        const dose = ped ? r0(25 * w) + 'mg' : '500mg';
        rx.push(t('bp.rx_amoxicillin', { n: String(rxNum++), dose }));
    } else if (!d.pregnant) {
        rx.push(t('bp.rx_doxycycline', { n: String(rxNum++) }));
    }
    if (d.pain >= 4) {
        rx.push(t('bp.rx_ketamine', { n: String(rxNum++), dose: `${r1(0.2 * w)}mg` }));
        const ondDose = ped ? r1(0.1 * w) + 'mg' : '4mg';
        rx.push(t('bp.rx_ondansetron', { n: String(rxNum++), dose: ondDose }));
    }
    if (d.pregnant && d.bleeding !== 'none') {
        rx.push(t('bp.rx_oxytocin', { n: String(rxNum++) }));
    }

    // Recovery
    const recovery: string[] = [];
    if (hc === 'III' || hc === 'IV') {
        recovery.push(t('bp.rec_dcs'));
        recovery.push(t('bp.rec_triad'));
        recovery.push(t('bp.rec_los_long'));
    } else if (hc === 'II') {
        recovery.push(t('bp.rec_significant'));
    } else {
        recovery.push(t('bp.rec_stable'));
    }
    if (gcs <= 12 && gcs > 3) recovery.push(t('bp.rec_tbi', { gcsCat }));
    if (d.tensionPneumo || d.openChest || d.regions.some(r => r.includes('Chest'))) {
        recovery.push(t('bp.rec_chest'));
    }
    if (d.pregnant) recovery.push(t('bp.rec_obstetric'));

    // Escalate
    const escalate = [
        t('bp.esc_sbp'),
        t('bp.esc_gcs'),
        t('bp.esc_spo2'),
        t('bp.esc_hr'),
        t('bp.esc_tq'),
        t('bp.esc_rr'),
        d.tensionPneumo ? t('bp.esc_decomp') : t('bp.esc_breath'),
    ];
    if (txaOk) escalate.push(t('bp.esc_txa', { deadline: txaDeadline || '3hr' }));

    return { priority, priorityLabel, si, hemoClass: hc, gcsCat, march, urgent, drugs, monitoring, rx, recovery, escalate, txaDeadline };
}

// ── Rebuild from record ──────────────────────────────────────────────────────

/** Re-run buildPlan from a stored PatientRecord + active t(). */
export function rebuildPlanFromRecord(record: PatientRecord, t: TFunc): Plan {
    const f = record.findings || { bleeding: 'none', airway: 'patent', breathing: 'normal', tensionPneumo: false, openChest: false, suspectedSpinal: false, hypothermiaSigns: false };
    const v = record.initialVitals;
    const d: PatientData = {
        name: record.name, age: String(record.age), ageUnit: record.ageUnit || 'years',
        sex: record.sex as 'M'|'F'|'U', weight: String(record.weight), weightUnit: 'kg',
        pregnant: record.pregnant, allergies: record.allergies,
        injuryTime: record.injuryTime, mechanism: (record.mechanism || '') as Mechanism | '',
        regions: record.regions,
        hr: String(v.hr), sbp: String(v.sbp), rr: String(v.rr), spo2: String(v.spo2),
        gcs: String(v.gcs), temp: String(v.temp), tempUnit: 'C', pain: v.pain || 0,
        bleeding: f.bleeding as BleedingStatus, airway: f.airway as AirwayStatus, breathing: f.breathing as BreathingStatus,
        tensionPneumo: f.tensionPneumo, openChest: f.openChest, suspectedSpinal: f.suspectedSpinal, hypothermiaSigns: f.hypothermiaSigns,
        wardId: record.wardId, roomNumber: record.roomNumber, notes: record.notes || '',
        attachments: [], nextOfKin: record.nextOfKin || '', spokenLanguage: record.spokenLanguage || 'English',
    };
    return buildPlan(d, t);
}
