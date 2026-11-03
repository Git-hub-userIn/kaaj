import React, { useState, useEffect } from 'react';
import { X, Share2, Copy, Check, Trash2, Globe, Clock } from 'lucide-react';
import { COLOR_TOKENS, SHADOW_TOKENS, RADIUS_TOKENS, TYPOGRAPHY_TOKENS } from '@kaaj/design';
import { API_BASE_URL, getAuthHeaders } from '../../config/api.js';

export interface ShareLinkItem {
  id: string;
  token: string;
  entryId: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface ShareModalProps {
  entryId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ entryId, isOpen, onClose }) => {
  const [links, setLinks] = useState<ShareLinkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchLinks = async () => {
    if (!entryId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/entries/${encodeURIComponent(entryId)}/share`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setLinks(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load share links:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLinks();
    }
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

  const handleCreateLink = async (expiresInDays?: number) => {
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/entries/${encodeURIComponent(entryId)}/share`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(expiresInDays ? { expiresInDays } : {}),
      });
      if (res.ok) {
        const created = await res.json();
        setLinks([created, ...links]);
      }
    } catch (err) {
      console.error('Failed to create share link:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeLink = async (linkId: string) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/entries/${encodeURIComponent(entryId)}/share/${encodeURIComponent(linkId)}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders(),
        }
      );
      if (res.ok) {
        setLinks(links.filter((l) => l.id !== linkId));
      }
    } catch (err) {
      console.error('Failed to revoke share link:', err);
    }
  };

  const copyToClipboard = (token: string, linkId: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const shareUrl = `${origin}/shared/${token}`;
    navigator.clipboard?.writeText(shareUrl);
    setCopiedId(linkId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        backdropFilter: 'blur(2px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="share-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        style={{
          width: '480px',
          maxWidth: '90vw',
          backgroundColor: COLOR_TOKENS.paper,
          borderRadius: RADIUS_TOKENS.md,
          boxShadow: SHADOW_TOKENS.detailsCard,
          border: `1px solid ${COLOR_TOKENS.border}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
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
            borderBottom: `1px solid ${COLOR_TOKENS.paperDark}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={18} color={COLOR_TOKENS.terracotta} />
            <h3
              id="share-modal-title"
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 600,
                color: COLOR_TOKENS.ink,
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
              }}
            >
              Share Document
            </h3>
          </div>
          <button
            data-testid="close-share-btn"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: COLOR_TOKENS.inkMuted,
              padding: '4px',
            }}
            title="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: COLOR_TOKENS.inkMuted, lineHeight: 1.5 }}>
            Create secure, read-only links to share this entry with anyone. Recipients do not require an account.
          </p>

          <button
            data-testid="create-share-btn"
            onClick={() => handleCreateLink()}
            disabled={creating}
            style={{
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: COLOR_TOKENS.ink,
              color: COLOR_TOKENS.paper,
              border: 'none',
              borderRadius: RADIUS_TOKENS.sm,
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: creating ? 'not-allowed' : 'pointer',
            }}
          >
            <Share2 size={14} />
            <span>{creating ? 'Generating Link...' : 'Create Share Link'}</span>
          </button>

          {/* Active Links List */}
          <div style={{ marginTop: '8px' }}>
            <h4
              style={{
                margin: '0 0 10px 0',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: COLOR_TOKENS.inkMuted,
              }}
            >
              Active Share Links ({links.length})
            </h4>

            {loading ? (
              <div style={{ fontSize: '12px', color: COLOR_TOKENS.inkMuted, padding: '12px 0' }}>
                Loading links...
              </div>
            ) : links.length === 0 ? (
              <div
                data-testid="no-links-notice"
                style={{
                  fontSize: '13px',
                  color: COLOR_TOKENS.inkMuted,
                  fontStyle: 'italic',
                  padding: '12px 0',
                }}
              >
                No active share links. Click above to generate one.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {links.map((link) => {
                  const shareUrl = `${origin}/shared/${link.token}`;
                  return (
                    <div
                      key={link.id}
                      data-testid="share-link-item"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '12px',
                        borderRadius: RADIUS_TOKENS.sm,
                        border: `1px solid ${COLOR_TOKENS.paperDark}`,
                        backgroundColor: COLOR_TOKENS.paperWarm,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          data-testid="share-url-input"
                          type="text"
                          readOnly
                          value={shareUrl}
                          style={{
                            flex: 1,
                            fontSize: '12px',
                            padding: '6px 8px',
                            borderRadius: RADIUS_TOKENS.xs || '3px',
                            border: `1px solid ${COLOR_TOKENS.border}`,
                            backgroundColor: COLOR_TOKENS.paper,
                            color: COLOR_TOKENS.ink,
                            outline: 'none',
                          }}
                        />
                        <button
                          data-testid="copy-share-btn"
                          onClick={() => copyToClipboard(link.token, link.id)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '6px 10px',
                            fontSize: '12px',
                            borderRadius: RADIUS_TOKENS.xs || '3px',
                            border: `1px solid ${COLOR_TOKENS.border}`,
                            backgroundColor: COLOR_TOKENS.paper,
                            color: COLOR_TOKENS.ink,
                            cursor: 'pointer',
                          }}
                          title="Copy link to clipboard"
                        >
                          {copiedId === link.id ? <Check size={13} color="#16a34a" /> : <Copy size={13} />}
                          <span>{copiedId === link.id ? 'Copied' : 'Copy'}</span>
                        </button>
                        <button
                          data-testid="revoke-share-btn"
                          onClick={() => handleRevokeLink(link.id)}
                          style={{
                            padding: '6px',
                            fontSize: '12px',
                            borderRadius: RADIUS_TOKENS.xs || '3px',
                            border: 'none',
                            backgroundColor: 'transparent',
                            color: COLOR_TOKENS.terracotta,
                            cursor: 'pointer',
                          }}
                          title="Revoke share link"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '11px',
                          color: COLOR_TOKENS.inkMuted,
                        }}
                      >
                        <Clock size={11} />
                        <span>Created {new Date(link.createdAt).toLocaleDateString()}</span>
                        {link.expiresAt && (
                          <span>· Expires {new Date(link.expiresAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
