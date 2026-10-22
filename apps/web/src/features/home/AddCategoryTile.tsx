import React, { useState } from 'react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  COPY,
  SEED_COVERS_MANIFEST,
} from '@kaaj/design';

interface AddCategoryTileProps {
  onAdd: (title: string, coverAssetId?: string) => Promise<void>;
  availableCoverAssetMap: Record<string, string>; // manifest key -> coverAssetId
}

export const AddCategoryTile: React.FC<AddCategoryTileProps> = ({ onAdd, availableCoverAssetMap }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [selectedKey, setSelectedKey] = useState<string>(SEED_COVERS_MANIFEST[0]?.key || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const coverAssetId = availableCoverAssetMap[selectedKey];
      await onAdd(title.trim(), coverAssetId);
      setTitle('');
      setIsOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <li
      className="add-catalogue-tile"
      data-testid="add-catalogue-tile"
      style={{
        listStyle: 'none',
        gridColumn: 'span var(--col-span, 4)',
        gridRow: 'span var(--row-span, 1)',
        minHeight: '260px',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        @media (min-width: 1024px) {
          .add-catalogue-tile {
            --col-span: 4;
            --row-span: 1;
          }
        }
        @media (min-width: 768px) and (max-width: 1023px) {
          .add-catalogue-tile {
            --col-span: 4;
            --row-span: 1;
          }
        }
        @media (max-width: 767px) {
          .add-catalogue-tile {
            --col-span: 2;
            --row-span: 1;
          }
        }
      `}</style>

      {!isOpen ? (
        <button
          type="button"
          data-testid="open-add-catalogue-btn"
          aria-label={COPY.addCatalogue}
          onClick={() => setIsOpen(true)}
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: COLOR_TOKENS.paperWarm,
            border: `2px dashed ${COLOR_TOKENS.border}`,
            borderRadius: RADIUS_TOKENS.sm,
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: SPACING_TOKENS.sm,
            color: COLOR_TOKENS.inkMuted,
            padding: SPACING_TOKENS.lg,
            transition: 'border-color 200ms ease, transform 200ms ease, box-shadow 200ms ease',
            outline: 'none',
            userSelect: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = COLOR_TOKENS.terracotta;
            e.currentTarget.style.transform = 'translateY(-3px)';
            e.currentTarget.style.boxShadow = SHADOW_TOKENS.tile;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = COLOR_TOKENS.border;
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = COLOR_TOKENS.terracotta;
            e.currentTarget.style.outline = `2px solid ${COLOR_TOKENS.terracotta}`;
            e.currentTarget.style.outlineOffset = '2px';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = COLOR_TOKENS.border;
            e.currentTarget.style.outline = 'none';
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: RADIUS_TOKENS.full,
              backgroundColor: COLOR_TOKENS.terracottaLight,
              color: COLOR_TOKENS.terracotta,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '26px',
              lineHeight: 1,
              fontWeight: 300,
            }}
          >
            +
          </div>
          <span
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
              fontSize: '20px',
              color: COLOR_TOKENS.ink,
              fontWeight: 600,
            }}
          >
            {COPY.addCatalogue}
          </span>
        </button>
      ) : (
        <div
          data-testid="add-catalogue-form-container"
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: COLOR_TOKENS.paper,
            border: `2px solid ${COLOR_TOKENS.terracotta}`,
            borderRadius: RADIUS_TOKENS.sm,
            padding: SPACING_TOKENS.md,
            boxShadow: SHADOW_TOKENS.tileHover,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: SPACING_TOKENS.sm, height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                style={{
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                  fontSize: '18px',
                  fontWeight: 700,
                  color: COLOR_TOKENS.terracotta,
                }}
              >
                {COPY.addCatalogue}
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '18px',
                  color: COLOR_TOKENS.inkMuted,
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                ✕
              </button>
            </div>

            <input
              type="text"
              data-testid="new-catalogue-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={COPY.newCataloguePlaceholder}
              autoFocus
              required
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                fontSize: '18px',
                padding: `${SPACING_TOKENS.xs} ${SPACING_TOKENS.sm}`,
                border: `1px solid ${COLOR_TOKENS.border}`,
                borderRadius: RADIUS_TOKENS.xs,
                backgroundColor: COLOR_TOKENS.paperWarm,
                outline: 'none',
              }}
            />

            <div>
              <label
                style={{
                  fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                  color: COLOR_TOKENS.inkMuted,
                  display: 'block',
                  marginBottom: '4px',
                }}
              >
                Choose cover:
              </label>
              <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                {SEED_COVERS_MANIFEST.map((cover) => (
                  <button
                    key={cover.key}
                    type="button"
                    onClick={() => setSelectedKey(cover.key)}
                    style={{
                      width: '36px',
                      height: '46px',
                      borderRadius: RADIUS_TOKENS.xs,
                      border: selectedKey === cover.key ? `2px solid ${COLOR_TOKENS.terracotta}` : `1px solid ${COLOR_TOKENS.border}`,
                      backgroundColor: cover.accentColor,
                      cursor: 'pointer',
                      flexShrink: 0,
                      padding: 0,
                      opacity: selectedKey === cover.key ? 1 : 0.65,
                      transform: selectedKey === cover.key ? 'scale(1.08)' : 'scale(1)',
                      transition: 'transform 100ms ease, opacity 100ms ease',
                    }}
                    title={cover.categoryTitle}
                  />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: SPACING_TOKENS.sm, marginTop: 'auto' }}>
              <button
                type="submit"
                data-testid="submit-add-catalogue-btn"
                disabled={isSubmitting || !title.trim()}
                style={{
                  flex: 1,
                  padding: `${SPACING_TOKENS.xs} ${SPACING_TOKENS.md}`,
                  backgroundColor: COLOR_TOKENS.terracotta,
                  color: '#fff',
                  border: 'none',
                  borderRadius: RADIUS_TOKENS.xs,
                  cursor: isSubmitting || !title.trim() ? 'not-allowed' : 'pointer',
                  fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
                  fontWeight: 600,
                  opacity: isSubmitting || !title.trim() ? 0.6 : 1,
                }}
              >
                {isSubmitting ? 'Adding...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                style={{
                  padding: `${SPACING_TOKENS.xs} ${SPACING_TOKENS.sm}`,
                  backgroundColor: 'transparent',
                  color: COLOR_TOKENS.inkMuted,
                  border: `1px solid ${COLOR_TOKENS.border}`,
                  borderRadius: RADIUS_TOKENS.xs,
                  cursor: 'pointer',
                  fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </li>
  );
};
