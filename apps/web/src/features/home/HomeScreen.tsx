import React, { useEffect, useState, useCallback } from 'react';
import type { CategoryLightRow } from '@kaaj/doc-model';
import { COLOR_TOKENS, SPACING_TOKENS, COPY } from '@kaaj/design';
import { HomeHeader } from './HomeHeader.js';
import { CategoryCollage } from './CategoryCollage.js';
import { UndoToast } from './UndoToast.js';

interface HomeScreenProps {
  onNavigateToCategory: (id: string) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onNavigateToCategory }) => {
  const [categories, setCategories] = useState<CategoryLightRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [recentlyDeleted, setRecentlyDeleted] = useState<CategoryLightRow | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories', {
        headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      });
      if (!res.ok) {
        throw new Error(`Failed to load categories: ${res.statusText}`);
      }
      const data = await res.json();
      setCategories(data);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to load catalogues');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleAddCategory = async (title: string, coverAssetId?: string) => {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer kaaj-local-dev-token',
      },
      body: JSON.stringify({ title, coverAssetId }),
    });

    if (res.ok) {
      const newCat = await res.json();
      setCategories((prev) => [...prev, newCat]);
    }
  };

  const handleDeleteCategory = async (category: CategoryLightRow) => {
    // Optimistic delete
    setCategories((prev) => prev.filter((c) => c.id !== category.id));
    setRecentlyDeleted(category);

    try {
      await fetch(`/api/categories/${category.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      });
    } catch (err) {
      console.error(err);
      // Revert if request fails
      setCategories((prev) => [...prev, category]);
      setRecentlyDeleted(null);
    }
  };

  const handleUndoDelete = async () => {
    if (!recentlyDeleted) return;
    const catToRestore = recentlyDeleted;
    setRecentlyDeleted(null);

    // Optimistic restore
    setCategories((prev) => [...prev, catToRestore].sort((a, b) => a.sortOrder - b.sortOrder));

    try {
      await fetch(`/api/categories/${catToRestore.id}/restore`, {
        method: 'POST',
        headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRenameCategory = async (category: CategoryLightRow, nextTitle: string) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === category.id ? { ...c, title: nextTitle } : c))
    );

    try {
      await fetch(`/api/categories/${category.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer kaaj-local-dev-token',
        },
        body: JSON.stringify({ title: nextTitle }),
      });
    } catch (err) {
      console.error(err);
      fetchCategories();
    }
  };

  return (
    <div
      data-testid="home-screen"
      style={{
        minHeight: '100vh',
        backgroundColor: COLOR_TOKENS.canvas,
        /* Subtle tactile paper desk grain texture */
        backgroundImage: `
          radial-gradient(circle at 50% 20%, rgba(255, 254, 250, 0.8) 0%, rgba(246, 244, 238, 0.4) 100%),
          radial-gradient(${COLOR_TOKENS.paperBorder} 0.65px, transparent 0.65px)
        `,
        backgroundSize: '100% 100%, 24px 24px',
        color: COLOR_TOKENS.ink,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflowX: 'hidden',
      }}
    >
      {/* Header with Kaaj wordmark at left, "JC" avatar at right */}
      <HomeHeader />

      {/* Main Body: Image-led category collage */}
      <main
        style={{
          flex: 1,
          maxWidth: '1440px',
          width: '100%',
          margin: '0 auto',
          padding: `0 ${SPACING_TOKENS.xl} ${SPACING_TOKENS.xxxl} ${SPACING_TOKENS.xl}`,
          boxSizing: 'border-box',
        }}
      >
        {isLoading ? (
          <div
            data-testid="home-loading"
            style={{
              padding: SPACING_TOKENS.xxxl,
              textAlign: 'center',
              color: COLOR_TOKENS.inkMuted,
            }}
          >
            Opening scrapbook...
          </div>
        ) : error ? (
          <div
            style={{
              padding: SPACING_TOKENS.xxl,
              textAlign: 'center',
              color: COLOR_TOKENS.terracotta,
            }}
          >
            {error}
          </div>
        ) : (
          <CategoryCollage
            categories={categories}
            onNavigate={onNavigateToCategory}
            onDelete={handleDeleteCategory}
            onRename={handleRenameCategory}
            onAdd={handleAddCategory}
          />
        )}
      </main>

      {/* Undo Toast Notification */}
      {recentlyDeleted && (
        <UndoToast
          message={COPY.deletedNotice(recentlyDeleted.title)}
          onUndo={handleUndoDelete}
          onDismiss={() => setRecentlyDeleted(null)}
        />
      )}
    </div>
  );
};
