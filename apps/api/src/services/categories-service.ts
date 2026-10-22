import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Category, CategoryLightRow, DocumentEnvelope } from '@kaaj/doc-model';
import { calculateWeight } from '@kaaj/doc-model';
import { SEED_COVERS_MANIFEST } from '@kaaj/design';
import type { LocalDiskAssetStore } from '../stores/asset-store.js';

export interface EntryRecord {
  id: string;
  categoryId: string;
  title: string;
  sortOrder: number;
  color?: string;
  weight: number;
  version: number;
  doc: DocumentEnvelope;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

const SEED_CATEGORIES_DATA = [
  {
    key: 'travel',
    title: 'Travel',
    description: 'Roads taken, train journeys, and field notes from afar',
    color: 'terracotta',
    sortOrder: 0,
    entries: [
      'Kyoto in Early Spring',
      'Rajasthan Desert Trail',
      'Cafes of Montmartre',
      'Highlands Sleeper Train',
      'Coastal Cliffs of Amalfi',
      'Night Market in Taipei',
      'Packing List & Journal Prompts',
    ],
  },
  {
    key: 'food-recipes',
    title: 'Food & Recipes',
    description: 'Kitchen experiments, heirloom measurements, and seasonal tables',
    color: 'amber',
    sortOrder: 1,
    entries: [
      'Sourdough Crumb Notes',
      'Summer Gazpacho Method',
      "Grandmother's Cardamom Chai",
      'Handmade Tagliatelle',
      'Spiced Plum Galette',
      'Fermentation Timeline',
    ],
  },
  {
    key: 'sketches',
    title: 'Sketches',
    description: 'Charcoal studies, ink wash diagrams, and loose lines',
    color: 'slate',
    sortOrder: 2,
    entries: [
      'Morning Subway Figures',
      'Botanical Ink Studies',
      'Architectural Archways',
      'Continuous Line Portraits',
      'Charcoal Light Studies',
      'Perspective Grid Tests',
      'Life Drawing Session 04',
      'Quick Gesture Poses',
    ],
  },
  {
    key: 'plants',
    title: 'Plants',
    description: 'Potting journals, leaf pressings, and cuttings on windowsills',
    color: 'moss',
    sortOrder: 3,
    entries: [
      'Fiddle Leaf Fig Recovery',
      'Eucalyptus Leaf Pressings',
      'Terrarium Layering Log',
      'Spring Seedling Propagation',
      'Wildflower Identification',
    ],
  },
  {
    key: 'music',
    title: 'Music',
    description: 'Listening logs, tape loops, vinyl notes, and harmonic ideas',
    color: 'indigo',
    sortOrder: 4,
    entries: [
      'Sunday Vinyl Listening Log',
      'Acoustic Fingerpicking Exercises',
      'Tape Loop Ambient Sketches',
      'Favorite Rhythms & Time Signatures',
      'Concert Ticket Stubs & Setlists',
      'Late Night Chord Progressions',
    ],
  },
  {
    key: 'ideas',
    title: 'Ideas',
    description: 'Fragments, architectural scraps, essay seeds, and questions',
    color: 'terracotta',
    sortOrder: 5,
    entries: [
      'Handmade Visual Archive Concept',
      'Paper Texture Generation Ideas',
      'Tactile Book Spine Calculations',
      'Micro-Interactions Without Framer',
      'Zine Layout Structures',
      'Offline First Sync Thoughts',
      'Editorial Mood Board Ratios',
      'Color Harmonies from Clay Pottery',
      'Minimalist Writing Typography',
    ],
  },
  {
    key: 'memories',
    title: 'Memories',
    description: 'Photographs, pressed tickets, letters, and quiet afternoons',
    color: 'slate',
    sortOrder: 6,
    entries: [
      'Summer of 1998 in the Orchard',
      'Letters from Old Friends',
      'Ticket to the Seaside Pavilion',
      'Photographs from the Darkroom',
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
      // If file doesn't exist or is empty, seed initial data
      await this.seed();
    }

    if (this.categories.size === 0) {
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
    const now = new Date().toISOString();

    // Map of manifest key to registered coverAssetId
    const coverAssetMap = new Map<string, string>();

    // Register static covers via real AssetStore as required by spec
    for (const item of SEED_COVERS_MANIFEST) {
      try {
        const svgPath = path.join(this.seedCoversDir, item.fileName);
        const svgBuffer = await fs.readFile(svgPath);

        // Convert SVG to high-res PNG for the asset store
        const pngBuffer = await sharp(svgBuffer).png().toBuffer();
        const { asset } = await this.assetStore.put(pngBuffer, 'image/png', item.fileName);
        coverAssetMap.set(item.key, asset.id);
      } catch (err) {
        console.warn(`Could not seed cover for ${item.key}:`, err);
      }
    }

    // Seed categories and entries
    for (const seedCat of SEED_CATEGORIES_DATA) {
      const catId = `cat_${seedCat.key}`;
      const coverAssetId = coverAssetMap.get(seedCat.key);

      const category: Category = {
        id: catId,
        title: seedCat.title,
        description: seedCat.description,
        coverAssetId,
        sortOrder: seedCat.sortOrder,
        color: seedCat.color,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      this.categories.set(catId, category);

      // Seed entries for this category
      let entrySort = 0;
      for (const title of seedCat.entries) {
        const entryId = `entry_${seedCat.key}_${entrySort + 1}`;
        const doc: DocumentEnvelope = {
          schemaVersion: 1,
          pages: [
            {
              id: `p_${entryId}_1`,
              size: { width: 1200, height: 1600 },
              background: { type: 'solid', token: 'paper' },
              body: {
                format: 'kaaj-rich-text-v1',
                content: [
                  { type: 'heading', level: 1, text: title },
                  { type: 'paragraph', text: `Writing entry for ${seedCat.title}.` },
                ],
              },
              layers: [],
            },
          ],
        };

        const weight = calculateWeight(doc);
        const entry: EntryRecord = {
          id: entryId,
          categoryId: catId,
          title,
          sortOrder: entrySort++,
          color: seedCat.color,
          weight,
          version: 1,
          doc,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
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

    // Sort by sortOrder
    return result.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getCategory(id: string): Promise<{ category: Category; entries: EntryRecord[] } | null> {
    await this.init();
    const category = this.categories.get(id);
    if (!category || category.deletedAt) return null;

    const entries = Array.from(this.entries.values())
      .filter((e) => e.categoryId === id && !e.deletedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return { category, entries };
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

  async updateCategory(id: string, updates: Partial<Pick<Category, 'title' | 'description' | 'coverAssetId' | 'color' | 'sortOrder'>>): Promise<Category | null> {
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
}
