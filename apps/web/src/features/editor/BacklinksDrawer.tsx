import React, { useEffect, useState } from 'react';
import { X, Link2, ExternalLink } from 'lucide-react';
import { COLOR_TOKENS, SHADOW_TOKENS } from '@kaaj/design';
import { API_BASE_URL, getAuthHeaders , apiFetch } from '../../config/api.js';

interface BacklinkItem {
  id: string;
  title: string;
  categoryId: string;
  updatedAt: string;
}

interface BacklinksDrawerProps {
  entryId: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigateToEntry?: (entryId: string) => void;
}

export const BacklinksDrawer: React.FC<BacklinksDrawerProps> = ({
  entryId,
  isOpen,
  onClose,
  onNavigateToEntry,
}) => {
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !entryId) return;

    let cancelled = false;
    setLoading(true);

    apiFetch(`${API_BASE_URL}/entries/${encodeURIComponent(entryId)}/backlinks`, {
      headers: getAuthHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load backlinks');
        return res.json();
      })
      .then((data: BacklinkItem[]) => {
        if (!cancelled) {
          setBacklinks(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load backlinks:', err);
        if (!cancelled) {
          setBacklinks([]);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, entryId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="backlinks-drawer"
      role="dialog"
      aria-label="Backlinks and Mentions"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: '360px',
        maxWidth: '90vw',
        backgroundColor: COLOR_TOKENS.paper,
        boxShadow: SHADOW_TOKENS.detailsCard,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: `1px solid ${COLOR_TOKENS.paperDark}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px',
          borderBottom: `1px solid ${COLOR_TOKENS.paperDark}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Link2 size={16} color={COLOR_TOKENS.ink} />
          <h3
            style={{
              margin: 0,
              fontSize: '14px',
              fontWeight: 600,
              color: COLOR_TOKENS.ink,
              fontFamily: 'serif',
            }}
          >
            Backlinks & Mentions
          </h3>
          <span
            style={{
              fontSize: '12px',
              padding: '2px 6px',
              borderRadius: '10px',
              backgroundColor: COLOR_TOKENS.paperDark,
              color: COLOR_TOKENS.inkMuted,
            }}
          >
            {backlinks.length}
          </span>
        </div>
        <button
          data-testid="close-backlinks-btn"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            color: COLOR_TOKENS.inkMuted,
          }}
          title="Close drawer"
        >
          <X size={18} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {loading ? (
          <div
            style={{
              textAlign: 'center',
              padding: '32px 0',
              color: COLOR_TOKENS.inkMuted,
              fontSize: '13px',
            }}
          >
            Searching mentions...
          </div>
        ) : backlinks.length === 0 ? (
          <div
            data-testid="empty-backlinks-notice"
            style={{
              textAlign: 'center',
              padding: '32px 16px',
              color: COLOR_TOKENS.inkMuted,
              fontSize: '13px',
              fontStyle: 'italic',
            }}
          >
            No other entries link to this document yet. Type [[Title]] in another entry to create a wikilink.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {backlinks.map((link) => (
              <div
                key={link.id}
                data-testid="backlink-item"
                onClick={() => {
                  if (onNavigateToEntry) {
                    onNavigateToEntry(link.id);
                  }
                }}
                style={{
                  padding: '12px',
                  borderRadius: '6px',
                  border: `1px solid ${COLOR_TOKENS.paperDark}`,
                  backgroundColor: COLOR_TOKENS.paperWarm,
                  cursor: onNavigateToEntry ? 'pointer' : 'default',
                  transition: 'background-color 0.15s ease',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '4px',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: '13px',
                      color: COLOR_TOKENS.ink,
                    }}
                  >
                    {link.title || 'Untitled Entry'}
                  </span>
                  {onNavigateToEntry && <ExternalLink size={12} color={COLOR_TOKENS.inkMuted} />}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: COLOR_TOKENS.inkMuted,
                  }}
                >
                  Referenced via [[{link.title}]]
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
