import {
  SPINE_PALETTES,
  DEFAULT_SPINE_PALETTE,
  STACK_CONFIG,
  SPINE_FONTS,
  SPINE_FINISHES,
  type SpinePaletteToken,
} from '@kaaj/design';
import {
  calculateSpineHeight,
  type EntryLightRow,
  type EntryStats,
  type SpineFont,
  type SpineFinish,
} from '@kaaj/doc-model';

export function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Avalanche mixer (fmix32) to ensure single-character differences spread evenly
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return Math.abs(hash | 0);
}

const PALETTE_KEYS = Object.keys(SPINE_PALETTES);
const FONT_PRESETS: SpineFont[] = [
  'newsreader',
  'special-elite',
  'kalam',
  'oswald',
  'playfair-display',
];

export interface BookGeometry {
  heightPx: number;
  lengthPx: number;
  offsetDesktopPx: number;
  tiltDeg: number;
  fontKey: SpineFont;
  fontSizePx: number;
  letterSpacing: string;
  textTransform?: string;
  textColor: string;
  textShadow: string;
  edgeBorder?: string;
  edgeShadow?: string;
  palette: SpinePaletteToken;
  variant: 'spine' | 'fore-edge';
  hasStickyFlag: boolean;
  hasRubberBand: boolean;
  flagOffsetPx: number;
  rubberBandOffsetPx: number;
  paperLabelTiltDeg: number;
  isBottomBook: boolean;
}

/**
 * Computes deterministic physical characteristics for every book in a pile.
 * Enforces all layout constraints:
 * - Bottom book of pile is exactly 0.0 rotation, resting flat.
 * - Every other book rotation <= 1.2 deg and |tilt_rad * length / 2| <= 6 px drift.
 * - Neighboring books may not both lean the same way past 0.8 deg.
 * - Length 520 to 780 px on laptop. Adjacent lengths differ by >= 40 px.
 * - At least 4 distinct lengths in any 7 books; no book > 780 px.
 * - Neighboring books must not share a title font; at least 3 distinct fonts in 7 books.
 * - Font size scales with thickness: 18 px to 30 px.
 * - Title ink vs spine background >= 4.5:1; light covers edge vs page >= 3:1.
 */
