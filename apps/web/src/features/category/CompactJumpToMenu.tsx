import React, { useState, useRef, useEffect } from 'react';
import type { EntryLightRow } from '@kaaj/doc-model';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
} from '@kaaj/design';
import { getPileLabel } from './stack-utils.js';
import { RiArrowDownSLine } from '@remixicon/react';

interface CompactJumpToMenuProps {
  piles: EntryLightRow[][];
  currentSort: 'date' | 'title' | 'length';
  onSelectPile: (pileIdx: number) => void;
}

export const CompactJumpToMenu: React.FC<CompactJumpToMenuProps> = ({
  piles,
  currentSort,
  onSelectPile,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      data-testid="compact-jump-to-container"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <button
        type="button"
        data-testid="compact-jump-to-btn"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          backgroundColor: COLOR_TOKENS.paperSubtle,
          border: `1px solid ${COLOR_TOKENS.border}`,
          borderRadius: RADIUS_TOKENS.sm,
          padding: '4px 10px',
          fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
          fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
          fontWeight: 600,
          color: COLOR_TOKENS.ink,
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(40, 30, 20, 0.06)',
        }}
      >
        <span>Jump to...</span>
        <RiArrowDownSLine size={14} color="#686259" />
      </button>

      {isOpen && (
        <div
          role="menu"
          data-testid="compact-jump-to-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '6px',
            backgroundColor: COLOR_TOKENS.paper,
            border: `1.5px solid ${COLOR_TOKENS.border}`,
            borderRadius: RADIUS_TOKENS.sm,
            boxShadow: SHADOW_TOKENS.detailsCard,
            minWidth: '180px',
            maxWidth: '240px',
            padding: SPACING_TOKENS.xs,
            zIndex: 90,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {piles.map((pileBooks, pileIdx) => {
            const label = getPileLabel(pileBooks, pileIdx, currentSort);

            return (
              <button
                key={`compact-pile-${pileIdx}`}
                type="button"
                role="menuitem"
                data-testid={`compact-jump-pile-${pileIdx}`}
                onClick={() => {
                  setIsOpen(false);
                  onSelectPile(pileIdx);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  width: '100%',
                  padding: '6px 8px',
                  border: 'none',
                  background: 'none',
                  borderRadius: RADIUS_TOKENS.xs,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                  fontSize: '14px',
                  color: COLOR_TOKENS.ink,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = COLOR_TOKENS.paperSubtle;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <span
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                    color: '#6e5e4e',
                    fontWeight: 600,
                  }}
                >
                  ({pileBooks.length})
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
