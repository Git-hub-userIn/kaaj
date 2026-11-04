import React, { useState, useEffect, useCallback } from 'react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
} from '@kaaj/design';
import { API_BASE_URL, getAuthHeaders , apiFetch } from '../../config/api.js';
import { Trash2, RotateCcw, X, AlertTriangle } from 'lucide-react';

export interface TrashItem {
  id: string;
  categoryId: string;
  title: string;
  deletedAt: string;
  weight: number;
  version: number;
}

export interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestored?: (entryId: string) => void;
}

export const TrashModal: React.FC<TrashModalProps> = ({
  isOpen,
  onClose,
  onRestored,
}) => {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);

  const fetchTrash = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/trash`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        throw new Error('Failed to load trash items');
      }
      const data = await res.json();
      setItems(data);
    } catch (err: any) {
      setError(err.message || 'Error loading trash');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchTrash();
    }
  }, [isOpen, fetchTrash]);

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

  const handleRestore = async (id: string) => {
    setActionLoadingId(id);
    try {
      const res = await apiFetch(`${API_BASE_URL}/entries/${id}/restore`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        throw new Error('Failed to restore entry');
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (onRestored) {
        onRestored(id);
      }
    } catch (err: any) {
      setError(err.message || 'Error restoring entry');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handlePurgeSingle = async (id: string) => {
    setActionLoadingId(id);
    try {
      const res = await apiFetch(`${API_BASE_URL}/entries/${id}/purge`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        throw new Error('Failed to permanently delete entry');
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err: any) {
      setError(err.message || 'Error deleting entry permanently');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleEmptyTrash = async () => {
    setEmptying(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/trash/purge?all=true`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        throw new Error('Failed to empty trash');
      }
      setItems([]);
    } catch (err: any) {
      setError(err.message || 'Error emptying trash');
    } finally {
      setEmptying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trash-dialog-title"
      data-testid="trash-modal"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(24, 21, 19, 0.5)',
        backdropFilter: 'blur(2px)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: COLOR_TOKENS.paper,
          borderRadius: RADIUS_TOKENS.lg,
          boxShadow: SHADOW_TOKENS.toast,
          width: '100%',
          maxWidth: '560px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: `1px solid ${COLOR_TOKENS.border}`,
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
            <Trash2 size={18} color={COLOR_TOKENS.terracotta} />
            <h2
              id="trash-dialog-title"
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: COLOR_TOKENS.ink,
                margin: 0,
              }}
            >
              Trash (Soft-Deleted Entries)
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {items.length > 0 && (
              <button
                type="button"
                data-testid="empty-trash-btn"
                disabled={emptying}
                onClick={handleEmptyTrash}
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: COLOR_TOKENS.terracottaDark,
                  backgroundColor: 'transparent',
                  border: `1px solid ${COLOR_TOKENS.border}`,
                  borderRadius: RADIUS_TOKENS.sm,
                  padding: '4px 8px',
                  cursor: emptying ? 'not-allowed' : 'pointer',
                  opacity: emptying ? 0.6 : 1,
                }}
              >
                {emptying ? 'Emptying...' : 'Empty Trash'}
              </button>
            )}
            <button
              type="button"
              data-testid="close-trash-modal-btn"
              onClick={onClose}
              aria-label="Close trash modal"
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

        {/* Content list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {loading && (
            <div style={{ padding: '24px', textAlign: 'center', color: COLOR_TOKENS.inkMuted, fontSize: '13px' }}>
              Loading trash items...
            </div>
          )}

          {!loading && items.length === 0 && (
            <div
              data-testid="trash-empty-msg"
              style={{ padding: '36px', textAlign: 'center', color: COLOR_TOKENS.inkMuted, fontSize: '14px' }}
            >
              Trash is empty. Soft-deleted items appear here for 30 days before automatic purge.
            </div>
          )}

          {items.map((item) => (
            <div
              key={item.id}
              data-testid={`trash-item-${item.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderBottom: `1px solid ${COLOR_TOKENS.paperDark}`,
                gap: '12px',
              }}
            >
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div
                  data-testid={`trash-item-title-${item.id}`}
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: COLOR_TOKENS.ink,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {item.title || 'Untitled'}
                </div>
                <div style={{ fontSize: '11px', color: COLOR_TOKENS.inkLight, marginTop: '2px' }}>
                  Deleted: {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : 'Recently'}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  data-testid={`restore-trash-item-${item.id}`}
                  disabled={actionLoadingId === item.id}
                  onClick={() => handleRestore(item.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: RADIUS_TOKENS.sm,
                    border: `1px solid ${COLOR_TOKENS.border}`,
                    backgroundColor: COLOR_TOKENS.paperDark,
                    color: COLOR_TOKENS.ink,
                    cursor: actionLoadingId === item.id ? 'not-allowed' : 'pointer',
                  }}
                >
                  <RotateCcw size={12} />
                  <span>Restore</span>
                </button>
                <button
                  type="button"
                  data-testid={`purge-trash-item-${item.id}`}
                  disabled={actionLoadingId === item.id}
                  onClick={() => handlePurgeSingle(item.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: RADIUS_TOKENS.sm,
                    border: 'none',
                    backgroundColor: '#fee2e2',
                    color: COLOR_TOKENS.terracottaDark,
                    cursor: actionLoadingId === item.id ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Trash2 size={12} />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
