export interface SeedCoverMetadata {
  key: string;
  categoryTitle: string;
  fileName: string;
  accentColor: string;
  suggestedSpan: {
    laptop: { colSpan: number; rowSpan: number };
    tablet: { colSpan: number; rowSpan: number };
    phone: { colSpan: number; rowSpan: number };
  };
}

export const SEED_COVERS_MANIFEST: SeedCoverMetadata[] = [
  {
    key: 'travel',
    categoryTitle: 'Travel',
    fileName: 'travel.svg',
    accentColor: '#c25e38',
    suggestedSpan: {
      laptop: { colSpan: 7, rowSpan: 2 }, // Hero tile
      tablet: { colSpan: 5, rowSpan: 2 },
      phone: { colSpan: 2, rowSpan: 2 },
    },
  },
  {
    key: 'food-recipes',
    categoryTitle: 'Food & Recipes',
    fileName: 'food-recipes.svg',
    accentColor: '#d9822b',
    suggestedSpan: {
      laptop: { colSpan: 5, rowSpan: 1 },
      tablet: { colSpan: 3, rowSpan: 1 },
      phone: { colSpan: 2, rowSpan: 1 },
    },
  },
  {
    key: 'sketches',
    categoryTitle: 'Sketches',
    fileName: 'sketches.svg',
    accentColor: '#2b2825',
    suggestedSpan: {
      laptop: { colSpan: 5, rowSpan: 1 },
      tablet: { colSpan: 3, rowSpan: 1 },
      phone: { colSpan: 1, rowSpan: 1 },
    },
  },
  {
    key: 'plants',
    categoryTitle: 'Plants',
    fileName: 'plants.svg',
    accentColor: '#506654',
    suggestedSpan: {
      laptop: { colSpan: 4, rowSpan: 1 },
      tablet: { colSpan: 4, rowSpan: 1 },
      phone: { colSpan: 1, rowSpan: 1 },
    },
  },
  {
    key: 'music',
    categoryTitle: 'Music',
    fileName: 'music.svg',
    accentColor: '#3b4d61',
    suggestedSpan: {
      laptop: { colSpan: 4, rowSpan: 1 },
      tablet: { colSpan: 4, rowSpan: 1 },
      phone: { colSpan: 1, rowSpan: 1 },
    },
  },
  {
    key: 'ideas',
    categoryTitle: 'Ideas',
    fileName: 'ideas.svg',
    accentColor: '#dca142',
    suggestedSpan: {
      laptop: { colSpan: 4, rowSpan: 1 },
      tablet: { colSpan: 4, rowSpan: 1 },
      phone: { colSpan: 1, rowSpan: 1 },
    },
  },
  {
    key: 'memories',
    categoryTitle: 'Memories',
    fileName: 'memories.svg',
    accentColor: '#b37367',
    suggestedSpan: {
      laptop: { colSpan: 6, rowSpan: 1 },
      tablet: { colSpan: 4, rowSpan: 1 },
      phone: { colSpan: 1, rowSpan: 1 },
    },
  },
];
