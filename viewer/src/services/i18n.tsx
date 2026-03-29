/* eslint-disable react-refresh/only-export-components */
/**
 * i18n.tsx — Lean internationalisation for Eve Os: Triage
 *
 * Architecture:
 *   - LangProvider wraps the app and loads /locales/{lang}.json
 *   - useT() returns a t(key, fallback?) function
 *   - Falls back to English string if key is missing in current locale
 *   - Language is persisted in localStorage('eve-lang')
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

type Locale = Record<string, string>;

interface I18nContext {
    lang: string;
    setLang: (code: string) => void;
    t: (key: string, paramsOrFallback?: string | Record<string, string>) => string;
    tEn: (key: string, paramsOrFallback?: string | Record<string, string>) => string;
}

// ── Context ──────────────────────────────────────────────────────────────────

const Ctx = createContext<I18nContext>({
    lang: 'en',
    setLang: () => { },
    t: (key: string, paramsOrFallback?: string | Record<string, string>) => (typeof paramsOrFallback === 'string' ? paramsOrFallback : key),
    tEn: (key: string, paramsOrFallback?: string | Record<string, string>) => (typeof paramsOrFallback === 'string' ? paramsOrFallback : key),
});

export function useT() {
    return useContext(Ctx);
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function LangProvider({ children }: { children: ReactNode }) {
    const [lang, setLangState] = useState(() => localStorage.getItem('eve-lang') || 'en');
    const [locale, setLocale] = useState<Locale>({});
    const enRef = useRef<Locale>({});

    // Load English as fallback baseline (always loaded)
    useEffect(() => {
        fetch('/locales/en.json')
            .then(r => r.json())
            .then((data: Locale) => { enRef.current = data; })
            .catch(() => { });
    }, []);

    // Load target language (cache-bust ensures fresh translations after crawler runs)
    useEffect(() => {
        const bust = `?v=${Date.now()}`;
        if (lang === 'en') {
            fetch(`/locales/en.json${bust}`)
                .then(r => r.json())
                .then(setLocale)
                .catch(() => setLocale({}));
        } else {
            fetch(`/locales/${lang}.json${bust}`)
                .then(r => {
                    if (!r.ok) throw new Error('not found');
                    return r.json();
                })
                .then(setLocale)
                .catch(() => setLocale({}));
        }
    }, [lang]);

    const setLang = useCallback((code: string) => {
        setLangState(code);
        localStorage.setItem('eve-lang', code);
    }, []);

    const t = useCallback((key: string, paramsOrFallback?: string | Record<string, string>): string => {
        const fallback = typeof paramsOrFallback === 'string' ? paramsOrFallback : undefined;
        const params = typeof paramsOrFallback === 'object' ? paramsOrFallback : undefined;
        let result = locale[key] || enRef.current[key] || fallback || key;
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                result = result.replaceAll(`{${k}}`, v);
            }
        }
        return result;
    }, [locale]);

    const tEn = useCallback((key: string, paramsOrFallback?: string | Record<string, string>): string => {
        const fallback = typeof paramsOrFallback === 'string' ? paramsOrFallback : undefined;
        const params = typeof paramsOrFallback === 'object' ? paramsOrFallback : undefined;
        let result = enRef.current[key] || fallback || key;
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                result = result.replaceAll(`{${k}}`, v);
            }
        }
        return result;
    }, []);

    return (
        <Ctx.Provider value={{ lang, setLang, t, tEn }}>
            {children}
        </Ctx.Provider>
    );
}
