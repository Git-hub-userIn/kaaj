import React from 'react';
import type { CategoryLightRow } from '@kaaj/doc-model';
import { SEED_COVERS_MANIFEST } from '@kaaj/design';
import { CategoryTile } from './CategoryTile.js';
import { AddCategoryTile } from './AddCategoryTile.js';

interface CategoryCollageProps {
  categories: CategoryLightRow[];
  onNavigate: (id: string) => void;
  onDelete: (category: CategoryLightRow) => void;
  onRename: (category: CategoryLightRow, nextTitle: string) => void;
  onAdd: (title: string, coverAssetId?: string) => Promise<void>;
}

export function getCategorySpans(cat: CategoryLightRow, index: number) {
  const seedItem = SEED_COVERS_MANIFEST.find(
    (m) => m.categoryTitle.toLowerCase() === cat.title.toLowerCase() || cat.id.includes(m.key)
  );

  if (seedItem) {
    return seedItem.suggestedSpan;
  }

  // Fallback balanced varied spans
  if (index === 0) {
    return {
      laptop: { colSpan: 7, rowSpan: 2 },
      tablet: { colSpan: 8, rowSpan: 1 },
      phone: { colSpan: 1, rowSpan: 1 },
    };
  }
  if (index === 1 || index === 2) {
    return {
      laptop: { colSpan: 5, rowSpan: 1 },
      tablet: { colSpan: 4, rowSpan: 1 },
      phone: { colSpan: 1, rowSpan: 1 },
    };
  }
  if (index === 3 || index === 4 || index === 5) {
    return {
      laptop: { colSpan: 4, rowSpan: 1 },
      tablet: { colSpan: 4, rowSpan: 1 },
      phone: { colSpan: 1, rowSpan: 1 },
    };
  }
  return {
    laptop: { colSpan: 6, rowSpan: 1 },
    tablet: { colSpan: 4, rowSpan: 1 },
    phone: { colSpan: 1, rowSpan: 1 },
  };
}

export const CategoryCollage: React.FC<CategoryCollageProps> = ({
  categories,
  onNavigate,
  onDelete,
  onRename,
  onAdd,
}) => {
  // Build a map of manifest key -> coverAssetId for the Add Catalogue modal
  const coverAssetMap: Record<string, string> = {};
  for (const cat of categories) {
    if (cat.coverAssetId) {
      for (const manifestItem of SEED_COVERS_MANIFEST) {
        if (cat.id.includes(manifestItem.key) || cat.title.toLowerCase() === manifestItem.categoryTitle.toLowerCase()) {
          coverAssetMap[manifestItem.key] = cat.coverAssetId;
        }
      }
    }
  }

  // Generate scoped CSS for each individual category tile span
  const tileCssRules = categories
    .map((cat, idx) => {
      const span = getCategorySpans(cat, idx);
      const safeId = cat.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      return `
        @media (min-width: 1024px) {
          .tile-span-${safeId} {
            grid-column: span ${span.laptop.colSpan} !important;
            grid-row: span ${span.laptop.rowSpan} !important;
          }
        }
        @media (min-width: 768px) and (max-width: 1023px) {
          .tile-span-${safeId} {
            grid-column: span ${span.tablet.colSpan} !important;
            grid-row: span ${span.tablet.rowSpan} !important;
          }
        }
        @media (max-width: 767px) {
          .tile-span-${safeId} {
            grid-column: span 1 !important;
            grid-row: span 1 !important;
          }
        }
      `;
    })
    .join('\n');

  return (
    <nav aria-label="Catalogues Collection">
      <style>{`
        .category-collage-grid {
          display: grid;
          width: 100%;
          box-sizing: border-box;
          list-style: none;
          margin: 0;
          padding: 0;
          grid-template-columns: repeat(12, 1fr);
          grid-auto-rows: 240px;
          gap: 28px;
          grid-auto-flow: dense;
        }

        @media (min-width: 768px) and (max-width: 1023px) {
          .category-collage-grid {
            grid-template-columns: repeat(8, 1fr);
            grid-auto-rows: 220px;
            gap: 20px;
          }
        }

        @media (max-width: 767px) {
          .category-collage-grid {
            grid-template-columns: 1fr;
            grid-auto-rows: 240px;
            gap: 20px;
          }
        }

        ${tileCssRules}

        @media (min-width: 1024px) {
          .add-catalogue-tile {
            grid-column: span 6 !important;
            grid-row: span 1 !important;
          }
        }
        @media (min-width: 768px) and (max-width: 1023px) {
          .add-catalogue-tile {
            grid-column: span 8 !important;
            grid-row: span 1 !important;
          }
        }
        @media (max-width: 767px) {
          .add-catalogue-tile {
            grid-column: span 1 !important;
            grid-row: span 1 !important;
          }
        }

        /* Staggered entrance animation (400ms max total) */
        @keyframes collageTileEntrance {
          from {
            opacity: 0;
            transform: translate3d(0, 12px, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        .category-tile-container, .add-catalogue-tile {
          animation: collageTileEntrance 300ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .category-tile-container:nth-child(1) { animation-delay: 20ms; }
        .category-tile-container:nth-child(2) { animation-delay: 55ms; }
        .category-tile-container:nth-child(3) { animation-delay: 90ms; }
        .category-tile-container:nth-child(4) { animation-delay: 125ms; }
        .category-tile-container:nth-child(5) { animation-delay: 160ms; }
        .category-tile-container:nth-child(6) { animation-delay: 195ms; }
        .category-tile-container:nth-child(7) { animation-delay: 230ms; }
        .category-tile-container:nth-child(8) { animation-delay: 265ms; }
        .add-catalogue-tile { animation-delay: 300ms; }

        @media (prefers-reduced-motion: reduce) {
          .category-tile-container, .add-catalogue-tile {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <ul
        role="list"
        data-testid="category-collage-grid"
        className="category-collage-grid"
      >
        {categories.map((cat, idx) => {
          const span = getCategorySpans(cat, idx);
          const isHero = idx === 0;

          return (
            <CategoryTile
              key={cat.id}
              category={cat}
              isHero={isHero}
              gridSpan={span}
              onNavigate={onNavigate}
              onDelete={onDelete}
              onRename={onRename}
            />
          );
        })}

        {/* Final Add Catalogue Tile */}
        <AddCategoryTile onAdd={onAdd} availableCoverAssetMap={coverAssetMap} />
      </ul>
    </nav>
  );
};
