import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type {
  Category,
  CategoryLightRow,
  DocumentEnvelope,
  Entry,
  EntryLightRow,
} from '@kaaj/doc-model';
import { calculateWeight, createEmptyDocument } from '@kaaj/doc-model';
import { SEED_COVERS_MANIFEST } from '@kaaj/design';
import type { LocalDiskAssetStore } from '../stores/asset-store.js';

export interface EntryRecord {
  id: string;
  categoryId: string;
  title: string;
  sortOrder: number;
  color?: string | null;
  pinned: boolean;
  weight: number;
  version: number;
  doc: DocumentEnvelope;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  lastOpenedAt?: string | null;
}

interface SeedEntrySpec {
  title: string;
  paragraphs: string[];
  imageCount?: number;
  color?: string;
  pinned?: boolean;
  dateOffsetDays?: number;
}

interface SeedCategorySpec {
  key: string;
  title: string;
  description: string;
  color: string;
  sortOrder: number;
  entries: SeedEntrySpec[];
}

const SEED_CATEGORIES_DATA: SeedCategorySpec[] = [
  {
    key: 'travel',
    title: 'Travel',
    description: 'Roads taken, train journeys, and field notes from afar',
    color: 'terracotta',
    sortOrder: 0,
    entries: [
      {
        title: 'Kyoto in Early Spring',
        paragraphs: [
          'The morning mist hangs low over the Kamo River. Stone lanterns line the perimeter of the shrine grounds, each wrapped in dry moss that smells of damp earth and incense.',
          'Walked four miles past the wooden merchant houses of Gion before the streets woke up. An elderly woman was sweeping cherry blossoms off a cobblestone threshold with a bamboo broom.',
        ],
        imageCount: 1,
        color: 'moss',
        dateOffsetDays: 30,
      },
      {
        title: 'Rajasthan Desert Trail',
        paragraphs: [
          'Ochre dunes stretch out past the desert fortress. The wind hums a low frequency against the sandstone ramparts, carrying the scent of cumin, dry woodsmoke, and heat.',
          'Evening settled with violet clouds along the western ridge. Caravans rest by the well while lanterns flicker across the courtyard tiles.',
        ],
        imageCount: 1,
        color: 'amber',
        dateOffsetDays: 25,
      },
      {
        title: 'Cafes of Montmartre',
        paragraphs: [
          'Zinc countertops polished by decades of espresso saucers. Rain taps against the leaded glass as artists argue over charcoal weights in the back corner booth.',
        ],
        color: 'slate',
        dateOffsetDays: 20,
      },
      {
        title: 'Highlands Sleeper Train',
        paragraphs: [
          'Rattling bogies through the Scottish night. Pine boughs brush against the window glass as the carriage winds through steep valleys and midnight lochs.',
          'Woke at dawn near Fort William with frost tracing lace patterns on the double-glazed panes.',
        ],
        imageCount: 1,
        color: 'indigo',
        dateOffsetDays: 15,
      },
      {
        title: 'Coastal Cliffs of Amalfi',
        paragraphs: [
          'Terraced lemon groves carved into sheer limestone. The sea beneath shines a saturated ultramarine, reflecting midday sun like hammered silver.',
        ],
        color: 'terracotta',
        dateOffsetDays: 10,
      },
      {
        title: 'Night Market in Taipei',
        paragraphs: [
          'Steam rising from scallion pancake griddles. Red paper lanterns illuminate narrow alleyways packed with patrons seeking herbal broths and shaved ice.',
        ],
        color: 'charcoal',
        dateOffsetDays: 5,
      },
      {
        title: 'Packing List & Journal Prompts',
        paragraphs: [
          'Heavy canvas rucksack, brass pencil sharpener, two notebooks with 120gsm laid paper, collapsible umbrella, wool sweater, and a tin of watercolours.',
        ],
        color: 'linen',
        dateOffsetDays: 1,
      },
    ],
  },
  {
    key: 'food-recipes',
    title: 'Food & Recipes',
    description: 'Kitchen experiments, heirloom measurements, and seasonal tables',
    color: 'amber',
    sortOrder: 1,
    entries: [
      {
        title: 'Sourdough Crumb Notes',
        paragraphs: [
          '80% hydration flour blend using stone-ground heritage wheat. Bulk fermentation extended to 5 hours at 24 degrees Celsius with three sets of coil folds.',
          'Bake in cast iron dutch oven at 240C with two ice cubes dropped behind parchment. Blistered blistered crust with deep mahogany caramelisation.',
        ],
        color: 'amber',
        dateOffsetDays: 24,
      },
      {
        title: 'Summer Gazpacho Method',
        paragraphs: [
          'Vine-ripened beefsteak tomatoes pressed through coarse sieve with bruised garlic, stale sourdough crumb, and unfiltered olive oil.',
        ],
        color: 'terracotta',
        dateOffsetDays: 20,
      },
      {
        title: "Grandmother's Cardamom Chai",
        paragraphs: [
          'Crush three whole green cardamom pods with a coin of ginger and one clove. Simmer in whole milk with loose Assam tea until golden tan.',
        ],
        color: 'clay',
        dateOffsetDays: 14,
      },
      {
        title: 'Handmade Tagliatelle',
        paragraphs: [
          'Semolina well on wooden pasta board. Ten egg yolks beaten gently with a fork and drawn slowly outward until a supple dough forms.',
          'Roll paper-thin through the brass hand-crank machine, dusted with extra semolina to prevent sticking.',
        ],
        imageCount: 1,
        color: 'linen',
        dateOffsetDays: 9,
      },
      {
        title: 'Spiced Plum Galette',
        paragraphs: [
          'Flaky butter crust chilled overnight. Tart damson plums tossed in muscovado sugar and cracked star anise, folded casually at the rim.',
        ],
        color: 'plum',
        dateOffsetDays: 4,
      },
      {
        title: 'Fermentation Timeline',
        paragraphs: [
          'Day 1: brine salt at 2.5%. Day 3: active bubble development. Day 7: sour lactic aroma emerges with crisp crunch retained.',
        ],
        color: 'moss',
        dateOffsetDays: 1,
      },
    ],
  },
  {
    key: 'sketches',
    title: 'Sketches',
    description: 'Charcoal studies, ink wash diagrams, and loose lines',
    color: 'slate',
    sortOrder: 2,
    entries: [
      {
        title: 'Morning Subway Figures',
        paragraphs: ['Commuters in winter coats caught in three-second gestural strokes with 4B compressed graphite.'],
        color: 'charcoal',
        dateOffsetDays: 28,
      },
      {
        title: 'Botanical Ink Studies',
        paragraphs: ['Japanese sumi ink and water wash on cold press watercolour paper. Capturing veining on dry hydrangea bracts.'],
        imageCount: 1,
        color: 'moss',
        dateOffsetDays: 22,
      },
      {
        title: 'Architectural Archways',
        paragraphs: ['Romanesque semi-circular vaults drawn with 0.3mm technical fineliner and crosshatching shadows.'],
        color: 'slate',
        dateOffsetDays: 18,
      },
      {
        title: 'Continuous Line Portraits',
        paragraphs: ['Blind contour drawing without lifting the fountain pen tip from the sheet. Raw expressiveness over geometric accuracy.'],
        color: 'terracotta',
        dateOffsetDays: 15,
      },
      {
        title: 'Charcoal Light Studies',
        paragraphs: ['White chalk highlights over toned grey paper. Single directional candle illumination.'],
        color: 'paper',
        dateOffsetDays: 11,
      },
      {
        title: 'Perspective Grid Tests',
        paragraphs: ['Two-point perspective street corner layout with receding cornices and awning shadows.'],
        color: 'indigo',
        dateOffsetDays: 8,
      },
      {
        title: 'Life Drawing Session 04',
        paragraphs: ['Twenty-minute standing pose with kneaded eraser highlights and sepia conte crayon.'],
        color: 'clay',
        dateOffsetDays: 4,
      },
      {
        title: 'Quick Gesture Poses',
        paragraphs: ['Thirty-second loose charcoal poses focusing on spine curvature and balance axis.'],
        color: 'linen',
        dateOffsetDays: 1,
      },
    ],
  },
  {
    key: 'plants',
    title: 'Plants',
    description: 'Potting journals, leaf pressings, and cuttings on windowsills',
    color: 'moss',
    sortOrder: 3,
    entries: [
      {
        title: 'Fiddle Leaf Fig Recovery',
        paragraphs: ['Notched upper trunk to encourage lateral branching. Added worm castings and filtered rainwater.'],
        color: 'moss',
        dateOffsetDays: 20,
      },
      {
        title: 'Eucalyptus Leaf Pressings',
        paragraphs: ['Blue gum leaves pressed under twenty heavy volumes between archival blotter sheets for six weeks.'],
        imageCount: 1,
        color: 'paper',
        dateOffsetDays: 15,
      },
      {
        title: 'Terrarium Layering Log',
        paragraphs: ['Leca gravel base, horticultural charcoal layer, sphagnum barrier, and terrarium potting soil with pillow moss.'],
        color: 'slate',
        dateOffsetDays: 10,
      },
      {
        title: 'Spring Seedling Propagation',
        paragraphs: ['Sweet pea seeds soaked for twelve hours and planted into cardboard toilet roll tubes on warm windowsill.'],
        color: 'linen',
        dateOffsetDays: 5,
      },
      {
        title: 'Wildflower Identification',
        paragraphs: ['Found meadow cranesbill, wild carrot, and yarrow in ditch edge along country lane.'],
        color: 'amber',
        dateOffsetDays: 1,
      },
    ],
  },
  {
    key: 'music',
    title: 'Music',
    description: 'Listening logs, tape loops, vinyl notes, and harmonic ideas',
    color: 'indigo',
    sortOrder: 4,
    entries: [
      {
        title: 'Sunday Vinyl Listening Log',
        paragraphs: ['Coltrane in the morning, Brian Eno ambient works at dusk. Tube amplifier warmth filling the wooden floorboards.'],
        color: 'indigo',
        dateOffsetDays: 25,
      },
      {
        title: 'Acoustic Fingerpicking Exercises',
        paragraphs: ['Travis picking patterns in drop D tuning. Practicing thumb bass independence at 72 bpm.'],
        color: 'amber',
        dateOffsetDays: 20,
      },
      {
        title: 'Tape Loop Ambient Sketches',
        paragraphs: ['Quarter-inch magnetic tape spliced into four-second loop on Reel-to-Reel recorder, degrading gently with each pass.'],
        imageCount: 1,
        color: 'charcoal',
        dateOffsetDays: 15,
      },
      {
        title: 'Favorite Rhythms & Time Signatures',
        paragraphs: ['Balkan 7/8 folk dances (3+2+2) and polyrhythmic Afrobeat interlocking guitar lines.'],
        color: 'slate',
        dateOffsetDays: 10,
      },
      {
        title: 'Concert Ticket Stubs & Setlists',
        paragraphs: ['Acoustic trio at the old brick cellar in Autumn. Memorable encore with upright bass bowed harmonics.'],
        color: 'paper',
        dateOffsetDays: 5,
      },
      {
        title: 'Late Night Chord Progressions',
        paragraphs: ['Maj9 to minor 11ths with voice-leading through chromatic passing tones.'],
        color: 'plum',
        dateOffsetDays: 1,
      },
    ],
  },
  {
    key: 'ideas',
    title: 'Ideas',
    description: 'Fragments, architectural scraps, essay seeds, and questions',
    color: 'terracotta',
    sortOrder: 5,
    entries: [
      {
        title: 'Field Manifesto for Slow Software',
        paragraphs: [
          'Software should age like paper and leather. It should reward contemplation rather than anxious vigilance.',
          'Eliminate infinite feeds, notification badges, and aggressive engagement metrics. Build tools that feel like physical objects on a sturdy oak table.',
        ],
        imageCount: 1,
        color: 'terracotta',
        pinned: true,
        dateOffsetDays: 45,
      },
      {
        title: 'Handmade Visual Archive Concept',
        paragraphs: ['A personal archive where pages have weight, thickness, and tactile friction. Digital tools inspired by zine culture.'],
        color: 'amber',
        dateOffsetDays: 40,
      },
      {
        title: 'Paper Texture Generation Ideas',
        paragraphs: ['Perlin noise combined with SVG turbulence filters to simulate laid paper fibers without multi-megabyte image assets.'],
        color: 'paper',
        dateOffsetDays: 38,
      },
      {
        title: 'Tactile Book Spine Calculations',
        paragraphs: ['Computing spine thickness directly from character density, image weights, and layer compositions.'],
        imageCount: 1,
        color: 'moss',
        dateOffsetDays: 35,
      },
      {
        title: 'Micro-Interactions Without Framer',
        paragraphs: ['Pure CSS transforms with cubic-bezier easing to keep bundle footprint under 60 KB.'],
        color: 'slate',
        dateOffsetDays: 32,
      },
      {
        title: 'Zine Layout Structures',
        paragraphs: [
          'Folding an A4 sheet into an eight-page booklet with a single horizontal slit in the center.',
          'Page pacing: dense text spreads alternating with bold graphic collages and margins for penciled notes.',
        ],
        imageCount: 1,
        color: 'linen',
        dateOffsetDays: 29,
      },
      {
        title: 'Offline First Sync Thoughts',
        paragraphs: ['Fencing tokens, version clocks, and local drafts in IndexedDB to survive network interruptions.'],
        color: 'indigo',
        dateOffsetDays: 27,
      },
      {
        title: 'Editorial Mood Board Ratios',
        paragraphs: ['Golden ratio and Rule of Thirds applied to asymmetric collage grids.'],
        color: 'clay',
        dateOffsetDays: 25,
      },
      {
        title: 'Color Harmonies from Clay Pottery',
        paragraphs: ['Earthy pigments extracted from terracotta, river silt, charcoal, and ochre clay.'],
        color: 'terracotta',
        dateOffsetDays: 22,
      },
      {
        title: 'Minimalist Writing Typography',
        paragraphs: ['Newsreader serif paired with warm monospaced footnotes and Kalam handwritten margin notes.'],
        color: 'charcoal',
        dateOffsetDays: 20,
      },
      {
        title: 'Deckle Edge SVG Filter Formulas',
        paragraphs: ['Using feTurbulence and feDisplacementMap to fray the geometric borders of digital paper sheets.'],
        color: 'paper',
        dateOffsetDays: 18,
      },
      {
        title: 'Washi Tape Opacity Experiments',
        paragraphs: ['Semi-translucent tape strips overlapping card borders with slight rotation offsets.'],
        color: 'linen',
        dateOffsetDays: 16,
      },
      {
        title: 'Acoustic Keyboard Soundscapes',
        paragraphs: ['Mechanical switches with lubricated stem housings emitting soft thuds resembling rain on cedar shingles.'],
        color: 'slate',
        dateOffsetDays: 14,
      },
      {
        title: 'Pocket Notebook Binding Stitches',
        paragraphs: [
          'Coptic stitch binding allowing notebooks to lie completely flat on any work surface.',
          'Waxed linen thread in crimson pulled tight through five pierced stations along the spine fold.',
        ],
        imageCount: 1,
        color: 'amber',
        dateOffsetDays: 12,
      },
      {
        title: 'Japanese Joinery Metaphors',
        paragraphs: ['Kanawa Tsugi scarf joints where modular components lock together without external fasteners.'],
        color: 'moss',
        dateOffsetDays: 10,
      },
      {
        title: 'Fountain Pen Ink Viscosity Logs',
        paragraphs: ['Testing iron gall ink flow against 100gsm cotton rag versus 52gsm Tomoe River paper.'],
        color: 'indigo',
        dateOffsetDays: 8,
      },
      {
        title: 'Ceramic Glaze Palette Studies',
        paragraphs: ['Celadon green, tenmoku iron brown, and shino white with crawling textures in reduction firing.'],
        color: 'clay',
        dateOffsetDays: 6,
      },
      {
        title: 'Collage Negative Space Rules',
        paragraphs: ['Leaving room for the table surface to breathe between overlapping scrapbook fragments.'],
        color: 'paper',
        dateOffsetDays: 4,
      },
      {
        title: 'Book Spine Embossing Techniques',
        paragraphs: ['Blind stamping with heated brass dies to press title letterforms into book cloth.'],
        color: 'plum',
        dateOffsetDays: 2,
      },
      {
        title: 'Architectural Drafting Principles',
        paragraphs: ['Line weight hierarchy: profile lines at 0.7mm, contour lines at 0.5mm, dimension lines at 0.25mm.'],
        color: 'charcoal',
        dateOffsetDays: 0,
      },
    ],
  },
  {
    key: 'memories',
    title: 'Memories',
    description: 'Photographs, pressed tickets, letters, and quiet afternoons',
    color: 'slate',
    sortOrder: 6,
    entries: [
      {
        title: 'Summer of 1998 in the Orchard',
        paragraphs: ['Apple blossoms falling like snow. Climbing the old walnut tree with a paperback adventure novel.'],
        color: 'amber',
        dateOffsetDays: 30,
      },
      {
        title: 'Letters from Old Friends',
        paragraphs: ['Postcards with airmail borders preserved in a cardboard shoe box tied with blue twine.'],
        color: 'paper',
        dateOffsetDays: 20,
      },
      {
        title: 'Ticket to the Seaside Pavilion',
        paragraphs: ['Pier carousel organ music playing across salt spray as fog rolled into the bay.'],
        color: 'slate',
        dateOffsetDays: 10,
      },
      {
        title: 'Photographs from the Darkroom',
        paragraphs: ['Faint silver halides emerging in the developer tray under red safelight glow.'],
        imageCount: 1,
        color: 'charcoal',
        dateOffsetDays: 1,
      },
    ],
  },
];

