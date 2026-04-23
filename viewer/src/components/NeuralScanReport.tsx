import React, { useState } from 'react';
import { runNeuralSweep, runLanguageProbe } from '../services/api';
import type { SweepResult } from '../services/api';

interface NeuralScanReportProps {
    onClose?: () => void;
}

export const NeuralScanReport: React.FC<NeuralScanReportProps> = ({ onClose }) => {
    const [running, setRunning] = useState(false);
    const [results, setResults] = useState<SweepResult[]>([]);
    const [error, setError] = useState<string | null>(null);

    const [viewMode, setViewMode] = useState<'matrix' | 'sandbox'>('matrix');
    const [sandboxLang, setSandboxLang] = useState('ar');
    const [sandboxText, setSandboxText] = useState('All medics must report to ward alpha immediately.');

    const handleRunSweep = async () => {
        if (running) return;
        setRunning(true);
        setError(null);
        try {
            const data = await runNeuralSweep();
            setResults(data);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage || 'System fault executing native diagnostic boundary.');
        } finally {
            setRunning(false);
        }
    };

    const handleRunSandbox = async () => {
        if (running || !sandboxText.trim()) return;
        setRunning(true);
        setError(null);
        try {
            const data = await runLanguageProbe(sandboxText, sandboxLang);
            setResults([data]);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage || 'Sandbox fault executing targeted payload.');
        } finally {
            setRunning(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 24, boxSizing: 'border-box', fontFamily: '"Inter", sans-serif'
        }}>
            <div style={{
                width: '100%', maxWidth: 1200, height: '90vh',
                background: '#0a0a0a', border: '1px solid #1f2937', borderRadius: 16,
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden'
            }}>
                {/* Header Sequence */}
                <div style={{
                    padding: '20px 24px', borderBottom: '1px solid #1f2937',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(to right, #111827, #0a0a0a)'
                }}>
                    <div>
                        <h2 style={{ margin: 0, color: '#e5e7eb', fontSize: 20, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            Neural Ground Truth
                        </h2>
                        <span style={{ color: '#6b7280', fontSize: 13, marginTop: 4, display: 'block' }}>
                            Deterministic Diagnostic Sweeps & Pipeline Trace
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ display: 'flex', background: '#111827', borderRadius: 8, overflow: 'hidden', border: '1px solid #374151', marginRight: 12 }}>
                            <button
                                onClick={() => { setViewMode('matrix'); setResults([]); }}
                                style={{
                                    padding: '8px 16px', border: 'none', cursor: 'pointer',
                                    background: viewMode === 'matrix' ? '#3b82f6' : 'transparent',
                                    color: viewMode === 'matrix' ? 'white' : '#9ca3af',
                                    fontWeight: viewMode === 'matrix' ? 600 : 400
                                }}
                            >Matrix Sweep</button>
                            <button
                                onClick={() => { setViewMode('sandbox'); setResults([]); }}
                                style={{
                                    padding: '8px 16px', border: 'none', cursor: 'pointer',
                                    background: viewMode === 'sandbox' ? '#3b82f6' : 'transparent',
                                    color: viewMode === 'sandbox' ? 'white' : '#9ca3af',
                                    fontWeight: viewMode === 'sandbox' ? 600 : 400
                                }}
                            >Silo Sandbox</button>
                        </div>
                        {viewMode === 'matrix' ? (
                            <button 
                                onClick={handleRunSweep}
                                disabled={running}
                                style={{
                                    padding: '8px 20px', borderRadius: 8, border: 'none',
                                    background: running ? '#374151' : '#3b82f6',
                                    color: running ? '#9ca3af' : 'white', fontWeight: 600,
                                    cursor: running ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.2s', boxShadow: running ? 'none' : '0 0 15px rgba(59, 130, 246, 0.4)'
                                }}
                            >
                                {running ? 'Sweeping Topology...' : 'Execute Sweep'}
                            </button>
                        ) : (
                            <button 
                                onClick={handleRunSandbox}
                                disabled={running}
                                style={{
                                    padding: '8px 20px', borderRadius: 8, border: 'none',
                                    background: running ? '#374151' : '#10b981',
                                    color: running ? '#9ca3af' : 'white', fontWeight: 600,
                                    cursor: running ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.2s', boxShadow: running ? 'none' : '0 0 15px rgba(16, 185, 129, 0.4)'
                                }}
                            >
                                {running ? 'Probing...' : 'Fire Probe'}
                            </button>
                        )}

                        <button 
                            onClick={onClose}
                            style={{
                                padding: '8px 20px', borderRadius: 8, border: '1px solid #374151',
                                background: 'transparent', color: '#e5e7eb', fontWeight: 600,
                                cursor: 'pointer', transition: 'all 0.2s'
                            }}
                        >
                            Close
                        </button>
                    </div>
                </div>

                {/* Dashboard Frame */}
                <div style={{ flex: 1, padding: 24, overflowY: 'auto', background: '#050505', display: 'flex', flexDirection: 'column' }}>
                    {error && (
                        <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444', color: '#ef4444', borderRadius: 4, marginBottom: 24 }}>
                            <strong>Diagnostic Fault:</strong> {error}
                        </div>
                    )}

                    {viewMode === 'sandbox' && results.length > 0 && results[0].phonemizer_ipa && (
                      <div className="bg-[#1a1a1a] p-4 rounded border border-gray-800" style={{ marginBottom: 24 }}>
                        <div className="text-sm font-semibold text-gray-400 mb-2">RAW IPA BRIDGE TRACE</div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Raw Output (espeak-ng)</div>
                            <code className="text-orange-400 text-lg">{results[0].phonemizer_ipa}</code>
                          </div>
                          {results[0].phonemizer_compiled_ipa && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Compiled Output (Kokoro Validated)</div>
                              <code className="text-green-400 text-lg">{results[0].phonemizer_compiled_ipa}</code>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {viewMode === 'sandbox' && (
                        <div style={{ marginBottom: 24, background: '#111', padding: 20, borderRadius: 12, border: '1px solid #1f2937' }}>
                            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase' }}>Source Payload (English)</label>
                                    <input 
                                        type="text" 
                                        value={sandboxText} 
                                        onChange={(e) => setSandboxText(e.target.value)}
                                        style={{ width: '100%', padding: '10px 14px', boxSizing: 'border-box', background: '#0a0a0a', border: '1px solid #374151', color: 'white', borderRadius: 8, fontSize: 14 }}
                                    />
                                </div>
                                <div style={{ width: 150 }}>
                                    <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase' }}>Target Silo</label>
                                    <select 
                                        value={sandboxLang} 
                                        onChange={(e) => setSandboxLang(e.target.value)}
                                        style={{ width: '100%', padding: '10px 14px', boxSizing: 'border-box', background: '#0a0a0a', border: '1px solid #374151', color: 'white', borderRadius: 8, fontSize: 14, WebkitAppearance: 'none' }}
                                    >
                                        {/* Baseline / Western / Latin */}
                                        <option value="en">en (English)</option>
                                        <option value="es">es (Spanish)</option>
                                        <option value="fr">fr (French)</option>
                                        <option value="de">de (German)</option>
                                        <option value="it">it (Italian)</option>
                                        <option value="pt">pt (Portuguese)</option>
                                        <option value="nl">nl (Dutch)</option>
                                        
                                        {/* Middle Eastern / Arabic Script */}
                                        <option value="ar">ar (Arabic)</option>
                                        <option value="fa">fa (Persian)</option>
                                        <option value="ur">ur (Urdu)</option>
                                        <option value="ps">ps (Pashto)</option>
                                        <option value="ku">ku (Kurdish)</option>
                                        <option value="he">he (Hebrew)</option>
                                        
                                        {/* Asian / Character Based */}
                                        <option value="zh">zh (Mandarin)</option>
                                        <option value="ja">ja (Japanese)</option>
                                        <option value="ko">ko (Korean)</option>
                                        <option value="th">th (Thai)</option>
                                        <option value="vi">vi (Vietnamese)</option>
                                        
                                        {/* Indic */}
                                        <option value="hi">hi (Hindi)</option>
                                        <option value="ta">ta (Tamil)</option>
                                        <option value="bn">bn (Bengali)</option>
                                        
                                        {/* Eastern European / Cyrillic */}
                                        <option value="ru">ru (Russian)</option>
                                        <option value="uk">uk (Ukrainian)</option>
                                        <option value="pl">pl (Polish)</option>
                                        <option value="tr">tr (Turkish)</option>
                                        
                                        {/* African / Other */}
                                        <option value="sw">sw (Swahili)</option>
                                        <option value="ha">ha (Hausa)</option>
                                        <option value="so">so (Somali)</option>
                                        <option value="am">am (Amharic)</option>
                                        <option value="id">id (Indonesian)</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {!running && results.length === 0 && !error && (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#4b5563' }}>
                            <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
                            <h3 style={{ margin: 0, fontWeight: 500 }}>System Ready for Authority Validation</h3>
                            <p style={{ marginTop: 8, fontSize: 14 }}>
                                {viewMode === 'matrix' ? 'Click "Execute Sweep" to fire payload boundaries across the entire NLLB and TTS matrices.' : 'Configure custom payload and fire the specific language probe.'}
                            </p>
                        </div>
                    )}

                    {results.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'sandbox' ? '1fr' : 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
                            {results.map((r, idx) => (
                                <div key={idx} style={{
                                    background: '#111', border: `1px solid ${r.mapping_match ? '#1f2937' : '#ef4444'}`, 
                                    borderRadius: 12, padding: 16, position: 'relative'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ fontSize: 18, fontWeight: 700, color: '#e5e7eb', textTransform: 'uppercase' }}>{r.target}</span>
                                                <span style={{ fontSize: 12, padding: '2px 8px', background: '#1f2937', color: '#9ca3af', borderRadius: 20 }}>{r.bcp47}</span>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <span style={{ fontSize: 14 }} title={r.nllb_status ? 'NLLB Online' : 'NLLB Drop'}>{r.nllb_status ? '🟢' : '🔴'}</span>
                                            <span style={{ fontSize: 14 }} title={r.phonemizer_status ? 'Phonemes Mapped' : 'Phoneme Fault'}>{r.phonemizer_status ? '🟢' : '🔴'}</span>
                                            <span style={{ fontSize: 14 }} title={r.tts_status ? 'Audio Tensor Success' : 'Tensor Error'}>{r.tts_status ? '🟢' : '🔴'}</span>
                                        </div>
                                    </div>

                                    <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12, background: '#0a0a0a', padding: 10, borderRadius: 8, fontFamily: 'monospace', minHeight: 40, border: '1px solid #1f2937' }}>
                                        {r.nllb_output || <span style={{ color: '#ef4444' }}>{r.translation_error || '[Payload Dropped]'}</span>}
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                            <span style={{ color: '#6b7280' }}>String Length (Chars):</span>
                                            <span style={{ color: (r.mapping_match || viewMode === 'sandbox') ? '#34d399' : '#ef4444', fontWeight: 600 }}>
                                                {r.nllb_char_count} {viewMode === 'matrix' && r.expected_char_count > 0 ? `/ ${r.expected_char_count}` : ''}
                                            </span>
                                        </div>
                                        
                                        {/* IPA PHONETIC TRACE */}
                                        <div style={{ marginTop: 6, marginBottom: 2, borderTop: '1px dashed #374151', paddingTop: 8 }}>
                                            <span style={{ color: '#8b5cf6', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Raw IPA Bridge Output</span>
                                            <div style={{ 
                                                marginTop: 4, padding: '8px 12px', background: '#1e1b4b', border: '1px solid #4c1d95',
                                                borderRadius: 6, color: '#f3e8ff', fontFamily: 'monospace', fontSize: 14, 
                                                wordBreak: 'break-all'
                                            }}>
                                                {r.phonemizer_ipa ? `/${r.phonemizer_ipa}/` : <span style={{ color: '#9ca3af' }}>[No Output]</span>}
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
                                            <span style={{ color: '#6b7280' }}>Phonemizer Tokens:</span>
                                            <span style={{ color: r.phonemizer_status ? '#e5e7eb' : '#ef4444', fontWeight: 600 }}>
                                                {r.phonemizer_status ? r.phonemizer_tokens : r.phonemizer_error || 'FAIl'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                            <span style={{ color: '#6b7280' }}>Audio Buffer Output:</span>
                                            <span style={{ color: r.tts_status ? '#e5e7eb' : '#ef4444', fontWeight: 600 }}>
                                                {r.tts_status ? `${r.audio_length} bytes` : r.tts_error || 'FAIL'}
                                            </span>
                                        </div>
                                    </div>
                                    {!r.mapping_match && r.nllb_char_count > 0 && r.expected_char_count !== 0 && (
                                        <div style={{ marginTop: 12, fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '4px 8px', borderRadius: 4 }}>
                                            WARNING: Deterministic character boundary drift detected!
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
