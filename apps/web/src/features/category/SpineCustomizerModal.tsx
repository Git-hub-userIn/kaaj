import React, { useState, useEffect } from 'react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  SPINE_PALETTES,
  SPINE_TEXTURES,
  SPINE_FONTS,
  SPINE_FINISHES,
  SPINE_BANDS,
  COPY,
  isFinishCompatible,
} from '@kaaj/design';
import type {
  EntryLightRow,
  SpineStyle,
  SpineTexture,
  SpineFont,
  SpineFinish,
  SpineBands,
} from '@kaaj/doc-model';
import { RiCloseLine, RiCheckLine } from '@remixicon/react';

interface SpineCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: EntryLightRow;
  onSave: (spine: SpineStyle) => Promise<void>;
}

export const SpineCustomizerModal: React.FC<SpineCustomizerModalProps> = ({
  isOpen,
  onClose,
  entry,
  onSave,
}) => {
  // Determine initial color hex from entry spine or color token
  const getInitialColorHex = (): string => {
    if (entry.spine?.color) return entry.spine.color;
    if (entry.color && SPINE_PALETTES[entry.color]) {
      return SPINE_PALETTES[entry.color].bg;
    }
    return SPINE_PALETTES.terracotta.bg;
  };

  const [texture, setTexture] = useState<SpineTexture>(entry.spine?.texture ?? 'cloth');
  const [color, setColor] = useState<string>(getInitialColorHex());
  const [font, setFont] = useState<SpineFont>(entry.spine?.font ?? 'newsreader');
  const [finish, setFinish] = useState<SpineFinish>(entry.spine?.finish ?? 'gold-foil');
  const [bands, setBands] = useState<SpineBands>(entry.spine?.bands ?? 'two');
  const [isSaving, setIsSaving] = useState(false);

  // Sync state when entry changes
  useEffect(() => {
    if (isOpen) {
      setTexture(entry.spine?.texture ?? 'cloth');
      const initialColor = getInitialColorHex();
      setColor(initialColor);
      setFont(entry.spine?.font ?? 'newsreader');
      const initialFinish = entry.spine?.finish ?? (isFinishCompatible('gold-foil', initialColor) ? 'gold-foil' : 'black-ink');
      setFinish(initialFinish);
      setBands(entry.spine?.bands ?? 'two');
    }
  }, [isOpen, entry]);

  // When color changes, ensure selected finish meets WCAG 4.5:1 contrast
  const handleColorChange = (newColorHex: string) => {
    setColor(newColorHex);
    if (!isFinishCompatible(finish, newColorHex)) {
      // Find first valid finish
      const validFinishes = (Object.keys(SPINE_FINISHES) as SpineFinish[]).filter((f) =>
        isFinishCompatible(f, newColorHex)
      );
      if (validFinishes.length > 0) {
        setFinish(validFinishes[0]);
      }
    }
  };

  if (!isOpen) return null;

  const currentTexture = SPINE_TEXTURES[texture] || SPINE_TEXTURES.cloth;
  const currentFont = SPINE_FONTS[font] || SPINE_FONTS.newsreader;
  const currentFinish = SPINE_FINISHES[finish] || SPINE_FINISHES['gold-foil'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        texture,
        color,
        font,
        finish,
        bands,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="spine-customizer-title"
      data-testid="spine-customizer-modal"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(30, 28, 26, 0.45)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: SPACING_TOKENS.md,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: COLOR_TOKENS.paper,
          border: `1.5px solid ${COLOR_TOKENS.border}`,
          borderRadius: RADIUS_TOKENS.lg,
          boxShadow: SHADOW_TOKENS.toast,
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'modalSlideIn 180ms ease-out',
        }}
      >
        <style>{`
          @keyframes modalSlideIn {
            from { opacity: 0; transform: scale(0.97) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          .customizer-tab-btn {
            padding: 6px 12px;
            font-size: 13px;
            border-radius: 4px;
            border: 1px solid ${COLOR_TOKENS.border};
            background: ${COLOR_TOKENS.paperWarm};
            color: ${COLOR_TOKENS.ink};
            cursor: pointer;
            transition: all 120ms ease;
          }
          .customizer-tab-btn.active {
            background: ${COLOR_TOKENS.terracotta};
            color: #ffffff;
            border-color: ${COLOR_TOKENS.terracottaDark};
            font-weight: 600;
          }
          .customizer-tab-btn:disabled {
            opacity: 0.35;
            cursor: not-allowed;
            text-decoration: line-through;
          }
        `}</style>

        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `${SPACING_TOKENS.md} ${SPACING_TOKENS.lg}`,
            borderBottom: `1px solid ${COLOR_TOKENS.borderSubtle}`,
          }}
        >
          <h2
            id="spine-customizer-title"
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
              fontSize: TYPOGRAPHY_TOKENS.fontSize.heading3,
              fontWeight: 600,
              color: COLOR_TOKENS.ink,
              margin: 0,
            }}
          >
            {COPY.spineCustomizerTitle}
          </h2>
          <button
            type="button"
            aria-label="Close"
            data-testid="close-spine-customizer"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              padding: SPACING_TOKENS.xs,
              color: COLOR_TOKENS.inkMuted,
              cursor: 'pointer',
              borderRadius: RADIUS_TOKENS.xs,
            }}
          >
            <RiCloseLine size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            padding: SPACING_TOKENS.lg,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: SPACING_TOKENS.lg,
          }}
        >
          {/* Live Preview Box */}
          <div>
            <span
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: COLOR_TOKENS.inkMuted,
                display: 'block',
                marginBottom: SPACING_TOKENS.sm,
              }}
            >
              {COPY.previewSpine}
            </span>

            <div
              style={{
                padding: '24px 16px',
                backgroundColor: COLOR_TOKENS.canvasMuted,
                borderRadius: RADIUS_TOKENS.md,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)',
              }}
            >
              {/* Preview Spine Element */}
              <div
                data-testid="spine-preview-book"
                style={{
                  width: '92%',
                  height: '58px',
                  backgroundColor: color,
                  backgroundImage: currentTexture.cssPattern,
                  borderRadius: '3px',
                  boxShadow: SHADOW_TOKENS.bookSpine,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 20px',
                  borderTop: '1px solid rgba(255,255,255,0.25)',
                  borderBottom: '2px solid rgba(0,0,0,0.3)',
                  overflow: 'hidden',
                }}
              >
                {/* Left Page Edge Cap */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: '10px',
                    background: 'repeating-linear-gradient(0deg, #ede7db 0px, #ede7db 1px, #fdfbf7 1px, #fdfbf7 3px)',
                    borderRight: '1px solid rgba(0,0,0,0.15)',
                  }}
                />

                {/* Right Page Edge Cap */}
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: '10px',
                    background: 'repeating-linear-gradient(0deg, #ede7db 0px, #ede7db 1px, #fdfbf7 1px, #fdfbf7 3px)',
                    borderLeft: '1px solid rgba(0,0,0,0.15)',
                  }}
                />

                {/* Bands decoration */}
                {bands !== 'none' && (
                  <>
                    <div
                      style={{
                        position: 'absolute',
                        left: '28px',
                        top: 0,
                        bottom: 0,
                        width: bands === 'three' ? '12px' : '8px',
                        borderLeft: '1.5px solid rgba(245, 215, 127, 0.7)',
                        borderRight: bands === 'three' ? '1.5px solid rgba(245, 215, 127, 0.7)' : undefined,
                        boxShadow: '0 0 2px rgba(0,0,0,0.3)',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        right: '75px',
                        top: 0,
                        bottom: 0,
                        width: bands === 'three' ? '12px' : '8px',
                        borderLeft: '1.5px solid rgba(245, 215, 127, 0.7)',
                        borderRight: bands === 'three' ? '1.5px solid rgba(245, 215, 127, 0.7)' : undefined,
                        boxShadow: '0 0 2px rgba(0,0,0,0.3)',
                      }}
                    />
                  </>
                )}

                {/* Title */}
                <span
                  style={{
                    fontFamily: currentFont.fontFamily,
                    color: currentFinish.textColor,
                    textShadow: currentFinish.textShadow,
                    fontSize: '15px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginLeft: '20px',
                    marginRight: '60px',
                  }}
                >
                  {entry.title}
                </span>

                {/* Date paper label on right */}
                <div
                  style={{
                    position: 'absolute',
                    right: '18px',
                    backgroundColor: COLOR_TOKENS.paperWarm,
                    border: `1px solid ${COLOR_TOKENS.border}`,
                    padding: '2px 6px',
                    fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                    fontSize: '11px',
                    color: COLOR_TOKENS.ink,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    transform: 'rotate(1deg)',
                  }}
                >
                  Oct 23
                </div>
              </div>
            </div>
          </div>

          {/* Spine Colour Picker */}
          <div>
            <label
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: COLOR_TOKENS.inkMuted,
                display: 'block',
                marginBottom: SPACING_TOKENS.xs,
              }}
            >
              {COPY.colorLabel}
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '8px',
              }}
            >
              {Object.entries(SPINE_PALETTES).map(([key, pal]) => {
                const isSelected = color.toLowerCase() === pal.bg.toLowerCase();
                return (
                  <button
                    key={key}
                    type="button"
                    data-testid={`customizer-color-${key}`}
                    title={pal.label}
                    onClick={() => handleColorChange(pal.bg)}
                    style={{
                      height: '36px',
                      borderRadius: RADIUS_TOKENS.xs,
                      backgroundColor: pal.bg,
                      border: isSelected ? `2.5px solid ${COLOR_TOKENS.ink}` : `1px solid ${pal.borderBottom}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: pal.text,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                    }}
                  >
                    {isSelected && <RiCheckLine size={16} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Texture Picker */}
          <div>
            <label
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: COLOR_TOKENS.inkMuted,
                display: 'block',
                marginBottom: SPACING_TOKENS.xs,
              }}
            >
              {COPY.textureLabel}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {(Object.keys(SPINE_TEXTURES) as SpineTexture[]).map((texKey) => (
                <button
                  key={texKey}
                  type="button"
                  data-testid={`customizer-texture-${texKey}`}
                  className={`customizer-tab-btn ${texture === texKey ? 'active' : ''}`}
                  onClick={() => setTexture(texKey)}
                >
                  {SPINE_TEXTURES[texKey].label}
                </button>
              ))}
            </div>
          </div>

          {/* Typography Picker */}
          <div>
            <label
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: COLOR_TOKENS.inkMuted,
                display: 'block',
                marginBottom: SPACING_TOKENS.xs,
              }}
            >
              {COPY.fontLabel}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {(Object.keys(SPINE_FONTS) as SpineFont[]).map((fontKey) => (
                <button
                  key={fontKey}
                  type="button"
                  data-testid={`customizer-font-${fontKey}`}
                  className={`customizer-tab-btn ${font === fontKey ? 'active' : ''}`}
                  onClick={() => setFont(fontKey)}
                  style={{ fontFamily: SPINE_FONTS[fontKey].fontFamily }}
                >
                  {SPINE_FONTS[fontKey].label}
                </button>
              ))}
            </div>
          </div>

          {/* Foil / Ink Finish Picker (Contrast Enforced) */}
          <div>
            <label
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: COLOR_TOKENS.inkMuted,
                display: 'block',
                marginBottom: SPACING_TOKENS.xs,
              }}
            >
              {COPY.finishLabel}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {(Object.keys(SPINE_FINISHES) as SpineFinish[]).map((finishKey) => {
                const passes = isFinishCompatible(finishKey, color);
                return (
                  <button
                    key={finishKey}
                    type="button"
                    data-testid={`customizer-finish-${finishKey}`}
                    disabled={!passes}
                    className={`customizer-tab-btn ${finish === finishKey ? 'active' : ''}`}
                    onClick={() => setFinish(finishKey)}
                    title={!passes ? 'Disabled: does not pass 4.5:1 contrast on this colour' : undefined}
                  >
                    {SPINE_FINISHES[finishKey].label}
                    {!passes && ' (Low contrast)'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Gilt Bands Picker */}
          <div>
            <label
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: COLOR_TOKENS.inkMuted,
                display: 'block',
                marginBottom: SPACING_TOKENS.xs,
              }}
            >
              {COPY.bandsLabel}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {(Object.keys(SPINE_BANDS) as SpineBands[]).map((bandKey) => (
                <button
                  key={bandKey}
                  type="button"
                  data-testid={`customizer-bands-${bandKey}`}
                  className={`customizer-tab-btn ${bands === bandKey ? 'active' : ''}`}
                  onClick={() => setBands(bandKey)}
                >
                  {SPINE_BANDS[bandKey].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: SPACING_TOKENS.sm,
            padding: `${SPACING_TOKENS.md} ${SPACING_TOKENS.lg}`,
            borderTop: `1px solid ${COLOR_TOKENS.borderSubtle}`,
            backgroundColor: COLOR_TOKENS.paperWarm,
          }}
        >
          <button
            type="button"
            className="customizer-tab-btn"
            onClick={onClose}
            disabled={isSaving}
          >
            {COPY.cancel}
          </button>
          <button
            type="button"
            data-testid="save-spine-customizer"
            onClick={handleSubmit}
            disabled={isSaving}
            style={{
              padding: '8px 18px',
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: COLOR_TOKENS.terracotta,
              color: '#ffffff',
              border: `1px solid ${COLOR_TOKENS.terracottaDark}`,
              borderRadius: RADIUS_TOKENS.xs,
              cursor: isSaving ? 'wait' : 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            }}
          >
            {isSaving ? 'Saving...' : COPY.saveChanges}
          </button>
        </div>
      </div>
    </div>
  );
};
