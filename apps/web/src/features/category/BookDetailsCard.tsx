import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  COPY,
} from '@kaaj/design';
import type { EntryLightRow } from '@kaaj/doc-model';
import {
  formatRelativeAndAbsoluteTime,
  formatCreatedDate,
  formatStats,
} from './stack-utils.js';

interface BookDetailsCardProps {
  entry: EntryLightRow;
  id: string;
  anchorCoords?: { x: number; y: number } | null;
  targetEl?: HTMLElement | null;
  onDismiss?: () => void;
}

export const BookDetailsCard: React.FC<BookDetailsCardProps> = ({
  entry,
  id,
  anchorCoords,
  targetEl,
  onDismiss,
}) => {
  const [placement, setPlacement] = useState<{ x: number; y: number; width: number } | null>(null);

  useEffect(() => {
    const updatePosition = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const margin = 12;
      const cardWidth = Math.min(320, Math.max(220, viewportWidth - margin * 2));
      const cardHeight = 160;

      let x: number;
      let y: number;

      if (anchorCoords) {
        // Pointer hover placement: placed once at pointer + (16, 16) px
        let posX = anchorCoords.x + 16;
        let posY = anchorCoords.y + 16;

        // Collision flip horizontally: flip left of pointer if colliding with right edge
        if (posX + cardWidth > viewportWidth - margin) {
          posX = anchorCoords.x - 16 - cardWidth;
        }

        // Collision flip vertically: flip above pointer if colliding with bottom edge
        if (posY + cardHeight > viewportHeight - margin) {
          posY = anchorCoords.y - 16 - cardHeight;
        }

        x = Math.max(margin, Math.min(posX, viewportWidth - cardWidth - margin));
        y = Math.max(margin, Math.min(posY, viewportHeight - cardHeight - margin));
      } else if (targetEl) {
        // Keyboard focus placement: anchored to the focused book's right end
        const rect = targetEl.getBoundingClientRect();
        let posX = rect.right + 12;
        let posY = rect.top + rect.height / 2 - cardHeight / 2;

        // Flip left if colliding with right edge
        if (posX + cardWidth > viewportWidth - margin) {
          posX = rect.left - 12 - cardWidth;
        }

        // Flip above if still colliding or out of bounds
        if (posX < margin) {
          posX = rect.left;
          posY = rect.top - 12 - cardHeight;
        }

        if (posY < margin) {
          posY = rect.bottom + 12;
        }

        x = Math.max(margin, Math.min(posX, viewportWidth - cardWidth - margin));
        y = Math.max(margin, Math.min(posY, viewportHeight - cardHeight - margin));
      } else {
        return;
      }

      setPlacement({ x, y, width: cardWidth });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorCoords, targetEl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  if (!placement || typeof document === 'undefined') {
    return null;
  }

  const lastEditedStr = formatRelativeAndAbsoluteTime(entry.updatedAt);
  const createdStr = formatCreatedDate(entry.createdAt);
  const statsStr = formatStats(entry.stats);

  const cardContent = (
    <div
      id={id}
      role="tooltip"
      data-testid={`details-card-${entry.id}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        transform: `translate3d(${Math.round(placement.x)}px, ${Math.round(placement.y)}px, 0)`,
        width: `${placement.width}px`,
        maxWidth: '320px',
        zIndex: 99999,
        backgroundColor: COLOR_TOKENS.paper,
        border: `1.5px solid ${COLOR_TOKENS.border}`,
        borderRadius: RADIUS_TOKENS.sm,
        boxShadow: SHADOW_TOKENS.detailsCard,
        padding: `${SPACING_TOKENS.sm} ${SPACING_TOKENS.md}`,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        animation: 'detailsCardFade 120ms ease-out',
        textAlign: 'left',
        boxSizing: 'border-box',
      }}
      className="book-details-card"
    >
      <style>{`
        @keyframes detailsCardFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      {/* Full Title (wraps, no truncation) */}
      <div
        data-testid="details-card-title"
        style={{
          fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
          fontSize: '15px',
          fontWeight: 600,
          color: COLOR_TOKENS.ink,
          lineHeight: 1.35,
          wordBreak: 'break-word',
        }}
      >
        {entry.title}
      </div>

      <div
        style={{
          height: '1px',
          backgroundColor: COLOR_TOKENS.borderSubtle,
          margin: '2px 0',
        }}
      />

      {/* Last Edited Time */}
      <div
        style={{
          fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
          fontSize: '12px',
          color: '#554a3e',
          lineHeight: 1.4,
        }}
      >
        <strong style={{ color: COLOR_TOKENS.ink }}>{COPY.lastEdited}:</strong>{' '}
        <span data-testid="details-card-last-edited">{lastEditedStr}</span>
      </div>

      {/* Created Date */}
      <div
        style={{
          fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
          fontSize: '12px',
          color: '#554a3e',
          lineHeight: 1.4,
        }}
      >
        <strong style={{ color: COLOR_TOKENS.ink }}>{COPY.created}:</strong>{' '}
        <span data-testid="details-card-created">{createdStr}</span>
      </div>

      {/* Entry Stats: words, pages, images */}
      <div
        data-testid="details-card-stats"
        style={{
          fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
          fontSize: '12px',
          color: '#554a3e',
          lineHeight: 1.4,
        }}
      >
        {statsStr}
      </div>
    </div>
  );

  return createPortal(cardContent, document.body);
};
