/**
 * PatientStore — HTTP client for the FastAPI backend.
 * Base URL is /api (proxied by Vite to http://127.0.0.1:7777).
 */

import type { PatientRecord, PatientSummary, PatientEvent, WardConfig, InventoryItem, InventoryLocation } from '../types';

const BASE = '/api';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? `API error ${res.status}`);
    }
    return res.json() as Promise<T>;
}

// ── Patients ────────────────────────────────────────────────────────────────

export async function listPatients(status?: string): Promise<PatientSummary[]> {
    const qs = status ? `?status=${status}` : '';
    return api<PatientSummary[]>(`/patients${qs}`);
}

export async function listAllPatientsFull(status?: string): Promise<PatientRecord[]> {
    let qs = '?full=true';
    if (status) qs += `&status=${status}`;
    return api<PatientRecord[]>(`/patients${qs}`);
}

export async function getPatient(id: string): Promise<PatientRecord> {
    return api<PatientRecord>(`/patients/${id}`);
}

export async function createPatient(record: PatientRecord): Promise<PatientRecord> {
    return api<PatientRecord>('/patients', {
        method: 'POST',
        body: JSON.stringify(record),
    });
}

export async function updatePatient(id: string, record: PatientRecord): Promise<PatientRecord> {
    return api<PatientRecord>(`/patients/${id}`, {
        method: 'PUT',
        body: JSON.stringify(record),
    });
}

export async function addEvent(patientId: string, event: PatientEvent): Promise<PatientRecord> {
    return api<PatientRecord>(`/patients/${patientId}/events`, {
        method: 'POST',
        body: JSON.stringify(event),
    });
}

export async function updateStatus(patientId: string, status: string): Promise<void> {
    await api(`/patients/${patientId}/status?status=${status}`, { method: 'PATCH' });
}

export async function uploadAttachment(patientId: string, file: File): Promise<{ filename: string }> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/patients/${patientId}/attachments`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
    return res.json();
}

export function attachmentUrl(patientId: string, filename: string): string {
    return `${BASE}/patients/${patientId}/attachments/${encodeURIComponent(filename)}`;
}

// ── Ward ────────────────────────────────────────────────────────────────────

export async function listWards(): Promise<WardConfig[]> {
    return api<WardConfig[]>('/wards');
}

export async function getWardConfig(id: string = 'ward-1'): Promise<WardConfig> {
    return api<WardConfig>(`/ward/config?id=${encodeURIComponent(id)}`);
}

export async function saveWardConfig(config: WardConfig): Promise<WardConfig> {
    return api<WardConfig>(`/ward/config?id=${encodeURIComponent(config.id)}`, {
        method: 'PUT',
        body: JSON.stringify(config),
    });
}

export async function deleteWard(id: string): Promise<void> {
    await api<void>(`/ward/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}

// ── Inventory ───────────────────────────────────────────────────────────────

export async function getInventory(): Promise<InventoryItem[]> {
    return api<InventoryItem[]>('/inventory');
}

export async function getInventoryLocations(): Promise<InventoryLocation[]> {
    return api<InventoryLocation[]>('/inventory/locations');
}

export async function addInventoryLocation(loc: InventoryLocation): Promise<InventoryLocation> {
    return api<InventoryLocation>('/inventory/locations', {
        method: 'POST',
        body: JSON.stringify(loc),
    });
}

export async function addInventoryItem(item: InventoryItem): Promise<InventoryItem> {
    return api<InventoryItem>('/inventory', {
        method: 'POST',
        body: JSON.stringify(item),
    });
}

export async function consumeInventory(id: string, amount: number): Promise<InventoryItem> {
    const who = encodeURIComponent(localStorage.getItem('eve-mesh-name') || 'unknown');
    return api<InventoryItem>(`/inventory/${id}/consume?modified_by=${who}`, {
        method: 'PATCH',
        body: JSON.stringify({ amount }),
    });
}

export async function restockInventory(id: string, amount: number): Promise<InventoryItem> {
    const who = encodeURIComponent(localStorage.getItem('eve-mesh-name') || 'unknown');
    return api<InventoryItem>(`/inventory/${id}/restock?modified_by=${who}`, {
        method: 'PATCH',
        body: JSON.stringify({ amount }),
    });
}

// ── Health ──────────────────────────────────────────────────────────────────

export async function checkHealth(): Promise<boolean> {
    try {
        await fetch(`${BASE}/health`);
        return true;
    } catch {
        return false;
    }
}

// ── Inventory Mgt ───────────────────────────────────────────────────────────

export async function updateInventoryLocation(id: string, loc: InventoryLocation): Promise<InventoryLocation> {
    return api<InventoryLocation>(`/inventory/locations/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(loc),
    });
}

export async function deleteInventoryLocation(id: string): Promise<void> {
    await api<void>(`/inventory/locations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}

export async function deleteInventoryItem(id: string): Promise<void> {
    await api<void>(`/inventory/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}
// ── Activity Log ────────────────────────────────────────────────────────────

export interface ActivityEntry { who: string; action: string; target: string; timestamp: string; }

export async function getInventoryActivity(limit = 50): Promise<ActivityEntry[]> {
    return api<ActivityEntry[]>(`/inventory/activity?limit=${limit}`);
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
