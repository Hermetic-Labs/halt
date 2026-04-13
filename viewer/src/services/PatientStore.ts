/**
 * PatientStore — Dual-path data layer (Tauri native ↔ Python HTTP).
 *
 * When running inside Tauri, calls go directly to Rust via `invoke()`.
 * Otherwise, falls back to the Python FastAPI backend on /api.
 *
 * Every function preserves the exact same signature and return type
 * as the original HTTP-only version — no frontend changes needed.
 */

import type { PatientRecord, PatientSummary, PatientEvent, WardConfig, InventoryItem, InventoryLocation } from '../types';
import { api, apiMutate, isNative, nativeCall, BASE } from './api';

// ── Patients ────────────────────────────────────────────────────────────────

export async function listPatients(status?: string): Promise<PatientSummary[]> {
    const qs = status ? `?status=${status}` : '';
    return api<PatientSummary[]>('list_patients', `/patients${qs}`, { status });
}

export async function listAllPatientsFull(status?: string): Promise<PatientRecord[]> {
    let qs = '?full=true';
    if (status) qs += `&status=${status}`;
    return api<PatientRecord[]>('list_patients', `/patients${qs}`, { status, full: true });
}

export async function getPatient(id: string): Promise<PatientRecord> {
    return api<PatientRecord>('get_patient', `/patients/${id}`, { patient_id: id });
}

export async function createPatient(record: PatientRecord): Promise<PatientRecord> {
    return apiMutate<PatientRecord>('create_patient', '/patients', { record }, {
        method: 'POST',
        body: JSON.stringify(record),
    });
}

export async function updatePatient(id: string, record: PatientRecord): Promise<PatientRecord> {
    return apiMutate<PatientRecord>('update_patient', `/patients/${id}`, { patient_id: id, record }, {
        method: 'PUT',
        body: JSON.stringify(record),
    });
}

export async function addEvent(patientId: string, event: PatientEvent): Promise<PatientRecord> {
    return apiMutate<PatientRecord>('add_patient_event', `/patients/${patientId}/events`, {
        patient_id: patientId, event,
    }, {
        method: 'POST',
        body: JSON.stringify(event),
    });
}

export async function updateStatus(patientId: string, status: string): Promise<void> {
    await apiMutate('update_patient_status', `/patients/${patientId}/status?status=${status}`, {
        patient_id: patientId, status,
    }, { method: 'PATCH' });
}

/** Hard purge — removes the patient JSON + attachments. No trace remains. */
export async function purgePatient(patientId: string): Promise<void> {
    await apiMutate('delete_patient', `/patients/${patientId}`, {
        patient_id: patientId,
    }, { method: 'DELETE' });
}

