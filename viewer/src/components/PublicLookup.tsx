import { useState, useCallback } from 'react';
import { useT } from '../services/i18n';

const LANGS = [
    ['en','English'],['ar','العربية'],['am','አማርኛ'],['bn','বাংলা'],['de','Deutsch'],
    ['es','Español'],['fa','فارسی'],['fr','Français'],['ha','Hausa'],['he','עברית'],
    ['hi','हिन्दी'],['id','Bahasa Indonesia'],['ig','Igbo'],['it','Italiano'],
    ['ja','日本語'],['jw','Basa Jawa'],['km','ខ្មែរ'],['ko','한국어'],['ku','Kurdî'],
    ['mg','Malagasy'],['mr','मराठी'],['my','မြန်မာ'],['nl','Nederlands'],['pl','Polski'],
    ['ps','پښتو'],['pt','Português'],['ru','Русский'],['so','Soomaali'],['sw','Kiswahili'],
    ['ta','தமிழ்'],['te','తెలుగు'],['th','ไทย'],['tl','Tagalog'],['tr','Türkçe'],
    ['uk','Українська'],['ur','اردو'],['vi','Tiếng Việt'],['xh','isiXhosa'],
    ['yo','Yorùbá'],['zh','中文'],['zu','isiZulu'],
] as const;

interface PublicPatient {
    id: string;
    name: string;
    wardId: string;
    roomNumber: string;
    status: string;
    admittedAt: string;
    hasPhoto: boolean;
    photoUrl?: string;
}

export default function PublicLookup() {
    const { t, lang, setLang } = useT();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PublicPatient[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSearch = useCallback(async () => {
        if (!query.trim()) return;

        setLoading(true);
        setError(null);
        setSearched(true);

        try {
            const res = await fetch(`/api/public/patients?name=${encodeURIComponent(query.trim())}`);
            if (!res.ok) throw new Error('Search failed');
            const data = await res.json();
            setResults(Array.isArray(data) ? data : data.results || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Search failed');
            setResults([]);
        } finally {
            setLoading(false);
        }
    }, [query]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch();
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: '#0d1117',
            color: '#e6edf3',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '40px 20px',
        }}>
            <div style={{ maxWidth: 560, margin: '0 auto' }}>
                {/* Language selector — top right */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                    <select
                        value={lang}
                        onChange={e => setLang(e.target.value)}
                        style={{
                            background: '#161b22',
                            color: '#8b949e',
                            border: '1px solid #30363d',
                            borderRadius: 6,
                            padding: '5px 10px',
                            fontSize: 12,
                            cursor: 'pointer',
                            outline: 'none',
                        }}
                    >
                        {LANGS.map(([code, name]) => (
                            <option key={code} value={code}>{name}</option>
                        ))}
                    </select>
                </div>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: 36 }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>🏥</div>
                    <h1 style={{
                        fontSize: 26,
                        fontWeight: 700,
                        color: '#e6edf3',
                        marginBottom: 10,
                    }}>
                        {t('lookup.title', 'Patient Lookup')}
                    </h1>
                    <p style={{
                        color: '#8b949e',
                        fontSize: 14,
                        lineHeight: 1.5,
                    }}>
                        {t('lookup.subtitle', 'Search for your family member by name')}
                    </p>
                </div>

                {/* Search Box */}
                <div style={{
                    background: '#161b22',
                    borderRadius: 12,
                    padding: 20,
                    marginBottom: 28,
                    border: '1px solid #30363d',
                }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <input
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('lookup.placeholder', 'Enter patient name...')}
                            autoFocus
                            style={{
                                flex: 1,
                                padding: '12px 16px',
                                fontSize: 15,
                                background: '#0d1117',
                                border: '1px solid #30363d',
                                borderRadius: 8,
                                color: '#e6edf3',
                                outline: 'none',
                            }}
                        />
                        <button
                            onClick={handleSearch}
                            disabled={loading || !query.trim()}
                            style={{
                                padding: '12px 24px',
                                fontSize: 14,
                                fontWeight: 600,
                                background: loading ? '#21262d' : '#238636',
                                color: loading ? '#8b949e' : '#fff',
                                border: 'none',
                                borderRadius: 8,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                transition: 'opacity 0.2s',
                            }}
                        >
                            {loading ? '...' : t('lookup.search', 'Search')}
                        </button>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div style={{
                        background: '#e74c3c22',
                        border: '1px solid #e74c3c44',
                        borderRadius: 8,
                        padding: '14px 18px',
                        color: '#e74c3c',
                        marginBottom: 20,
                        textAlign: 'center',
                        fontSize: 13,
                    }}>
                        {error}
                    </div>
                )}

                {/* Results */}
                {searched && !loading && (
                    <div>
                        <div style={{
                            color: '#8b949e',
                            fontSize: 13,
                            marginBottom: 14,
                        }}>
                            {results.length === 0
                                ? t('lookup.no_results', 'No patients found matching that name.')
                                : `${results.length} ${t('lookup.results_found', 'result(s) found')}`}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {results.map(patient => (
                                <div
                                    key={patient.id}
                                    style={{
                                        background: '#161b22',
                                        border: '1px solid #30363d',
                                        borderRadius: 10,
                                        padding: 18,
                                        display: 'flex',
                                        gap: 14,
                                        alignItems: 'center',
                                    }}
                                >
                                    {/* Photo */}
                                    <div style={{
                                        width: 52,
                                        height: 52,
                                        borderRadius: '50%',
                                        background: '#21262d',
                                        border: '2px solid #30363d',
                                        overflow: 'hidden',
                                        flexShrink: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}>
                                        {patient.hasPhoto && patient.photoUrl ? (
                                            <img
                                                src={patient.photoUrl}
                                                alt={patient.name}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                        ) : (
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="1.5">
                                                <circle cx="12" cy="8" r="4" />
                                                <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                                            </svg>
                                        )}
                                    </div>

                                    {/* Info — Name, Ward, Bed only */}
                                    <div style={{ flex: 1 }}>
                                        <div style={{
                                            fontSize: 17,
                                            fontWeight: 600,
                                            color: '#e6edf3',
                                            marginBottom: 6,
                                        }}>
                                            {patient.name}
                                        </div>
                                        <div style={{
                                            color: '#8b949e',
                                            fontSize: 13,
                                            display: 'flex',
                                            gap: 16,
                                            flexWrap: 'wrap',
                                        }}>
                                            <span>
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 4 }}>
                                                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                                                </svg>
                                                {t('lookup.ward', 'Ward')}: {patient.wardId || '—'}
                                            </span>
                                            <span>
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 4 }}>
                                                    <rect x="3" y="7" width="18" height="13" rx="2" />
                                                    <path d="M3 10h18" />
                                                </svg>
                                                {t('lookup.bed', 'Bed')}: {patient.roomNumber || '—'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Initial state */}
                {!searched && !loading && (
                    <div style={{
                        textAlign: 'center',
                        padding: '36px 20px',
                        color: '#484f58',
                    }}>
                        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.4, marginBottom: 14 }}>
                            <circle cx="11" cy="11" r="8" />
                            <path d="M21 21l-4.35-4.35" />
                        </svg>
                        <p style={{ fontSize: 14 }}>
                            {t('lookup.instructions', 'Enter a patient name above to search')}
                        </p>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div style={{
                textAlign: 'center',
                marginTop: 44,
                padding: '16px',
                color: '#484f58',
                fontSize: 11,
            }}>
                {t('lookup.privacy_note', 'Only patients who have consented to family lookup are shown. No medical details are displayed.')}
            </div>
        </div>
    );
}
