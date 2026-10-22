import React, { useState, useRef, useEffect } from 'react';
import type { EntryLightRow, CategoryLightRow } from '@kaaj/doc-model';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  STACK_CONFIG,
  SPINE_TEXTURES,
  SPINE_FONTS,
  SPINE_FINISHES,
} from '@kaaj/design';
import { getBookGeometry, formatDate } from './stack-utils.js';
import { BookSpineMenu } from './BookSpineMenu.js';
import { BookDetailsCard } from './BookDetailsCard.js';
import { RiMoreFill, RiPushpinFill } from '@remixicon/react';

interface BookSpineProps {
  entry: EntryLightRow;
  categories: CategoryLightRow[];
  currentCategoryId: string;
  onOpen: (entryId: string) => void;
  onRename: (entryId: string, newTitle: string) => void;
  onMoveToCategory: (entryId: string, targetCategoryId: string) => void;
  onSelectColor: (entryId: string, colorKey: string) => void;
  onOpenSpineCustomizer?: (entryId: string) => void;
  onTogglePin: (entryId: string) => void;
  onDelete: (entryId: string) => void;
  onPrefetch?: (entryId: string) => void;
}

export const BookSpine: React.FC<BookSpineProps> = ({
  entry,
  categories,
  currentCategoryId,
  onOpen,
  onRename,
  onMoveToCategory,
  onSelectColor,
  onOpenSpineCustomizer,
  onTogglePin,
  onDelete,
  onPrefetch,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.title);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spineRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const hasCustomSpine = Boolean(entry.spine);
  const geometry = getBookGeometry(entry.id, entry.weight, entry.color, hasCustomSpine);
  const formattedDate = formatDate(entry.updatedAt);
  const accessibleName = `${entry.title}, ${formattedDate || 'recent'}, weight ${entry.weight}`;
  const detailsCardId = `details-card-${entry.id}`;

  // Spine visual properties (from custom spine or defaults)
  const textureConfig = entry.spine?.texture
    ? SPINE_TEXTURES[entry.spine.texture]
    : SPINE_TEXTURES.cloth;

  const fontConfig = entry.spine?.font
    ? SPINE_FONTS[entry.spine.font]
    : SPINE_FONTS.newsreader;

  const finishConfig = entry.spine?.finish
    ? SPINE_FINISHES[entry.spine.finish]
    : SPINE_FINISHES['gold-foil'];

  const bandsConfig = entry.spine?.bands ?? 'two';

  const spineBgColor = entry.spine?.color || geometry.palette.bg;
  const isForeEdge = geometry.variant === 'fore-edge';

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // Global Escape key listener to dismiss details card per spec
  useEffect(() => {
    if (!showDetails) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDetails(false);
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [showDetails]);

  // Hover delay handling (250 ms delay per spec)
  const handlePointerEnter = () => {
    setIsHovered(true);
    onPrefetch?.(entry.id);

    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setShowDetails(true);
    }, STACK_CONFIG.detailsCardDelayMs);
  };

  const handlePointerLeave = () => {
    setIsHovered(false);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (!isFocused) {
      setShowDetails(false);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    setShowDetails(true);
    onPrefetch?.(entry.id);
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Check if new focus target is still inside this spine
    if (spineRef.current && spineRef.current.contains(e.relatedTarget as Node)) {
      return;
    }
    setIsFocused(false);
    if (!isHovered) {
      setShowDetails(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsMenuOpen(true);
    setShowDetails(false);
  };

  const handleTouchStart = () => {
    longPressTimerRef.current = setTimeout(() => {
      setIsMenuOpen(true);
      setShowDetails(false);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleSpineClick = (e: React.MouseEvent) => {
    if (isRenaming || isMenuOpen) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-testid^="book-menu"]') || target.closest('[data-testid^="rename-input"]')) {
      return;
    }
    onOpen(entry.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowDetails(false);
      if (isRenaming) {
        setRenameValue(entry.title);
        setIsRenaming(false);
      }
      return;
    }
    if (e.key === 'ContextMenu') {
      e.preventDefault();
      e.stopPropagation();
      setIsMenuOpen(true);
      setShowDetails(false);
      return;
    }
    if (e.key === 'Enter' && !isRenaming && !isMenuOpen) {
      const target = e.target as HTMLElement;
      if (target === spineRef.current) {
        e.preventDefault();
        onOpen(entry.id);
      }
    }
  };

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== entry.title) {
      onRename(entry.id, trimmed);
    } else {
      setRenameValue(entry.title);
    }
    setIsRenaming(false);
  };

  return (
    <li
      style={{
        listStyle: 'none',
        position: 'relative',
        margin: '0',
        padding: '0',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        marginTop: '-2px',
        zIndex: isMenuOpen ? 70 : (showDetails ? 50 : (isHovered || isFocused ? 20 : 1)),
      }}
    >
      <div
        ref={spineRef}
        role="link"
        aria-label={accessibleName}
        aria-describedby={showDetails ? detailsCardId : undefined}
        data-testid={`book-spine-${entry.id}`}
        data-entry-id={entry.id}
        tabIndex={0}
        onClick={handleSpineClick}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleKeyDown}
        className={`book-spine-item ${entry.id}`}
        style={{
          display: 'block',
          position: 'relative',
          boxSizing: 'border-box',
          width: `${geometry.widthPercent}%`,
          height: `${geometry.heightPx}px`,
          backgroundColor: isForeEdge ? '#faf6ee' : spineBgColor,
          backgroundImage: isForeEdge
            ? 'repeating-linear-gradient(0deg, #ede7db 0px, #ede7db 1px, #faf6ee 1px, #faf6ee 3px)'
            : `${textureConfig.cssPattern}, radial-gradient(circle at 0% 0%, rgba(255,255,255,0.12) 0%, transparent 12px), radial-gradient(circle at 100% 0%, rgba(255,255,255,0.12) 0%, transparent 12px), radial-gradient(circle at 0% 100%, rgba(0,0,0,0.2) 0%, transparent 12px), radial-gradient(circle at 100% 100%, rgba(0,0,0,0.2) 0%, transparent 12px)`,
          borderRadius: RADIUS_TOKENS.xs,
          boxShadow: isHovered || isFocused ? SHADOW_TOKENS.bookSpineHover : SHADOW_TOKENS.bookSpine,
          borderTop: isForeEdge
            ? `3px solid ${spineBgColor}`
            : '1.5px solid rgba(255, 255, 255, 0.28)',
          borderBottom: isForeEdge
            ? `3px solid ${spineBgColor}`
            : '2.5px solid rgba(0, 0, 0, 0.38)',
          cursor: isRenaming ? 'text' : 'pointer',
          userSelect: 'none',
          outlineOffset: '2px',
          transform: `translateX(${geometry.offsetDesktopPx + (isHovered || isFocused ? STACK_CONFIG.slideOffsetPx : 0)}px) rotate(${geometry.tiltDeg}deg)`,
          transition: 'transform 180ms cubic-bezier(0.2, 0, 0, 1), box-shadow 180ms ease-out',
        }}
      >
        <style>{`
          .book-spine-item:focus-visible {
            outline: 2.5px solid ${COLOR_TOKENS.terracotta};
            outline-offset: 3px;
            z-index: 30;
          }
          @media (prefers-reduced-motion: reduce) {
            .book-spine-item {
              transition: none !important;
              animation: none !important;
            }
          }
          @media (max-width: 640px) {
            .book-spine-item {
              width: 98% !important;
              transform: translateX(${geometry.offsetMobilePx + (isHovered || isFocused ? 6 : 0)}px) rotate(${geometry.tiltDeg * 0.7}deg) !important;
            }
            .book-spine-content {
              padding: 0 10px !important;
            }
          }
        `}</style>

        {/* Cream Page Edge Caps on left and right (Spine view) */}
        {!isForeEdge && (
          <>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '10px',
                background: 'repeating-linear-gradient(0deg, #ede7db 0px, #ede7db 1px, #fdfbf7 1px, #fdfbf7 3px)',
                borderRight: '1px solid rgba(0,0,0,0.18)',
                zIndex: 2,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: '10px',
                background: 'repeating-linear-gradient(0deg, #ede7db 0px, #ede7db 1px, #fdfbf7 1px, #fdfbf7 3px)',
                borderLeft: '1px solid rgba(0,0,0,0.18)',
                zIndex: 2,
                pointerEvents: 'none',
              }}
            />
          </>
        )}

        {/* Raised Vertical Gilt Bands (Spine view) */}
        {!isForeEdge && bandsConfig !== 'none' && (
          <>
            <div
              style={{
                position: 'absolute',
                left: '28px',
                top: 0,
                bottom: 0,
                width: bandsConfig === 'three' ? '12px' : '8px',
                borderLeft: '1.5px solid rgba(245, 215, 127, 0.75)',
                borderRight: bandsConfig === 'three' ? '1.5px solid rgba(245, 215, 127, 0.75)' : undefined,
                boxShadow: '0 0 2px rgba(0,0,0,0.3)',
                zIndex: 3,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                right: '80px',
                top: 0,
                bottom: 0,
                width: bandsConfig === 'three' ? '12px' : '8px',
                borderLeft: '1.5px solid rgba(245, 215, 127, 0.75)',
                borderRight: bandsConfig === 'three' ? '1.5px solid rgba(245, 215, 127, 0.75)' : undefined,
                boxShadow: '0 0 2px rgba(0,0,0,0.3)',
                zIndex: 3,
                pointerEvents: 'none',
              }}
            />
          </>
        )}

        {/* Physical Props: Red ribbon bookmark hanging from book = pinned */}
        {entry.pinned && (
          <div
            data-testid={`pinned-ribbon-${entry.id}`}
            title="Pinned bookmark"
            style={{
              position: 'absolute',
              bottom: '-16px',
              left: '32px',
              width: '14px',
              height: '24px',
              backgroundColor: COLOR_TOKENS.ribbonBookmark,
              clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 82%, 0 100%)',
              boxShadow: '0 3px 6px rgba(0,0,0,0.28)',
              zIndex: 25,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Physical Props: Yellow sticky flag */}
        {geometry.hasStickyFlag && (
          <div
            data-testid={`sticky-flag-${entry.id}`}
            title="Sticky flag"
            style={{
              position: 'absolute',
              top: '-10px',
              left: `${geometry.flagOffsetPercent}%`,
              width: '28px',
              height: '16px',
              backgroundColor: COLOR_TOKENS.stickyFlag,
              borderTop: `1px solid ${COLOR_TOKENS.stickyFlagBorder}`,
              borderRadius: '1px',
              transform: 'rotate(-2.5deg)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.14)',
              zIndex: 15,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Physical Props: Rubber band */}
        {geometry.hasRubberBand && (
          <div
            data-testid={`rubber-band-${entry.id}`}
            title="Rubber band"
            style={{
              position: 'absolute',
              top: '-3px',
              bottom: '-3px',
              left: `${geometry.rubberBandOffsetPercent}%`,
              width: '5px',
              backgroundColor: COLOR_TOKENS.rubberBand,
              boxShadow: `0 0 3px ${COLOR_TOKENS.rubberBandShadow}, inset 0 1px 1px rgba(255,255,255,0.4)`,
              borderRadius: '1px',
              zIndex: 14,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Counter-rotated content container so titles stay strictly horizontal */}
        <div
          className="book-spine-content"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `0 ${SPACING_TOKENS.lg}`,
            boxSizing: 'border-box',
            transform: `rotate(${-geometry.tiltDeg}deg)`,
            transformOrigin: 'center center',
            position: 'relative',
            zIndex: 10,
          }}
        >
          {/* Left side: Pin icon + Title */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: SPACING_TOKENS.sm,
              minWidth: 0,
              flex: 1,
              paddingLeft: !isForeEdge ? '14px' : '8px',
              paddingRight: SPACING_TOKENS.md,
            }}
          >
            {entry.pinned && (
              <span
                data-testid={`pin-indicator-${entry.id}`}
                title="Pinned entry"
                style={{
                  color: isForeEdge ? COLOR_TOKENS.terracotta : geometry.palette.accent,
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <RiPushpinFill size={15} />
              </span>
            )}

            {isRenaming ? (
              <input
                ref={renameInputRef}
                type="text"
                data-testid={`rename-input-${entry.id}`}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') {
                    setRenameValue(entry.title);
                    setIsRenaming(false);
                  }
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontFamily: fontConfig.fontFamily,
                  fontSize: '16px',
                  fontWeight: 600,
                  color: COLOR_TOKENS.ink,
                  backgroundColor: COLOR_TOKENS.paper,
                  border: `1.5px solid ${COLOR_TOKENS.terracotta}`,
                  borderRadius: RADIUS_TOKENS.xs,
                  padding: '2px 6px',
                  width: '80%',
                  outline: 'none',
                }}
              />
            ) : isForeEdge ? (
              /* Fore-edge variant: title on a taped paper tab */
              <div
                style={{
                  backgroundColor: COLOR_TOKENS.paperWarm,
                  border: `1px solid ${COLOR_TOKENS.border}`,
                  padding: '3px 10px',
                  borderRadius: RADIUS_TOKENS.xs,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  maxWidth: '85%',
                  position: 'relative',
                }}
              >
                {/* Washi tape at tab top */}
                <div
                  style={{
                    position: 'absolute',
                    top: '-6px',
                    left: '12px',
                    width: '26px',
                    height: '10px',
                    backgroundColor: COLOR_TOKENS.washiTape,
                    border: `1px solid ${COLOR_TOKENS.washiTapeBorder}`,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                  }}
                />
                <span
                  data-testid={`book-title-${entry.id}`}
                  style={{
                    fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                    fontSize: '14px',
                    fontWeight: 600,
                    color: COLOR_TOKENS.ink,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {entry.title}
                </span>
              </div>
            ) : (
              /* Standard Spine: Title stamped in foil or ink */
              <span
                data-testid={`book-title-${entry.id}`}
                style={{
                  fontFamily: fontConfig.fontFamily,
                  fontSize: '17px',
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: finishConfig.textColor,
                  textShadow: finishConfig.textShadow,
                  lineHeight: 1.2,
                }}
              >
                {entry.title}
              </span>
            )}
          </div>

          {/* Right side: Handwritten Paper Date Label + Action Menu Button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: SPACING_TOKENS.sm,
              flexShrink: 0,
              paddingRight: !isForeEdge ? '14px' : '6px',
            }}
          >
            {formattedDate && (
              <div
                data-testid={`paper-date-label-${entry.id}`}
                style={{
                  backgroundColor: COLOR_TOKENS.paperWarm,
                  border: `1px solid ${COLOR_TOKENS.border}`,
                  padding: '2px 8px',
                  borderRadius: '2px',
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                  fontSize: '12px',
                  color: COLOR_TOKENS.ink,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                  transform: `rotate(${geometry.paperLabelTiltDeg}deg)`,
                  userSelect: 'none',
                }}
              >
                {formattedDate}
              </div>
            )}

            {/* Quiet '...' Action Button */}
            <button
              type="button"
              data-testid={`book-menu-btn-${entry.id}`}
              aria-label={`Options for ${entry.title}`}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsMenuOpen((prev) => !prev);
                setShowDetails(false);
              }}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: RADIUS_TOKENS.xs,
                backgroundColor: isForeEdge ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.16)',
                border: 'none',
                color: isForeEdge ? COLOR_TOKENS.ink : finishConfig.textColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                opacity: isHovered || isFocused || isMenuOpen ? 1 : 0.35,
                transition: 'opacity 150ms ease-out, background-color 150ms ease-out',
              }}
            >
              <RiMoreFill size={18} />
            </button>
          </div>
        </div>

        {/* Hover / Focus Details Card */}
        {showDetails && !isMenuOpen && !isRenaming && (
          <BookDetailsCard entry={entry} id={detailsCardId} />
        )}

        {/* Action Menu Dropdown */}
        <BookSpineMenu
          isOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          onOpenEntry={() => onOpen(entry.id)}
          onStartRename={() => setIsRenaming(true)}
          onMoveToCategory={(targetCatId) => onMoveToCategory(entry.id, targetCatId)}
          onSelectColor={(colorKey) => onSelectColor(entry.id, colorKey)}
          onOpenSpineCustomizer={() => onOpenSpineCustomizer?.(entry.id)}
          onToggleDetails={() => setShowDetails((prev) => !prev)}
          onTogglePin={() => onTogglePin(entry.id)}
          onDelete={() => onDelete(entry.id)}
          isPinned={entry.pinned}
          currentColor={entry.color}
          categories={categories}
          currentCategoryId={currentCategoryId}
        />
      </div>
    </li>
  );
};