export function computePileGeometries(pileBooks: EntryLightRow[]): Map<string, BookGeometry> {
  const result = new Map<string, BookGeometry>();
  const count = pileBooks.length;
  if (count === 0) return result;

  // 1. Calculate lengths (520 to 780 px, adjacent differ by >= 40 px)
  const lengths: number[] = [];
  for (let i = 0; i < count; i++) {
    const entry = pileBooks[i];
    const hash = hashString(entry.id);

    // Raw length between 520 and 780 px
    let len = 520 + ((hash >> 4) % (STACK_CONFIG.maxBookLengthLaptopPx - STACK_CONFIG.minBookLengthLaptopPx + 1));

    if (i > 0) {
      const prevLen = lengths[i - 1];
      if (Math.abs(len - prevLen) < STACK_CONFIG.minAdjacentLengthDiffPx) {
        if (len >= prevLen) {
          if (prevLen + STACK_CONFIG.minAdjacentLengthDiffPx <= STACK_CONFIG.maxBookLengthLaptopPx) {
            len = prevLen + STACK_CONFIG.minAdjacentLengthDiffPx;
          } else {
            len = prevLen - STACK_CONFIG.minAdjacentLengthDiffPx;
          }
        } else {
          if (prevLen - STACK_CONFIG.minAdjacentLengthDiffPx >= STACK_CONFIG.minBookLengthLaptopPx) {
            len = prevLen - STACK_CONFIG.minAdjacentLengthDiffPx;
          } else {
            len = prevLen + STACK_CONFIG.minAdjacentLengthDiffPx;
          }
        }
      }
    }

    // Ensure at least 4 distinct lengths in any window of 7 books
    if (i >= 3) {
      const windowStart = Math.max(0, i - 6);
      const window = lengths.slice(windowStart, i);
      const distinct = new Set([...window, len]);
      const needed = Math.min(4, i + 1);
      if (distinct.size < needed) {
        const candidates = [520, 570, 620, 670, 720, 770];
        for (const cand of candidates) {
          if (!distinct.has(cand) && Math.abs(cand - lengths[i - 1]) >= STACK_CONFIG.minAdjacentLengthDiffPx) {
            len = cand;
            break;
          }
        }
      }
    }

    // Strict clamp
    len = Math.min(STACK_CONFIG.maxBookLengthLaptopPx, Math.max(STACK_CONFIG.minBookLengthLaptopPx, Math.round(len)));
    lengths.push(len);
  }

  // 2. Calculate horizontal offsets (0 to 120 px, keeping book within 900 px container)
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const entry = pileBooks[i];
    const hash = hashString(entry.id);
    const len = lengths[i];
    const maxAllowedOffset = Math.min(STACK_CONFIG.maxOffsetLaptopPx, Math.max(0, STACK_CONFIG.stackWidthLaptopPx - len));
    const off = maxAllowedOffset > 0 ? (hash >> 2) % (maxAllowedOffset + 1) : 0;
    offsets.push(off);
  }

  // 3. Calculate tilts from bottom book up
  // Bottom book is index count - 1 (rests flat on table strip, rotation = 0)
  const tilts: number[] = new Array(count).fill(0);
  tilts[count - 1] = 0.0;

  for (let i = count - 2; i >= 0; i--) {
    const entry = pileBooks[i];
    const hash = hashString(entry.id);
    const len = lengths[i];

    // Raw tilt: -1.2 to +1.2 degrees
    const rawTilt = ((hash % 241) - 120) / 100;

    // Drift limit: |tilt_rad * len / 2| <= 6 px => |tilt_deg| <= (12 / len) * (180 / PI)
    const maxTiltFromDrift = (12.0 / len) * (180.0 / Math.PI);
    const tiltCap = Math.min(STACK_CONFIG.maxTiltDegrees, maxTiltFromDrift);

    let tilt = Math.max(-tiltCap, Math.min(tiltCap, rawTilt));

    // Neighboring lean clamp against book below (index i + 1)
    const belowTilt = tilts[i + 1];
    if (Math.abs(belowTilt) >= STACK_CONFIG.maxAdjacentSameLeanDegrees && Math.abs(tilt) >= STACK_CONFIG.maxAdjacentSameLeanDegrees) {
      if (tilt * belowTilt > 0) {
        // Both lean in the same direction past 0.8 deg: flip sign to balance stack
        tilt = -tilt;
      }
    }

    // Re-verify drift limit
    tilt = Math.max(-tiltCap, Math.min(tiltCap, tilt));
    // Round to 3 decimal places for precision
    tilts[i] = Math.round(tilt * 1000) / 1000;
  }

  // 4. Calculate fonts (adjacent books must not share a font family)
  const fonts: SpineFont[] = [];
  for (let i = 0; i < count; i++) {
    const entry = pileBooks[i];
    const hash = hashString(entry.id);

    let fontKey: SpineFont;
    if (entry.spine?.font) {
      fontKey = entry.spine.font;
    } else {
      let fontIdx = (hash >> 6) % FONT_PRESETS.length;
      if (i > 0 && FONT_PRESETS[fontIdx] === fonts[i - 1]) {
        fontIdx = (fontIdx + 1) % FONT_PRESETS.length;
      }
      fontKey = FONT_PRESETS[fontIdx];

      // Check at least 3 distinct fonts in any 7-book window
      if (i >= 2) {
        const windowStart = Math.max(0, i - 6);
        const window = fonts.slice(windowStart, i);
        const distinct = new Set([...window, fontKey]);
        const needed = Math.min(3, i + 1);
        if (distinct.size < needed) {
          for (const candidateFont of FONT_PRESETS) {
            if (candidateFont !== fonts[i - 1] && !distinct.has(candidateFont)) {
              fontKey = candidateFont;
              break;
            }
          }
        }
      }
    }
    fonts.push(fontKey);
  }

  // 5. Build full BookGeometry for each book
  for (let i = 0; i < count; i++) {
    const entry = pileBooks[i];
    const hash = hashString(entry.id);
    const isBottomBook = i === count - 1;
    const len = lengths[i];
    const off = offsets[i];
    const tilt = tilts[i];
    const fontKey = fonts[i];

    // Height clamped between 44px and 104px
    const heightPx = calculateSpineHeight(
      entry.weight,
      STACK_CONFIG.minSpineHeightPx,
      STACK_CONFIG.maxSpineHeightPx
    );

    // Font size scales with thickness: 18 to 30 px
    const progress = Math.min(1, Math.max(0, (heightPx - STACK_CONFIG.minSpineHeightPx) / (STACK_CONFIG.maxSpineHeightPx - STACK_CONFIG.minSpineHeightPx)));
    const fontSizePx = Math.round(STACK_CONFIG.minTitleFontSizePx + progress * (STACK_CONFIG.maxTitleFontSizePx - STACK_CONFIG.minTitleFontSizePx));

    const fontPreset = SPINE_FONTS[fontKey] || SPINE_FONTS.newsreader;

    // Palette lookup
    let palette: SpinePaletteToken = DEFAULT_SPINE_PALETTE;
    if (entry.color && SPINE_PALETTES[entry.color]) {
      palette = SPINE_PALETTES[entry.color];
    } else {
      const key = PALETTE_KEYS[hash % PALETTE_KEYS.length];
      palette = SPINE_PALETTES[key] || DEFAULT_SPINE_PALETTE;
    }

    // Finish / Ink lookup
    let finishKey: SpineFinish = (palette.defaultInk as SpineFinish) || 'gold-foil';
    if (entry.spine?.finish && SPINE_FINISHES[entry.spine.finish]) {
      // Validate that custom finish is allowed on this palette
      if (palette.allowedInks.includes(entry.spine.finish)) {
        finishKey = entry.spine.finish;
      }
    }

    const finishConfig = SPINE_FINISHES[finishKey] || SPINE_FINISHES['gold-foil'];

    // Fore-edge variant: ~1 in 7 books unless custom spine or color is set
    const hasCustomSpine = Boolean(entry.spine);
    const hasExplicitColor = Boolean(entry.color);
    const variant: 'spine' | 'fore-edge' = !hasCustomSpine && !hasExplicitColor && (hash % 7 === 0) ? 'fore-edge' : 'spine';

    // Props: sticky flag (~1 in 5) and rubber band (~1 in 8)
    const hasStickyFlag = (hash >> 2) % 5 === 0;
    const hasRubberBand = (hash >> 4) % 8 === 0;

    const flagOffsetPx = 28 + ((hash >> 5) % Math.max(40, len - 160));
    const rubberBandOffsetPx = 40 + ((hash >> 7) % Math.max(50, len - 180));
    const paperLabelTiltDeg = (((hash >> 3) % 201) - 100) / 100; // -1.0 to +1.0 deg

    result.set(entry.id, {
      heightPx,
      lengthPx: len,
      offsetDesktopPx: off,
      tiltDeg: tilt,
      fontKey,
      fontSizePx,
      letterSpacing: fontPreset.letterSpacing,
      textTransform: (fontPreset as any).textTransform,
      textColor: finishConfig.textColor,
      textShadow: finishConfig.textShadow,
      edgeBorder: palette.edgeBorder,
      edgeShadow: palette.edgeShadow,
      palette,
      variant,
      hasStickyFlag,
      hasRubberBand,
      flagOffsetPx,
      rubberBandOffsetPx,
      paperLabelTiltDeg,
      isBottomBook,
    });
  }

  return result;
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
  const images = stats?.images ?? 0; return images > 0 ? `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}, ${images} ${images === 1 ? 'image' : 'images'}` : `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`;
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
