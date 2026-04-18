// ─── Data shapes matching the triage schema spec ───────────────────

export type Section =
    | 'assessments'
    | 'procedures'
    | 'pharmacology'
    | 'protocols'
    | 'special_populations';



export interface Modifier {
    dose?: string;
    note?: string;
}

export interface Modifiers {
    pediatric?: Modifier;
    obstetric?: Modifier;
}

export interface ScoringOption {
    score?: number;
    code?: string;
    label?: string;
    description?: string;
}

export interface ScoringDomain {
    domain?: string;
    options?: ScoringOption[];
    range?: [number, number];
    code?: string;
    label?: string;
    triage?: string;
    class?: string;
    blood_loss_ml?: string;
    blood_loss_pct?: string;
    hr?: string;
    sbp?: string;
    rr?: string;
    mental_status?: string;
    treatment?: string;
    color?: string;
    description?: string;
}

export interface Assessment {
    id: string;
    name: string;
    category: string;
    description: string;
    instructions?: string;
    scoring?: ScoringDomain[];
    interpretation?: ScoringDomain[];
    categories?: ScoringDomain[];
    modifiers?: Modifiers;
    source?: string;
}

export interface Procedure {
    id: string;
    name: string;
    category: string;
    skill_level?: string;
    time_estimate?: string;
    description: string;
    equipment?: string[];
    steps?: string[];
    warnings?: string[];
    follows?: string[];
    precedes?: string[];
    modifiers?: Modifiers;
    source?: string;
}

export interface Drug {
    id: string;
    name: string;
    category: string;
    rxnorm?: string;
    brand_names?: string[];
    description: string;
    indications?: string[];
    dose?: string;
    route?: string[];
    window?: string;
    contraindications?: string[];
    warnings?: string[];
    regional_names?: Record<string, string>;
    modifiers?: Modifiers;
    source?: string;
}




export interface Protocol {
    id: string;
    name: string;
    description: string;
    source?: string;
}

// ─── Patient Record (mirrors FastAPI models) ────────────────────────

export type PatientStatus = 'active' | 'stable' | 'critical' | 'transferred' | 'discharged';

export interface PatientEvent {
    id: string;
    timestamp: string;
    type: 'vitals' | 'medication' | 'procedure' | 'note' | 'status_change';
    summary: string;
    data?: Record<string, unknown>;
}

export interface NoteEntry {
    id: string;
    text: string;
    author: string;
    timestamp: string;
}

export interface PatientRecord {
    id: string;
    name: string;
    age: number;
    ageUnit: 'years' | 'months';
    sex: 'M' | 'F' | 'U';
    weight: number;
    pregnant: boolean;
    allergies: string[];
    admittedAt: string;
    injuryTime: string;
    mechanism: string;
    regions: string[];
    wardId: string;
    roomNumber: string;
    status: PatientStatus;
    triage: { priority: string; priorityLabel: string; hemoClass: string; gcsCat: string };
    initialVitals: { hr: number; sbp: number; rr: number; spo2: number; gcs: number; temp: number; pain: number };
    plan: {
        march: Array<{ phase: string; label: string; actions: string[] }>;
        drugs: Array<{ name: string; dose: string; route: string; regimen: string; warning?: string }>;
        rx: string[];
        recovery: string[];
        escalate: string[];
    };
    events: PatientEvent[];
    notes: string;
    noteEntries?: NoteEntry[];  // structured notes with author + date
    attachmentNames: string[];
    nextOfKin: string;
    spokenLanguage: string;
    findings?: {
        bleeding: string; airway: string; breathing: string;
        tensionPneumo: boolean; openChest: boolean; suspectedSpinal: boolean; hypothermiaSigns: boolean;
    };
    i18n?: Record<string, Record<string, string>>; // lang → englishText → translatedText
    publicOptIn?: boolean; // Allow family lookup on local network
}

export interface PatientSummary {
    id: string; name: string; age: number; sex: string;
    wardId: string; roomNumber: string; status: PatientStatus;
    priority: string; admittedAt: string; mechanism: string;
    allergies: string[];
}

export interface WardConfig {
    id: string;
    name: string;
    columns: number;
    rooms: string[];
}

export interface InventoryItem {
    id: string;
    name: string;
    quantity: number;
    minThreshold: number;
    category: string;
    alternatives: string[];
    locationId: string;
}

export interface InventoryLocation {
    id: string;
    name: string;
}

export interface InventoryRestock {
    id: string;
    itemId: string;
    locationId: string;
    quantity: number;
    timestamp: string;
    restockedBy: string;
}

// ─── Site Map / Field Map ────────────────────────────────────────────

export type LineStyle = 'straight' | 'curve-left' | 'curve-right' | 'dotted' | 'ascending' | 'descending';

export interface FieldNode {
    id: string;
    label: string;
    x: number;   // 0–100 percentage
    y: number;
    type: 'base' | 'pivot' | 'ward' | 'inventory';
    style?: LineStyle;
}

export const SKILL_OPTIONS = [
    'First Aid', 'CPR', 'IV Lines', 'Splinting', 'Airway', 'Sutures',
    'Triage', 'Medication', 'Wound Care', 'Childbirth', 'Vitals',
    'Radio/Comms', 'Translation', 'Logistics', 'Security', 'Search & Rescue',
];
