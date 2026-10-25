import React, { useState, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  EDITOR_TEXT_COLORS,
  EDITOR_HIGHLIGHT_COLORS,
  EDITOR_FONTS,
  EDITOR_FONT_SIZES,
} from '@kaaj/design';
import { ensureFontLoaded } from './font-loader.js';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Link as LinkIcon,
  Palette,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  RemoveFormatting,
  Undo,
  Redo,
  ChevronDown,
  X,
  Type,
} from 'lucide-react';

export interface SelectionToolbarProps {
  editor: Editor;
}

type ActiveDropdown = 'none' | 'font' | 'size' | 'color' | 'highlight' | 'link';

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({ editor }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<ActiveDropdown>('none');
  const [linkInput, setLinkInput] = useState('');
  const [customSizeInput, setCustomSizeInput] = useState('');
  const [isPhone, setIsPhone] = useState(false);
  const [mobileBottom, setMobileBottom] = useState(8);

  const toolbarRef = useRef<HTMLDivElement>(null);

  // Detect phone viewport
  useEffect(() => {
    const checkViewport = () => {
      setIsPhone(window.innerWidth < 768);
    };
    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);

  // Track visualViewport for mobile keyboard offset
  useEffect(() => {
    if (!isPhone || typeof window === 'undefined' || !window.visualViewport) return;

    const vv = window.visualViewport;
    const updateVv = () => {
      const offsetFromBottom = window.innerHeight - (vv.offsetTop + vv.height);
      setMobileBottom(Math.max(8, offsetFromBottom + 8));
    };

    vv.addEventListener('resize', updateVv);
    vv.addEventListener('scroll', updateVv);
    updateVv();

    return () => {
      vv.removeEventListener('resize', updateVv);
      vv.removeEventListener('scroll', updateVv);
    };
  }, [isPhone]);

  // Position toolbar on text selection
  useEffect(() => {
    const handleSelection = () => {
      const { selection } = editor.state;
      if (selection.empty) {
        setIsVisible(false);
        setActiveDropdown('none');
        return;
      }

      const { from, to } = selection;
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);

      if (!isPhone) {
        const toolbarWidth = 440;
        const toolbarHeight = 44;
        const centerX = (start.left + end.right) / 2;
        const left = Math.min(
          Math.max(16, centerX - toolbarWidth / 2),
          window.innerWidth - toolbarWidth - 16
        );
        const top = Math.max(16, Math.min(start.top, end.top) - toolbarHeight - 10);

        setCoords({ top, left });
      }

      setIsVisible(true);
    };

    editor.on('selectionUpdate', handleSelection);
    return () => {
      editor.off('selectionUpdate', handleSelection);
    };
  }, [editor, isPhone]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isVisible) {
        setIsVisible(false);
        setActiveDropdown('none');
        editor.commands.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, editor]);

  if (!isVisible) return null;

  const currentFont = editor.getAttributes('textStyle').fontFamily || '';
  const currentFontSize = editor.getAttributes('textStyle').fontSize || '18px';
  const currentColor = editor.getAttributes('textStyle').color || '';
  const currentHighlight = editor.getAttributes('highlight').color || '';
  const isLinkActive = editor.isActive('link');

  const handleApplyLink = (e: React.FormEvent) => {
    e.preventDefault();
    const url = linkInput.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
    } else {
      let finalUrl = url;
      if (!/^(https?:\/\/|mailto:)/i.test(finalUrl)) {
        finalUrl = `https://${finalUrl}`;
      }
      editor.chain().focus().setLink({ href: finalUrl }).run();
    }
    setActiveDropdown('none');
    setLinkInput('');
  };

  const handleApplyCustomSize = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(customSizeInput, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(8, Math.min(200, parsed));
      editor.chain().focus().setFontSize(clamped + 'px').run();
    }
    setActiveDropdown('none');
    setCustomSizeInput('');
  };

  const handleFontSelect = (font: typeof EDITOR_FONTS[number]) => {
    ensureFontLoaded(font.id);
    editor.chain().focus().setFontFamily(font.family).run();
    setActiveDropdown('none');
  };

  const handleFontSizeSelect = (size: number) => {
    editor.chain().focus().setFontSize(size + 'px').run();
    setActiveDropdown('none');
  };

  const handleColorSelect = (colorHex: string) => {
    editor.chain().focus().setColor(colorHex).run();
    setActiveDropdown('none');
  };

  const handleHighlightSelect = (colorHex: string) => {
    editor.chain().focus().setHighlight({ color: colorHex }).run();
    setActiveDropdown('none');
  };

  const handleClearFormatting = () => {
    editor.chain().focus().unsetAllMarks().clearNodes().run();
    setActiveDropdown('none');
  };

  // Render desktop floating toolbar vs mobile dock
  const desktopStyle: React.CSSProperties = {
    position: 'fixed',
    top: `${coords?.top ?? 80}px`,
    left: `${coords?.left ?? 80}px`,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '4px 6px',
    backgroundColor: COLOR_TOKENS.paper,
    border: `1px solid ${COLOR_TOKENS.border}`,
    borderRadius: RADIUS_TOKENS.md,
    boxShadow: SHADOW_TOKENS.detailsCard,
  };

  const mobileStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: `${mobileBottom}px`,
    left: '8px',
    right: '8px',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px',
    backgroundColor: COLOR_TOKENS.paper,
    border: `1.5px solid ${COLOR_TOKENS.border}`,
    borderRadius: RADIUS_TOKENS.md,
    boxShadow: SHADOW_TOKENS.detailsCard,
    overflowX: 'auto',
  };

  const buttonStyle = (isActive = false, minWidth = '32px'): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: isPhone ? '44px' : minWidth,
    height: isPhone ? '44px' : '32px',
    padding: '0 6px',
    backgroundColor: isActive ? COLOR_TOKENS.paperSubtle : 'transparent',
    color: isActive ? COLOR_TOKENS.terracottaDark : COLOR_TOKENS.ink,
    border: 'none',
    borderRadius: RADIUS_TOKENS.sm,
    cursor: 'pointer',
    fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
    fontSize: '13px',
    fontWeight: isActive ? 600 : 400,
    outline: 'none',
  });

  return (
    <>
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Text formatting toolbar"
        data-testid="selection-toolbar"
        style={isPhone ? mobileStyle : desktopStyle}
        onMouseDown={(e) => {
          // Prevent blur on editor when interacting with toolbar buttons
          if ((e.target as HTMLElement).tagName !== 'INPUT') {
            e.preventDefault();
          }
        }}
      >
        {/* Bold */}
        <button
          type="button"
          aria-label="Bold (Ctrl+B)"
          aria-pressed={editor.isActive('bold')}
          data-testid="toolbar-bold"
          style={buttonStyle(editor.isActive('bold'))}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={16} aria-hidden="true" />
        </button>

        {/* Italic */}
        <button
          type="button"
          aria-label="Italic (Ctrl+I)"
          aria-pressed={editor.isActive('italic')}
          data-testid="toolbar-italic"
          style={buttonStyle(editor.isActive('italic'))}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} aria-hidden="true" />
        </button>

        {/* Underline */}
        <button
          type="button"
          aria-label="Underline (Ctrl+U)"
          aria-pressed={editor.isActive('underline')}
          data-testid="toolbar-underline"
          style={buttonStyle(editor.isActive('underline'))}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon size={16} aria-hidden="true" />
        </button>

        {/* Strikethrough */}
        <button
          type="button"
          aria-label="Strikethrough"
          aria-pressed={editor.isActive('strike')}
          data-testid="toolbar-strike"
          style={buttonStyle(editor.isActive('strike'))}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={16} aria-hidden="true" />
        </button>

        {/* Link */}
        <button
          type="button"
          aria-label="Add or remove link"
          aria-pressed={isLinkActive}
          data-testid="toolbar-link"
          style={buttonStyle(isLinkActive)}
          onClick={() => {
            if (isLinkActive) {
              editor.chain().focus().unsetLink().run();
            } else {
              setLinkInput(editor.getAttributes('link').href || '');
              setActiveDropdown(activeDropdown === 'link' ? 'none' : 'link');
            }
          }}
        >
          <LinkIcon size={16} aria-hidden="true" />
        </button>

        <div style={{ width: '1px', height: '20px', backgroundColor: COLOR_TOKENS.border, margin: '0 2px' }} />

        {/* Font Family Dropdown Toggle */}
        <button
          type="button"
          aria-label="Select font family"
          data-testid="toolbar-font-family"
          style={buttonStyle(activeDropdown === 'font', 'auto')}
          onClick={() => setActiveDropdown(activeDropdown === 'font' ? 'none' : 'font')}
        >
          <Type size={14} style={{ marginRight: '4px' }} aria-hidden="true" />
          <span style={{ maxWidth: '70px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {EDITOR_FONTS.find((f) => f.family.includes(currentFont) || currentFont.includes(f.id))?.label.split(' ')[0] || 'Font'}
          </span>
          <ChevronDown size={12} style={{ marginLeft: '2px' }} aria-hidden="true" />
        </button>

        {/* Font Size Dropdown Toggle */}
        <button
          type="button"
          aria-label="Select font size"
          data-testid="toolbar-font-size"
          style={buttonStyle(activeDropdown === 'size', 'auto')}
          onClick={() => setActiveDropdown(activeDropdown === 'size' ? 'none' : 'size')}
        >
          <span>{currentFontSize.replace('px', '')}</span>
          <ChevronDown size={12} style={{ marginLeft: '2px' }} aria-hidden="true" />
        </button>

        <div style={{ width: '1px', height: '20px', backgroundColor: COLOR_TOKENS.border, margin: '0 2px' }} />

        {/* Text Colour */}
        <button
          type="button"
          aria-label="Text colour"
          data-testid="toolbar-text-color"
          style={buttonStyle(activeDropdown === 'color')}
          onClick={() => setActiveDropdown(activeDropdown === 'color' ? 'none' : 'color')}
        >
          <Palette size={16} style={{ color: currentColor || COLOR_TOKENS.ink }} aria-hidden="true" />
        </button>

        {/* Highlight */}
        <button
          type="button"
          aria-label="Highlight text"
          data-testid="toolbar-highlight"
          style={buttonStyle(activeDropdown === 'highlight')}
          onClick={() => setActiveDropdown(activeDropdown === 'highlight' ? 'none' : 'highlight')}
        >
          <Highlighter size={16} style={{ color: currentHighlight || COLOR_TOKENS.inkMuted }} aria-hidden="true" />
        </button>

        <div style={{ width: '1px', height: '20px', backgroundColor: COLOR_TOKENS.border, margin: '0 2px' }} />

        {/* Alignment */}
        <button
          type="button"
          aria-label="Align left"
          aria-pressed={editor.isActive({ textAlign: 'left' })}
          data-testid="toolbar-align-left"
          style={buttonStyle(editor.isActive({ textAlign: 'left' }))}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        >
          <AlignLeft size={16} aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label="Align centre"
          aria-pressed={editor.isActive({ textAlign: 'center' })}
          data-testid="toolbar-align-center"
          style={buttonStyle(editor.isActive({ textAlign: 'center' }))}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        >
          <AlignCenter size={16} aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label="Align right"
          aria-pressed={editor.isActive({ textAlign: 'right' })}
          data-testid="toolbar-align-right"
          style={buttonStyle(editor.isActive({ textAlign: 'right' }))}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        >
          <AlignRight size={16} aria-hidden="true" />
        </button>

        <div style={{ width: '1px', height: '20px', backgroundColor: COLOR_TOKENS.border, margin: '0 2px' }} />

        {/* Clear formatting */}
        <button
          type="button"
          aria-label="Clear formatting"
          data-testid="toolbar-clear-formatting"
          style={buttonStyle(false)}
          onClick={handleClearFormatting}
        >
          <RemoveFormatting size={16} aria-hidden="true" />
        </button>

        {/* Undo */}
        <button
          type="button"
          aria-label="Undo (Ctrl+Z)"
          data-testid="toolbar-undo"
          style={buttonStyle(false)}
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo size={16} aria-hidden="true" />
        </button>

        {/* Redo */}
        <button
          type="button"
          aria-label="Redo (Ctrl+Shift+Z)"
          data-testid="toolbar-redo"
          style={buttonStyle(false)}
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Popovers & Dropdowns */}
      {activeDropdown === 'font' && (
        <div
          data-testid="font-family-dropdown"
          role="listbox"
          aria-label="Font presets"
          style={{
            position: 'fixed',
            top: isPhone ? 'auto' : `${(coords?.top ?? 80) + 48}px`,
            bottom: isPhone ? '0px' : 'auto',
            left: isPhone ? '0px' : `${coords?.left ?? 80}px`,
            right: isPhone ? '0px' : 'auto',
            zIndex: 10001,
            backgroundColor: COLOR_TOKENS.paper,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: isPhone ? `${RADIUS_TOKENS.lg} ${RADIUS_TOKENS.lg} 0 0` : RADIUS_TOKENS.md,
            boxShadow: SHADOW_TOKENS.detailsCard,
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            width: isPhone ? '100%' : '260px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: COLOR_TOKENS.inkMuted }}>Typography Preset</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setActiveDropdown('none')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLOR_TOKENS.inkMuted }}
            >
              <X size={16} />
            </button>
          </div>
          {EDITOR_FONTS.map((font) => (
            <button
              key={font.id}
              role="option"
              type="button"
              data-testid={`font-option-${font.id}`}
              onClick={() => handleFontSelect(font)}
              style={{
                fontFamily: font.family,
                fontSize: '15px',
                padding: isPhone ? '12px 10px' : '8px 10px',
                minHeight: isPhone ? '44px' : 'auto',
                border: 'none',
                borderRadius: RADIUS_TOKENS.sm,
                backgroundColor: currentFont.includes(font.id) ? COLOR_TOKENS.paperSubtle : 'transparent',
                color: COLOR_TOKENS.ink,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              {font.label}
            </button>
          ))}
        </div>
      )}

      {activeDropdown === 'size' && (
        <div
          data-testid="font-size-dropdown"
          role="listbox"
          aria-label="Font sizes"
          style={{
            position: 'fixed',
            top: isPhone ? 'auto' : `${(coords?.top ?? 80) + 48}px`,
            bottom: isPhone ? '0px' : 'auto',
            left: isPhone ? '0px' : `${coords?.left ?? 80}px`,
            right: isPhone ? '0px' : 'auto',
            zIndex: 10001,
            backgroundColor: COLOR_TOKENS.paper,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: isPhone ? `${RADIUS_TOKENS.lg} ${RADIUS_TOKENS.lg} 0 0` : RADIUS_TOKENS.md,
            boxShadow: SHADOW_TOKENS.detailsCard,
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            width: isPhone ? '100%' : '200px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: COLOR_TOKENS.inkMuted }}>Font Size</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setActiveDropdown('none')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLOR_TOKENS.inkMuted }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
            {EDITOR_FONT_SIZES.map((size) => (
              <button
                key={size}
                role="option"
                type="button"
                data-testid={`font-size-option-${size}`}
                onClick={() => handleFontSizeSelect(size)}
                style={{
                  padding: isPhone ? '10px 4px' : '6px 4px',
                  minHeight: isPhone ? '44px' : 'auto',
                  border: 'none',
                  borderRadius: RADIUS_TOKENS.sm,
                  backgroundColor: currentFontSize === `${size}px` ? COLOR_TOKENS.paperSubtle : 'transparent',
                  color: COLOR_TOKENS.ink,
                  fontSize: '13px',
                  fontWeight: currentFontSize === `${size}px` ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {size}
              </button>
            ))}
          </div>

          <form onSubmit={handleApplyCustomSize} style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <input
              type="number"
              min={8}
              max={200}
              placeholder="8-200"
              value={customSizeInput}
              onChange={(e) => setCustomSizeInput(e.target.value)}
              aria-label="Custom size in pixels"
              data-testid="custom-size-input"
              style={{
                width: '70px',
                padding: '4px 6px',
                border: `1px solid ${COLOR_TOKENS.border}`,
                borderRadius: RADIUS_TOKENS.sm,
                fontSize: '13px',
                backgroundColor: COLOR_TOKENS.paper,
                color: COLOR_TOKENS.ink,
              }}
            />
            <button
              type="submit"
              data-testid="apply-custom-size-btn"
              style={{
                padding: '4px 8px',
                backgroundColor: COLOR_TOKENS.ink,
                color: COLOR_TOKENS.paper,
                border: 'none',
                borderRadius: RADIUS_TOKENS.sm,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Set
            </button>
          </form>
        </div>
      )}

      {activeDropdown === 'color' && (
        <div
          data-testid="color-picker-dropdown"
          role="dialog"
          aria-label="Text colour picker"
          style={{
            position: 'fixed',
            top: isPhone ? 'auto' : `${(coords?.top ?? 80) + 48}px`,
            bottom: isPhone ? '0px' : 'auto',
            left: isPhone ? '0px' : `${coords?.left ?? 80}px`,
            right: isPhone ? '0px' : 'auto',
            zIndex: 10001,
            backgroundColor: COLOR_TOKENS.paper,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: isPhone ? `${RADIUS_TOKENS.lg} ${RADIUS_TOKENS.lg} 0 0` : RADIUS_TOKENS.md,
            boxShadow: SHADOW_TOKENS.detailsCard,
            padding: '12px',
            width: isPhone ? '100%' : '240px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: COLOR_TOKENS.inkMuted }}>Ink Palette</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setActiveDropdown('none')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLOR_TOKENS.inkMuted }}
            >
              <X size={16} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
            {EDITOR_TEXT_COLORS.map((col) => (
              <button
                key={col.id}
                type="button"
                aria-label={col.label}
                data-testid={`color-swatch-${col.id}`}
                onClick={() => handleColorSelect(col.value)}
                style={{
                  width: isPhone ? '44px' : '32px',
                  height: isPhone ? '44px' : '32px',
                  borderRadius: '50%',
                  backgroundColor: col.value,
                  border: currentColor === col.value ? `2.5px solid ${COLOR_TOKENS.terracotta}` : `1px solid ${COLOR_TOKENS.border}`,
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {activeDropdown === 'highlight' && (
        <div
          data-testid="highlight-picker-dropdown"
          role="dialog"
          aria-label="Highlight colour picker"
          style={{
            position: 'fixed',
            top: isPhone ? 'auto' : `${(coords?.top ?? 80) + 48}px`,
            bottom: isPhone ? '0px' : 'auto',
            left: isPhone ? '0px' : `${coords?.left ?? 80}px`,
            right: isPhone ? '0px' : 'auto',
            zIndex: 10001,
            backgroundColor: COLOR_TOKENS.paper,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: isPhone ? `${RADIUS_TOKENS.lg} ${RADIUS_TOKENS.lg} 0 0` : RADIUS_TOKENS.md,
            boxShadow: SHADOW_TOKENS.detailsCard,
            padding: '12px',
            width: isPhone ? '100%' : '240px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: COLOR_TOKENS.inkMuted }}>Highlight Washes</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setActiveDropdown('none')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLOR_TOKENS.inkMuted }}
            >
              <X size={16} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
            {EDITOR_HIGHLIGHT_COLORS.map((hl) => (
              <button
                key={hl.id}
                type="button"
                aria-label={hl.label}
                data-testid={`highlight-swatch-${hl.id}`}
                onClick={() => handleHighlightSelect(hl.value)}
                style={{
                  width: isPhone ? '44px' : '32px',
                  height: isPhone ? '44px' : '32px',
                  borderRadius: RADIUS_TOKENS.xs,
                  backgroundColor: hl.value,
                  border: currentHighlight === hl.value ? `2.5px solid ${COLOR_TOKENS.ink}` : `1px solid ${COLOR_TOKENS.border}`,
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {activeDropdown === 'link' && (
        <div
          data-testid="link-modal"
          role="dialog"
          aria-label="Insert link"
          style={{
            position: 'fixed',
            top: isPhone ? 'auto' : `${(coords?.top ?? 80) + 48}px`,
            bottom: isPhone ? '0px' : 'auto',
            left: isPhone ? '0px' : `${coords?.left ?? 80}px`,
            right: isPhone ? '0px' : 'auto',
            zIndex: 10001,
            backgroundColor: COLOR_TOKENS.paper,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: isPhone ? `${RADIUS_TOKENS.lg} ${RADIUS_TOKENS.lg} 0 0` : RADIUS_TOKENS.md,
            boxShadow: SHADOW_TOKENS.detailsCard,
            padding: '12px',
            width: isPhone ? '100%' : '320px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: COLOR_TOKENS.ink }}>Link URL</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setActiveDropdown('none')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLOR_TOKENS.inkMuted }}
            >
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleApplyLink} style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              placeholder="https://..."
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              aria-label="URL"
              data-testid="link-url-input"
              autoFocus
              style={{
                flex: 1,
                padding: '6px 8px',
                border: `1px solid ${COLOR_TOKENS.border}`,
                borderRadius: RADIUS_TOKENS.sm,
                fontSize: '13px',
                backgroundColor: COLOR_TOKENS.paper,
                color: COLOR_TOKENS.ink,
              }}
            />
            <button
              type="submit"
              data-testid="apply-link-btn"
              style={{
                padding: '6px 12px',
                backgroundColor: COLOR_TOKENS.ink,
                color: COLOR_TOKENS.paper,
                border: 'none',
                borderRadius: RADIUS_TOKENS.sm,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Apply
            </button>
          </form>
        </div>
      )}
    </>
  );
};
