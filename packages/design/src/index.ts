/**
 * Static Design Tokens and Constants for Kaaj.
 * Contains no React components and no business logic.
 */

export const COLOR_TOKENS = {
  // Surfaces and background tokens
  canvas: '#f6f4ee',
  canvasMuted: '#ece8de',
  paper: '#fcfbf7',
  paperWarm: '#faf7f0',
  paperSubtle: '#f2efe9',
  paperDark: '#e8e3d8',
  paperBorder: '#e5dfd3',

  // Ink and contrast tokens
  ink: '#1e1c1a',
  inkMuted: '#68645e',
  inkLight: '#9e9990',
  border: '#dcd7cb',
  borderSubtle: '#eae5dc',

  // Physical scrapbook details
  washiTape: 'rgba(238, 233, 222, 0.88)',
  washiTapeBorder: 'rgba(215, 205, 190, 0.45)',
  washiTapeShadow: 'rgba(50, 40, 30, 0.08)',
  shadowAmbient: 'rgba(45, 35, 25, 0.06)',
  shadowDirect: 'rgba(45, 35, 25, 0.12)',

  // Palette accent tokens (strictly palette-token colours)
  terracotta: '#c25e38',
  terracottaDark: '#a34827',
  terracottaLight: '#f4e4dc',
  moss: '#506654',
  mossLight: '#e4eae4',
  slate: '#475b63',
  slateLight: '#e3e8ea',
  amber: '#d9822b',
  amberLight: '#fbf0e1',
  indigo: '#3b4d61',
  indigoLight: '#e2e7ec',
} as const;

export const SHADOW_TOKENS = {
  tile: '0 2px 4px rgba(45, 35, 25, 0.04), 0 8px 20px -4px rgba(45, 35, 25, 0.08)',
  tileHover: '0 6px 12px rgba(45, 35, 25, 0.06), 0 20px 36px -8px rgba(45, 35, 25, 0.14)',
  caption: '0 1px 3px rgba(35, 28, 20, 0.08), 0 3px 8px -2px rgba(35, 28, 20, 0.06)',
  toast: '0 4px 12px rgba(40, 30, 20, 0.12), 0 16px 32px -4px rgba(40, 30, 20, 0.16)',
} as const;

export const TYPOGRAPHY_TOKENS = {
  fontFamilySans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontFamilySerif: '"Newsreader", Georgia, Cambria, "Times New Roman", serif',
  fontFamilyHandwriting: '"Kalam", "Caveat", cursive, sans-serif',
  fontFamilyMono: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace',
  fontSize: {
    xs: '12px',
    sm: '13px',
    base: '15px',
    lg: '18px',
    xl: '22px',
    heading3: '24px',
    heading2: '30px',
    heading1: '38px',
  },
} as const;

export const SPACING_TOKENS = {
  px1: '1px',
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
  xxxl: '64px',
} as const;

export const RADIUS_TOKENS = {
  none: '0px',
  xs: '2px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  full: '9999px',
} as const;

export const CANVAS_TOKENS = {
  logicalWidth: 1200,
  logicalHeight: 1600,
  aspectRatio: '3 / 4',
  maxLayers: 8,
  maxObjectsPerLayer: 200,
} as const;

/**
 * Single source of truth for user-facing copy strings.
 * Spec rule: Code uses 'category', UI displays 'Catalogues'.
 */
export const COPY = {
  cataloguesTitle: 'Catalogues',
  cataloguesSubtitle: 'Personal visual scrapbooks and journal collections',
  addCatalogue: 'Add catalogue',
  newCataloguePlaceholder: 'Catalogue title...',
  deleteCatalogue: 'Delete catalogue',
  renameCatalogue: 'Rename catalogue',
  emptyEntryCount: '0 entries',
  singleEntryCount: '1 entry',
  entryCount: (count: number): string => (count === 1 ? '1 entry' : `${count} entries`),
  undoDelete: 'Undo',
  deletedNotice: (title: string): string => `"${title}" removed.`,
  comingSoonCategory: 'Book stack coming next',
  backToCatalogues: '← Back to Catalogues',
} as const;

/**
 * Current User Profile Constant.
 * In v1, this is a fixed avatar definition replaceable by auth seams in future phases.
 */
export const CURRENT_USER = {
  name: 'J. C.',
  initials: 'JC',
} as const;

export { SEED_COVERS_MANIFEST, type SeedCoverMetadata } from './seed-covers/manifest.js';

