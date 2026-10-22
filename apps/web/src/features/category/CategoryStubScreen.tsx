import React, { useEffect, useState } from 'react';
import { COLOR_TOKENS, TYPOGRAPHY_TOKENS, SPACING_TOKENS, RADIUS_TOKENS, COPY } from '@kaaj/design';

interface CategoryStubScreenProps {
  categoryId: string;
  onNavigateHome: () => void;
}

export const CategoryStubScreen: React.FC<CategoryStubScreenProps> = ({ categoryId, onNavigateHome }) => {
  const [categoryTitle, setCategoryTitle] = useState<string>('Catalogue');
  const [entryCount, setEntryCount] = useState<number>(0);

  useEffect(() => {
    fetch(`/api/categories/${categoryId}`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.category) {
          setCategoryTitle(data.category.title);
          setEntryCount(data.entries?.length || 0);
        }
      })
      .catch(console.error);
  }, [categoryId]);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: COLOR_TOKENS.canvas,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: SPACING_TOKENS.xl,
        fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
        color: COLOR_TOKENS.ink,
      }}
    >
      <div
        style={{
          maxWidth: '540px',
          width: '100%',
          backgroundColor: COLOR_TOKENS.paper,
          border: `1px solid ${COLOR_TOKENS.paperBorder}`,
          borderRadius: RADIUS_TOKENS.md,
          boxShadow: '0 4px 16px rgba(45, 35, 25, 0.06)',
          padding: SPACING_TOKENS.xxl,
          textAlign: 'center',
          position: 'relative',
        }}
      >
        <button
          onClick={onNavigateHome}
          data-testid="back-to-catalogues"
          style={{
            position: 'absolute',
            top: SPACING_TOKENS.md,
            left: SPACING_TOKENS.md,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
            color: COLOR_TOKENS.terracotta,
            fontWeight: 500,
            padding: `${SPACING_TOKENS.xs} ${SPACING_TOKENS.sm}`,
            borderRadius: RADIUS_TOKENS.sm,
          }}
        >
          {COPY.backToCatalogues}
        </button>

        <h1
          data-testid="category-title"
          style={{
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
            fontSize: '36px',
            color: COLOR_TOKENS.ink,
            margin: `${SPACING_TOKENS.lg} 0 ${SPACING_TOKENS.xs} 0`,
          }}
        >
          {categoryTitle}
        </h1>

        <p
          style={{
            fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
            color: COLOR_TOKENS.inkMuted,
            margin: `0 0 ${SPACING_TOKENS.xl} 0`,
          }}
        >
          {COPY.entryCount(entryCount)}
        </p>

        <div
          style={{
            padding: SPACING_TOKENS.lg,
            backgroundColor: COLOR_TOKENS.paperSubtle,
            borderRadius: RADIUS_TOKENS.sm,
            border: `1px dashed ${COLOR_TOKENS.border}`,
            margin: `${SPACING_TOKENS.lg} 0`,
          }}
        >
          <p
            data-testid="category-stub-message"
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
              fontStyle: 'italic',
              fontSize: TYPOGRAPHY_TOKENS.fontSize.lg,
              color: COLOR_TOKENS.terracotta,
              margin: 0,
            }}
          >
            {COPY.comingSoonCategory}
          </p>
        </div>
      </div>
    </div>
  );
};
