import {
  SPINE_PALETTES,
  DEFAULT_SPINE_PALETTE,
  STACK_CONFIG,
  type SpinePaletteToken,
} from '@kaaj/design';
import { calculateSpineHeight } from '@kaaj/doc-model';

export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const PALETTE_KEYS = Object.keys(SPINE_PALETTES);

export interface BookGeometry {
  heightPx: number;
  tiltDeg: number;
  offsetDesktopPx: number;
  offsetMobilePx: number;
  widthPercent: number;
  palette: SpinePaletteToken;
  decorationType: number; // 0: double debossed, 1: stitched ribbon, 2: gold foil bands, 3: minimal
}

/**
 * Computes deterministic physical book characteristics from entry ID and weight.
 * Strictly stable across reloads, never random per render.
 */
export function getBookGeometry(
  entryId: string,
  weight: number,
  color?: string | null
): BookGeometry {
  const hash = hashString(entryId);

  // Height clamped between min 44px and max 96px
  const heightPx = calculateSpineHeight(
    weight,
    STACK_CONFIG.minSpineHeightPx,
    STACK_CONFIG.maxSpineHeightPx
  );

  // Tilt between -1.5 deg and +1.5 deg
  const tiltDeg = ((hash % 301) - 150) / 100;

  // Horizontal jitter: desktop max 14px, mobile max 5px
  const offsetDesktopPx = ((hash >> 3) % (STACK_CONFIG.maxOffsetPx * 2 + 1)) - STACK_CONFIG.maxOffsetPx;
  const offsetMobilePx = ((hash >> 3) % (STACK_CONFIG.maxOffsetMobilePx * 2 + 1)) - STACK_CONFIG.maxOffsetMobilePx;

  // Length variation: 95% to 100% of stack width
  const widthPercent = 95 + ((hash >> 6) % 6);

  // Decoration type: 0 to 3
  const decorationType = hash % 4;

  // Spine palette
  let palette: SpinePaletteToken = DEFAULT_SPINE_PALETTE;
  if (color && SPINE_PALETTES[color]) {
    palette = SPINE_PALETTES[color];
  } else {
    const key = PALETTE_KEYS[hash % PALETTE_KEYS.length];
    palette = SPINE_PALETTES[key] || DEFAULT_SPINE_PALETTE;
  }

  return {
    heightPx,
    tiltDeg,
    offsetDesktopPx,
    offsetMobilePx,
    widthPercent,
    palette,
    decorationType,
  };
}

export function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return '';
  }
}
