import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Category, CategoryStats, TodoItem } from '@kaaj/doc-model';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  SEED_COVERS_MANIFEST,
} from '@kaaj/design';
import {
  formatRelativeAndAbsoluteTime,
  formatCreatedDate,
} from './stack-utils.js';
import {
  RiCheckLine,
  RiCloseLine,
  RiImageAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
} from '@remixicon/react';

interface CategoryRightRailProps {
  category: Category;
  stats: CategoryStats | null;
  availableCoverAssetMap: Record<string, string>;
  onUpdateCategory: (updates: Partial<Category>) => Promise<boolean | void>;
  isCollapsibleSection?: boolean;
  defaultExpanded?: boolean;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export const CategoryRightRail: React.FC<CategoryRightRailProps> = ({
  category,
  stats,
  availableCoverAssetMap,
  onUpdateCategory,
  isCollapsibleSection = false,
  defaultExpanded = true,
}) => {
  const [isCoverModalOpen, setIsCoverModalOpen] = useState(false);
  const [isSectionOpen, setIsSectionOpen] = useState(defaultExpanded);

  // Todo list state initialized from category.todo
  const [todos, setTodos] = useState<TodoItem[]>(() => category.todo || []);
  const [newTodoText, setNewTodoText] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict'>('idle');

  // Keep todos in sync when category.todo updates from external fetches
  useEffect(() => {
    if (category.todo) {
      setTodos(category.todo);
    }
  }, [category.todo]);

  // Deterministic Polaroid tilt <= 3 degrees derived from category.id hash
  const hash = hashString(category.id);
  const polaroidTiltDeg = ((hash % 60) - 30) / 10; // Between -3.0 and +3.0 degrees
  const tapeTiltDeg = ((hash % 14) - 7) / 2; // Between -3.5 and +3.5 degrees

  // Debounce save timer ref for checklist text edits (1s idle per spec)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistTodos = useCallback(
    async (nextTodos: TodoItem[]) => {
      setSaveStatus('saving');
      try {
        const success = await onUpdateCategory({ todo: nextTodos });
        if (success === false) {
          setSaveStatus('conflict');
        } else {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 1500);
        }
      } catch {
        setSaveStatus('conflict');
      }
    },
    [onUpdateCategory]
  );

  // Immediate save on check toggle or delete or add
  const handleToggleTodo = (id: string) => {
    const next = todos.map((item) =>
      item.id === id ? { ...item, done: !item.done } : item
    );
    setTodos(next);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    persistTodos(next);
  };

  const handleDeleteTodo = (id: string) => {
    const next = todos.filter((item) => item.id !== id);
    setTodos(next);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    persistTodos(next);
  };

  const handleTextChange = (id: string, text: string) => {
    const next = todos.map((item) =>
      item.id === id ? { ...item, text: text.slice(0, 200) } : item
    );
    setTodos(next);

    // Debounce save after 1 second idle per spec
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      persistTodos(next);
    }, 1000);
  };

  const handleAddTodo = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = newTodoText.trim();
      if (!trimmed || todos.length >= 12) return;

      const newItem: TodoItem = {
        id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: trimmed.slice(0, 200),
        done: false,
      };

      const next = [...todos, newItem];
      setTodos(next);
      setNewTodoText('');

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      persistTodos(next);
    }
  };

  const handleSelectCover = async (coverAssetId?: string) => {
    await onUpdateCategory({ coverAssetId });
    setIsCoverModalOpen(false);
  };

  const maxMonthCount = Math.max(
    1,
    ...(stats?.entriesPerMonth.map((m) => m.count) || [1])
  );

  // Content blocks
  const railContent = (
    <div
      style={{
        display: 'flex',
        flexDirection: isCollapsibleSection ? 'row' : 'column',
        flexWrap: isCollapsibleSection ? 'wrap' : 'nowrap',
        gap: '20px',
        width: '100%',
        alignItems: isCollapsibleSection ? 'flex-start' : 'stretch',
        justifyContent: isCollapsibleSection ? 'center' : 'flex-start',
      }}
    >
      {/* 1. Category Image: Taped Polaroid */}
      <div
        data-testid="category-polaroid-cover"
        style={{
          width: isCollapsibleSection ? '240px' : '100%',
          maxWidth: '280px',
          backgroundColor: '#fefdfb',
          border: '1px solid rgba(215, 205, 190, 0.7)',
          borderRadius: RADIUS_TOKENS.xs,
          boxShadow: '0 4px 14px rgba(45, 35, 25, 0.12), 0 1px 3px rgba(45, 35, 25, 0.08)',
          padding: '10px 10px 18px 10px',
          boxSizing: 'border-box',
          position: 'relative',
          transform: `rotate(${polaroidTiltDeg}deg)`,
          transition: 'transform 200ms ease, box-shadow 200ms ease',
          margin: '8px auto',
        }}
      >
        {/* Washi Tape Accent */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '-9px',
            left: '50%',
            transform: `translateX(-50%) rotate(${tapeTiltDeg}deg)`,
            width: '64px',
            height: '18px',
            backgroundColor: COLOR_TOKENS.washiTape,
            border: `1px solid ${COLOR_TOKENS.washiTapeBorder}`,
            boxShadow: '0 1px 3px rgba(40, 30, 20, 0.08)',
            zIndex: 3,
            borderRadius: RADIUS_TOKENS.xs,
            pointerEvents: 'none',
          }}
        />

        {/* Photo Area or Designed Placeholder */}
        <div
          style={{
            width: '100%',
            aspectRatio: '1 / 1',
            backgroundColor: COLOR_TOKENS.paperWarm,
            border: '1px solid rgba(220, 215, 200, 0.8)',
            borderRadius: RADIUS_TOKENS.xs,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {category.coverAssetId ? (
            <img
              src={`/api/assets/${category.coverAssetId}/thumb?size=960`}
              alt={`${category.title} cover`}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            <div
              data-testid="cover-placeholder"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '16px',
                textAlign: 'center',
              }}
            >
              <span
                style={{
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
                  fontSize: '36px',
                  fontWeight: 700,
                  color: COLOR_TOKENS.terracotta,
                  opacity: 0.65,
                }}
              >
                {category.title.charAt(0).toUpperCase()}
              </span>
              <span
                style={{
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                  fontSize: '13px',
                  color: COLOR_TOKENS.inkMuted,
                }}
              >
                {category.title}
              </span>
            </div>
          )}
        </div>

        {/* Bottom Chin: Title and "Change cover" action */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: '8px',
            gap: '2px',
          }}
        >
          <div
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
              fontSize: '14px',
              fontWeight: 700,
              color: COLOR_TOKENS.ink,
              textAlign: 'center',
              lineHeight: 1.2,
            }}
          >
            {category.title}
          </div>
          <button
            type="button"
            data-testid="change-cover-btn"
            onClick={() => setIsCoverModalOpen(true)}
            style={{
              background: 'none',
              border: 'none',
              padding: '2px 6px',
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              fontSize: '11px',
              color: COLOR_TOKENS.terracotta,
              cursor: 'pointer',
              textDecoration: 'underline',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <RiImageAddLine size={12} />
            Change cover
          </button>
        </div>
      </div>

      {/* 2. Category Details Panel */}
      <div
        data-testid="category-stats-panel"
        style={{
          width: isCollapsibleSection ? '260px' : '100%',
          maxWidth: '280px',
          backgroundColor: COLOR_TOKENS.paper,
          border: `1.5px solid ${COLOR_TOKENS.border}`,
          borderRadius: RADIUS_TOKENS.sm,
          boxShadow: SHADOW_TOKENS.detailsCard,
          padding: `${SPACING_TOKENS.md} ${SPACING_TOKENS.md}`,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div
          style={{
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
            fontSize: '16px',
            fontWeight: 700,
            color: '#42372c',
            borderBottom: `1px solid ${COLOR_TOKENS.borderSubtle}`,
            paddingBottom: '4px',
          }}
        >
          Catalogue Details
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#554a3e' }}>
          <div>
            <strong style={{ color: COLOR_TOKENS.ink }}>Entries:</strong>{' '}
            <span data-testid="stats-entry-count">{stats ? stats.entries : '—'}</span>
          </div>
          <div>
            <strong style={{ color: COLOR_TOKENS.ink }}>Words:</strong>{' '}
            <span data-testid="stats-word-count">{stats ? stats.words.toLocaleString() : '—'}</span>
          </div>
          <div>
            <strong style={{ color: COLOR_TOKENS.ink }}>Images:</strong>{' '}
            <span data-testid="stats-image-count">{stats ? stats.images : '—'}</span>
          </div>
          <div>
            <strong style={{ color: COLOR_TOKENS.ink }}>Created:</strong>{' '}
            <span data-testid="stats-created">{stats ? formatCreatedDate(stats.createdAt) : '—'}</span>
          </div>
          <div>
            <strong style={{ color: COLOR_TOKENS.ink }}>Last edited:</strong>{' '}
            <span data-testid="stats-last-edited">{stats ? formatRelativeAndAbsoluteTime(stats.lastEditedAt || stats.createdAt) : '—'}</span>
          </div>
        </div>

        {/* 6-Month Entries-Per-Month Bar Strip */}
        {stats && stats.entriesPerMonth && stats.entriesPerMonth.length > 0 && (
          <div style={{ marginTop: '4px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: COLOR_TOKENS.inkMuted,
                marginBottom: '6px',
              }}
            >
              Entries per month
            </div>

            {/* Visual Bar Strip */}
            <div
              data-testid="entries-bar-strip"
              aria-hidden="true"
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: '6px',
                height: '52px',
                padding: '4px 6px',
                backgroundColor: COLOR_TOKENS.paperSubtle,
                borderRadius: RADIUS_TOKENS.xs,
                border: `1px solid ${COLOR_TOKENS.borderSubtle}`,
              }}
            >
              {stats.entriesPerMonth.map((item) => {
                const barHeight = Math.max(
                  item.count > 0 ? 8 : 2,
                  Math.round((item.count / maxMonthCount) * 36)
                );
                return (
                  <div
                    key={item.month}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '3px',
                      height: '100%',
                      justifyContent: 'flex-end',
                    }}
                  >
                    {item.count > 0 && (
                      <span style={{ fontSize: '9px', color: COLOR_TOKENS.terracotta, lineHeight: 1 }}>
                        {item.count}
                      </span>
                    )}
                    <div
                      style={{
                        width: '100%',
                        maxWidth: '14px',
                        height: `${barHeight}px`,
                        backgroundColor: item.count > 0 ? COLOR_TOKENS.terracotta : '#d5cebe',
                        borderRadius: '2px 2px 0 0',
                        transition: 'height 200ms ease',
                      }}
                    />
                    <span style={{ fontSize: '9px', color: COLOR_TOKENS.inkMuted, lineHeight: 1 }}>
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Visually Hidden Text Table Fallback per Spec */}
            <table
              data-testid="entries-table-fallback"
              className="sr-only"
              style={{
                position: 'absolute',
                width: '1px',
                height: '1px',
                padding: 0,
                margin: '-1px',
                overflow: 'hidden',
                clip: 'rect(0, 0, 0, 0)',
                whiteSpace: 'nowrap',
                border: 0,
              }}
            >
              <caption>Entries per month for {category.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Entries</th>
                </tr>
              </thead>
              <tbody>
                {stats.entriesPerMonth.map((item) => (
                  <tr key={item.month}>
                    <td>{item.label}</td>
                    <td>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. Sticky Note: Checklist */}
      <div
        data-testid="category-checklist-sticky"
        style={{
          width: isCollapsibleSection ? '280px' : '100%',
          maxWidth: '280px',
          backgroundColor: '#fef9c3',
          backgroundImage: 'linear-gradient(180deg, #fefce8 0%, #fef08a 100%)',
          border: '1px solid #ebd77c',
          borderRadius: RADIUS_TOKENS.xs,
          boxShadow: '0 4px 12px rgba(70, 55, 20, 0.1), 0 1px 3px rgba(70, 55, 20, 0.06)',
          padding: '14px 12px 14px 12px',
          boxSizing: 'border-box',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {/* Subtle Tape at top */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '-7px',
            left: '50%',
            transform: 'translateX(-50%) rotate(-0.5deg)',
            width: '44px',
            height: '14px',
            backgroundColor: 'rgba(240, 235, 210, 0.85)',
            border: '1px solid rgba(215, 200, 160, 0.6)',
            boxShadow: '0 1px 2px rgba(40, 30, 10, 0.08)',
            zIndex: 2,
            borderRadius: RADIUS_TOKENS.xs,
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px dashed #d4c264',
            paddingBottom: '4px',
          }}
        >
          <span
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
              fontSize: '16px',
              fontWeight: 700,
              color: '#3d321d',
            }}
          >
            Checklist
          </span>
          <span
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
              fontSize: '12px',
              color: '#6d5a36',
            }}
          >
            {todos.length}/12
          </span>
        </div>

        {/* Checklist Items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {todos.map((item) => (
            <div
              key={item.id}
              data-testid={`todo-item-${item.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                width: '100%',
              }}
            >
              <button
                type="button"
                data-testid={`todo-toggle-${item.id}`}
                aria-label={item.done ? 'Mark undone' : 'Mark done'}
                onClick={() => handleToggleTodo(item.id)}
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '2px',
                  border: '1.5px solid #6b5c33',
                  backgroundColor: item.done ? '#4a3b1b' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                {item.done && <RiCheckLine size={13} color="#fef9c3" />}
              </button>

              <input
                type="text"
                value={item.text}
                maxLength={200}
                data-testid={`todo-input-${item.id}`}
                onChange={(e) => handleTextChange(item.id, e.target.value)}
                style={{
                  flex: 1,
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                  fontSize: '14px',
                  color: item.done ? '#786e58' : '#2b2416',
                  textDecoration: item.done ? 'line-through' : 'none',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  padding: '1px 2px',
                  minWidth: 0,
                }}
              />

              <button
                type="button"
                data-testid={`todo-delete-${item.id}`}
                aria-label="Delete item"
                onClick={() => handleDeleteTodo(item.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8c7b5a',
                  cursor: 'pointer',
                  padding: '0 2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RiCloseLine size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Add Item Field (Max 12 items, 200 chars each) */}
        {todos.length < 12 && (
          <input
            type="text"
            data-testid="add-todo-input"
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            onKeyDown={handleAddTodo}
            placeholder="+ Add note (Press Enter)"
            maxLength={200}
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
              fontSize: '13px',
              backgroundColor: 'rgba(255, 255, 255, 0.45)',
              border: '1px dashed #c9b758',
              borderRadius: RADIUS_TOKENS.xs,
              padding: '4px 6px',
              color: '#3d321d',
              outline: 'none',
              marginTop: '4px',
            }}
          />
        )}

        {saveStatus === 'saving' && (
          <div style={{ fontSize: '10px', color: '#6d5a36', fontStyle: 'italic', textAlign: 'right' }}>
            Saving...
          </div>
        )}
        {saveStatus === 'conflict' && (
          <div style={{ fontSize: '10px', color: COLOR_TOKENS.terracotta, textAlign: 'right' }}>
            Modified elsewhere. Reloading.
          </div>
        )}
      </div>
    </div>
  );

  // If rendered as collapsible "About this catalogue" section above stack (< 1280px)
  if (isCollapsibleSection) {
    return (
      <div
        data-testid="about-catalogue-collapsible"
        style={{
          width: '100%',
          maxWidth: '900px',
          margin: '0 auto 24px auto',
          backgroundColor: COLOR_TOKENS.paperWarm,
          border: `1px solid ${COLOR_TOKENS.border}`,
          borderRadius: RADIUS_TOKENS.sm,
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <button
          type="button"
          data-testid="toggle-about-catalogue-btn"
          aria-expanded={isSectionOpen}
          onClick={() => setIsSectionOpen((prev) => !prev)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `${SPACING_TOKENS.sm} ${SPACING_TOKENS.md}`,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
              fontSize: '16px',
              fontWeight: 700,
              color: COLOR_TOKENS.ink,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isSectionOpen ? <RiArrowDownSLine size={18} /> : <RiArrowRightSLine size={18} />}
            About this catalogue
          </span>
          <span
            style={{
              fontSize: '12px',
              color: COLOR_TOKENS.inkMuted,
            }}
          >
            {isSectionOpen ? 'Hide' : 'Show details & notes'}
          </span>
        </button>

        {isSectionOpen && (
          <div
            style={{
              padding: `${SPACING_TOKENS.sm} ${SPACING_TOKENS.md} ${SPACING_TOKENS.md}`,
              borderTop: `1px solid ${COLOR_TOKENS.borderSubtle}`,
            }}
          >
            {railContent}
          </div>
        )}

        {/* Change Cover Modal */}
        {isCoverModalOpen && (
          <CoverPickerModal
            onClose={() => setIsCoverModalOpen(false)}
            onSelect={handleSelectCover}
            availableCoverAssetMap={availableCoverAssetMap}
            currentCoverAssetId={category.coverAssetId}
          />
        )}
      </div>
    );
  }

  // Sticky right rail (>= 1280px)
  return (
    <aside
      data-testid="category-right-rail"
      aria-label="Catalogue Information and Notes"
      style={{
        width: '280px',
        flexShrink: 0,
        position: 'sticky',
        top: '72px',
        maxHeight: 'calc(100vh - 96px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        boxSizing: 'border-box',
      }}
    >
      {railContent}

      {/* Change Cover Modal */}
      {isCoverModalOpen && (
        <CoverPickerModal
          onClose={() => setIsCoverModalOpen(false)}
          onSelect={handleSelectCover}
          availableCoverAssetMap={availableCoverAssetMap}
          currentCoverAssetId={category.coverAssetId}
        />
      )}
    </aside>
  );
};

interface CoverPickerModalProps {
  onClose: () => void;
  onSelect: (coverAssetId?: string) => Promise<void>;
  availableCoverAssetMap: Record<string, string>;
  currentCoverAssetId?: string;
}

const CoverPickerModal: React.FC<CoverPickerModalProps> = ({
  onClose,
  onSelect,
  availableCoverAssetMap,
  currentCoverAssetId,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cover-picker-title"
      data-testid="cover-picker-modal"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(30, 25, 20, 0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: SPACING_TOKENS.md,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: COLOR_TOKENS.paper,
          border: `1.5px solid ${COLOR_TOKENS.border}`,
          borderRadius: RADIUS_TOKENS.md,
          boxShadow: SHADOW_TOKENS.toast,
          padding: SPACING_TOKENS.lg,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACING_TOKENS.md,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2
            id="cover-picker-title"
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
              fontSize: '20px',
              fontWeight: 700,
              color: COLOR_TOKENS.ink,
              margin: 0,
            }}
          >
            Change Cover
          </h2>
          <button
            type="button"
            data-testid="close-cover-modal-btn"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: COLOR_TOKENS.inkMuted,
            }}
          >
            <RiCloseLine size={20} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '10px' }}>
          {/* No Cover option */}
          <button
            type="button"
            data-testid="cover-option-none"
            onClick={() => onSelect(undefined)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '110px',
              backgroundColor: COLOR_TOKENS.paperSubtle,
              border: !currentCoverAssetId ? `2px solid ${COLOR_TOKENS.terracotta}` : `1px dashed ${COLOR_TOKENS.border}`,
              borderRadius: RADIUS_TOKENS.xs,
              cursor: 'pointer',
              gap: '4px',
              padding: '6px',
            }}
          >
            <span style={{ fontSize: '11px', color: COLOR_TOKENS.inkMuted, fontWeight: 600 }}>No Cover</span>
            <span style={{ fontSize: '10px', color: COLOR_TOKENS.inkMuted }}>(Placeholder)</span>
          </button>

          {SEED_COVERS_MANIFEST.map((cover) => {
            const assetId = availableCoverAssetMap[cover.key];
            const isSelected = currentCoverAssetId && currentCoverAssetId === assetId;

            return (
              <button
                key={cover.key}
                type="button"
                data-testid={`cover-option-${cover.key}`}
                onClick={() => onSelect(assetId)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  height: '110px',
                  backgroundColor: cover.accentColor,
                  border: isSelected ? `2.5px solid ${COLOR_TOKENS.terracotta}` : `1px solid ${COLOR_TOKENS.border}`,
                  borderRadius: RADIUS_TOKENS.xs,
                  cursor: 'pointer',
                  padding: '6px',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  position: 'relative',
                  transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#ffffff',
                    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                    marginTop: 'auto',
                    textAlign: 'center',
                    lineHeight: 1.2,
                  }}
                >
                  {cover.categoryTitle}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
