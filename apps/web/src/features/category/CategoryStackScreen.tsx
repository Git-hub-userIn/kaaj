import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { HomeHeader } from '../home/HomeHeader.js';
import { BookSpine } from './BookSpine.js';
import { EmptyBlankBook } from './EmptyBlankBook.js';
import { StackSkeleton } from './StackSkeleton.js';
import { SpineCustomizerModal } from './SpineCustomizerModal.js';
import { UndoToast } from '../home/UndoToast.js';
import { CategoryLeftRail } from './CategoryLeftRail.js';
import { CategoryRightRail } from './CategoryRightRail.js';
import { CompactJumpToMenu } from './CompactJumpToMenu.js';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  STACK_CONFIG,
  COPY,
  SEED_COVERS_MANIFEST,
} from '@kaaj/design';
import type { Category, CategoryLightRow, EntryLightRow, SpineStyle, CategoryStats } from '@kaaj/doc-model';
import { getPileLabel, computePileGeometries } from './stack-utils.js';
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
  const [stats, setStats] = useState<CategoryStats | null>(null);
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

  // Soft delete and undo state
  const [deletedEntry, setDeletedEntry] = useState<{ id: string; title: string } | null>(null);

  // Spine Customizer modal state
  const [customizingEntry, setCustomizingEntry] = useState<EntryLightRow | null>(null);

  // Sticky slim bar visibility state
  const [showStickyBar, setShowStickyBar] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // Viewport width for responsive rails and details mode
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1440
  );

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isWideScreen = viewportWidth >= 1280;
  const isMediumScreen = viewportWidth >= 1024 && viewportWidth < 1280;

  // Active entry for sticky Details panel (>= 1280px)
  const [activeEntry, setActiveEntry] = useState<EntryLightRow | null>(null);

  // Default to first entry once loaded; never empty
  useEffect(() => {
    if (entries.length > 0 && !activeEntry) {
      setActiveEntry(entries[0]);
    }
  }, [entries, activeEntry]);

  const handleBookHover = useCallback((entry: EntryLightRow) => {
    setActiveEntry(entry);
  }, []);

  const handleBookFocus = useCallback((entry: EntryLightRow) => {
    setActiveEntry(entry);
  }, []);

  // Active pile index for "Jump to" highlight via IntersectionObserver
  const [activePileIdx, setActivePileIdx] = useState(0);

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

      const [catRes, entriesRes, allCatsRes, statsRes] = await Promise.all([
        fetch(`http://localhost:3001/categories/${categoryId}`, { headers }),
        fetch(`http://localhost:3001/categories/${categoryId}/entries`, { headers }),
        fetch('http://localhost:3001/categories', { headers }),
        fetch(`http://localhost:3001/categories/${categoryId}/stats`, { headers }),
      ]);

      if (!catRes.ok) {
        throw new Error('Category not found');
      }

      const catData = await catRes.json();
      const entriesData = entriesRes.ok ? await entriesRes.json() : [];
      const allCatsData = allCatsRes.ok ? await allCatsRes.json() : [];
      const statsData = statsRes.ok ? await statsRes.json() : null;

      setCategory(catData);
      setEntries(entriesData);
      setAllCategories(allCatsData);
      setStats(statsData);
    } catch (err: any) {
      setError(err.message || COPY.loadError);
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  // Map of seed covers manifest key -> coverAssetId
  const availableCoverAssetMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cat of allCategories) {
      if (cat.coverAssetId) {
        for (const item of SEED_COVERS_MANIFEST) {
          if (cat.id.includes(item.key) || cat.title.toLowerCase() === item.categoryTitle.toLowerCase()) {
            map[item.key] = cat.coverAssetId;
          }
        }
      }
    }
    return map;
  }, [allCategories]);

  // Update category handler with If-Match version optimistic concurrency
  const handleUpdateCategory = useCallback(
    async (updates: Partial<Category>): Promise<boolean> => {
      if (!category) return false;
      try {
        const res = await fetch(`http://localhost:3001/categories/${category.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer kaaj-local-dev-token',
            'If-Match': `"${category.version}"`,
          },
          body: JSON.stringify(updates),
        });

        if (res.status === 409) {
          await loadData();
          return false;
        }

        if (!res.ok) {
          throw new Error('Failed to update catalogue');
        }

        const updatedCat = await res.json();
        setCategory(updatedCat);
        setAllCategories((prev) =>
          prev.map((c) => (c.id === updatedCat.id ? { ...c, ...updatedCat } : c))
        );
        return true;
      } catch (err) {
        console.error('Update category failed:', err);
        return false;
      }
    },
    [category, loadData]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Restore scroll position when returning from an entry
  useEffect(() => {
    if (!loading && entries.length > 0) {
      const savedScroll = sessionStorage.getItem(`kaaj-scroll-${categoryId}`);
      if (savedScroll) {
        const y = parseInt(savedScroll, 10);
        if (!isNaN(y) && y > 0) {
          const timer = setTimeout(() => {
            window.scrollTo({ top: y, behavior: 'instant' });
          }, 60);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [loading, entries.length, categoryId]);

  // Scroll listener for sticky slim header bar
  useEffect(() => {
    const checkSticky = () => {
      const headerEl = headerRef.current;
      if (!headerEl) return;
      const rect = headerEl.getBoundingClientRect();
      setShowStickyBar(rect.bottom < 0);
    };

    window.addEventListener('scroll', checkSticky, { passive: true });
    checkSticky();
    return () => window.removeEventListener('scroll', checkSticky);
  }, [loading]);

  // Save scroll and navigate to entry
  const handleOpenEntry = useCallback(
    (entryId: string) => {
      sessionStorage.setItem(`kaaj-scroll-${categoryId}`, String(window.scrollY));
      onNavigateToEntry(entryId);
    },
    [categoryId, onNavigateToEntry]
  );

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

      handleOpenEntry(newEntry.id);
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

  // Customise spine
  const handleSaveSpine = async (spine: SpineStyle) => {
    if (!customizingEntry) return;
    const entryId = customizingEntry.id;

    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, spine } : e))
    );

    try {
      await fetch(`http://localhost:3001/entries/${entryId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer kaaj-local-dev-token',
        },
        body: JSON.stringify({ spine }),
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

  // Sorted and partitioned entries into piles of N books (default 10)
  // Per spec: DEFAULT newest on top (first pile), older below. Pinned first.
  const piles = useMemo(() => {
    // 1. Separate pinned vs unpinned
    const pinned = entries.filter((e) => e.pinned);
    const unpinned = entries.filter((e) => !e.pinned);

    // 2. Sort unpinned based on currentSort
    const sortedUnpinned = [...unpinned].sort((a, b) => {
      if (currentSort === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (currentSort === 'length') {
        return b.weight - a.weight;
      }
      // Default: date descending (newest on top of the stack)
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    // 3. Combined ordered list: pinned first, then sorted unpinned
    const allOrdered = [...pinned, ...sortedUnpinned];

    // 4. Split into chunks of N books (STACK_CONFIG.defaultPileSize = 10)
    const pileChunks: EntryLightRow[][] = [];
    const pileSize = STACK_CONFIG.defaultPileSize;
    for (let i = 0; i < allOrdered.length; i += pileSize) {
      pileChunks.push(allOrdered.slice(i, i + pileSize));
    }

    return pileChunks;
  }, [entries, currentSort]);

  // Highlight pile in view using IntersectionObserver
  useEffect(() => {
    if (piles.length === 0) return;

    const observer = new IntersectionObserver(
      (obsEntries) => {
        for (const entry of obsEntries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('id');
            if (id && id.startsWith('stack-pile-')) {
              const idx = parseInt(id.replace('stack-pile-', ''), 10);
              if (!isNaN(idx)) {
                setActivePileIdx(idx);
              }
            }
          }
        }
      },
      {
        rootMargin: '-80px 0px -50% 0px',
        threshold: [0, 0.2, 0.5],
      }
    );

    piles.forEach((_, idx) => {
      const el = document.getElementById(`stack-pile-${idx}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [piles]);

  const handleSelectPile = useCallback((pileIdx: number) => {
    setActivePileIdx(pileIdx);
    const target = document.getElementById(`pile-heading-${pileIdx}`);
    if (target) {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({
        behavior: prefersReducedMotion ? 'instant' : 'smooth',
        block: 'start',
      });
      target.focus();
    }
  }, []);

  const isCapped = entries.length >= STACK_CONFIG.maxLightRowsCap;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: COLOR_TOKENS.canvas,
        backgroundImage: `
          radial-gradient(${COLOR_TOKENS.paperWarm} 1px, transparent 1px),
          radial-gradient(${COLOR_TOKENS.paperSubtle} 1px, ${COLOR_TOKENS.canvas} 1px),
          radial-gradient(ellipse at 50% 30%, transparent 40%, rgba(45, 35, 25, 0.05) 100%)
        `,
        backgroundSize: '32px 32px, 32px 32px, 100% 100%',
        backgroundPosition: '0 0, 16px 16px, 0 0',
        color: COLOR_TOKENS.ink,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <HomeHeader />

      {/* Slim Sticky Bar (appears after title area scrolls away) */}
      <div
        data-testid="sticky-category-bar"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '48px',
          backgroundColor: 'rgba(252, 251, 247, 0.94)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${COLOR_TOKENS.border}`,
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `0 ${SPACING_TOKENS.xl}`,
          boxShadow: '0 2px 8px rgba(40, 30, 20, 0.08)',
          transform: showStickyBar ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 200ms ease-in-out',
          pointerEvents: showStickyBar ? 'auto' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACING_TOKENS.md }}>
          <button
            type="button"
            data-testid="sticky-back-link"
            onClick={onNavigateHome}
            style={{
              background: 'none',
              border: 'none',
              color: COLOR_TOKENS.inkMuted,
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              padding: '4px',
            }}
            aria-label="Back to Catalogues"
          >
            <RiArrowLeftLine size={18} />
          </button>
          <span
            data-testid="sticky-category-name"
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
              fontSize: '18px',
              fontWeight: 600,
              color: COLOR_TOKENS.ink,
            }}
          >
            {category?.title || 'Catalogue'}
          </span>
        </div>

        <button
          type="button"
          data-testid="sticky-new-entry-btn"
          onClick={handleCreateEntry}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: SPACING_TOKENS.xs,
            backgroundColor: COLOR_TOKENS.terracotta,
            color: '#ffffff',
            border: 'none',
            borderRadius: RADIUS_TOKENS.xs,
            padding: '5px 12px',
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <RiAddLine size={16} />
          {COPY.newEntry}
        </button>
      </div>

      <main
        style={{
          flex: 1,
          width: '100%',
          margin: '0 auto',
          padding: `${SPACING_TOKENS.lg} 0 ${SPACING_TOKENS.xxxl}`,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          overflow: 'visible',
        }}
      >
        {/* Back Link */}
        <div
          style={{
            width: '100%',
            maxWidth: isWideScreen ? '1440px' : '900px',
            margin: '0 auto',
            padding: `0 ${SPACING_TOKENS.xl}`,
            marginBottom: SPACING_TOKENS.sm,
            boxSizing: 'border-box',
          }}
        >
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
            {COPY.backToCatalogues}
          </button>
        </div>

        {/* Category Header Row */}
        <header
          ref={headerRef}
          style={{
            width: '100%',
            maxWidth: isWideScreen ? '1440px' : '900px',
            margin: '0 auto',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: SPACING_TOKENS.md,
            padding: `0 ${SPACING_TOKENS.xl} ${SPACING_TOKENS.md}`,
            borderBottom: `1px solid ${COLOR_TOKENS.borderSubtle}`,
            boxSizing: 'border-box',
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

          {/* Primary Action, Quiet Sort Control, and Compact Jump To (1024-1279px) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: SPACING_TOKENS.sm,
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

            {/* Compact Jump to Menu (1024px to 1279px only) */}
            {isMediumScreen && piles.length > 1 && (
              <CompactJumpToMenu
                piles={piles}
                currentSort={currentSort}
                onSelectPile={handleSelectPile}
              />
            )}

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

        {/* 500 Entry Cap Calm Note Banner */}
        {isCapped && (
          <div
            data-testid="stack-cap-note"
            style={{
              width: '100%',
              maxWidth: '900px',
              padding: `${SPACING_TOKENS.sm} ${SPACING_TOKENS.md}`,
              backgroundColor: COLOR_TOKENS.paperWarm,
              border: `1px solid ${COLOR_TOKENS.border}`,
              borderRadius: RADIUS_TOKENS.sm,
              marginTop: SPACING_TOKENS.md,
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              fontSize: '13px',
              color: COLOR_TOKENS.inkMuted,
              textAlign: 'center',
              boxSizing: 'border-box',
            }}
          >
            {COPY.showingNewestCapped(STACK_CONFIG.maxLightRowsCap)}
          </div>
        )}

        {/* Layout container: Three columns (>= 1280px) or Single column (< 1280px) */}
        <div
          className="category-three-col-layout"
          data-testid="category-three-col-layout"
          style={{
            width: '100%',
            maxWidth: isWideScreen ? '1440px' : '900px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            gap: isWideScreen ? '24px' : '0',
            padding: isWideScreen ? '0 24px' : '0',
            boxSizing: 'border-box',
          }}
        >
          {/* Left Rail (>= 1280px) */}
          {isWideScreen && piles.length > 0 && (
            <CategoryLeftRail
              piles={piles}
              currentSort={currentSort}
              entries={entries}
              activePileIdx={activePileIdx}
              onSelectPile={handleSelectPile}
            />
          )}

          {/* Center Stack Section */}
          <section
            data-testid="book-stack-container"
            style={{
              flex: isWideScreen ? '1 1 0' : 'none',
              width: isWideScreen ? 'auto' : '100%',
              maxWidth: '900px',
              minWidth: 0,
              paddingTop: '48px', // At least 48px between header divider and first book
              paddingBottom: '64px', // At least 64px below the last table strip
              paddingLeft: '32px', // At least 32px inside left
              paddingRight: '32px', // At least 32px inside right
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              position: 'relative',
              overflow: 'visible',
            }}
          >
            {/* Collapsible "About this catalogue" section (< 1280px) */}
            {!isWideScreen && category && (
              <CategoryRightRail
                category={category}
                stats={stats}
                availableCoverAssetMap={availableCoverAssetMap}
                onUpdateCategory={handleUpdateCategory}
                isCollapsibleSection={true}
                defaultExpanded={viewportWidth >= 768}
              />
            )}

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
              <div
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '24px', // 24px vertical gap between piles
                  overflow: 'visible',
                }}
              >
                {piles.map((pileBooks, pileIdx) => {
                  const pileLabel = getPileLabel(pileBooks, pileIdx, currentSort);
                  const pileGeometries = computePileGeometries(pileBooks);

                  return (
                    <div
                      key={`pile-${pileIdx}`}
                      id={`stack-pile-${pileIdx}`}
                      data-testid={`stack-pile-${pileIdx}`}
                      style={{
                        width: '100%',
                        maxWidth: '900px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        overflow: 'visible',
                        position: 'relative',
                      }}
                    >
                      {/* Pile Heading */}
                      <div
                        style={{
                          width: '100%',
                          marginBottom: '14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingLeft: '6px',
                        }}
                      >
                        <h2
                          id={`pile-heading-${pileIdx}`}
                          data-testid={`pile-heading-${pileIdx}`}
                          tabIndex={-1}
                          style={{
                            fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                            fontSize: '18px',
                            fontWeight: 700,
                            color: '#42372c',
                            margin: 0,
                            outline: 'none',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {pileLabel}
                        </h2>
                      </div>

                      <ol
                        role="list"
                        aria-label={`Books in ${category?.title || 'Catalogue'} - ${pileLabel}`}
                        data-testid={`book-stack-list-${pileIdx}`}
                        style={{
                          width: '100%',
                          maxWidth: '900px',
                          padding: 0,
                          margin: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          boxSizing: 'border-box',
                          overflow: 'visible',
                        }}
                      >
                        {pileBooks.map((entry) => (
                          <BookSpine
                            key={entry.id}
                            entry={entry}
                            geometry={pileGeometries.get(entry.id)}
                            categories={allCategories}
                            currentCategoryId={categoryId}
                            isWideScreen={isWideScreen}
                            onOpen={handleOpenEntry}
                            onRename={handleRenameEntry}
                            onMoveToCategory={handleMoveToCategory}
                            onSelectColor={handleSelectColor}
                            onOpenSpineCustomizer={() => setCustomizingEntry(entry)}
                            onTogglePin={handleTogglePin}
                            onDelete={handleDeleteEntry}
                            onHover={handleBookHover}
                            onFocusEntry={handleBookFocus}
                          />
                        ))}
                      </ol>

                      {/* Wooden Table Strip for this pile */}
                      <div
                        data-testid={`table-strip-${pileIdx}`}
                        aria-hidden="true"
                        style={{
                          width: '100%',
                          maxWidth: '900px',
                          height: '24px',
                          background: `
                            repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 3px, transparent 3px, transparent 12px),
                            linear-gradient(180deg, #d8cbbe 0%, #c4b5a3 30%, #b8a692 70%, #9e8a75 100%)
                          `,
                          borderRadius: `${RADIUS_TOKENS.xs} ${RADIUS_TOKENS.xs} ${RADIUS_TOKENS.sm} ${RADIUS_TOKENS.sm}`,
                          borderTop: '2px solid rgba(255,255,255,0.45)',
                          borderBottom: '3px solid rgba(40,30,20,0.3)',
                          boxShadow: SHADOW_TOKENS.tableStrip,
                          marginTop: '4px',
                          boxSizing: 'border-box',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          padding: '0 18px',
                        }}
                      >
                        <span
                          data-testid={`pile-month-label-${pileIdx}`}
                          style={{
                            fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
                            fontSize: '13px',
                            color: '#42372c',
                            letterSpacing: '0.02em',
                            textShadow: '0 1px 0 rgba(255,255,255,0.35)',
                          }}
                        >
                          {pileLabel}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Right Rail (>= 1280px) */}
          {isWideScreen && category && (
            <CategoryRightRail
              category={category}
              stats={stats}
              availableCoverAssetMap={availableCoverAssetMap}
              onUpdateCategory={handleUpdateCategory}
              isCollapsibleSection={false}
            />
          )}
        </div>
      </main>

      {/* Spine Customizer Modal */}
      {customizingEntry && (
        <SpineCustomizerModal
          isOpen={Boolean(customizingEntry)}
          onClose={() => setCustomizingEntry(null)}
          entry={customizingEntry}
          onSave={handleSaveSpine}
        />
      )}

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
