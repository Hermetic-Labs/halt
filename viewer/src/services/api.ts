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
 * Unified API call — Rust invoke first, Python HTTP fallback.
 *
 * In Tauri (dev + store): tries invoke() → Rust. If it fails, falls
 * back to Python sidecar on :7778. This dual-path ensures the app
 * always works even if a Rust command has a bug.
 *
 * In browser-only mode: Python HTTP directly.
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
  if (isNative) {
    const result = await nativeCall<T>(command, args);
    if (result !== null) return result;
    // Rust failed — fall through to Python sidecar
    console.warn(`[api] Rust invoke(${command}) failed → falling back to Python`);
  }
  return httpCall<T>(path, fetchOpt);
}

/**
 * Fire-and-forget mutation — same Rust-first, Python-fallback pattern.
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
    console.warn(`[api] Rust invoke(${command}) failed → falling back to Python`);
  }
  return httpCall<T>(path, fetchOpt);
}

export { httpCall, BASE };

// ── Endpoint URL Resolution ──────────────────────────────────────────────────

/**
 * Resolve a backend URL.
 * - Browser/dev: relative path (Vite proxy handles it)
 * - Tauri store: absolute URL to native HTTP server on :7779
 */
export function resolveUrl(path: string): string {
  if (isNative) return `http://127.0.0.1:7778${path}`;
  return path;
}

// ── Typed Helpers — Rust invoke first, Python fetch fallback ─────────────────

/** Translate a single text string. */
export async function translateText(
  text: string, source: string, target: string,
): Promise<{ translated: string }> {
  if (isNative) {
    const r = await nativeCall<{ translated: string }>('translate_text', { request: { text, source, target } });
    if (r) return r;
  }
  const res = await fetch(resolveUrl('/api/translate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source, target }),
  });
  if (!res.ok) throw new Error(`translate failed: ${res.status}`);
  return res.json();
}

/** Translate multiple texts at once. */
export async function translateBatch(
  texts: string[], source: string, target: string,
): Promise<{ translations: string[] }> {
  if (isNative) {
    const r = await nativeCall<{ translations: string[] }>('translate_batch', { request: { texts, source, target } });
    if (r) return r;
  }
  const res = await fetch(resolveUrl('/api/translate/batch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, source, target }),
  });
  if (!res.ok) throw new Error(`translate batch failed: ${res.status}`);
  return res.json();
}

/** Synthesize speech from text — returns JSON with audio_base64. */
export async function ttsSynthesize(
  text: string, voice?: string, speed?: number, lang?: string,
): Promise<Response> {
  if (isNative) {
    const r = await nativeCall<{ audio_base64: string; sample_rate: number; duration_ms: number }>(
      'tts_synthesize', { request: { text, voice: voice || 'af_heart', speed: speed || 1.0, lang: lang || '' } },
    );
    if (r) {
      // Wrap Rust response in a Response object so callers can handle it uniformly
      return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }
  return fetch(resolveUrl('/tts/synthesize'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voice || 'af_heart', speed: speed || 1.0, lang: lang || '' }),
  });
}

/** Multi-segment TTS synthesis. */
export async function ttsSynthesizeMulti(
  segments: { text: string; lang: string }[], speed?: number,
): Promise<Response> {
  if (isNative) {
    const r = await nativeCall<{ audio_base64: string; sample_rate: number; duration_ms: number }>(
      'tts_synthesize_multi', { request: { segments, speed: speed || 1.0 } },
    );
    if (r) {
      return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }
  return fetch(resolveUrl('/tts/synthesize-multi'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments, speed: speed || 1.0 }),
  });
}

export async function sttListen(formData: FormData): Promise<{ text: string; language?: string }> {
  const audioFile = formData.get('audio') as File | Blob | null;
  const language = formData.get('language') as string | null;

  if (isNative && audioFile) {
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl);
      };
      reader.onerror = reject;
      reader.readAsDataURL(audioFile);
    });

    const r = await nativeCall<{ text: string; language?: string }>(
      'stt_listen', { audioDataB64: base64Data, language: language || undefined },
    );
    if (r) return r;
  }

  if (audioFile) {
    const langQuery = language ? `?lang=${encodeURIComponent(language)}` : '';
    const res = await fetch(resolveUrl(`/stt/listen${langQuery}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: audioFile,
    });
    if (!res.ok) throw new Error(`STT HTTP fallback failed: ${res.status}`);
    return res.json();
  }

  const res = await fetch(resolveUrl('/stt/listen'), { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`STT failed: ${res.status}`);
  return res.json();
}
