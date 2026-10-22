import React from 'react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  COPY,
} from '@kaaj/design';
import { RiExpandUpDownLine } from '@remixicon/react';

interface OlderEntriesPileProps {
  count: number;
  onExpand: () => void;
}

export const OlderEntriesPile: React.FC<OlderEntriesPileProps> = ({ count, onExpand }) => {
  return (
    <li
      style={{
        listStyle: 'none',
        position: 'relative',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        margin: `${SPACING_TOKENS.sm} 0`,
      }}
    >
      <button
        type="button"
        data-testid="older-entries-pile"
        onClick={onExpand}
        aria-label={`${count} older entries, click to expand`}
        style={{
          width: '94%',
          height: '52px',
          backgroundColor: COLOR_TOKENS.paperSubtle,
          border: `1.5px dashed ${COLOR_TOKENS.border}`,
          borderRadius: RADIUS_TOKENS.sm,
          boxShadow: SHADOW_TOKENS.caption,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SPACING_TOKENS.sm,
          cursor: 'pointer',
          padding: `0 ${SPACING_TOKENS.md}`,
          position: 'relative',
          transition: 'all 150ms ease-out',
        }}
      >
        <style>{`
          [data-testid="older-entries-pile"]:hover {
            background-color: ${COLOR_TOKENS.paperWarm};
            border-color: ${COLOR_TOKENS.terracotta};
            transform: translateY(-1px);
          }
          [data-testid="older-entries-pile"]:focus-visible {
            outline: 2.5px solid ${COLOR_TOKENS.terracotta};
            outline-offset: 2px;
          }
        `}</style>

        {/* Layered book edges visual motif */}
        <div
          style={{
            position: 'absolute',
            left: '20px',
            top: '8px',
            bottom: '8px',
            display: 'flex',
            gap: '3px',
            alignItems: 'center',
            opacity: 0.6,
          }}
        >
          <div style={{ width: '4px', height: '100%', backgroundColor: COLOR_TOKENS.slate, borderRadius: '1px' }} />
          <div style={{ width: '5px', height: '90%', backgroundColor: COLOR_TOKENS.amber, borderRadius: '1px' }} />
          <div style={{ width: '3px', height: '95%', backgroundColor: COLOR_TOKENS.moss, borderRadius: '1px' }} />
        </div>

        <span
          style={{
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
            fontSize: '17px',
            color: COLOR_TOKENS.inkMuted,
            letterSpacing: '0.02em',
          }}
        >
          {COPY.olderEntries(count)}
        </span>

        <RiExpandUpDownLine size={16} color={COLOR_TOKENS.inkLight} />
      </button>
    </li>
  );
};
