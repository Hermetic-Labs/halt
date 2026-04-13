/**
 * DistributionTab.tsx — Model Pack Download UI
 *
 * Shows installed/available model packs with download controls.
 * Streams progress via SSE from /api/distribution/progress.
 */
import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useT } from '../services/i18n';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PackInfo {
  installed: boolean;
  size_mb: number;
}

interface PackStatus {
  packs: Record<string, PackInfo>;
  models_dir: string;
}

interface Progress {
  pack?: string;
  phase: 'idle' | 'downloading' | 'verifying' | 'extracting' | 'complete' | 'error';
  percent: number;
  bytes_done?: number;
  bytes_total?: number;
  error?: string;
}

// ── Pack Config ────────────────────────────────────────────────────────────────

const PACK_META: Record<string, { label: string; icon: string; desc: string }> = {
  voice: {
    label: 'Voice',
    icon: '🗣️',
    desc: 'Text-to-Speech (Kokoro ONNX)',
  },
  stt: {
    label: 'Speech-to-Text',
    icon: '🎤',
    desc: 'Whisper transcription',
  },
  translation: {
    label: 'Translation',
    icon: '🌐',
    desc: 'NLLB-200 multilingual',
  },
  ai: {
    label: 'AI Assistant',
    icon: '🧠',
    desc: 'MedGemma 1.5 medical reasoning',
  },
};

const R2_BUCKET_URL = 'https://models.7hermeticloops.com'; // REPLACE with your pub-*.r2.dev link if it's not bound to this custom domain

