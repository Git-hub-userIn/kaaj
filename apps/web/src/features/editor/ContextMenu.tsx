import React, { useState, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
} from '@kaaj/design';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Type,
  Link as LinkIcon,
  Image as ImageIcon,
  Scissors,
  Copy,
  Clipboard,
} from 'lucide-react';

export interface ContextMenuProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
  coords: { x: number; y: number } | null;
  onInsertImage?: () => void;
}

interface ContextMenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  category?: 'style' | 'block' | 'align' | 'font' | 'action';
  action: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  editor,
  isOpen,
  onClose,
  coords,
  onInsertImage,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const items: ContextMenuItem[] = [
    // Text formatting
    {
      id: 'bold',
      label: 'Bold',
      shortcut: 'Ctrl+B',
      category: 'style',
      icon: <Bold size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleBold().run(),
      isActive: (ed) => ed.isActive('bold'),
    },
    {
      id: 'italic',
      label: 'Italic',
      shortcut: 'Ctrl+I',
      category: 'style',
      icon: <Italic size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleItalic().run(),
      isActive: (ed) => ed.isActive('italic'),
    },
    {
      id: 'underline',
      label: 'Underline',
      shortcut: 'Ctrl+U',
      category: 'style',
      icon: <UnderlineIcon size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleUnderline().run(),
      isActive: (ed) => ed.isActive('underline'),
    },
    {
      id: 'strike',
      label: 'Strikethrough',
      category: 'style',
      icon: <Strikethrough size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleStrike().run(),
      isActive: (ed) => ed.isActive('strike'),
    },
    // Headings & Blocks
    {
      id: 'heading-1',
      label: 'Heading 1',
      category: 'block',
      icon: <Heading1 size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: (ed) => ed.isActive('heading', { level: 1 }),
    },
    {
      id: 'heading-2',
      label: 'Heading 2',
      category: 'block',
      icon: <Heading2 size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: (ed) => ed.isActive('heading', { level: 2 }),
    },
    {
      id: 'heading-3',
      label: 'Heading 3',
      category: 'block',
      icon: <Heading3 size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: (ed) => ed.isActive('heading', { level: 3 }),
    },
    {
      id: 'bullet-list',
      label: 'Bullet List',
      category: 'block',
      icon: <List size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleBulletList().run(),
      isActive: (ed) => ed.isActive('bulletList'),
    },
    {
      id: 'ordered-list',
      label: 'Numbered List',
      category: 'block',
      icon: <ListOrdered size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleOrderedList().run(),
      isActive: (ed) => ed.isActive('orderedList'),
    },
    {
      id: 'quote',
      label: 'Quote',
      category: 'block',
      icon: <Quote size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleBlockquote().run(),
      isActive: (ed) => ed.isActive('blockquote'),
    },
    // Alignment
    {
      id: 'align-left',
      label: 'Align Left',
      category: 'align',
      icon: <AlignLeft size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().setTextAlign('left').run(),
      isActive: (ed) => ed.isActive({ textAlign: 'left' }),
    },
    {
      id: 'align-center',
      label: 'Align Center',
      category: 'align',
      icon: <AlignCenter size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().setTextAlign('center').run(),
      isActive: (ed) => ed.isActive({ textAlign: 'center' }),
    },
    {
      id: 'align-right',
      label: 'Align Right',
      category: 'align',
      icon: <AlignRight size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().setTextAlign('right').run(),
      isActive: (ed) => ed.isActive({ textAlign: 'right' }),
    },
    // Fonts
    {
      id: 'font-serif',
      label: 'Classic Serif',
      category: 'font',
      icon: <Type size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().setFontFamily('Newsreader, Georgia, serif').run(),
    },
    {
      id: 'font-sans',
      label: 'Clean Sans',
      category: 'font',
      icon: <Type size={15} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().setFontFamily('Inter, system-ui, sans-serif').run(),
    },
    // Link & Media
    {
      id: 'link',
      label: 'Link',
      category: 'action',
      icon: <LinkIcon size={15} aria-hidden="true" />,
      action: (ed) => {
        if (ed.isActive('link')) {
          ed.chain().focus().unsetLink().run();
          return;
        }
        const href = window.prompt('Enter link URL (e.g. https://example.com):');
        if (href && href.trim()) {
          ed.chain().focus().setLink({ href: href.trim() }).run();
        }
      },
      isActive: (ed) => ed.isActive('link'),
    },
    {
      id: 'insert-image',
      label: 'Insert Image',
      category: 'action',
      icon: <ImageIcon size={15} aria-hidden="true" />,
      action: () => {
        if (onInsertImage) onInsertImage();
      },
    },
    // Clipboard
    {
      id: 'cut',
      label: 'Cut',
      shortcut: 'Ctrl+X',
      category: 'action',
      icon: <Scissors size={15} aria-hidden="true" />,
      action: (ed) => {
        const { from, to } = ed.state.selection;
        if (from !== to) {
          const selectedText = ed.state.doc.textBetween(from, to);
          navigator.clipboard.writeText(selectedText).catch(() => {});
          ed.chain().focus().deleteRange({ from, to }).run();
        }
      },
    },
    {
      id: 'copy',
      label: 'Copy',
      shortcut: 'Ctrl+C',
      category: 'action',
      icon: <Copy size={15} aria-hidden="true" />,
      action: (ed) => {
        const { from, to } = ed.state.selection;
        if (from !== to) {
          const selectedText = ed.state.doc.textBetween(from, to);
          navigator.clipboard.writeText(selectedText).catch(() => {});
        }
      },
    },
    {
      id: 'paste',
      label: 'Paste',
      shortcut: 'Ctrl+V',
      category: 'action',
      icon: <Clipboard size={15} aria-hidden="true" />,
      action: (ed) => {
        navigator.clipboard.readText().then((text) => {
          if (text) {
            ed.chain().focus().insertContent(text).run();
          }
        }).catch(() => {});
      },
    },
  ];

  useEffect(() => {
    setSelectedIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selectedIndex]) {
          applyItem(items[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        editor.commands.focus();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, selectedIndex, items, editor, onClose]);

  if (!isOpen || !coords) return null;

  const applyItem = (item: ContextMenuItem) => {
    item.action(editor);
    onClose();
    editor.commands.focus();
  };

  // Clamping to keep menu strictly within viewport boundaries
  const menuWidth = 220;
  const menuHeight = 360;
  const left = Math.min(Math.max(8, coords.x), window.innerWidth - menuWidth - 8);
  const top = Math.min(Math.max(8, coords.y), window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Editor context menu"
      data-testid="custom-context-menu"
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        zIndex: 10000,
        width: `${menuWidth}px`,
        maxHeight: `${menuHeight}px`,
        overflowY: 'auto',
        backgroundColor: COLOR_TOKENS.paper,
        border: `1px solid ${COLOR_TOKENS.border}`,
        borderRadius: RADIUS_TOKENS.md,
        boxShadow: SHADOW_TOKENS.detailsCard,
        padding: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        userSelect: 'none',
      }}
    >
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const isActive = item.isActive ? item.isActive(editor) : false;

        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            data-testid={`context-menu-item-${item.id}`}
            aria-selected={isSelected}
            onClick={() => applyItem(item)}
            onMouseEnter={() => setSelectedIndex(index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              border: 'none',
              borderRadius: RADIUS_TOKENS.sm,
              backgroundColor: isSelected
                ? COLOR_TOKENS.paperSubtle
                : isActive
                ? COLOR_TOKENS.paperWarm
                : 'transparent',
              color: isActive ? COLOR_TOKENS.terracotta : COLOR_TOKENS.ink,
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              fontSize: '13px',
              outline: 'none',
              transition: 'background-color 0.1s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: isActive ? COLOR_TOKENS.terracotta : COLOR_TOKENS.inkMuted }}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </div>
            {item.shortcut && (
              <span
                style={{
                  fontSize: '11px',
                  color: COLOR_TOKENS.inkMuted,
                  opacity: 0.7,
                }}
              >
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
