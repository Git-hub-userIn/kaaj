import React, { useState, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  SPACING_TOKENS,
} from '@kaaj/design';
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
} from 'lucide-react';

export interface SlashMenuProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
  coords: { x: number; y: number } | null;
  query: string;
}

interface MenuItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: (editor: Editor) => void;
}

export const SlashMenu: React.FC<SlashMenuProps> = ({
  editor,
  isOpen,
  onClose,
  coords,
  query,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const items: MenuItem[] = [
    {
      id: 'paragraph',
      label: 'Text',
      description: 'Start writing with plain body text',
      icon: <Type size={16} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().setParagraph().run(),
    },
    {
      id: 'heading-1',
      label: 'Heading 1',
      description: 'Large section heading (36 px)',
      icon: <Heading1 size={16} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
      id: 'heading-2',
      label: 'Heading 2',
      description: 'Medium sub-heading (28 px)',
      icon: <Heading2 size={16} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      id: 'heading-3',
      label: 'Heading 3',
      description: 'Small sub-heading (22 px)',
      icon: <Heading3 size={16} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().setHeading({ level: 3 }).run(),
    },
    {
      id: 'bullet-list',
      label: 'Bullet List',
      description: 'Unordered list with clean bullet marks',
      icon: <List size={16} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleBulletList().run(),
    },
    {
      id: 'ordered-list',
      label: 'Numbered List',
      description: 'Sequential ordered list with numbers',
      icon: <ListOrdered size={16} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleOrderedList().run(),
    },
    {
      id: 'blockquote',
      label: 'Quote',
      description: 'Editorial blockquote with margin rule',
      icon: <Quote size={16} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().toggleBlockquote().run(),
    },
    {
      id: 'divider',
      label: 'Divider',
      description: 'Horizontal separator line',
      icon: <Minus size={16} aria-hidden="true" />,
      action: (ed) => ed.chain().focus().setHorizontalRule().run(),
    },
  ];

  const filteredItems = items.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      item.description.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filteredItems.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % (filteredItems.length || 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          applyItem(filteredItems[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        editor.commands.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, selectedIndex, filteredItems, editor]);

  if (!isOpen || !coords || filteredItems.length === 0) return null;

  const applyItem = (item: MenuItem) => {
    // Delete slash text in current line before applying command
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from, '\n', '\0');
    const slashPos = textBefore.lastIndexOf('/');
    if (slashPos !== -1) {
      const deleteFrom = from - (textBefore.length - slashPos);
      editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).run();
    }
    item.action(editor);
    onClose();
    editor.commands.focus();
  };

  // Keep menu inside viewport
  const left = Math.min(Math.max(16, coords.x), window.innerWidth - 300);
  const top = Math.min(coords.y + 24, window.innerHeight - 340);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Insert block"
      data-testid="slash-menu"
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        zIndex: 10000,
        width: '280px',
        maxHeight: '320px',
        overflowY: 'auto',
        backgroundColor: COLOR_TOKENS.paper,
        border: `1px solid ${COLOR_TOKENS.border}`,
        borderRadius: RADIUS_TOKENS.md,
        boxShadow: SHADOW_TOKENS.detailsCard,
        padding: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }}
    >
      {filteredItems.map((item, index) => {
        const isSelected = index === selectedIndex;
        return (
          <button
            key={item.id}
            role="menuitem"
            type="button"
            data-testid={`slash-item-${item.id}`}
            aria-selected={isSelected}
            onClick={() => applyItem(item)}
            onMouseEnter={() => setSelectedIndex(index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 10px',
              borderRadius: RADIUS_TOKENS.sm,
              backgroundColor: isSelected ? COLOR_TOKENS.paperSubtle : 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              color: COLOR_TOKENS.ink,
              outline: 'none',
              transition: 'background-color 80ms ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '26px',
                height: '26px',
                borderRadius: RADIUS_TOKENS.xs,
                backgroundColor: isSelected ? COLOR_TOKENS.paperWarm : COLOR_TOKENS.paperSubtle,
                color: COLOR_TOKENS.ink,
                flexShrink: 0,
              }}
            >
              {item.icon}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '14px', fontWeight: 500, lineHeight: 1.2 }}>
                {item.label}
              </span>
              <span style={{ fontSize: '11px', color: COLOR_TOKENS.inkMuted, lineHeight: 1.2 }}>
                {item.description}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
};
