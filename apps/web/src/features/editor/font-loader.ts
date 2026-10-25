/// <reference types="vite/client" />

/**
 * Dynamic font-face loader.
 * Loads self-hosted open-source fonts on-demand only when used by an entry.
 */

const loadedFonts = new Set<string>();

export function ensureFontLoaded(fontCategoryOrFamily: string): void {
  const normalized = fontCategoryOrFamily.toLowerCase();

  let key = '';
  if (normalized.includes('newsreader') || normalized === 'classic-serif') {
    key = 'classic-serif';
  } else if (normalized.includes('inter') || normalized === 'clean-sans') {
    key = 'clean-sans';
  } else if (normalized.includes('special elite') || normalized === 'typewriter') {
    key = 'typewriter';
  } else if (normalized.includes('kalam') || normalized === 'handwriting') {
    key = 'handwriting';
  } else if (normalized.includes('oswald') || normalized === 'condensed-display') {
    key = 'condensed-display';
  } else if (normalized.includes('playfair') || normalized === 'elegant-display') {
    key = 'elegant-display';
  }

  if (!key || loadedFonts.has(key)) return;
  loadedFonts.add(key);

  switch (key) {
    case 'classic-serif':
      // @ts-ignore
      import('@fontsource/newsreader/400.css');
      // @ts-ignore
      import('@fontsource/newsreader/600.css');
      // @ts-ignore
      import('@fontsource/newsreader/700.css');
      break;
    case 'clean-sans':
      // @ts-ignore
      import('@fontsource/inter/400.css');
      // @ts-ignore
      import('@fontsource/inter/600.css');
      break;
    case 'typewriter':
      // @ts-ignore
      import('@fontsource/special-elite/400.css');
      break;
    case 'handwriting':
      // @ts-ignore
      import('@fontsource/kalam/400.css');
      // @ts-ignore
      import('@fontsource/kalam/700.css');
      break;
    case 'condensed-display':
      // @ts-ignore
      import('@fontsource/oswald/400.css');
      // @ts-ignore
      import('@fontsource/oswald/600.css');
      break;
    case 'elegant-display':
      // @ts-ignore
      import('@fontsource/playfair-display/400.css');
      // @ts-ignore
      import('@fontsource/playfair-display/600.css');
      // @ts-ignore
      import('@fontsource/playfair-display/700.css');
      break;
  }
}