const DEFAULT_URLS: Record<string, string> = {
  voice: `${R2_BUCKET_URL}/voice.tar.gz`,
  stt: `${R2_BUCKET_URL}/stt.tar.gz`,
  translation: `${R2_BUCKET_URL}/translation.tar.gz`,
  ai: `${R2_BUCKET_URL}/ai.tar.gz`,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function DistributionTab() {
  const { t } = useT();
  const [status, setStatus] = useState<PackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ phase: 'idle', percent: 0 });
  const [error, setError] = useState<string | null>(null);

  // Fetch pack status
  const fetchStatus = useCallback(async () => {
    try {
      const data = await invoke<PackStatus>('distribution_status');
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : (e instanceof Error ? e.message : 'API unavailable'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Native Tauri IPC listener
  const startProgressListener = useCallback(() => {
    const unlistenPromise = listen<Progress>('distribution-progress', (event) => {
      setProgress(event.payload);
      if (event.payload.phase === 'complete' || event.payload.phase === 'error') {
        setDownloading(null);
        if (event.payload.phase === 'complete') {
          fetchStatus();
        }
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [fetchStatus]);

  // Initial load
  useEffect(() => {
    fetchStatus();
    const cleanup = startProgressListener();
    return cleanup;
  }, [fetchStatus, startProgressListener]);

  // Download a single pack
  const handleDownload = async (packId: string) => {
    if (downloading) return;
    setDownloading(packId);
    setProgress({ pack: packId, phase: 'downloading', percent: 0 });
    setError(null);

    try {
      await invoke('distribution_download', {
        request: {
          pack: packId,
          url: DEFAULT_URLS[packId] || `${R2_BUCKET_URL}/${packId}.tar.gz`,
        }
      });
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error).message);
      setDownloading(null);
      setProgress({ phase: 'idle', percent: 0 });
    }
  };

  // Download all packs
  const handleDownloadAll = async () => {
    if (downloading || !status) return;

    const missing = Object.entries(status.packs)
      .filter(([, info]) => !info.installed)
      .map(([id]) => id);

    if (missing.length === 0) return;

    setDownloading('all');
    setError(null);

    try {
      await invoke('distribution_download_all');
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error).message);
      setDownloading(null);
      setProgress({ phase: 'idle', percent: 0 });
    }
  };

  // Count installed vs total
  const installedCount = status ? Object.values(status.packs).filter((p) => p.installed).length : 0;
  const totalCount = status ? Object.keys(status.packs).length : 4;

  // Progress bar color
  const getProgressColor = (phase: string) => {
    switch (phase) {
      case 'downloading': return '#3fb950';
      case 'verifying': return '#f0a500';
      case 'extracting': return '#3498db';
      case 'complete': return '#3fb950';
      case 'error': return '#e74c3c';
      default: return '#8b949e';
    }
  };

  // Format bytes
  const formatBytes = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading model status...
      </div>
    );
  }

  return (
    <div style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {t('dist.title', 'Model Packs')}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              {installedCount}/{totalCount} installed — {t('dist.subtitle', 'Download AI models for offline use')}
            </p>
          </div>

          {/* Install Full Suite button */}
          <button
            onClick={handleDownloadAll}
            disabled={downloading !== null || installedCount === totalCount}
            style={{
              padding: '8px 14px',
              background: downloading ? '#333' : '#3fb95022',
              border: '1px solid #3fb950',
              borderRadius: 8,
              color: downloading ? '#666' : '#3fb950',
              fontWeight: 700,
              fontSize: 12,
              cursor: downloading ? 'not-allowed' : 'pointer',
              opacity: installedCount === totalCount ? 0.5 : 1,
            }}
          >
            {installedCount === totalCount
              ? t('dist.all_installed', 'All Installed')
              : downloading
                ? t('dist.downloading', 'Installing...')
                : t('dist.install_all', 'Install Full Suite')}
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div style={{
          padding: '10px 14px',
          background: '#e74c3c22',
          border: '1px solid #e74c3c55',
          borderRadius: 8,
          color: '#e74c3c',
          fontSize: 12,
          marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* Progress bar (when downloading) */}
      {downloading && progress.phase !== 'idle' && progress.phase !== 'complete' && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              {PACK_META[downloading]?.icon} {PACK_META[downloading]?.label || t('dist.downloading', 'Downloading')}...
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
              {progress.phase === 'downloading' && formatBytes(progress.bytes_done)}
              {progress.phase === 'downloading' && progress.bytes_total && ` / ${formatBytes(progress.bytes_total)}`}
              {progress.phase === 'verifying' && t('dist.verifying', 'Verifying...')}
              {progress.phase === 'extracting' && t('dist.extracting', 'Extracting...')}
            </span>
          </div>
          <div style={{
            height: 6,
            background: 'var(--bg)',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${progress.percent}%`,
              background: getProgressColor(progress.phase),
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ textAlign: 'right', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            {progress.percent}%
          </div>
        </div>
      )}

      {/* Pack Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {status && Object.entries(status.packs).map(([packId, info]) => {
          const meta = PACK_META[packId] || { label: packId, icon: '📦', desc: '' };
          const isDownloading = downloading === packId;
          const isAnyDownloading = downloading !== null;

          return (
            <div
              key={packId}
              style={{
                padding: '14px 16px',
                background: 'var(--surface)',
                border: `1px solid ${info.installed ? '#3fb95044' : 'var(--border)'}`,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                opacity: isAnyDownloading && !isDownloading ? 0.7 : 1,
              }}
            >
              {/* Icon */}
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: info.installed ? '#3fb95022' : 'var(--bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}>
                {meta.icon}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                    {meta.label}
                  </span>
                  {info.installed ? (
                    <span style={{
                      padding: '2px 6px',
                      background: '#3fb95022',
                      border: '1px solid #3fb95044',
                      borderRadius: 4,
                      color: '#3fb950',
                      fontSize: 10,
                      fontWeight: 600,
                    }}>
                      Installed ✅
                    </span>
                  ) : (
                    <span style={{
                      padding: '2px 6px',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      color: 'var(--text-muted)',
                      fontSize: 10,
                      fontWeight: 600,
                    }}>
                      Available
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {meta.desc} · {info.size_mb} MB
                </div>
              </div>

              {/* Download Button */}
              <button
                onClick={() => handleDownload(packId)}
                disabled={info.installed || isDownloading || isAnyDownloading}
                style={{
                  padding: '6px 12px',
                  background: info.installed ? 'transparent' : isDownloading ? '#333' : '#3fb95022',
                  border: `1px solid ${info.installed ? 'var(--border)' : '#3fb950'}`,
                  borderRadius: 6,
                  color: info.installed ? 'var(--text-muted)' : isDownloading ? '#666' : '#3fb950',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: info.installed || isAnyDownloading ? 'not-allowed' : 'pointer',
                  flexShrink: 0,
                }}
              >
                {info.installed
                  ? t('dist.installed', 'Installed')
                  : isDownloading
                    ? t('dist.downloading_btn', '...')
                    : t('dist.download', 'Download')}
              </button>
            </div>
          );
        })}
      </div>

      {/* Models directory path */}
      {status && (
        <div style={{
          marginTop: 16,
          padding: '8px 12px',
          background: 'var(--bg)',
          borderRadius: 6,
          fontSize: 10,
          color: 'var(--text-faint)',
          fontFamily: 'var(--font-mono)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          Models: {status.models_dir}
        </div>
      )}
    </div>
  );
}
