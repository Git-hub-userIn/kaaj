import React, { useMemo } from 'react';
import type { EntryLightRow } from '@kaaj/doc-model';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
} from '@kaaj/design';
import { getPileLabel, formatRelativeAndAbsoluteTime } from './stack-utils.js';

interface CategoryLeftRailProps {
  piles: EntryLightRow[][];
  currentSort: 'date' | 'title' | 'length';
  entries: EntryLightRow[];
  activePileIdx: number;
  onSelectPile: (pileIdx: number) => void;
}

export const CategoryLeftRail: React.FC<CategoryLeftRailProps> = ({
  piles,
  currentSort,
  entries,
  activePileIdx,
  onSelectPile,
}) => {
  const totalWords = useMemo(() => {
    return entries.reduce((sum, e) => sum + (e.stats?.words ?? 0), 0);
  }, [entries]);

  const lastEditedTime = useMemo(() => {
    if (entries.length === 0) return 'None';
    let latest = entries[0].updatedAt;
    for (const entry of entries) {
      if (new Date(entry.updatedAt).getTime() > new Date(latest).getTime()) {
        latest = entry.updatedAt;
      }
    }
    return formatRelativeAndAbsoluteTime(latest);
  }, [entries]);

  return (
    <aside
      data-testid="category-left-rail"
      aria-label="Catalogue navigation and summary"
      style={{
        width: '220px',
        flexShrink: 0,
        position: 'sticky',
        top: '72px',
        maxHeight: 'calc(100vh - 96px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: SPACING_TOKENS.lg,
        padding: `${SPACING_TOKENS.md} ${SPACING_TOKENS.sm}`,
        boxSizing: 'border-box',
      }}
    >
      {/* "Jump to" Section */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: SPACING_TOKENS.xs,
        }}
      >
        <span
          style={{
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
            fontSize: '18px',
            color: '#42372c',
            fontWeight: 700,
            letterSpacing: '0.02em',
            paddingLeft: '6px',
            marginBottom: '4px',
          }}
        >
          Jump to
        </span>

        <nav aria-label="Pile quick links">
          <ul
            data-testid="jump-to-list"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {piles.map((pileBooks, pileIdx) => {
              const label = getPileLabel(pileBooks, pileIdx, currentSort);
              const isActive = activePileIdx === pileIdx;

              return (
                <li key={`rail-pile-${pileIdx}`}>
                  <button
                    type="button"
                    data-testid={`jump-to-pile-${pileIdx}`}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => onSelectPile(pileIdx)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      padding: '6px 10px',
                      background: isActive ? '#f1ebe0' : 'transparent',
                      border: 'none',
                      borderLeft: isActive
                        ? `3px solid ${COLOR_TOKENS.terracotta}`
                        : '3px solid transparent',
                      borderRadius: RADIUS_TOKENS.xs,
                      cursor: 'pointer',
                      color: isActive ? COLOR_TOKENS.ink : '#4a3f33',
                      fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                      fontSize: '15px',
                      fontWeight: isActive ? 700 : 500,
                      transition: 'background-color 140ms ease, border-left-color 140ms ease',
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
                      data-testid={`jump-to-count-${pileIdx}`}
                      style={{
                        fontSize: '12px',
                        fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                        color: '#6e5e4e',
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      ({pileBooks.length})
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* Summary Section */}
      <div
        data-testid="category-summary"
        style={{
          borderTop: `1px dashed ${COLOR_TOKENS.border}`,
          paddingTop: SPACING_TOKENS.md,
          paddingLeft: '6px',
          paddingRight: '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
          fontSize: '12px',
          color: '#42372c',
        }}
      >
        <span
          style={{
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
            fontSize: '15px',
            color: '#42372c',
            fontWeight: 700,
            marginBottom: '2px',
          }}
        >
          Summary
        </span>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#686259' }}>Entries:</span>
          <strong data-testid="summary-total-entries" style={{ color: COLOR_TOKENS.ink }}>
            {entries.length}
          </strong>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#686259' }}>Words:</span>
          <strong data-testid="summary-total-words" style={{ color: COLOR_TOKENS.ink }}>
            {totalWords.toLocaleString()}
          </strong>
        </div>

        <div style={{ marginTop: '4px' }}>
          <span style={{ color: '#686259', display: 'block', marginBottom: '2px' }}>Last edited:</span>
          <span
            data-testid="summary-last-edited"
            style={{
              color: COLOR_TOKENS.ink,
              fontWeight: 500,
              fontSize: '11px',
              lineHeight: 1.3,
              display: 'block',
            }}
          >
            {lastEditedTime}
          </span>
        </div>
      </div>
    </aside>
  );
};
