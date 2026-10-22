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

  // Table surface under the stack (wood texture & strip)
  tableSurface: '#eae3d5',
  tableEdgeHighlight: '#f7f4ec',
  tableEdgeShadow: '#cfc6b6',
  tableWoodTop: '#d8cbbe',
  tableWoodMid: '#c4b5a3',
  tableWoodDeep: '#9e8a75',

  // Physical props tokens
  ribbonBookmark: '#c23b22',
  stickyFlag: '#f6d860',
  stickyFlagBorder: '#e8c743',
  rubberBand: '#c99a60',
  rubberBandShadow: 'rgba(60, 40, 20, 0.25)',

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
  isDark: boolean;
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
    isDark: true,
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
    isDark: true,
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
    isDark: true,
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
    isDark: true,
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
    isDark: true,
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
    isDark: false,
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
    isDark: false,
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
    isDark: true,
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
    isDark: true,
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
    isDark: true,
  },
} as const;

export const DEFAULT_SPINE_PALETTE = SPINE_PALETTES.terracotta;

export const SPINE_TEXTURES = {
  cloth: {
    id: 'cloth',
    label: 'Bookcloth',
    cssPattern: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.04) 0px, rgba(0,0,0,0.04) 1px, transparent 1px, transparent 3px)',
  },
  leather: {
    id: 'leather',
    label: 'Fine Leather',
    cssPattern: 'radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.06) 0%, transparent 60%), radial-gradient(circle at 10% 80%, rgba(0,0,0,0.12) 0%, transparent 40%), repeating-linear-gradient(90deg, rgba(0,0,0,0.02) 0px, rgba(0,0,0,0.02) 2px, transparent 2px, transparent 4px)',
  },
  linen: {
    id: 'linen',
    label: 'Raw Linen',
    cssPattern: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.05) 0px, rgba(0,0,0,0.05) 1px, transparent 1px, transparent 2px), repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 2px)',
  },
  marbled: {
    id: 'marbled',
    label: 'Marbled Paper',
    cssPattern: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.07) 25%, rgba(255,255,255,0.05) 50%, rgba(0,0,0,0.08) 75%, rgba(255,255,255,0.07) 100%)',
  },
  kraft: {
    id: 'kraft',
    label: 'Kraft Paper',
    cssPattern: 'repeating-linear-gradient(60deg, rgba(0,0,0,0.03) 0px, rgba(0,0,0,0.03) 1px, transparent 1px, transparent 4px), repeating-linear-gradient(120deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 4px)',
  },
  worn: {
    id: 'worn',
    label: 'Worn Antiquarian',
    cssPattern: 'linear-gradient(to right, rgba(0,0,0,0.2) 0%, transparent 8%, transparent 92%, rgba(0,0,0,0.22) 100%), radial-gradient(ellipse at 50% 50%, transparent 50%, rgba(0,0,0,0.15) 100%)',
  },
} as const;

export const SPINE_FONTS = {
  'newsreader': {
    id: 'newsreader',
    label: 'Newsreader (Classic Serif)',
    fontFamily: '"Newsreader", Georgia, Cambria, serif',
  },
  'kalam': {
    id: 'kalam',
    label: 'Kalam (Handwritten)',
    fontFamily: '"Kalam", cursive, sans-serif',
  },
  'special-elite': {
    id: 'special-elite',
    label: 'Special Elite (Typewriter)',
    fontFamily: '"Special Elite", "Courier New", monospace, serif',
  },
  'oswald': {
    id: 'oswald',
    label: 'Oswald (Condensed)',
    fontFamily: '"Oswald", Impact, sans-serif',
  },
  'playfair-display': {
    id: 'playfair-display',
    label: 'Playfair Display (Editorial)',
    fontFamily: '"Playfair Display", Georgia, serif',
  },
} as const;

export const SPINE_FINISHES = {
  'gold-foil': {
    id: 'gold-foil',
    label: 'Gold Foil',
    textColor: '#f5d77f',
    textShadow: '0 1px 0 rgba(255, 245, 190, 0.65), 0 -1px 0 rgba(110, 75, 15, 0.8), 0 0 4px rgba(245, 215, 127, 0.4)',
    requiresDarkBackground: true,
  },
  'silver-foil': {
    id: 'silver-foil',
    label: 'Silver Foil',
    textColor: '#e8edf2',
    textShadow: '0 1px 0 rgba(255, 255, 255, 0.8), 0 -1px 0 rgba(50, 60, 70, 0.85), 0 0 3px rgba(220, 230, 240, 0.35)',
    requiresDarkBackground: true,
  },
  'white-ink': {
    id: 'white-ink',
    label: 'White Ink',
    textColor: '#fdfbf7',
    textShadow: '0 1px 2px rgba(20, 15, 10, 0.5), 0 -1px 0 rgba(255, 255, 255, 0.2)',
    requiresDarkBackground: true,
  },
  'black-ink': {
    id: 'black-ink',
    label: 'Black Ink',
    textColor: '#1a1816',
    textShadow: '0 1px 0 rgba(255, 255, 255, 0.35), 0 -1px 0 rgba(0, 0, 0, 0.2)',
    requiresDarkBackground: false,
  },
} as const;

