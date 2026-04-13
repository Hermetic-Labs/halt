/**
 * api.ts — Dual-path adapter for Tauri native ↔ Python HTTP fallback.
 *
 * Detection logic:
 *   - If `window.__TAURI_INTERNALS__` exists → we're in a Tauri webview,
 *     use `invoke()` for direct Rust calls (zero network overhead).
 *   - Otherwise → fall back to `fetch()` against the Python FastAPI backend.
 *
 * This lets the entire frontend work unchanged whether:
 *   1. Running on iOS (Rust-native only, no Python)
 *   2. Running on desktop dev (Python sidecar on :7777)
 *   3. Running on desktop prod (Rust handles everything)
 *
 * Usage:
 *   import { nativeCall, isNative } from './api';
 *
 *   // Try native first, fall back to fetch:
 *   const patients = await nativeCall('list_patients', { status: 'active' })
 *     ?? await fetch('/api/patients?status=active').then(r => r.json());
 *
 *   // Or use the helper:
 *   const patients = await api('list_patients', '/patients', { status: 'active' });
 */

// ── Tauri Detection ─────────────────────────────────────────────────────────

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/** True when running inside Tauri webview (native Rust backend available). */
export const isNative: boolean = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

// Runtime diagnostic — visible in devtools console
console.log(`[HALT] Backend: ${isNative ? '🦀 Rust (invoke)' : '🐍 Python (fetch)'}`);


let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

/** Lazy-load the Tauri invoke function to avoid import errors in non-Tauri builds. */
async function getInvoke() {
  if (_invoke) return _invoke;
  if (!isNative) return null;
  try {
    const tauri = await import('@tauri-apps/api/core');
    _invoke = tauri.invoke;
    return _invoke;
  } catch {
    console.warn('[api] Tauri invoke not available, falling back to fetch');
    return null;
  }
}

// ── Dual-Path Helpers ───────────────────────────────────────────────────────

const BASE = '/api';

/**
 * Call a Tauri command directly. Returns null if not in Tauri or if the
 * command fails (so caller can fall back to fetch).
 */
export async function nativeCall<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke(command, args) as T;
  } catch (e) {
    console.warn(`[api] native invoke(${command}) failed:`, e);
    return null;
  }
}

/**
 * HTTP fetch against the Python backend (existing behavior).
 */
async function httpCall<T>(path: string, options?: RequestInit): Promise<T> {
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

/**
 * Unified API call — tries Tauri invoke first, falls back to HTTP fetch.
 *
 * @param command  - Tauri command name (snake_case, e.g. 'list_patients')
 * @param path     - HTTP path (e.g. '/patients')
 * @param args     - Arguments passed to invoke (also used as query/body for fetch)
 * @param fetchOpt - Optional fetch RequestInit overrides for the HTTP path
 */
export async function api<T>(
  command: string,
  path: string,
  args?: Record<string, unknown>,
  fetchOpt?: RequestInit,
): Promise<T> {
  // Try native first
  if (isNative) {
    const result = await nativeCall<T>(command, args);
    if (result !== null) return result;
  }
  // Fall back to HTTP
  return httpCall<T>(path, fetchOpt);
}

/**
 * Fire-and-forget native call with HTTP fallback.
 * Used for mutations (POST/PUT/DELETE) where the response shape doesn't matter.
 */
export async function apiMutate<T>(
  command: string,
  path: string,
  args?: Record<string, unknown>,
  fetchOpt?: RequestInit,
): Promise<T> {
  if (isNative) {
    const result = await nativeCall<T>(command, args);
    if (result !== null) return result;
  }
  return httpCall<T>(path, fetchOpt);
}

export { httpCall, BASE };
