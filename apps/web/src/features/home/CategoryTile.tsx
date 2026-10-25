import React, { useState } from 'react';
import type { CategoryLightRow } from '@kaaj/doc-model';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  COPY,
} from '@kaaj/design';
import { API_BASE_URL } from '../../config/api.js';

interface CategoryTileProps {
  category: CategoryLightRow;
  isHero?: boolean;
  gridSpan: {
    laptop: { colSpan: number; rowSpan: number };
    tablet: { colSpan: number; rowSpan: number };
    phone: { colSpan: number; rowSpan: number };
  };
  onNavigate: (id: string) => void;
  onDelete: (category: CategoryLightRow) => void;
  onRename: (category: CategoryLightRow, nextTitle: string) => void;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export const CategoryTile: React.FC<CategoryTileProps> = ({
  category,
  isHero = false,
  onNavigate,
  onDelete,
  onRename,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(category.title);

  const hash = hashString(category.id);

  // Deterministic tilt between -1.2 and +1.2 degrees (stable across reloads)
  const baseTilt = ((hash % 25) - 12) / 10;
  // Has washi tape on select tiles (roughly 60% of tiles)
  const hasTape = hash % 5 !== 0;
  const tapeCorner = hash % 2 === 0 ? 'right' : 'left';
  const tapeRotation = ((hash % 7) - 3) * 1.4;

  const currentTilt = isHovered ? 0 : baseTilt;
  const currentLift = isHovered ? -4 : 0;
  const safeId = category.id.replace(/[^a-zA-Z0-9_-]/g, '_');

  const handleTileClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.tile-menu-container') || isRenaming) {
      return;
    }
    e.preventDefault();
    onNavigate(category.id);
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (renameValue.trim() && renameValue !== category.title) {
      onRename(category, renameValue.trim());
    }
    setIsRenaming(false);
    setIsMenuOpen(false);
  };

