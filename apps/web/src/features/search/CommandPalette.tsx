import React, { useState, useEffect, useRef } from 'react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
} from '@kaaj/design';
import { Search, FileText, Plus, X, CornerDownLeft } from 'lucide-react';
import { API_BASE_URL, getAuthHeaders } from '../../config/api.js';

export interface SearchResultItem {
  id: string;
  categoryId: string;
  title: string;
  categoryTitle?: string;
  categoryColor?: string;
  updatedAt?: string;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToEntry: (entryId: string) => void;
  onNewEntry?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigateToEntry,
  onNewEntry,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input whenever palette opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced search query
  useEffect(() => {
    if (!isOpen) return;
    const clean = query.trim();
    if (!clean) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(clean)}`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data: SearchResultItem[] = await res.json();
          setResults(data);
          setSelectedIndex(0);
        }
      } catch (err) {
        console.error('Search query failed:', err);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const total = results.length + (onNewEntry ? 1 : 0);
        if (total > 0) {
          setSelectedIndex((prev) => (prev + 1) % total);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const total = results.length + (onNewEntry ? 1 : 0);
        if (total > 0) {
          setSelectedIndex((prev) => (prev - 1 + total) % total);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (results.length > 0 && selectedIndex < results.length) {
          const selected = results[selectedIndex];
          onNavigateToEntry(selected.id);
          onClose();
        } else if (onNewEntry && selectedIndex === results.length) {
          onNewEntry();
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, results, selectedIndex, onClose, onNavigateToEntry, onNewEntry]);

  if (!isOpen) return null;

  const handleSelectEntry = (id: string) => {
    onNavigateToEntry(id);
    onClose();
  };

  const handleCreateNew = () => {
    if (onNewEntry) {
      onNewEntry();
      onClose();
    }
  };

  return (
    <div
      data-testid="command-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(26, 22, 18, 0.45)',
        backdropFilter: 'blur(3px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      <div
        data-testid="command-palette-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: COLOR_TOKENS.paper,
          borderRadius: RADIUS_TOKENS.lg,
          boxShadow: SHADOW_TOKENS.detailsCard,
          border: `1px solid ${COLOR_TOKENS.border}`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '70vh',
        }}
      >
        {/* Search Input Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px 18px',
            borderBottom: `1px solid ${COLOR_TOKENS.border}`,
            backgroundColor: COLOR_TOKENS.paperWarm,
          }}
        >
          <Search size={18} style={{ color: COLOR_TOKENS.inkMuted, flexShrink: 0 }} aria-hidden="true" />
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entries or jump to note..."
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              backgroundColor: 'transparent',
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              fontSize: '15px',
              color: COLOR_TOKENS.ink,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: COLOR_TOKENS.inkMuted,
                padding: '2px',
              }}
              aria-label="Clear search input"
            >
              <X size={15} />
            </button>
          )}
          <kbd
            style={{
              fontSize: '11px',
              padding: '2px 6px',
              borderRadius: RADIUS_TOKENS.sm,
              backgroundColor: COLOR_TOKENS.paperSubtle,
              color: COLOR_TOKENS.inkMuted,
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              border: `1px solid ${COLOR_TOKENS.border}`,
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results & Actions Area */}
        <div
          ref={listRef}
          role="listbox"
          data-testid="command-palette-results"
          style={{
            padding: '8px',
            overflowY: 'auto',
            maxHeight: '400px',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          {isLoading && (
            <div
              style={{
                padding: '16px',
                textAlign: 'center',
                color: COLOR_TOKENS.inkMuted,
                fontSize: '13px',
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              }}
            >
              Searching notes...
            </div>
          )}

          {!isLoading && query && results.length === 0 && (
            <div
              data-testid="command-palette-empty"
              style={{
                padding: '20px 16px',
                textAlign: 'center',
                color: COLOR_TOKENS.inkMuted,
                fontSize: '13px',
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              }}
            >
              No matching entries found for &ldquo;{query}&rdquo;
            </div>
          )}

          {results.map((entry, index) => {
            const isSelected = index === selectedIndex;
            return (
              <div
                key={entry.id}
                role="option"
                aria-selected={isSelected}
                data-testid={`command-result-${entry.id}`}
                onClick={() => handleSelectEntry(entry.id)}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 12px',
                  borderRadius: RADIUS_TOKENS.sm,
                  backgroundColor: isSelected ? COLOR_TOKENS.paperSubtle : 'transparent',
                  cursor: 'pointer',
                  transition: 'background-color 0.1s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <FileText
                    size={16}
                    style={{
                      color: entry.categoryColor || COLOR_TOKENS.terracotta,
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  />
                  <span
                    style={{
                      fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
                      fontSize: '15px',
                      color: COLOR_TOKENS.ink,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {entry.title || 'Untitled'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  {entry.categoryTitle && (
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: RADIUS_TOKENS.xs,
                        backgroundColor: entry.categoryColor
                          ? `${entry.categoryColor}18`
                          : COLOR_TOKENS.paperWarm,
                        color: entry.categoryColor || COLOR_TOKENS.inkMuted,
                        fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                        fontWeight: 500,
                      }}
                    >
                      {entry.categoryTitle}
                    </span>
                  )}
                  {isSelected && (
                    <CornerDownLeft size={13} style={{ color: COLOR_TOKENS.inkMuted }} aria-hidden="true" />
                  )}
                </div>
              </div>
            );
          })}

          {/* Quick Action: New Entry */}
          {onNewEntry && (
            <div
              role="option"
              aria-selected={selectedIndex === results.length}
              data-testid="command-palette-new-entry"
              onClick={handleCreateNew}
              onMouseEnter={() => setSelectedIndex(results.length)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                borderRadius: RADIUS_TOKENS.sm,
                backgroundColor:
                  selectedIndex === results.length ? COLOR_TOKENS.paperSubtle : 'transparent',
                cursor: 'pointer',
                marginTop: results.length > 0 ? '4px' : '0',
                borderTop: results.length > 0 ? `1px dashed ${COLOR_TOKENS.border}` : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Plus size={16} style={{ color: COLOR_TOKENS.terracotta }} aria-hidden="true" />
                <span
                  style={{
                    fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                    fontSize: '14px',
                    color: COLOR_TOKENS.ink,
                    fontWeight: 500,
                  }}
                >
                  Create New Entry
                </span>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  color: COLOR_TOKENS.inkMuted,
                  fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                }}
              >
                Jump straight to write
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