export const SPINE_BANDS = {
  none: { id: 'none', label: 'None' },
  two: { id: 'two', label: 'Two Gilt Bands' },
  three: { id: 'three', label: 'Three Gilt Bands' },
} as const;

/**
 * Calculates luminance for contrast checking (WCAG 2.1 algorithm).
 */
export function getRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const toLinear = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Calculates contrast ratio between two hex colours.
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1);
  const lum2 = getRelativeLuminance(hex2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

/**
 * Checks if a finish passes WCAG 4.5:1 contrast against a given background hex.
 */
export function isFinishCompatible(finishId: keyof typeof SPINE_FINISHES, bgHex: string): boolean {
  const finish = SPINE_FINISHES[finishId];
  if (!finish) return false;
  const ratio = getContrastRatio(finish.textColor, bgHex);
  return ratio >= 4.5;
}

export const SHADOW_TOKENS = {
  tile: '0 2px 4px rgba(45, 35, 25, 0.04), 0 8px 20px -4px rgba(45, 35, 25, 0.08)',
  tileHover: '0 6px 12px rgba(45, 35, 25, 0.06), 0 20px 36px -8px rgba(45, 35, 25, 0.14)',
  caption: '0 1px 3px rgba(35, 28, 20, 0.08), 0 3px 8px -2px rgba(35, 28, 20, 0.06)',
  toast: '0 4px 12px rgba(40, 30, 20, 0.12), 0 16px 32px -4px rgba(40, 30, 20, 0.16)',
  bookSpine: '0 3px 8px rgba(35, 25, 15, 0.12), 0 1px 2px rgba(35, 25, 15, 0.08)',
  bookSpineHover: '0 8px 20px rgba(35, 25, 15, 0.18), 0 3px 6px rgba(35, 25, 15, 0.12)',
  stackBase: '0 12px 28px -4px rgba(35, 25, 15, 0.22), 0 4px 10px rgba(35, 25, 15, 0.12)',
  tableStrip: '0 14px 26px -4px rgba(35, 25, 15, 0.22), 0 4px 8px rgba(35, 25, 15, 0.14)',
  detailsCard: '0 8px 24px -2px rgba(35, 25, 15, 0.16), 0 2px 6px rgba(35, 25, 15, 0.08)',
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
  maxSpineHeightPx: 104, // Maximum spine height cap
  defaultPileSize: 10, // Entries per pile resting on a wooden table strip
  maxLightRowsCap: 500, // Light rows cap per category
  maxTiltDegrees: 2.5, // Deterministic tilt cap per spec
  maxOffsetPx: 16, // Max horizontal offset jitter on laptop
  maxOffsetMobilePx: 6, // Reduced jitter on phone to prevent clipping
  slideOffsetPx: 12, // Sideways nudge on hover/focus
  stackWidthLaptopPx: 900, // Stack width on laptop
  detailsCardDelayMs: 250, // Hover delay for details card
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
  emptyStackTitle: 'A blank stack waiting for its first story',
  emptyStackAction: 'Write the first entry',
  deleteEntry: 'Delete entry',
  renameEntry: 'Rename',
  moveToCategory: 'Move to catalogue',
  setColour: 'Spine colour',
  customiseSpine: 'Customise spine',
  spineCustomizerTitle: 'Customise Spine',
  previewSpine: 'Spine Preview',
  textureLabel: 'Cover Texture',
  colorLabel: 'Spine Colour',
  finishLabel: 'Title Foil / Ink',
  fontLabel: 'Title Typography',
  bandsLabel: 'Spine Bands',
  saveChanges: 'Save Changes',
  cancel: 'Cancel',
  pinEntry: 'Pin to top',
  unpinEntry: 'Unpin',
  openEntry: 'Open',
  entryDeletedNotice: (title: string): string => `"${title}" removed.`,
  showingNewestCapped: (cap: number): string => `Showing newest ${cap} entries`,
  pileLabel: (index: number): string => `Pile ${index}`,
  lastEdited: 'Last edited',
  created: 'Created',
  wordsPagesImages: (words: number, pages: number, images: number): string =>
    `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}, ${pages} ${pages === 1 ? 'page' : 'pages'}, ${images} ${images === 1 ? 'image' : 'images'}`,
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
