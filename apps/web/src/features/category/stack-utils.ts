import {
  SPINE_PALETTES,
  DEFAULT_SPINE_PALETTE,
  STACK_CONFIG,
  type SpinePaletteToken,
} from '@kaaj/design';
import { calculateSpineHeight, type EntryLightRow, type EntryStats } from '@kaaj/doc-model';

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
  variant: 'spine' | 'fore-edge';
  hasStickyFlag: boolean;
  hasRubberBand: boolean;
  flagOffsetPercent: number;
  rubberBandOffsetPercent: number;
  paperLabelTiltDeg: number;
}

/**
 * Computes deterministic physical book characteristics from entry ID, weight, and color.
 * Strictly stable across reloads, never random per render.
 */
export function getBookGeometry(
  entryId: string,
  weight: number,
  color?: string | null,
  hasCustomSpine = false
): BookGeometry {
  const hash = hashString(entryId);

  // Height clamped between min 44px and max 104px
  const heightPx = calculateSpineHeight(
    weight,
    STACK_CONFIG.minSpineHeightPx,
    STACK_CONFIG.maxSpineHeightPx
  );

  // Tilt between -2.5 deg and +2.5 deg per prompt
  const tiltDeg = ((hash % 501) - 250) / 100;

  // Horizontal jitter: desktop max 16px, mobile max 6px
  const offsetDesktopPx = ((hash >> 3) % (STACK_CONFIG.maxOffsetPx * 2 + 1)) - STACK_CONFIG.maxOffsetPx;
  const offsetMobilePx = ((hash >> 3) % (STACK_CONFIG.maxOffsetMobilePx * 2 + 1)) - STACK_CONFIG.maxOffsetMobilePx;

  // Length variation: 94% to 100% of stack width
  const widthPercent = 94 + ((hash >> 6) % 7);

  // Fore-edge variant (cream striped page block facing out): ~1 in 7 books unless custom spine or colour styled
  const variant: 'spine' | 'fore-edge' = !hasCustomSpine && !color && (hash % 7 === 0) ? 'fore-edge' : 'spine';

  // Physical props: yellow sticky flag (~1 in 5) and rubber band (~1 in 8)
  const hasStickyFlag = (hash >> 2) % 5 === 0;
  const hasRubberBand = (hash >> 4) % 8 === 0;

  const flagOffsetPercent = 18 + ((hash >> 5) % 55); // 18% to 73% along book top
  const rubberBandOffsetPercent = 22 + ((hash >> 7) % 50); // 22% to 72% across book

  // Date paper label rotation between -1.5 deg and +1.5 deg
  const paperLabelTiltDeg = (((hash >> 3) % 301) - 150) / 100;

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
    variant,
    hasStickyFlag,
    hasRubberBand,
    flagOffsetPercent,
    rubberBandOffsetPercent,
    paperLabelTiltDeg,
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

export function formatCreatedDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function formatRelativeAndAbsoluteTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    let relative = '';
    if (diffMins < 1) relative = 'just now';
    else if (diffMins < 60) relative = `${diffMins} min${diffMins === 1 ? '' : 's'} ago`;
    else if (diffHours < 24) relative = `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    else if (diffDays === 1) relative = 'yesterday';
    else if (diffDays < 30) relative = `${diffDays} days ago`;
    else {
      const diffMonths = Math.floor(diffDays / 30);
      relative = `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
    }

    const month = d.toLocaleDateString('en-US', { month: 'short' });
    const day = d.getDate();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${month} ${day}, ${hours}:${mins}, ${relative}`;
  } catch {
    return '';
  }
}

export function formatStats(stats?: EntryStats): string {
  const words = stats?.words ?? 0;
  const pages = stats?.pages ?? 1;
  const images = stats?.images ?? 0;
  return `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}, ${pages} ${pages === 1 ? 'page' : 'pages'}, ${images} ${images === 1 ? 'image' : 'images'}`;
}

export function getPileLabel(
  booksInPile: EntryLightRow[],
  pileIndex: number,
  sortMode: 'date' | 'title' | 'length'
): string {
  if (sortMode !== 'date' || booksInPile.length === 0) {
    return `Pile ${pileIndex + 1}`;
  }
  try {
    const d = new Date(booksInPile[0].updatedAt);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
  } catch {
    // fallback
  }
  return `Pile ${pileIndex + 1}`;
}
