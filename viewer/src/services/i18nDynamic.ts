/**
 * i18nDynamic.ts — Per-patient dynamic translation system.
 *
 * Architecture:
 *   - normalizeToEnglish(text, sourceLang) → translates user input to English
 *   - precomputeAllLocales(texts, patientId) → translates English to all 41 locales, stores in cache
 *   - pt(patientId, lang, text) → instant lookup from per-patient cache
 *   - flushPatientTranslations(patientId) → returns all translations for archiving, clears cache
 *   - hydratePatientTranslations(patientId, data) → restores cache from archived record
 */

// ── NLLB API ────────────────────────────────────────────────────────────────

import { translateBatch } from './api';

const NLLB_LOCALES = [
    'am', 'ar', 'bn', 'de', 'es', 'fa', 'fr', 'ha', 'he', 'hi',
    'id', 'ig', 'it', 'ja', 'jw', 'km', 'ko', 'ku', 'la', 'mg',
    'mr', 'my', 'nl', 'pl', 'ps', 'pt', 'ru', 'so', 'sw', 'ta',
    'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'xh', 'yo', 'zh', 'zu',
];

async function nllbBatch(texts: string[], source: string, target: string): Promise<string[]> {
    try {
        const data = await translateBatch(texts, source, target);
        return data.translations;
    } catch (err) {
        console.warn(`[i18nDynamic] NLLB batch failed (${source}→${target}):`, err);
        return texts; // fallback: return originals
    }
}

// ── Per-patient cache ────────────────────────────────────────────────────────
// Structure: patientId → lang → englishText → translatedText

const cache: Record<string, Record<string, Record<string, string>>> = {};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Translate user input text to English.
 * Returns { english, original } so both are preserved.
 */
export async function normalizeToEnglish(
    text: string,
    sourceLang: string,
): Promise<{ english: string; original: string }> {
    if (!text.trim()) return { english: text, original: text };
    if (sourceLang === 'en') return { english: text, original: text };

    const [english] = await nllbBatch([text], sourceLang, 'en');
    return { english, original: text };
}

/**
 * Precompute translations for English text(s) across ALL locales.
 * Stores results in per-patient runtime cache.
 * Runs in background — doesn't block UI.
 */
export async function precomputeAllLocales(
    englishTexts: string[],
    patientId: string,
): Promise<void> {
    const unique = [...new Set(englishTexts.filter(t => t.trim()))];
    if (unique.length === 0) return;

    // Initialize cache structure
    if (!cache[patientId]) cache[patientId] = {};

    // Also store English → English (identity)
    if (!cache[patientId]['en']) cache[patientId]['en'] = {};
    for (const t of unique) cache[patientId]['en'][t] = t;

    // Translate to each locale in parallel (small batches to avoid overload)
    const concurrency = 4;
    for (let i = 0; i < NLLB_LOCALES.length; i += concurrency) {
        const batch = NLLB_LOCALES.slice(i, i + concurrency);
        await Promise.all(batch.map(async (lang) => {
            // Skip if already cached for this patient+lang
            if (!cache[patientId][lang]) cache[patientId][lang] = {};
            const needed = unique.filter(t => !(t in cache[patientId][lang]));
            if (needed.length === 0) return;

            const translated = await nllbBatch(needed, 'en', lang);
            needed.forEach((text, idx) => {
                cache[patientId][lang][text] = translated[idx];
            });
        }));
    }
}

/**
 * Look up a per-patient translation. Instant — no NLLB call.
 * Returns translated text or falls back to original.
 */
export function pt(patientId: string, lang: string, text: string): string {
    return cache[patientId]?.[lang]?.[text] ?? text;
}

/**
 * Check if a patient has precomputed translations in cache.
 */
export function hasPatientTranslations(patientId: string): boolean {
    return !!cache[patientId] && Object.keys(cache[patientId]).length > 0;
}

/**
 * Flush per-patient translations from cache.
 * Returns the full translation map for archiving in the patient record.
 * Clears the runtime cache for this patient.
 */
export function flushPatientTranslations(
    patientId: string,
): Record<string, Record<string, string>> | undefined {
    const data = cache[patientId];
    if (data) {
        delete cache[patientId];
    }
    return data;
}

/**
 * Hydrate the runtime cache from a patient record's archived i18n data.
 * Call this when loading a patient that was previously saved with translations.
 */
export function hydratePatientTranslations(
    patientId: string,
    data: Record<string, Record<string, string>>,
): void {
    cache[patientId] = data;
}