export async function uploadAttachment(patientId: string, file: File): Promise<{ filename: string }> {
    if (isNative) {
        // Convert File to byte array for Tauri invoke
        const buf = await file.arrayBuffer();
        const data = Array.from(new Uint8Array(buf));
        const result = await nativeCall<{ filename: string }>('upload_attachment', {
            patient_id: patientId,
            filename: file.name,
            data,
        });
        if (result) return result;
    }
    // HTTP fallback with FormData
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/patients/${patientId}/attachments`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
    return res.json();
}

export function attachmentUrl(patientId: string, filename: string): string {
    // In native mode, attachments are served via invoke (get_attachment)
    // but for <img> tags we still need a URL — use the HTTP path
    return `${BASE}/patients/${patientId}/attachments/${encodeURIComponent(filename)}`;
}

// ── Ward ────────────────────────────────────────────────────────────────────

export async function listWards(): Promise<WardConfig[]> {
    return api<WardConfig[]>('list_wards', '/wards');
}

export async function getWardConfig(id: string = 'ward-1'): Promise<WardConfig> {
    return api<WardConfig>('get_ward_config', `/ward/config?id=${encodeURIComponent(id)}`, { id });
}

export async function saveWardConfig(config: WardConfig): Promise<WardConfig> {
    return apiMutate<WardConfig>('save_ward_config', `/ward/config?id=${encodeURIComponent(config.id)}`, {
        config, id: config.id,
    }, {
        method: 'PUT',
        body: JSON.stringify(config),
    });
}

export async function deleteWard(id: string): Promise<void> {
    await apiMutate('delete_ward', `/ward/${encodeURIComponent(id)}`, { id }, {
        method: 'DELETE',
    });
}

// ── Inventory ───────────────────────────────────────────────────────────────

export async function getInventory(): Promise<InventoryItem[]> {
    return api<InventoryItem[]>('get_inventory', '/inventory');
}

export async function getInventoryLocations(): Promise<InventoryLocation[]> {
    return api<InventoryLocation[]>('get_inventory_locations', '/inventory/locations');
}

export async function addInventoryLocation(loc: InventoryLocation): Promise<InventoryLocation> {
    return apiMutate<InventoryLocation>('add_inventory_location', '/inventory/locations', { loc }, {
        method: 'POST',
        body: JSON.stringify(loc),
    });
}

export async function addInventoryItem(item: InventoryItem): Promise<InventoryItem> {
    return apiMutate<InventoryItem>('add_inventory_item', '/inventory', { item }, {
        method: 'POST',
        body: JSON.stringify(item),
    });
}

export async function consumeInventory(id: string, amount: number): Promise<InventoryItem> {
    const who = localStorage.getItem('eve-mesh-name') || 'unknown';
    return apiMutate<InventoryItem>('consume_inventory', `/inventory/${id}/consume?modified_by=${encodeURIComponent(who)}`, {
        id, restock: { amount }, modified_by: who,
    }, {
        method: 'PATCH',
        body: JSON.stringify({ amount }),
    });
}

export async function restockInventory(id: string, amount: number): Promise<InventoryItem> {
    const who = localStorage.getItem('eve-mesh-name') || 'unknown';
    return apiMutate<InventoryItem>('restock_inventory', `/inventory/${id}/restock?modified_by=${encodeURIComponent(who)}`, {
        id, restock: { amount }, modified_by: who,
    }, {
        method: 'PATCH',
        body: JSON.stringify({ amount }),
    });
}

export async function updateInventoryLocation(id: string, loc: InventoryLocation): Promise<InventoryLocation> {
    return apiMutate<InventoryLocation>('update_inventory_location', `/inventory/locations/${encodeURIComponent(id)}`, {
        id, loc,
    }, {
        method: 'PUT',
        body: JSON.stringify(loc),
    });
}

export async function deleteInventoryLocation(id: string): Promise<void> {
    await apiMutate('delete_inventory_location', `/inventory/locations/${encodeURIComponent(id)}`, { id }, {
        method: 'DELETE',
    });
}

export async function deleteInventoryItem(id: string): Promise<void> {
    await apiMutate('delete_inventory_item', `/inventory/${encodeURIComponent(id)}`, { id }, {
        method: 'DELETE',
    });
}

// ── Health ──────────────────────────────────────────────────────────────────

export async function checkHealth(): Promise<boolean> {
    try {
        if (isNative) {
            const result = await nativeCall<{ ready: boolean }>('get_health');
            if (result) return result.ready;
        }
        await fetch(`${BASE}/health`);
        return true;
    } catch {
        return false;
    }
}

// ── Activity Log ────────────────────────────────────────────────────────────

export interface ActivityEntry { who: string; action: string; target: string; timestamp: string; action_type?: string; qty?: number; }

export async function getInventoryActivity(limit = 50): Promise<ActivityEntry[]> {
    return api<ActivityEntry[]>('get_inventory_activity', `/inventory/activity?limit=${limit}`, { limit });
}

// ── ID gen ──────────────────────────────────────────────────────────────────

export function generatePatientId(): string {
    const now = new Date();
    const pad = (n: number, d = 2) => String(n).padStart(d, '0');
    return `PAT-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function generateEventId(): string {
    return `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
