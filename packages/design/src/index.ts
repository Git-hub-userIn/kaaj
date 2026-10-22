/**
 * Static Design Tokens and Constants for Kaaj.
 * Contains no React components and no business logic.
 */

export const COLOR_TOKENS = {
  // Surfaces and background tokens
  canvas: '#f6f4ee',
  paper: '#fcfbf7',
  paperSubtle: '#f2efe9',
  paperDark: '#e8e3d8',

  // Ink and contrast tokens
  ink: '#1e1c1a',
  inkMuted: '#68645e',
  inkLight: '#9e9990',
  border: '#dcd7cb',

  // Palette accent tokens (strictly palette-token colours)
  terracotta: '#c25e38',
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

export const TYPOGRAPHY_TOKENS = {
  fontFamilySans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontFamilySerif: '"Newsreader", "Georgia", "Times New Roman", serif',
  fontFamilyMono: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace',
  fontSize: {
    xs: '12px',
    sm: '14px',
    base: '16px',
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
} as const;

export const RADIUS_TOKENS = {
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
