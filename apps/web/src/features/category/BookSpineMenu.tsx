import React, { useEffect, useRef, useState } from 'react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  SPINE_PALETTES,
  COPY,
} from '@kaaj/design';
import type { CategoryLightRow } from '@kaaj/doc-model';
import {
  RiArrowRightLine,
  RiEditLine,
  RiFolderTransferLine,
  RiPaletteLine,
  RiPushpinLine,
  RiPushpinFill,
  RiDeleteBinLine,
  RiArrowLeftLine,
} from '@remixicon/react';

interface BookSpineMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenEntry: () => void;
  onStartRename: () => void;
  onMoveToCategory: (categoryId: string) => void;
  onSelectColor: (colorKey: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
  isPinned: boolean;
  currentColor?: string | null;
  categories: CategoryLightRow[];
  currentCategoryId: string;
}

type MenuView = 'main' | 'color' | 'category';

export const BookSpineMenu: React.FC<BookSpineMenuProps> = ({
  isOpen,
  onClose,
  onOpenEntry,
  onStartRename,
  onMoveToCategory,
  onSelectColor,
  onTogglePin,
  onDelete,
  isPinned,
  currentColor,
  categories,
  currentCategoryId,
}) => {
  const [view, setView] = useState<MenuView>('main');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setView('main');
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view !== 'main') {
          setView('main');
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, view, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="book-spine-menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: '100%',
        right: '12px',
        marginTop: '6px',
        backgroundColor: COLOR_TOKENS.paper,
        border: `1.5px solid ${COLOR_TOKENS.border}`,
        borderRadius: RADIUS_TOKENS.md,
        boxShadow: SHADOW_TOKENS.toast,
        zIndex: 50,
        minWidth: '220px',
        maxWidth: '280px',
        padding: SPACING_TOKENS.xs,
        display: 'flex',
        flexDirection: 'column',
        animation: 'menuFade 150ms ease-out',
      }}
    >
      <style>{`
        @keyframes menuFade {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .spine-menu-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          border: none;
          background: none;
          font-family: ${TYPOGRAPHY_TOKENS.fontFamilySans};
          font-size: 13px;
          color: ${COLOR_TOKENS.ink};
          border-radius: ${RADIUS_TOKENS.xs};
          cursor: pointer;
          text-align: left;
        }
        .spine-menu-btn:hover, .spine-menu-btn:focus-visible {
          background-color: ${COLOR_TOKENS.paperSubtle};
          outline: none;
        }
        .spine-menu-btn.destructive {
          color: ${COLOR_TOKENS.terracotta};
        }
        .spine-menu-btn.destructive:hover {
          background-color: ${COLOR_TOKENS.terracottaLight};
        }
      `}</style>

      {view === 'main' && (
        <>
          <button
            type="button"
            role="menuitem"
            className="spine-menu-btn"
            data-testid="menu-open-entry"
            onClick={() => {
              onClose();
              onOpenEntry();
            }}
          >
            <RiArrowRightLine size={16} />
            {COPY.openEntry}
          </button>

          <button
            type="button"
            role="menuitem"
            className="spine-menu-btn"
            data-testid="menu-rename-entry"
            onClick={() => {
              onClose();
              onStartRename();
            }}
          >
            <RiEditLine size={16} />
            {COPY.renameEntry}
          </button>

          <button
            type="button"
            role="menuitem"
            className="spine-menu-btn"
            data-testid="menu-move-entry"
            onClick={() => setView('category')}
          >
            <RiFolderTransferLine size={16} />
            {COPY.moveToCategory}...
          </button>

          <button
            type="button"
            role="menuitem"
            className="spine-menu-btn"
            data-testid="menu-color-entry"
            onClick={() => setView('color')}
          >
            <RiPaletteLine size={16} />
            {COPY.setColour}...
          </button>

          <button
            type="button"
            role="menuitem"
            className="spine-menu-btn"
            data-testid="menu-pin-entry"
            onClick={() => {
              onClose();
              onTogglePin();
            }}
          >
            {isPinned ? <RiPushpinFill size={16} /> : <RiPushpinLine size={16} />}
            {isPinned ? COPY.unpinEntry : COPY.pinEntry}
          </button>

          <div
            style={{
              height: '1px',
              backgroundColor: COLOR_TOKENS.borderSubtle,
              margin: '4px 0',
            }}
          />

          <button
            type="button"
            role="menuitem"
            className="spine-menu-btn destructive"
            data-testid="menu-delete-entry"
            onClick={() => {
              onClose();
              onDelete();
            }}
          >
            <RiDeleteBinLine size={16} />
            {COPY.deleteEntry}
          </button>
        </>
      )}

      {view === 'color' && (
        <div style={{ padding: SPACING_TOKENS.xs }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: SPACING_TOKENS.xs,
              marginBottom: SPACING_TOKENS.sm,
              paddingBottom: SPACING_TOKENS.xs,
              borderBottom: `1px solid ${COLOR_TOKENS.borderSubtle}`,
            }}
          >
            <button
              type="button"
              className="spine-menu-btn"
              style={{ width: 'auto', padding: '4px 6px' }}
              onClick={() => setView('main')}
              aria-label="Back to actions"
            >
              <RiArrowLeftLine size={14} />
            </button>
            <span
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                fontSize: '12px',
                fontWeight: 600,
                color: COLOR_TOKENS.inkMuted,
              }}
            >
              Choose Spine Colour
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '6px',
              padding: '2px',
            }}
          >
            {Object.entries(SPINE_PALETTES).map(([key, pal]) => {
              const isSelected = currentColor === key;
              return (
                <button
                  key={key}
                  type="button"
                  data-testid={`palette-choice-${key}`}
                  title={pal.label}
                  aria-label={pal.label}
                  onClick={() => {
                    onClose();
                    onSelectColor(key);
                  }}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: RADIUS_TOKENS.xs,
                    backgroundColor: pal.bg,
                    border: isSelected ? `2px solid ${COLOR_TOKENS.ink}` : `1px solid ${pal.borderBottom}`,
                    cursor: 'pointer',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                    padding: 0,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {view === 'category' && (
        <div style={{ padding: SPACING_TOKENS.xs }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: SPACING_TOKENS.xs,
              marginBottom: SPACING_TOKENS.sm,
              paddingBottom: SPACING_TOKENS.xs,
              borderBottom: `1px solid ${COLOR_TOKENS.borderSubtle}`,
            }}
          >
            <button
              type="button"
              className="spine-menu-btn"
              style={{ width: 'auto', padding: '4px 6px' }}
              onClick={() => setView('main')}
              aria-label="Back to actions"
            >
              <RiArrowLeftLine size={14} />
            </button>
            <span
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                fontSize: '12px',
                fontWeight: 600,
                color: COLOR_TOKENS.inkMuted,
              }}
            >
              Move to Catalogue
            </span>
          </div>

          <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
            {categories
              .filter((c) => c.id !== currentCategoryId)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`move-target-${c.id}`}
                  className="spine-menu-btn"
                  onClick={() => {
                    onClose();
                    onMoveToCategory(c.id);
                  }}
                >
                  <span style={{ fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif, fontSize: '14px' }}>
                    {c.title}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
