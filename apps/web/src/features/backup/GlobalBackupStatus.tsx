import React, { useState, useEffect, useCallback } from 'react';
import { Cloud, RefreshCw, AlertCircle, Sparkles, CheckCircle2, X } from 'lucide-react';
import { COLOR_TOKENS, TYPOGRAPHY_TOKENS, RADIUS_TOKENS, SPACING_TOKENS } from '@kaaj/design';
import { API_BASE_URL, AUTH_TOKEN } from '../../config/api';

export interface BackupStatusResponse {
  status: 'idle' | 'running' | 'failed';
  phase?: string;
  statusText?: string;
  lastBackupTime: string | null;
  lastCleanupTime?: string | null;
  lastPruneResult?: string | null;
  lastError: string | null;
  lastSnapshotId: string | null;
  remoteFileCount?: number;
  target?: string;
}

export const GlobalBackupStatus: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [data, setData] = useState<BackupStatusResponse | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanMessage, setCleanMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/backup/status`, {
        headers: { Authorization: AUTH_TOKEN },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // Quietly ignore network failures
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleCleanUpNow = async () => {
    setIsCleaning(true);
    setCleanMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/backup/prune`, {
        method: 'POST',
        headers: { Authorization: AUTH_TOKEN },
      });
      if (res.ok) {
        const result = await res.json();
        setCleanMessage('Cleanup completed successfully.');
        await fetchStatus();
      } else {
        const err = await res.json();
        setCleanMessage(`Cleanup failed: ${err.error || 'Server error'}`);
      }
    } catch (err: any) {
      setCleanMessage(`Cleanup error: ${err.message || 'Network error'}`);
    } finally {
      setIsCleaning(false);
    }
  };

  const handleBackupNow = async () => {
    try {
      await fetch(`${API_BASE_URL}/backup/trigger`, {
        method: 'POST',
        headers: { Authorization: AUTH_TOKEN },
      });
      await fetchStatus();
    } catch {}
  };

  const formatTime = (isoString?: string | null) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Never';
    const diffMins = Math.round((Date.now() - date.getTime()) / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const pillText = () => {
    if (!data) return 'Backup: Checking...';
    if (data.status === 'running') return data.statusText || 'Backing up...';
    if (data.status === 'failed') return 'Backup failed · Retry';
    const remoteCountStr = typeof data.remoteFileCount === 'number' ? ` (remote files: ${data.remoteFileCount})` : '';
    if (data.lastBackupTime) return `Backup: ${formatTime(data.lastBackupTime)}${remoteCountStr}`;
    return `Backup: Ready${remoteCountStr}`;
  };

  return (
    <div
      data-testid="global-backup-status"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
      }}
    >
      {/* Status Trigger Pill */}
      <button
        type="button"
        data-testid="backup-status-indicator"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          backgroundColor: COLOR_TOKENS.paperSubtle,
          border: `1px solid ${COLOR_TOKENS.border}`,
          borderRadius: RADIUS_TOKENS.full,
          padding: compact ? '4px 10px' : '6px 12px',
          fontSize: '12px',
          fontWeight: 500,
          color: data?.status === 'failed' ? COLOR_TOKENS.terracottaDark : COLOR_TOKENS.ink,
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          transition: 'all 0.15s ease',
        }}
      >
        {data?.status === 'running' && <RefreshCw size={13} className="spin" aria-hidden="true" />}
        {data?.status === 'idle' && <Cloud size={13} aria-hidden="true" style={{ color: COLOR_TOKENS.inkMuted }} />}
        {data?.status === 'failed' && <AlertCircle size={13} aria-hidden="true" style={{ color: COLOR_TOKENS.terracotta }} />}
        <span>{pillText()}</span>
      </button>

      {/* Details & Actions Popover */}
      {isOpen && (
        <div
          data-testid="backup-status-popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '290px',
            backgroundColor: COLOR_TOKENS.paper,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: RADIUS_TOKENS.md,
            padding: SPACING_TOKENS.md,
            boxShadow: '0 8px 24px rgba(45, 35, 25, 0.14)',
            zIndex: 1000,
            boxSizing: 'border-box',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontWeight: 600, fontSize: '13px', color: COLOR_TOKENS.ink }}>
              Repository Status
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: COLOR_TOKENS.inkLight, padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Metrics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: COLOR_TOKENS.ink }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: COLOR_TOKENS.inkLight }}>Target:</span>
              <span style={{ fontWeight: 500 }}>{data?.target === 'google-drive' ? 'Google Drive' : 'Local Disk'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: COLOR_TOKENS.inkLight }}>Last Backup:</span>
              <span data-testid="backup-last-time" style={{ fontWeight: 500 }}>{formatTime(data?.lastBackupTime)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: COLOR_TOKENS.inkLight }}>Last Cleanup:</span>
              <span data-testid="cleanup-last-time" style={{ fontWeight: 500 }}>{formatTime(data?.lastCleanupTime)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: COLOR_TOKENS.inkLight }}>Remote Files:</span>
              <span data-testid="backup-remote-files" style={{ fontWeight: 600 }}>{data?.remoteFileCount ?? 0}</span>
            </div>
            {data?.lastError && (
              <div style={{ marginTop: '4px', padding: '6px 8px', borderRadius: RADIUS_TOKENS.sm, backgroundColor: '#fdf2f2', color: COLOR_TOKENS.terracottaDark, fontSize: '11px' }}>
                {data.lastError}
              </div>
            )}
            {cleanMessage && (
              <div style={{ marginTop: '4px', padding: '6px 8px', borderRadius: RADIUS_TOKENS.sm, backgroundColor: '#f0fdf4', color: '#166534', fontSize: '11px' }}>
                {cleanMessage}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
            <button
              type="button"
              data-testid="cleanup-now-button"
              disabled={isCleaning}
              onClick={handleCleanUpNow}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                padding: '6px 10px',
                backgroundColor: COLOR_TOKENS.paperSubtle,
                border: `1px solid ${COLOR_TOKENS.border}`,
                borderRadius: RADIUS_TOKENS.sm,
                fontSize: '11px',
                fontWeight: 600,
                color: COLOR_TOKENS.ink,
                cursor: isCleaning ? 'not-allowed' : 'pointer',
              }}
            >
              {isCleaning ? <RefreshCw size={11} className="spin" /> : <Sparkles size={11} />}
              {isCleaning ? 'Cleaning...' : 'Clean up now'}
            </button>

            <button
              type="button"
              data-testid="backup-now-button"
              onClick={handleBackupNow}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                padding: '6px 10px',
                backgroundColor: COLOR_TOKENS.terracotta,
                border: 'none',
                borderRadius: RADIUS_TOKENS.sm,
                fontSize: '11px',
                fontWeight: 600,
                color: '#ffffff',
                cursor: 'pointer',
              }}
            >
              <Cloud size={11} />
              Back up now
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
