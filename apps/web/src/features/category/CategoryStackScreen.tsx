import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { HomeHeader } from '../home/HomeHeader.js';
import { BookSpine } from './BookSpine.js';
import { OlderEntriesPile } from './OlderEntriesPile.js';
import { EmptyBlankBook } from './EmptyBlankBook.js';
import { StackSkeleton } from './StackSkeleton.js';
import { UndoToast } from '../home/UndoToast.js';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  STACK_CONFIG,
  COPY,
} from '@kaaj/design';
import type { Category, CategoryLightRow, EntryLightRow } from '@kaaj/doc-model';
import { RiAddLine, RiArrowLeftLine, RiAlertLine } from '@remixicon/react';

interface CategoryStackScreenProps {
  categoryId: string;
  onNavigateHome: () => void;
  onNavigateToEntry: (entryId: string) => void;
}

type SortOption = 'date' | 'title' | 'length';

export const CategoryStackScreen: React.FC<CategoryStackScreenProps> = ({
  categoryId,
  onNavigateHome,
  onNavigateToEntry,
}) => {
  const [category, setCategory] = useState<Category | null>(null);
  const [allCategories, setAllCategories] = useState<CategoryLightRow[]>([]);
  const [entries, setEntries] = useState<EntryLightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read sort option from URL query (?sort=date | title | length)
  const [currentSort, setCurrentSort] = useState<SortOption>(() => {
    const params = new URLSearchParams(window.location.search);
    const sortParam = params.get('sort');
    if (sortParam === 'title' || sortParam === 'length' || sortParam === 'date') {
      return sortParam;
    }
    return 'date';
  });

  // Track if older entries pile is expanded
  const [isOlderExpanded, setIsOlderExpanded] = useState(false);

  // Soft delete and undo state
  const [deletedEntry, setDeletedEntry] = useState<{ id: string; title: string } | null>(null);

  // Responsive mobile detector (fewer visible items before fold)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 640 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Sync sort param from URL popstate
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const sortParam = params.get('sort') as SortOption | null;
      if (sortParam && (sortParam === 'date' || sortParam === 'title' || sortParam === 'length')) {
        setCurrentSort(sortParam);
      } else {
        setCurrentSort('date');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const setSort = (sort: SortOption) => {
    setCurrentSort(sort);
    const url = new URL(window.location.href);
    if (sort === 'date') {
      url.searchParams.delete('sort');
    } else {
      url.searchParams.set('sort', sort);
    }
    window.history.pushState({}, '', url.toString());
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = { Authorization: 'Bearer kaaj-local-dev-token' };

      const [catRes, entriesRes, allCatsRes] = await Promise.all([
        fetch(`http://localhost:3001/categories/${categoryId}`, { headers }),
        fetch(`http://localhost:3001/categories/${categoryId}/entries`, { headers }),
        fetch('http://localhost:3001/categories', { headers }),
      ]);

      if (!catRes.ok) {
        throw new Error('Category not found');
      }

      const catData = await catRes.json();
      const entriesData = entriesRes.ok ? await entriesRes.json() : [];
      const allCatsData = allCatsRes.ok ? await allCatsRes.json() : [];

      setCategory(catData);
      setEntries(entriesData);
      setAllCategories(allCatsData);
    } catch (err: any) {
      setError(err.message || COPY.loadError);
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Prefetch entry on hover/focus
  const handlePrefetchEntry = useCallback((entryId: string) => {
    fetch(`http://localhost:3001/entries/${entryId}`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    }).catch(() => {});
  }, []);

  // Create new entry
  const handleCreateEntry = async () => {
    try {
      const res = await fetch('http://localhost:3001/entries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer kaaj-local-dev-token',
        },
        body: JSON.stringify({
          categoryId,
          title: 'Untitled entry',
        }),
      });

      if (!res.ok) throw new Error('Failed to create entry');
      const newEntry = await res.json();

      // Navigate to /entry/:id per specification
      onNavigateToEntry(newEntry.id);
    } catch (err) {
      console.error('Create entry failed:', err);
    }
  };

  // Rename entry
  const handleRenameEntry = async (entryId: string, newTitle: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, title: newTitle } : e))
    );

    try {
      await fetch(`http://localhost:3001/entries/${entryId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer kaaj-local-dev-token',
        },
        body: JSON.stringify({ title: newTitle }),
      });
    } catch {
      loadData();
    }
  };

  // Move entry to another category
  const handleMoveToCategory = async (entryId: string, targetCategoryId: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== entryId));

    try {
      await fetch(`http://localhost:3001/entries/${entryId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer kaaj-local-dev-token',
        },
        body: JSON.stringify({ categoryId: targetCategoryId }),
      });
    } catch {
      loadData();
    }
  };

  // Select colour
  const handleSelectColor = async (entryId: string, colorKey: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, color: colorKey } : e))
    );

    try {
      await fetch(`http://localhost:3001/entries/${entryId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer kaaj-local-dev-token',
        },
        body: JSON.stringify({ color: colorKey }),
      });
    } catch {
      loadData();
    }
  };

  // Toggle pin
  const handleTogglePin = async (entryId: string) => {
    const target = entries.find((e) => e.id === entryId);
    if (!target) return;
    const newPinned = !target.pinned;

    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, pinned: newPinned } : e))
    );

    try {
      await fetch(`http://localhost:3001/entries/${entryId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer kaaj-local-dev-token',
        },
        body: JSON.stringify({ pinned: newPinned }),
      });
    } catch {
      loadData();
    }
  };

  // Soft delete entry
  const handleDeleteEntry = async (entryId: string) => {
    const target = entries.find((e) => e.id === entryId);
    if (!target) return;

    setEntries((prev) => prev.filter((e) => e.id !== entryId));
    setDeletedEntry({ id: target.id, title: target.title });

    try {
      await fetch(`http://localhost:3001/entries/${entryId}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      });
    } catch {
      loadData();
    }
  };

  // Undo delete
  const handleUndoDelete = async () => {
    if (!deletedEntry) return;
    const toRestore = deletedEntry;
    setDeletedEntry(null);

    try {
      const res = await fetch(`http://localhost:3001/entries/${toRestore.id}/restore`, {
        method: 'POST',
        headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      });
      if (res.ok) {
        loadData();
      }
    } catch {
      loadData();
    }
  };

  // Sorted and partitioned entries
  const { pinnedEntries, visibleUnpinnedEntries, olderEntriesCount } = useMemo(() => {
    // 1. Separate pinned vs unpinned
    const pinned = entries.filter((e) => e.pinned);
    const unpinned = entries.filter((e) => !e.pinned);

    // 2. Sort unpinned based on currentSort
    const sortedUnpinned = [...unpinned].sort((a, b) => {
      if (currentSort === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (currentSort === 'length') {
        // By weight descending (thickest first)
        return b.weight - a.weight;
      }
      // Default: date ascending (oldest first at top, newest at bottom of the stack)
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    });

    // 3. Overflow handling: show newest 8 (or 6 on mobile) before folding
    const maxVisible = isMobile ? STACK_CONFIG.mobileVisibleCount : STACK_CONFIG.defaultVisibleCount;

    if (currentSort === 'date') {
      if (sortedUnpinned.length > maxVisible && !isOlderExpanded) {
        const splitIndex = sortedUnpinned.length - maxVisible;
        const older = sortedUnpinned.slice(0, splitIndex);
        const newest = sortedUnpinned.slice(splitIndex);
        return {
          pinnedEntries: pinned,
          visibleUnpinnedEntries: newest,
          olderEntriesCount: older.length,
        };
      }
    }

    return {
      pinnedEntries: pinned,
      visibleUnpinnedEntries: sortedUnpinned,
      olderEntriesCount: 0,
    };
  }, [entries, currentSort, isOlderExpanded, isMobile]);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: COLOR_TOKENS.canvas,
        backgroundImage: `
          radial-gradient(${COLOR_TOKENS.paperWarm} 1px, transparent 1px),
          radial-gradient(${COLOR_TOKENS.paperSubtle} 1px, ${COLOR_TOKENS.canvas} 1px)
        `,
        backgroundSize: '32px 32px',
        backgroundPosition: '0 0, 16px 16px',
        color: COLOR_TOKENS.ink,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <HomeHeader />

      <main
        style={{
          flex: 1,
          maxWidth: '1040px',
          margin: '0 auto',
          padding: `${SPACING_TOKENS.lg} ${SPACING_TOKENS.xl} ${SPACING_TOKENS.xxxl}`,
          width: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Back Link */}
        <div style={{ width: '100%', maxWidth: '860px', marginBottom: SPACING_TOKENS.sm }}>
          <button
            type="button"
            data-testid="back-to-catalogues-link"
            onClick={onNavigateHome}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: SPACING_TOKENS.xs,
              background: 'none',
              border: 'none',
              color: COLOR_TOKENS.inkMuted,
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
              fontWeight: 500,
              cursor: 'pointer',
              padding: '4px 0',
              transition: 'color 150ms ease-out',
            }}
          >
            <RiArrowLeftLine size={16} />
            {COPY.backToCatalogues}
          </button>
        </div>

        {/* Category Header Row */}
        <header
          style={{
            width: '100%',
            maxWidth: '860px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: SPACING_TOKENS.md,
            marginBottom: SPACING_TOKENS.xl,
            paddingBottom: SPACING_TOKENS.md,
            borderBottom: `1px solid ${COLOR_TOKENS.borderSubtle}`,
          }}
        >
          {/* Title and Entry Count */}
          <div>
            <h1
              data-testid="category-title"
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
                fontSize: TYPOGRAPHY_TOKENS.fontSize.heading1,
                fontWeight: 700,
                color: COLOR_TOKENS.ink,
                margin: '0 0 4px 0',
                lineHeight: 1.15,
                letterSpacing: '-0.015em',
              }}
            >
              {loading ? 'Catalogue' : category?.title || 'Catalogue'}
            </h1>
            <span
              data-testid="category-entry-count"
              style={{
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                fontSize: '16px',
                color: COLOR_TOKENS.inkMuted,
              }}
            >
              {COPY.entryCount(entries.length)}
            </span>
          </div>

          {/* Primary Action and Quiet Sort Control */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: SPACING_TOKENS.lg,
              flexWrap: 'wrap',
            }}
          >
            {/* Quiet Sort Control (Text Toggle: Date / Title / Length) */}
            <div
              role="radiogroup"
              aria-label="Sort stack by"
              data-testid="sort-toggle-group"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: SPACING_TOKENS.xs,
                backgroundColor: COLOR_TOKENS.paperSubtle,
                padding: '3px 4px',
                borderRadius: RADIUS_TOKENS.sm,
                border: `1px solid ${COLOR_TOKENS.border}`,
              }}
            >
              {(['date', 'title', 'length'] as const).map((s) => {
                const isActive = currentSort === s;
                const label = s === 'date' ? COPY.sortDate : s === 'title' ? COPY.sortTitle : COPY.sortLength;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    data-testid={`sort-toggle-${s}`}
                    onClick={() => setSort(s)}
                    style={{
                      background: isActive ? COLOR_TOKENS.paper : 'transparent',
                      color: isActive ? COLOR_TOKENS.ink : COLOR_TOKENS.inkMuted,
                      border: 'none',
                      borderRadius: RADIUS_TOKENS.xs,
                      padding: '4px 10px',
                      fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                      fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                      fontWeight: isActive ? 600 : 400,
                      boxShadow: isActive ? '0 1px 2px rgba(40, 30, 20, 0.08)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 120ms ease-out',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Primary Action: New Entry */}
            <button
              type="button"
              data-testid="new-entry-btn"
              onClick={handleCreateEntry}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: SPACING_TOKENS.xs,
                backgroundColor: COLOR_TOKENS.terracotta,
                color: '#ffffff',
                border: 'none',
                borderRadius: RADIUS_TOKENS.sm,
                padding: `${SPACING_TOKENS.sm} ${SPACING_TOKENS.md}`,
                fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
                fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 5px rgba(194, 94, 56, 0.25)',
                transition: 'background-color 150ms ease-out, transform 150ms ease-out',
              }}
            >
              <RiAddLine size={18} />
              {COPY.newEntry}
            </button>
          </div>
        </header>

        {/* Stack Content Body */}
        <section
          data-testid="book-stack-container"
          style={{
            width: '100%',
            maxWidth: `${STACK_CONFIG.stackWidthLaptopPx}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative',
          }}
        >
          {loading && <StackSkeleton />}

          {error && (
            <div
              data-testid="stack-error-state"
              style={{
                textAlign: 'center',
                padding: SPACING_TOKENS.xxl,
                backgroundColor: COLOR_TOKENS.paper,
                border: `1px solid ${COLOR_TOKENS.border}`,
                borderRadius: RADIUS_TOKENS.md,
                width: '90%',
              }}
            >
              <RiAlertLine size={32} color={COLOR_TOKENS.terracotta} style={{ marginBottom: SPACING_TOKENS.sm }} />
              <p style={{ fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans, color: COLOR_TOKENS.inkMuted }}>
                {error}
              </p>
              <button
                type="button"
                data-testid="error-retry-btn"
                onClick={loadData}
                style={{
                  marginTop: SPACING_TOKENS.md,
                  backgroundColor: COLOR_TOKENS.paperSubtle,
                  border: `1px solid ${COLOR_TOKENS.border}`,
                  padding: `${SPACING_TOKENS.xs} ${SPACING_TOKENS.md}`,
                  borderRadius: RADIUS_TOKENS.xs,
                  cursor: 'pointer',
                }}
              >
                {COPY.retry}
              </button>
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <EmptyBlankBook onCreateFirstEntry={handleCreateEntry} />
          )}

          {!loading && !error && entries.length > 0 && (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <ol
                role="list"
                aria-label={`Books in ${category?.title || 'Catalogue'}`}
                data-testid="book-stack-list"
                style={{
                  width: '100%',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  boxSizing: 'border-box',
                }}
              >
                {/* 1. Pinned entries at the top of the stack */}
                {pinnedEntries.map((entry) => (
                  <BookSpine
                    key={entry.id}
                    entry={entry}
                    categories={allCategories}
                    currentCategoryId={categoryId}
                    onOpen={onNavigateToEntry}
                    onRename={handleRenameEntry}
                    onMoveToCategory={handleMoveToCategory}
                    onSelectColor={handleSelectColor}
                    onTogglePin={handleTogglePin}
                    onDelete={handleDeleteEntry}
                    onPrefetch={handlePrefetchEntry}
                  />
                ))}

                {/* 2. Folded older entries pile (if collapsed) */}
                {olderEntriesCount > 0 && !isOlderExpanded && (
                  <OlderEntriesPile
                    count={olderEntriesCount}
                    onExpand={() => setIsOlderExpanded(true)}
                  />
                )}

                {/* 3. Visible unpinned books (leading down to the newest at the bottom) */}
                {visibleUnpinnedEntries.map((entry) => (
                  <BookSpine
                    key={entry.id}
                    entry={entry}
                    categories={allCategories}
                    currentCategoryId={categoryId}
                    onOpen={onNavigateToEntry}
                    onRename={handleRenameEntry}
                    onMoveToCategory={handleMoveToCategory}
                    onSelectColor={handleSelectColor}
                    onTogglePin={handleTogglePin}
                    onDelete={handleDeleteEntry}
                    onPrefetch={handlePrefetchEntry}
                  />
                ))}
              </ol>

              {/* Physical table edge surface beneath the bottom book */}
              <div
                data-testid="table-edge"
                aria-hidden="true"
                style={{
                  width: '100%',
                  maxWidth: '880px',
                  height: '22px',
                  backgroundColor: COLOR_TOKENS.tableSurface,
                  borderRadius: `${RADIUS_TOKENS.xs} ${RADIUS_TOKENS.xs} ${RADIUS_TOKENS.md} ${RADIUS_TOKENS.md}`,
                  borderTop: `2px solid ${COLOR_TOKENS.tableEdgeHighlight}`,
                  borderBottom: `3px solid ${COLOR_TOKENS.tableEdgeShadow}`,
                  boxShadow: SHADOW_TOKENS.stackBase,
                  marginTop: '4px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
        </section>
      </main>

      {/* Soft Delete Undo Toast */}
      {deletedEntry && (
        <UndoToast
          message={COPY.entryDeletedNotice(deletedEntry.title)}
          onUndo={handleUndoDelete}
          onDismiss={() => setDeletedEntry(null)}
        />
      )}
    </div>
  );
};
