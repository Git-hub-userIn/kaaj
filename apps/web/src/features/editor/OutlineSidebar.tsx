import React, { useEffect, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
} from '@kaaj/design';
import { ListTree, X, ChevronRight, ChevronDown } from 'lucide-react';

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

export interface OutlineSidebarProps {
  editor: Editor | null;
  isOpen: boolean;
  onClose: () => void;
}

export const OutlineSidebar: React.FC<OutlineSidebarProps> = ({
  editor,
  isOpen,
  onClose,
}) => {
  const [headings, setHeadings] = useState<OutlineItem[]>([]);
  const [collapsedLevels, setCollapsedLevels] = useState<Record<number, boolean>>({});

  const updateHeadings = useCallback(() => {
    if (!editor) return;
    const items: OutlineItem[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level || 1;
        const text = node.textContent.trim() || `Untitled Heading ${level}`;
        items.push({
          id: `heading-${pos}`,
          level,
          text,
          pos,
        });
      }
    });
    setHeadings(items);
  }, [editor]);

  useEffect(() => {
    if (!editor || !isOpen) return;
    updateHeadings();
    editor.on('update', updateHeadings);
    return () => {
      editor.off('update', updateHeadings);
    };
  }, [editor, isOpen, updateHeadings]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleHeadingClick = (pos: number) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(pos + 1).run();

    // Scroll into view
    const domNode = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (domNode && typeof domNode.scrollIntoView === 'function') {
      domNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const toggleLevelCollapse = (level: number) => {
    setCollapsedLevels((prev) => ({
      ...prev,
      [level]: !prev[level],
    }));
  };

  if (!isOpen) return null;

  return (
    <aside
      data-testid="outline-sidebar"
      role="region"
      aria-label="Document Outline"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: '320px',
        maxWidth: '85vw',
        backgroundColor: COLOR_TOKENS.paper,
        borderRight: `1px solid ${COLOR_TOKENS.border}`,
        boxShadow: SHADOW_TOKENS.detailsCard,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: `1px solid ${COLOR_TOKENS.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ListTree size={18} color={COLOR_TOKENS.terracotta} />
          <h2
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: COLOR_TOKENS.ink,
              margin: 0,
            }}
          >
            Outline
          </h2>
        </div>
        <button
          type="button"
          data-testid="close-outline-btn"
          onClick={onClose}
          aria-label="Close outline"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            color: COLOR_TOKENS.inkMuted,
            borderRadius: RADIUS_TOKENS.sm,
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Headings List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {headings.length === 0 && (
          <div
            data-testid="outline-empty-msg"
            style={{
              padding: '24px 8px',
              textAlign: 'center',
              color: COLOR_TOKENS.inkMuted,
              fontSize: '13px',
              lineHeight: 1.5,
            }}
          >
            No headings yet. Add H1, H2, or H3 headings to populate this document outline.
          </div>
        )}

        {headings.map((item, idx) => {
          const isCollapsed = collapsedLevels[item.level];
          const indent = (item.level - 1) * 14;

          return (
            <div
              key={item.id || idx}
              data-testid={`outline-item-h${item.level}`}
              onClick={() => handleHeadingClick(item.pos)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 8px',
                marginLeft: `${indent}px`,
                borderRadius: RADIUS_TOKENS.sm,
                cursor: 'pointer',
                color: item.level === 1 ? COLOR_TOKENS.ink : COLOR_TOKENS.inkMuted,
                fontWeight: item.level === 1 ? 600 : item.level === 2 ? 500 : 400,
                fontSize: item.level === 1 ? '13.5px' : '12.5px',
                lineHeight: 1.4,
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = COLOR_TOKENS.paperDark;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '1px 4px',
                  borderRadius: RADIUS_TOKENS.xs,
                  backgroundColor: COLOR_TOKENS.paperDark,
                  color: COLOR_TOKENS.inkLight,
                }}
              >
                H{item.level}
              </span>
              <span
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                }}
              >
                {item.text}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