  return (
    <li
      className={`category-tile-container tile-span-${safeId}`}
      data-testid={`category-tile-${category.id}`}
      style={{
        listStyle: 'none',
        position: 'relative',
        transform: `translate3d(0, ${currentLift}px, 0) rotate(${currentTilt}deg)`,
        transition: 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 220ms ease',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsMenuOpen(false);
      }}
    >
      {/* Decorative Washi Tape overlapping corner */}
      {hasTape && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '-10px',
            [tapeCorner]: '24px',
            width: '74px',
            height: '24px',
            backgroundColor: COLOR_TOKENS.washiTape,
            border: `1px solid ${COLOR_TOKENS.washiTapeBorder}`,
            boxShadow: `0 2px 5px ${COLOR_TOKENS.washiTapeShadow}`,
            transform: `rotate(${tapeRotation}deg)`,
            zIndex: 4,
            pointerEvents: 'none',
            borderRadius: RADIUS_TOKENS.xs,
          }}
        />
      )}

      {/* Primary Accessible Tile Anchor */}
      <a
        href={`/category/${category.id}`}
        onClick={handleTileClick}
        aria-label={`${category.title}, ${COPY.entryCount(category.entryCount)}`}
        style={{
          display: 'block',
          position: 'relative',
          width: '100%',
          height: '100%',
          backgroundColor: COLOR_TOKENS.paper,
          borderRadius: RADIUS_TOKENS.sm,
          border: `2.5px solid ${COLOR_TOKENS.paperBorder}`,
          boxShadow: isHovered ? SHADOW_TOKENS.tileHover : SHADOW_TOKENS.tile,
          overflow: 'hidden',
          textDecoration: 'none',
          color: 'inherit',
          outline: 'none',
          boxSizing: 'border-box',
        }}
        onFocus={() => setIsHovered(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setIsHovered(false);
          }
        }}
      >
        {/* Cover Image or Designed Placeholder */}
        {category.coverAssetId ? (
          <img
            src={`${API_BASE_URL}/assets/${category.coverAssetId}/thumb?size=960`}
            alt=""
            loading={isHero ? 'eager' : 'lazy'}
            width="800"
            height="1000"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              filter: 'saturate(0.96) contrast(1.02)',
              transition: 'transform 300ms ease',
              transform: isHovered ? 'scale(1.02)' : 'scale(1)',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: COLOR_TOKENS.paperSubtle,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `1px dashed ${COLOR_TOKENS.border}`,
            }}
          >
            <span
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
                fontSize: '48px',
                color: COLOR_TOKENS.terracotta,
                opacity: 0.4,
              }}
            >
              {category.title.charAt(0)}
            </span>
          </div>
        )}

        {/* Paper-strip caption overlapping bottom-left edge */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '-2px',
            maxWidth: 'calc(100% - 24px)',
            backgroundColor: COLOR_TOKENS.paper,
            border: `1.5px solid ${COLOR_TOKENS.paperBorder}`,
            borderRadius: RADIUS_TOKENS.xs,
            padding: `${SPACING_TOKENS.xs} ${SPACING_TOKENS.md}`,
            boxShadow: SHADOW_TOKENS.caption,
            zIndex: 2,
            transform: `rotate(${-currentTilt}deg)`, // Counter-rotate so text remains level and readable
            transition: 'transform 200ms ease',
          }}
        >
          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} style={{ display: 'flex', gap: '4px' }}>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.stopPropagation()}
                style={{
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                  fontSize: '18px',
                  border: `1px solid ${COLOR_TOKENS.terracotta}`,
                  borderRadius: RADIUS_TOKENS.xs,
                  padding: '2px 6px',
                  outline: 'none',
                  color: COLOR_TOKENS.ink,
                  backgroundColor: COLOR_TOKENS.paperWarm,
                }}
              />
              <button
                type="submit"
                style={{
                  fontSize: '12px',
                  backgroundColor: COLOR_TOKENS.terracotta,
                  color: '#fff',
                  border: 'none',
                  borderRadius: RADIUS_TOKENS.xs,
                  cursor: 'pointer',
                  padding: '2px 8px',
                  fontWeight: 600,
                }}
              >
                Save
              </button>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <span
                style={{
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                  fontSize: isHero ? '23px' : '19px',
                  fontWeight: 700,
                  color: COLOR_TOKENS.ink,
                  letterSpacing: '0.01em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.2,
                }}
              >
                {category.title}
              </span>
              <span
                style={{
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                  fontSize: '12px',
                  color: COLOR_TOKENS.inkMuted,
                  letterSpacing: '0.02em',
                  lineHeight: 1.1,
                }}
              >
                {COPY.entryCount(category.entryCount)}
              </span>
            </div>
          )}
        </div>
      </a>

      {/* Quiet Tile Action Menu (`⋯`) */}
      <div
        className="tile-menu-container"
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          zIndex: 5,
        }}
      >
        <button
          type="button"
          data-testid={`tile-menu-btn-${category.id}`}
          aria-label={`Options for ${category.title}`}
          aria-expanded={isMenuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          style={{
            width: '28px',
            height: '28px',
            borderRadius: RADIUS_TOKENS.full,
            backgroundColor: COLOR_TOKENS.paper,
            border: `1px solid ${COLOR_TOKENS.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            opacity: isHovered || isMenuOpen ? 0.95 : 0,
            transition: 'opacity 150ms ease, background-color 150ms ease',
            color: COLOR_TOKENS.ink,
            fontSize: '16px',
            lineHeight: 1,
            boxShadow: '0 1px 4px rgba(45, 35, 25, 0.1)',
          }}
        >
          ⋯
        </button>

        {isMenuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: '32px',
              right: 0,
              backgroundColor: COLOR_TOKENS.paper,
              border: `1px solid ${COLOR_TOKENS.border}`,
              borderRadius: RADIUS_TOKENS.sm,
              boxShadow: SHADOW_TOKENS.toast,
              padding: SPACING_TOKENS.xs,
              display: 'flex',
              flexDirection: 'column',
              minWidth: '130px',
              zIndex: 10,
            }}
          >
            <button
              type="button"
              role="menuitem"
              data-testid={`rename-btn-${category.id}`}
              onClick={(e) => {
                e.stopPropagation();
                setIsRenaming(true);
                setIsMenuOpen(false);
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: `${SPACING_TOKENS.sm} ${SPACING_TOKENS.md}`,
                textAlign: 'left',
                fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
                color: COLOR_TOKENS.ink,
                cursor: 'pointer',
                borderRadius: RADIUS_TOKENS.xs,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = COLOR_TOKENS.paperSubtle)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {COPY.renameCatalogue}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid={`delete-btn-${category.id}`}
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
                onDelete(category);
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: `${SPACING_TOKENS.sm} ${SPACING_TOKENS.md}`,
                textAlign: 'left',
                fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
                color: COLOR_TOKENS.terracotta,
                cursor: 'pointer',
                borderRadius: RADIUS_TOKENS.xs,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = COLOR_TOKENS.terracottaLight)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {COPY.deleteCatalogue}
            </button>
          </div>
        )}
      </div>
    </li>
  );
};
