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

  // Table surface under the stack
  tableSurface: '#eae3d5',
  tableEdgeHighlight: '#f7f4ec',
  tableEdgeShadow: '#cfc6b6',

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

export interface SpinePaletteToken {
  id: string;
  label: string;
  bg: string;
  text: string;
  borderTop: string;
  borderBottom: string;
  accent: string;
  ribbon: string;
}

/**
 * Curated book spine palette combinations.
 * Every pair strictly exceeds WCAG 4.5:1 text contrast.
 */
export const SPINE_PALETTES: Record<string, SpinePaletteToken> = {
  terracotta: {
    id: 'terracotta',
    label: 'Terracotta',
    bg: '#8c3a1e',
    text: '#fdf9f4',
    borderTop: '#ab5435',
    borderBottom: '#632511',
    accent: '#d4886e',
    ribbon: '#d9822b',
  },
  moss: {
    id: 'moss',
    label: 'Deep Moss',
    bg: '#344c39',
    text: '#f4f8f4',
    borderTop: '#49664f',
    borderBottom: '#223326',
    accent: '#7b9880',
    ribbon: '#d9822b',
  },
  slate: {
    id: 'slate',
    label: 'Slate Navy',
    bg: '#2e414c',
    text: '#f2f7fa',
    borderTop: '#445b68',
    borderBottom: '#1c2b33',
    accent: '#7c96a5',
    ribbon: '#c25e38',
  },
  amber: {
    id: 'amber',
    label: 'Aged Amber',
    bg: '#7a4813',
    text: '#fffaf2',
    borderTop: '#995e1e',
    borderBottom: '#54300a',
    accent: '#d99a54',
    ribbon: '#506654',
  },
  indigo: {
    id: 'indigo',
    label: 'Midnight Indigo',
    bg: '#263449',
    text: '#f3f6fc',
    borderTop: '#3b4e6a',
    borderBottom: '#172130',
    accent: '#7990b3',
    ribbon: '#d9822b',
  },
  linen: {
    id: 'linen',
    label: 'Vintage Linen',
    bg: '#ede6d8',
    text: '#24201b',
    borderTop: '#fdfbf7',
    borderBottom: '#d0c6b4',
    accent: '#8c3a1e',
    ribbon: '#8c3a1e',
  },
  paper: {
    id: 'paper',
    label: 'Warm Parchment',
    bg: '#dfd7c5',
    text: '#1e1c1a',
    borderTop: '#f3eee2',
    borderBottom: '#c4b9a3',
    accent: '#344c39',
    ribbon: '#344c39',
  },
  charcoal: {
    id: 'charcoal',
    label: 'Soft Soot',
    bg: '#2c2825',
    text: '#f8f4ed',
    borderTop: '#423c38',
    borderBottom: '#191614',
    accent: '#c25e38',
    ribbon: '#c25e38',
  },
  clay: {
    id: 'clay',
    label: 'Sunbaked Clay',
    bg: '#9e563a',
    text: '#fdf8f4',
    borderTop: '#b86e50',
    borderBottom: '#783e27',
    accent: '#e2a38b',
    ribbon: '#263449',
  },
  plum: {
    id: 'plum',
    label: 'Dark Plum',
    bg: '#4e2d3f',
    text: '#fbf4f8',
    borderTop: '#684056',
    borderBottom: '#331b29',
    accent: '#9a6784',
    ribbon: '#d9822b',
  },
} as const;

export const DEFAULT_SPINE_PALETTE = SPINE_PALETTES.terracotta;

export const SHADOW_TOKENS = {
  tile: '0 2px 4px rgba(45, 35, 25, 0.04), 0 8px 20px -4px rgba(45, 35, 25, 0.08)',
  tileHover: '0 6px 12px rgba(45, 35, 25, 0.06), 0 20px 36px -8px rgba(45, 35, 25, 0.14)',
  caption: '0 1px 3px rgba(35, 28, 20, 0.08), 0 3px 8px -2px rgba(35, 28, 20, 0.06)',
  toast: '0 4px 12px rgba(40, 30, 20, 0.12), 0 16px 32px -4px rgba(40, 30, 20, 0.16)',
  bookSpine: '0 3px 8px rgba(35, 25, 15, 0.12), 0 1px 2px rgba(35, 25, 15, 0.08)',
  bookSpineHover: '0 8px 20px rgba(35, 25, 15, 0.18), 0 3px 6px rgba(35, 25, 15, 0.12)',
  stackBase: '0 12px 28px -4px rgba(35, 25, 15, 0.22), 0 4px 10px rgba(35, 25, 15, 0.12)',
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

export const STACK_CONFIG = {
  minSpineHeightPx: 44, // Minimum touch target
  maxSpineHeightPx: 96, // Maximum spine height cap
  defaultVisibleCount: 8, // Visible count before older entries fold
  mobileVisibleCount: 6, // Fewer on mobile viewports
  maxTiltDegrees: 1.5, // Deterministic tilt cap
  maxOffsetPx: 14, // Max horizontal offset jitter on laptop
  maxOffsetMobilePx: 5, // Reduced jitter on phone to prevent clipping
  slideOffsetPx: 12, // Sideways nudge on hover/focus
  stackWidthLaptopPx: 860, // Stack width on laptop
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
  backToCatalogues: '← Catalogues',
  newEntry: 'New entry',
  sortDate: 'Date',
  sortTitle: 'Title',
  sortLength: 'Length',
  olderEntries: (count: number): string => `${count} older ${count === 1 ? 'entry' : 'entries'}`,
  emptyStackTitle: 'A blank stack waiting for its first story',
  emptyStackAction: 'Write the first entry',
  deleteEntry: 'Delete entry',
  renameEntry: 'Rename',
  moveToCategory: 'Move to catalogue',
  setColour: 'Spine colour',
  pinEntry: 'Pin to top',
  unpinEntry: 'Unpin',
  openEntry: 'Open',
  entryDeletedNotice: (title: string): string => `"${title}" removed.`,
  retry: 'Retry',
  loadingStack: 'Loading stack...',
  loadError: 'Could not load catalogue stack',
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