export class CategoriesService {
  private categories: Map<string, Category> = new Map();
  private entries: Map<string, EntryRecord> = new Map();
  private dataFilePath: string;
  private assetStore: LocalDiskAssetStore;
  private seedCoversDir: string;
  private initialized = false;

  constructor(baseDataDir: string, assetStore: LocalDiskAssetStore, seedCoversDir: string) {
    this.dataFilePath = path.join(baseDataDir, 'db-store.json');
    this.assetStore = assetStore;
    this.seedCoversDir = seedCoversDir;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(path.dirname(this.dataFilePath), { recursive: true });
      const raw = await fs.readFile(this.dataFilePath, 'utf8');
      const data = JSON.parse(raw);
      for (const cat of data.categories || []) {
        this.categories.set(cat.id, cat);
      }
      for (const ent of data.entries || []) {
        this.entries.set(ent.id, ent);
      }
    } catch {
      await this.seed();
    }

    // If categories empty or ideas category has fewer than 20 entries, reseed
    const ideasEntries = Array.from(this.entries.values()).filter(
      (e) => e.categoryId === 'cat_ideas' && !e.deletedAt
    );
    if (this.categories.size === 0 || ideasEntries.length < 20) {
      await this.seed();
    }

    this.initialized = true;
  }

  private async persist(): Promise<void> {
    const data = {
      categories: Array.from(this.categories.values()),
      entries: Array.from(this.entries.values()),
    };
    await fs.writeFile(this.dataFilePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async seed(): Promise<void> {
    const nowMs = Date.now();
    const coverAssetMap = new Map<string, string>();

    // Register static covers via real AssetStore as required by spec
    for (const item of SEED_COVERS_MANIFEST) {
      try {
        const svgPath = path.join(this.seedCoversDir, item.fileName);
        const svgBuffer = await fs.readFile(svgPath);
        const pngBuffer = await sharp(svgBuffer).png().toBuffer();
        const { asset } = await this.assetStore.put(pngBuffer, 'image/png', item.fileName);
        coverAssetMap.set(item.key, asset.id);
      } catch (err) {
        console.warn(`Could not seed cover for ${item.key}:`, err);
      }
    }

    // Clear and rebuild initial categories & entries
    this.categories.clear();
    this.entries.clear();

    for (const seedCat of SEED_CATEGORIES_DATA) {
      const catId = `cat_${seedCat.key}`;
      const coverAssetId = coverAssetMap.get(seedCat.key);
      const catCreatedAt = new Date(nowMs - 60 * 24 * 60 * 60 * 1000).toISOString();

      const category: Category = {
        id: catId,
        title: seedCat.title,
        description: seedCat.description,
        coverAssetId,
        sortOrder: seedCat.sortOrder,
        color: seedCat.color,
        createdAt: catCreatedAt,
        updatedAt: catCreatedAt,
        deletedAt: null,
      };

      this.categories.set(catId, category);

      let entryIndex = 0;
      for (const entrySpec of seedCat.entries) {
        const entryId = `entry_${seedCat.key}_${entryIndex + 1}`;
        const offsetDays = entrySpec.dateOffsetDays ?? (seedCat.entries.length - entryIndex);
        const entryTimestamp = new Date(nowMs - offsetDays * 24 * 60 * 60 * 1000 + entryIndex * 60000).toISOString();

        // Build document body blocks with varied, realistic length based on entry index
        const bodyContent: Array<Record<string, unknown>> = [
          { type: 'heading', level: 1, text: entrySpec.title },
        ];

        const depth = (entryIndex % 6) + 1;
        for (let r = 0; r < depth; r++) {
          for (const p of entrySpec.paragraphs) {
            bodyContent.push({ type: 'paragraph', text: p });
          }
        }

        const imagesToAdd = entrySpec.imageCount ?? (entryIndex % 4 === 0 ? 1 : 0);
        if (imagesToAdd > 0) {
          for (let i = 0; i < imagesToAdd; i++) {
            bodyContent.push({
              type: 'image',
              assetId: coverAssetId || `asset_${entrySpec.color || 'default'}`,
              alt: `${entrySpec.title} illustration`,
              width: 0.85,
            });
          }
        }

        const doc: DocumentEnvelope = {
          schemaVersion: 1,
          pages: [
            {
              id: `p_${entryId}_1`,
              size: { width: 1200, height: 1600 },
              background: { type: 'solid', token: 'paper' },
              body: {
                format: 'kaaj-rich-text-v1',
                content: bodyContent,
              },
              layers: [],
            },
          ],
        };

        const calculatedWeight = calculateWeight(doc);

        const entry: EntryRecord = {
          id: entryId,
          categoryId: catId,
          title: entrySpec.title,
          sortOrder: entryIndex++,
          color: entrySpec.color || seedCat.color,
          pinned: entrySpec.pinned ?? false,
          weight: calculatedWeight,
          version: 1,
          doc,
          createdAt: entryTimestamp,
          updatedAt: entryTimestamp,
          deletedAt: null,
          lastOpenedAt: null,
        };

        this.entries.set(entryId, entry);
      }
    }

    await this.persist();
  }

  async listCategories(): Promise<CategoryLightRow[]> {
    await this.init();

    const result: CategoryLightRow[] = [];
    for (const cat of this.categories.values()) {
      if (cat.deletedAt) continue;

      let entryCount = 0;
      for (const entry of this.entries.values()) {
        if (entry.categoryId === cat.id && !entry.deletedAt) {
          entryCount++;
        }
      }

      result.push({
        ...cat,
        entryCount,
      });
    }

    return result.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getCategory(id: string): Promise<Category | null> {
    await this.init();
    const category = this.categories.get(id);
    if (!category || category.deletedAt) return null;
    return category;
  }

  async createCategory(title: string, coverAssetId?: string, color?: string): Promise<CategoryLightRow> {
    await this.init();
    const now = new Date().toISOString();
    const count = this.categories.size;
    const id = `cat_${Date.now()}`;

    const newCat: Category = {
      id,
      title: title.trim(),
      description: '',
      coverAssetId,
      sortOrder: count,
      color: color || 'terracotta',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    this.categories.set(id, newCat);
    await this.persist();

    return {
      ...newCat,
      entryCount: 0,
    };
  }

  async updateCategory(
    id: string,
    updates: Partial<Pick<Category, 'title' | 'description' | 'coverAssetId' | 'color' | 'sortOrder'>>
  ): Promise<Category | null> {
    await this.init();
    const cat = this.categories.get(id);
    if (!cat || cat.deletedAt) return null;

    const updated: Category = {
      ...cat,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.categories.set(id, updated);
    await this.persist();
    return updated;
  }

  async deleteCategory(id: string): Promise<boolean> {
    await this.init();
    const cat = this.categories.get(id);
    if (!cat || cat.deletedAt) return false;

    cat.deletedAt = new Date().toISOString();
    this.categories.set(id, cat);
    await this.persist();
    return true;
  }

  async restoreCategory(id: string): Promise<Category | null> {
    await this.init();
    const cat = this.categories.get(id);
    if (!cat || !cat.deletedAt) return null;

    cat.deletedAt = null;
    cat.updatedAt = new Date().toISOString();
    this.categories.set(id, cat);
    await this.persist();
    return cat;
  }

  /**
   * List light rows for entries in a category (never load doc).
   */
  async listEntriesForCategory(categoryId: string): Promise<EntryLightRow[]> {
    await this.init();
    const rows: EntryLightRow[] = [];

    for (const e of this.entries.values()) {
      if (e.categoryId === categoryId && !e.deletedAt) {
        rows.push({
          id: e.id,
          categoryId: e.categoryId,
          title: e.title,
          weight: e.weight,
          sortOrder: e.sortOrder,
          color: e.color ?? null,
          pinned: e.pinned,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          lastOpenedAt: e.lastOpenedAt ?? null,
          deletedAt: null,
        });
      }
    }

    return rows;
  }

  /**
   * Get full entry row by id (including doc).
   */
  async getEntry(id: string): Promise<EntryRecord | null> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || entry.deletedAt) return null;
    return entry;
  }

  /**
   * Create new entry in a category.
   */
  async createEntry(
    categoryId: string,
    title = 'Untitled',
    color?: string,
    pinned = false
  ): Promise<EntryRecord> {
    await this.init();
    const now = new Date().toISOString();
    const entryId = `entry_${Date.now()}`;
    const cleanTitle = title.trim() || 'Untitled';

    const doc = createEmptyDocument(cleanTitle);
    const weightVal = calculateWeight(doc);

    // Count existing unpinned entries for sortOrder
    const existing = Array.from(this.entries.values()).filter(
      (e) => e.categoryId === categoryId && !e.deletedAt
    );

    const newEntry: EntryRecord = {
      id: entryId,
      categoryId,
      title: cleanTitle,
      sortOrder: existing.length,
      color: color || null,
      pinned,
      weight: weightVal,
      version: 1,
      doc,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      lastOpenedAt: now,
    };

    this.entries.set(entryId, newEntry);
    await this.persist();
    return newEntry;
  }

  /**
   * Update entry metadata (title, categoryId, color, pinned, sortOrder).
   */
  async updateEntry(
    id: string,
    updates: {
      title?: string;
      categoryId?: string;
      color?: string | null;
      pinned?: boolean;
      sortOrder?: number;
    }
  ): Promise<EntryRecord | null> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || entry.deletedAt) return null;

    if (updates.title !== undefined) entry.title = updates.title.trim();
    if (updates.categoryId !== undefined) entry.categoryId = updates.categoryId;
    if (updates.color !== undefined) entry.color = updates.color;
    if (updates.pinned !== undefined) entry.pinned = updates.pinned;
    if (updates.sortOrder !== undefined) entry.sortOrder = updates.sortOrder;

    entry.updatedAt = new Date().toISOString();
    this.entries.set(id, entry);
    await this.persist();
    return entry;
  }

  /**
   * Save document envelope and compute weight.
   */
  async saveEntryDoc(
    id: string,
    doc: DocumentEnvelope,
    expectedVersion?: number
  ): Promise<{ entry: EntryRecord; saved: boolean }> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || entry.deletedAt) {
      throw new Error('Entry not found');
    }

    if (expectedVersion !== undefined && entry.version !== expectedVersion) {
      throw new Error(`Version conflict: expected ${expectedVersion}, got ${entry.version}`);
    }

    const calculatedWeight = calculateWeight(doc);
    entry.doc = doc;
    entry.weight = calculatedWeight;
    entry.version += 1;
    entry.updatedAt = new Date().toISOString();

    this.entries.set(id, entry);
    await this.persist();
    return { entry, saved: true };
  }

  /**
   * Soft delete entry.
   */
  async deleteEntry(id: string): Promise<boolean> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || entry.deletedAt) return false;

    entry.deletedAt = new Date().toISOString();
    this.entries.set(id, entry);
    await this.persist();
    return true;
  }

  /**
   * Restore soft-deleted entry.
   */
  async restoreEntry(id: string): Promise<EntryRecord | null> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || !entry.deletedAt) return null;

    entry.deletedAt = null;
    entry.updatedAt = new Date().toISOString();
    this.entries.set(id, entry);
    await this.persist();
    return entry;
  }
}
