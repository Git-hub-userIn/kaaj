import React, { useState, useEffect, useCallback } from 'react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
} from '@kaaj/design';
import { API_BASE_URL, getAuthHeaders , apiFetch } from '../../config/api.js';
import { X, History, RotateCcw, Clock, FileText } from 'lucide-react';

export interface RevisionSummary {
  id: string;
  entryId: string;
  version: number;
  title: string;
  createdAt: string;
}

export interface RevisionDetail extends RevisionSummary {
  manifest: any;
  doc: any;
}

export interface RevisionHistoryDrawerProps {
  entryId: string;
  isOpen: boolean;
  onClose: () => void;
  onRestored: () => void;
}

export const RevisionHistoryDrawer: React.FC<RevisionHistoryDrawerProps> = ({
  entryId,
  isOpen,
  onClose,
  onRestored,
}) => {
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<RevisionDetail | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch revisions list
  const fetchRevisions = useCallback(async () => {
    if (!entryId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/entries/${entryId}/revisions`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        throw new Error(`Failed to load revisions: ${res.statusText}`);
      }
      const data = await res.json();
      setRevisions(data);
      if (data.length > 0 && selectedVersion === null) {
        setSelectedVersion(data[0].version);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading revisions');
    } finally {
      setLoading(false);
    }
  }, [entryId, selectedVersion]);

  // Fetch preview when selected version changes
  useEffect(() => {
    if (!isOpen || selectedVersion === null || !entryId) return;
    let cancelled = false;

    async function loadPreview() {
      setLoadingPreview(true);
      try {
        const res = await apiFetch(
          `${API_BASE_URL}/entries/${entryId}/revisions/${selectedVersion}`,
          {
            headers: getAuthHeaders(),
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setSelectedRevision(data);
          }
        }
      } catch (err) {
        console.error('Failed to load revision preview:', err);
      } finally {
        if (!cancelled) {
          setLoadingPreview(false);
        }
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [entryId, isOpen, selectedVersion]);

  useEffect(() => {
    if (isOpen) {
      fetchRevisions();
    }
  }, [isOpen, fetchRevisions]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleRestore = async () => {
    if (selectedVersion === null || !entryId || restoring) return;
    setRestoring(true);
    try {
      const res = await apiFetch(
        `${API_BASE_URL}/entries/${entryId}/revisions/${selectedVersion}/restore`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
        }
      );
      if (!res.ok) {
        throw new Error('Failed to restore revision');
      }
      onRestored();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error restoring revision');
    } finally {
      setRestoring(false);
    }
  };

  if (!isOpen) return null;

  // Extract preview text from revision doc
  const getPreviewText = (rev: RevisionDetail | null): string => {
    if (!rev?.doc) return 'No content in snapshot.';
    const content = rev.doc?.doc?.content || rev.doc?.content;
    if (!Array.isArray(content)) return 'No content in snapshot.';
    return content
      .map((block: any) => {
        if (block.content && Array.isArray(block.content)) {
          return block.content.map((c: any) => c.text || '').join('');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  };

  return (
    <div
      data-testid="revision-history-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Revision History"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: '420px',
        maxWidth: '90vw',
        backgroundColor: COLOR_TOKENS.paper,
        borderLeft: `1px solid ${COLOR_TOKENS.border}`,
        boxShadow: SHADOW_TOKENS.detailsCard,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: `1px solid ${COLOR_TOKENS.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <History size={18} color={COLOR_TOKENS.terracotta} />
          <h2
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: COLOR_TOKENS.ink,
              margin: 0,
            }}
          >
            Revision History
          </h2>
        </div>
        <button
          type="button"
          data-testid="close-history-drawer-btn"
          onClick={onClose}
          aria-label="Close revision history"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            color: COLOR_TOKENS.inkMuted,
            borderRadius: RADIUS_TOKENS.sm,
          }}
        >
          <X size={18} />
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 20px',
            backgroundColor: '#fef2f2',
            color: COLOR_TOKENS.terracottaDark,
            fontSize: '13px',
            borderBottom: `1px solid ${COLOR_TOKENS.border}`,
          }}
        >
          {error}
        </div>
      )}

      {/* Main Container: Split into Revisions List and Selected Preview */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {/* Revisions List */}
        <div
          style={{
            maxHeight: '220px',
            overflowY: 'auto',
            borderBottom: `1px solid ${COLOR_TOKENS.border}`,
            padding: '8px 12px',
          }}
        >
          {loading && (
            <div style={{ padding: '16px', textAlign: 'center', color: COLOR_TOKENS.inkMuted, fontSize: '13px' }}>
              Loading revision history...
            </div>
          )}
          {!loading && revisions.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: COLOR_TOKENS.inkMuted, fontSize: '13px' }}>
              No revisions saved yet.
            </div>
          )}
          {revisions.map((rev) => {
            const isSelected = selectedVersion === rev.version;
            return (
              <div
                key={rev.id || rev.version}
                data-testid={`revision-item-${rev.version}`}
                onClick={() => setSelectedVersion(rev.version)}
                style={{
                  padding: '10px 12px',
                  borderRadius: RADIUS_TOKENS.md,
                  cursor: 'pointer',
                  backgroundColor: isSelected ? COLOR_TOKENS.paperDark : 'transparent',
                  marginBottom: '4px',
                  transition: 'background-color 0.15s ease',
                  border: isSelected ? `1px solid ${COLOR_TOKENS.border}` : '1px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: COLOR_TOKENS.ink }}>
                    Version {rev.version}
                  </span>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      color: COLOR_TOKENS.inkLight,
                    }}
                  >
                    <Clock size={12} />
                    <span>{new Date(rev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: COLOR_TOKENS.inkMuted,
                    marginTop: '2px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {rev.title || 'Untitled'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Revision Preview */}
        <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: COLOR_TOKENS.inkLight,
              marginBottom: '8px',
            }}
          >
            Revision Preview {selectedVersion ? `(v${selectedVersion})` : ''}
          </div>

          {loadingPreview ? (
            <div style={{ color: COLOR_TOKENS.inkMuted, fontSize: '13px', padding: '12px 0' }}>
              Loading snapshot preview...
            </div>
          ) : selectedRevision ? (
            <div
              data-testid="revision-preview-content"
              style={{
                flex: 1,
                backgroundColor: COLOR_TOKENS.paperDark,
                borderRadius: RADIUS_TOKENS.md,
                padding: '14px',
                fontSize: '13px',
                lineHeight: 1.6,
                color: COLOR_TOKENS.ink,
                whiteSpace: 'pre-wrap',
                overflowY: 'auto',
                border: `1px solid ${COLOR_TOKENS.border}`,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '8px', borderBottom: `1px solid ${COLOR_TOKENS.border}`, paddingBottom: '4px' }}>
                {selectedRevision.title}
              </div>
              <div>{getPreviewText(selectedRevision)}</div>
            </div>
          ) : (
            <div style={{ color: COLOR_TOKENS.inkMuted, fontSize: '13px', padding: '12px 0' }}>
              Select a version above to preview snapshot.
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: `1px solid ${COLOR_TOKENS.border}`,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 14px',
              borderRadius: RADIUS_TOKENS.md,
              border: `1px solid ${COLOR_TOKENS.border}`,
              backgroundColor: 'transparent',
              color: COLOR_TOKENS.inkMuted,
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="restore-revision-btn"
            disabled={!selectedRevision || restoring}
            onClick={handleRestore}
            style={{
              padding: '8px 14px',
              borderRadius: RADIUS_TOKENS.md,
              border: 'none',
              backgroundColor: COLOR_TOKENS.terracotta,
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 500,
              cursor: !selectedRevision || restoring ? 'not-allowed' : 'pointer',
              opacity: !selectedRevision || restoring ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RotateCcw size={14} />
            <span>{restoring ? 'Restoring...' : 'Restore this version'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
