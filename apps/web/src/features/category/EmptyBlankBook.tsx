import React from 'react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  COPY,
} from '@kaaj/design';
import { RiAddLine } from '@remixicon/react';

interface EmptyBlankBookProps {
  onCreateFirstEntry: () => void;
  isCreating?: boolean;
}

export const EmptyBlankBook: React.FC<EmptyBlankBookProps> = ({
  onCreateFirstEntry,
  isCreating = false,
}) => {
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: `${SPACING_TOKENS.xxl} 0`,
      }}
    >
      <button
        type="button"
        data-testid="empty-blank-book"
        onClick={onCreateFirstEntry}
        disabled={isCreating}
        aria-label={COPY.emptyStackAction}
        style={{
          width: '90%',
          maxWidth: '720px',
          height: '76px',
          backgroundColor: COLOR_TOKENS.paperWarm,
          border: `2px dashed ${COLOR_TOKENS.border}`,
          borderRadius: RADIUS_TOKENS.md,
          boxShadow: SHADOW_TOKENS.tile,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SPACING_TOKENS.md,
          cursor: isCreating ? 'wait' : 'pointer',
          padding: `0 ${SPACING_TOKENS.xl}`,
          transition: 'all 180ms ease-out',
        }}
      >
        <style>{`
          [data-testid="empty-blank-book"]:hover {
            border-color: ${COLOR_TOKENS.terracotta};
            background-color: ${COLOR_TOKENS.paper};
            transform: translateY(-2px);
          }
          [data-testid="empty-blank-book"]:focus-visible {
            outline: 2.5px solid ${COLOR_TOKENS.terracotta};
            outline-offset: 3px;
          }
        `}</style>

        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: RADIUS_TOKENS.full,
            backgroundColor: COLOR_TOKENS.terracottaLight,
            color: COLOR_TOKENS.terracotta,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <RiAddLine size={20} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <span
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
              fontSize: '18px',
              fontWeight: 600,
              color: COLOR_TOKENS.ink,
            }}
          >
            {isCreating ? 'Creating entry...' : COPY.emptyStackAction}
          </span>
          <span
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
              fontSize: '14px',
              color: COLOR_TOKENS.inkMuted,
            }}
          >
            {COPY.emptyStackTitle}
          </span>
        </div>
      </button>
    </div>
  );
};
