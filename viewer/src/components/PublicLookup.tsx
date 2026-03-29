import { useState, useCallback } from 'react';
import { useT } from '../services/i18n';

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

const STATUS_COLORS: Record<string, string> = {
    active: '#3fb950',
    discharged: '#8b949e',
    transferred: '#f0a500',
    deceased: '#e74c3c',
};

export default function PublicLookup() {
    const { t } = useT();
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

    const formatTime = (iso: string) => {
        try {
            const d = new Date(iso);
            return d.toLocaleString();
        } catch {
            return iso;
        }
    };

    const getStatusLabel = (status: string) => {
        const key = `status.${status}` as const;
        return t(key) || status;
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--bg)',
            padding: '40px 20px',
        }}>
            <div style={{
                maxWidth: 600,
                margin: '0 auto',
            }}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: 40 }}>
                    <h1 style={{
                        fontSize: 28,
                        fontWeight: 700,
                        color: 'var(--text)',
                        marginBottom: 12,
                    }}>
                        {t('lookup.title', 'Patient Lookup')}
                    </h1>
                    <p style={{
                        color: 'var(--text-muted)',
                        fontSize: 15,
                        lineHeight: 1.5,
                    }}>
                        {t('lookup.subtitle', 'Search for your family member by name. Only patients who have opted in to family lookup will appear.')}
                    </p>
                </div>

                {/* Search Box */}
                <div style={{
                    background: 'var(--surface)',
                    borderRadius: 12,
                    padding: 24,
                    marginBottom: 32,
                    border: '1px solid var(--border)',
                }}>
                    <div style={{
                        display: 'flex',
                        gap: 12,
                    }}>
                        <input
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('lookup.placeholder', 'Enter patient name...')}
                            autoFocus
                            style={{
                                flex: 1,
                                padding: '14px 18px',
                                fontSize: 16,
                                background: 'var(--surface2)',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                color: 'var(--text)',
                                outline: 'none',
                            }}
                        />
                        <button
                            onClick={handleSearch}
                            disabled={loading || !query.trim()}
                            style={{
                                padding: '14px 28px',
                                fontSize: 15,
                                fontWeight: 600,
                                background: loading ? 'var(--surface2)' : 'var(--primary)',
                                color: loading ? 'var(--text-muted)' : '#fff',
                                border: 'none',
                                borderRadius: 8,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                transition: 'opacity 0.2s',
                            }}
                        >
                            {loading ? t('lookup.searching', 'Searching...') : t('lookup.search', 'Search')}
                        </button>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div style={{
                        background: '#e74c3c22',
                        border: '1px solid #e74c3c44',
                        borderRadius: 8,
                        padding: '16px 20px',
                        color: '#e74c3c',
                        marginBottom: 24,
                        textAlign: 'center',
                    }}>
                        {error}
                    </div>
                )}

                {/* Results */}
                {searched && !loading && (
                    <div>
                        <div style={{
                            color: 'var(--text-muted)',
                            fontSize: 14,
                            marginBottom: 16,
                        }}>
                            {results.length === 0
                                ? t('lookup.no_results', 'No patients found with that name.')
                                : t('lookup.found', `Found ${results.length} patient(s)`)}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {results.map(patient => (
                                <div
                                    key={patient.id}
                                    style={{
                                        background: 'var(--surface)',
                                        border: '1px solid var(--border)',
                                        borderRadius: 10,
                                        padding: 20,
                                        display: 'flex',
                                        gap: 16,
                                        alignItems: 'center',
                                    }}
                                >
                                    {/* Photo */}
                                    <div style={{
                                        width: 64,
                                        height: 64,
                                        borderRadius: '50%',
                                        background: 'var(--surface2)',
                                        border: '2px solid var(--border)',
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
                                            <span style={{ fontSize: 24, opacity: 0.4 }}>
                                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                    <circle cx="12" cy="8" r="4" />
                                                    <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                                                </svg>
                                            </span>
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div style={{ flex: 1 }}>
                                        <div style={{
                                            fontSize: 18,
                                            fontWeight: 600,
                                            color: 'var(--text)',
                                            marginBottom: 4,
                                        }}>
                                            {patient.name}
                                        </div>
                                        <div style={{
                                            color: 'var(--text-muted)',
                                            fontSize: 14,
                                            display: 'flex',
                                            gap: 16,
                                            flexWrap: 'wrap',
                                        }}>
                                            <span>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 4 }}>
                                                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                                                </svg>
                                                {patient.wardId} / {patient.roomNumber}
                                            </span>
                                            <span>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 4 }}>
                                                    <circle cx="12" cy="12" r="10" />
                                                    <path d="M12 6v6l4 2" />
                                                </svg>
                                                {formatTime(patient.admittedAt)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Status Badge */}
                                    <div style={{
                                        padding: '6px 14px',
                                        borderRadius: 20,
                                        fontSize: 13,
                                        fontWeight: 600,
                                        background: (STATUS_COLORS[patient.status] || '#8b949e') + '22',
                                        color: STATUS_COLORS[patient.status] || '#8b949e',
                                        border: `1px solid ${STATUS_COLORS[patient.status] || '#8b949e'}44`,
                                    }}>
                                        {getStatusLabel(patient.status)}
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
                        padding: '40px 20px',
                        color: 'var(--text-muted)',
                    }}>
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.3, marginBottom: 16 }}>
                            <circle cx="11" cy="11" r="8" />
                            <path d="M21 21l-4.35-4.35" />
                        </svg>
                        <p style={{ fontSize: 15 }}>
                            {t('lookup.instructions', 'Enter a patient name above to search')}
                        </p>
                    </div>
                )}
            </div>

            {/* Footer note */}
            <div style={{
                textAlign: 'center',
                marginTop: 48,
                padding: '20px',
                color: 'var(--text-faint)',
                fontSize: 12,
            }}>
                {t('lookup.privacy_note', 'Only patients who have consented to family lookup are shown. For privacy, no medical details are displayed.')}
            </div>
        </div>
    );
}
