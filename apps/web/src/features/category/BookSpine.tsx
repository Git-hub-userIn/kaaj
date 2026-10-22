import React, { useState, useRef, useEffect } from 'react';
import type { EntryLightRow, CategoryLightRow } from '@kaaj/doc-model';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  STACK_CONFIG,
} from '@kaaj/design';
import { getBookGeometry, formatDate } from './stack-utils.js';
import { BookSpineMenu } from './BookSpineMenu.js';
import { RiMoreFill, RiPushpinFill } from '@remixicon/react';

interface BookSpineProps {
  entry: EntryLightRow;
  categories: CategoryLightRow[];
  currentCategoryId: string;
  onOpen: (entryId: string) => void;
  onRename: (entryId: string, newTitle: string) => void;
  onMoveToCategory: (entryId: string, targetCategoryId: string) => void;
  onSelectColor: (entryId: string, colorKey: string) => void;
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
  onTogglePin,
  onDelete,
  onPrefetch,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.title);
  const [isHovered, setIsHovered] = useState(false);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spineRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const geometry = getBookGeometry(entry.id, entry.weight, entry.color);
  const formattedDate = formatDate(entry.updatedAt);
  const accessibleName = `${entry.title}, ${formattedDate || 'recent'}, weight ${entry.weight}`;

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handlePointerEnter = () => {
    setIsHovered(true);
    onPrefetch?.(entry.id);
  };

  const handlePointerLeave = () => {
    setIsHovered(false);
  };

  const handleFocus = () => {
    onPrefetch?.(entry.id);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsMenuOpen(true);
  };

  const handleTouchStart = () => {
    longPressTimerRef.current = setTimeout(() => {
      setIsMenuOpen(true);
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
    if (e.key === 'ContextMenu') {
      e.preventDefault();
      e.stopPropagation();
      setIsMenuOpen(true);
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
        zIndex: isMenuOpen ? 60 : (isHovered ? 10 : 1),
      }}
    >
      <div
        ref={spineRef}
        role="link"
        aria-label={accessibleName}
        data-testid={`book-spine-${entry.id}`}
        data-entry-id={entry.id}
        tabIndex={0}
        onClick={handleSpineClick}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onFocus={handleFocus}
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
          backgroundColor: geometry.palette.bg,
          color: geometry.palette.text,
          borderRadius: RADIUS_TOKENS.sm,
          boxShadow: isHovered ? SHADOW_TOKENS.bookSpineHover : SHADOW_TOKENS.bookSpine,
          borderTop: `1.5px solid ${geometry.palette.borderTop}`,
          borderBottom: `2px solid ${geometry.palette.borderBottom}`,
          cursor: isRenaming ? 'text' : 'pointer',
          userSelect: 'none',
          outlineOffset: '2px',
          zIndex: isMenuOpen ? 60 : (isHovered ? 10 : 1),
          transform: `translateX(${geometry.offsetDesktopPx + (isHovered ? STACK_CONFIG.slideOffsetPx : 0)}px) rotate(${geometry.tiltDeg}deg)`,
          transition: 'transform 180ms cubic-bezier(0.2, 0, 0, 1), box-shadow 180ms ease-out',
        }}
      >
        <style>{`
          .book-spine-item:focus-visible {
            outline: 2.5px solid ${COLOR_TOKENS.terracotta};
            outline-offset: 3px;
            z-index: 20;
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
              transform: translateX(${geometry.offsetMobilePx + (isHovered ? 6 : 0)}px) rotate(${geometry.tiltDeg * 0.7}deg) !important;
            }
            .book-spine-content {
              padding: 0 12px !important;
            }
          }
        `}</style>

        {/* Tactile decoration elements */}
        {geometry.decorationType === 0 && (
          <div
            style={{
              position: 'absolute',
              top: '4px',
              bottom: '4px',
              left: '18px',
              width: '4px',
              borderLeft: `1px solid ${geometry.palette.accent}`,
              borderRight: `1px solid ${geometry.palette.borderBottom}`,
              opacity: 0.5,
              pointerEvents: 'none',
            }}
          />
        )}

        {geometry.decorationType === 1 && (
          <div
            style={{
              position: 'absolute',
              top: '0',
              bottom: '0',
              left: '32px',
              width: '8px',
              backgroundColor: geometry.palette.ribbon,
              boxShadow: '0 0 2px rgba(0,0,0,0.2)',
              opacity: 0.85,
              pointerEvents: 'none',
            }}
          />
        )}

        {geometry.decorationType === 2 && (
          <>
            <div
              style={{
                position: 'absolute',
                top: '0',
                bottom: '0',
                left: '20px',
                width: '2px',
                backgroundColor: geometry.palette.accent,
                opacity: 0.7,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: '0',
                bottom: '0',
                left: '25px',
                width: '1px',
                backgroundColor: geometry.palette.accent,
                opacity: 0.5,
                pointerEvents: 'none',
              }}
            />
          </>
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
              paddingRight: SPACING_TOKENS.md,
            }}
          >
            {entry.pinned && (
              <span
                data-testid={`pin-indicator-${entry.id}`}
                title="Pinned entry"
                style={{
                  color: geometry.palette.accent,
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
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
                  fontSize: '17px',
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
            ) : (
              <span
                data-testid={`book-title-${entry.id}`}
                style={{
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
                  fontSize: '17px',
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: geometry.palette.text,
                  lineHeight: 1.2,
                }}
              >
                {entry.title}
              </span>
            )}
          </div>

          {/* Right side: Date + Action Menu Button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: SPACING_TOKENS.sm,
              flexShrink: 0,
            }}
          >
            {formattedDate && (
              <span
                style={{
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                  fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                  color: geometry.palette.text,
                  opacity: 0.75,
                  letterSpacing: '0.02em',
                }}
              >
                {formattedDate}
              </span>
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
              }}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: RADIUS_TOKENS.xs,
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                border: 'none',
                color: geometry.palette.text,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                opacity: isHovered || isMenuOpen ? 1 : 0.35,
                transition: 'opacity 150ms ease-out, background-color 150ms ease-out',
              }}
            >
              <RiMoreFill size={18} />
            </button>
          </div>
        </div>

        {/* Action Menu Dropdown */}
        <BookSpineMenu
          isOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          onOpenEntry={() => onOpen(entry.id)}
          onStartRename={() => setIsRenaming(true)}
          onMoveToCategory={(targetCatId) => onMoveToCategory(entry.id, targetCatId)}
          onSelectColor={(colorKey) => onSelectColor(entry.id, colorKey)}
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
