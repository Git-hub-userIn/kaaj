import React from 'react';
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
}

export const BookDetailsCard: React.FC<BookDetailsCardProps> = ({ entry, id }) => {
  const lastEditedStr = formatRelativeAndAbsoluteTime(entry.updatedAt);
  const createdStr = formatCreatedDate(entry.createdAt);
  const statsStr = formatStats(entry.stats);

  return (
    <div
      id={id}
      role="tooltip"
      data-testid={`details-card-${entry.id}`}
      style={{
        position: 'absolute',
        zIndex: 80,
        backgroundColor: COLOR_TOKENS.paper,
        border: `1.5px solid ${COLOR_TOKENS.border}`,
        borderRadius: RADIUS_TOKENS.sm,
        boxShadow: SHADOW_TOKENS.detailsCard,
        padding: `${SPACING_TOKENS.sm} ${SPACING_TOKENS.md}`,
        minWidth: '240px',
        maxWidth: '320px',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        animation: 'detailsCardFade 150ms ease-out',
        textAlign: 'left',
      }}
      className="book-details-card"
    >
      <style>{`
        @keyframes detailsCardFade {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* Desktop: appear to the right of the book */
        @media (min-width: 1024px) {
          .book-details-card {
            top: 50%;
            left: calc(100% + 18px);
            transform: translateY(-50%);
          }
        }
        /* Tablet & Mobile: appear above the book */
        @media (max-width: 1023px) {
          .book-details-card {
            bottom: calc(100% + 8px);
            left: 12px;
            max-width: calc(100vw - 48px);
          }
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
          color: COLOR_TOKENS.inkMuted,
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
          color: COLOR_TOKENS.inkMuted,
          lineHeight: 1.4,
        }}
      >
        <strong style={{ color: COLOR_TOKENS.ink }}>{COPY.created}:</strong>{' '}
        <span data-testid="details-card-created">{createdStr}</span>
      </div>

      {/* Stats (words, pages, images) */}
      <div
        style={{
          fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
          fontSize: '12px',
          color: COLOR_TOKENS.terracottaDark,
          fontWeight: 500,
          marginTop: '2px',
        }}
      >
        <span data-testid="details-card-stats">{statsStr}</span>
      </div>
    </div>
  );
};
