import 'dotenv/config';
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrismaClient, closeDb } from '../apps/api/src/db/client.js';
import { LocalDiskAssetStore } from '../apps/api/src/stores/asset-store.js';
import { hotPathSaveChunkedEntry } from '../apps/api/src/db/hot-paths.js';
import {
  calculateWeight,
  calculateEntryStats,
  splitBlocksIntoChunks,
  type TopLevelBlock,
  type DocumentEnvelopeV2,
} from '../packages/doc-model/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const storageDir = path.resolve(rootDir, 'data', 'storage');

export interface SeedOptions {
  force?: boolean;
  targetDbUrl?: string;
}

export async function runSeed(targetDbUrl?: string, force = false): Promise<void> {
  const prisma = getPrismaClient(targetDbUrl);
  const assetStore = new LocalDiskAssetStore(storageDir, prisma);
  await assetStore.init();

  const existingCategories = await prisma.category.count();
  const existingEntries = await prisma.entry.count();

  if ((existingCategories > 0 || existingEntries > 0) && !force) {
    throw new Error('Refusing to seed non-empty database without --force flag.');
  }

  console.log('Seeding small dataset (2 categories, 3 entries, 1 image < 100 KB)...');

  // 1. Create Categories
  const cat1 = await prisma.category.create({
    data: {
      id: 'cat_field_notes',
      title: 'Field Notes',
      description: 'Observations, slow thoughts, and natural impressions.',
      color: '#8c3a1e',
      sortOrder: 0,
      todo: [
        { id: 't1', text: 'Catalog autumn pressings', done: false },
        { id: 't2', text: 'Sharpen carving chisels', done: true },
      ],
      version: 1,
    },
  });

  const cat2 = await prisma.category.create({
    data: {
      id: 'cat_studio_archive',
      title: 'Studio Archive',
      description: 'Bookbinding structures, materials, and workshop methods.',
      color: '#344c39',
      sortOrder: 1,
      todo: [],
      version: 1,
    },
  });

  // 2. Generate small test image (< 100 KB)
  const imageBuffer = await sharp({
    create: {
      width: 160,
      height: 160,
      channels: 4,
      background: { r: 140, g: 58, b: 30, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const { asset } = await assetStore.put(imageBuffer, 'image/png', 'botanical_specimen.png');

  // 3. Entries
  const entrySpecs = [
    {
      id: 'ent_philosophy_craft',
      categoryId: cat1.id,
      title: 'The Philosophy of Slow Craft',
      color: '#8c3a1e',
      pinned: true,
      spine: { texture: 'cloth', color: '#8c3a1e', font: 'newsreader', finish: 'gold-foil', bands: 'three' },
      blocks: [
        {
          type: 'paragraph',
          attrs: { id: 'b_1_1' },
          content: [
            {
              type: 'text',
              text: 'Tools should age with dignity. A notebook bound in linen develops character through use, its creases recording touch and time.',
            },
          ],
        },
        {
          type: 'paragraph',
          attrs: { id: 'b_1_2' },
          content: [
            {
              type: 'text',
              text: 'In digital spaces, we must recreate friction and deliberate pacing. Fast feeds induce anxiety; deliberate archives cultivate reflection.',
            },
          ],
        },
      ] as TopLevelBlock[],
    },
    {
      id: 'ent_specimens',
      categoryId: cat1.id,
      title: 'Specimens and Impressions',
      color: '#7a4813',
      pinned: false,
      spine: { texture: 'linen', color: '#7a4813', font: 'kalam', finish: 'silver-foil', bands: 'two' },
      blocks: [
        {
          type: 'paragraph',
          attrs: { id: 'b_2_1' },
          content: [
            {
              type: 'text',
              text: 'Found in the high meadow: dry oak gall, lichen on birch bark, and river stones smoothed by glacial silt.',
            },
          ],
        },
        {
          type: 'image',
          attrs: {
            id: 'b_2_img',
            assetId: asset.id,
            width: 160,
            height: 160,
            caption: 'Collected autumn specimen',
          },
        },
        {
          type: 'paragraph',
          attrs: { id: 'b_2_2' },
          content: [
            {
              type: 'text',
              text: 'Tannins extracted from the oak gall produce deep dark inks that withstand sunlight and moisture.',
            },
          ],
        },
      ] as TopLevelBlock[],
    },
    {
      id: 'ent_leather_binding',
      categoryId: cat2.id,
      title: 'Binding Structures and Leather',
      color: '#344c39',
      pinned: false,
      spine: { texture: 'leather', color: '#344c39', font: 'playfair-display', finish: 'gold-foil', bands: 'two' },
      blocks: [
        {
          type: 'paragraph',
          attrs: { id: 'b_3_1' },
          content: [
            {
              type: 'text',
              text: 'Vegetable-tanned goat leather provides optimal pliability around raised bands without cracking at the joints.',
            },
          ],
        },
        {
          type: 'paragraph',
          attrs: { id: 'b_3_2' },
          content: [
            {
              type: 'text',
              text: 'Sewing signatures on linen cords with unbleached flax thread guarantees durability across centuries.',
            },
          ],
        },
      ] as TopLevelBlock[],
    },
  ];

  for (let i = 0; i < entrySpecs.length; i++) {
    const spec = entrySpecs[i];
    const weight = calculateWeight(spec.blocks);
    const stats = calculateEntryStats(spec.blocks);

    await prisma.entry.create({
      data: {
        id: spec.id,
        categoryId: spec.categoryId,
        title: spec.title,
        color: spec.color,
        pinned: spec.pinned,
        sortOrder: i,
        weight,
        version: 1,
        schemaVersion: 2,
        spine: spec.spine as any,
        stats: stats as any,
      },
    });

    const { manifest, chunks } = splitBlocksIntoChunks(spec.blocks, {
      entryId: spec.id,
      version: 1,
    });

    await hotPathSaveChunkedEntry(prisma, {
      entryId: spec.id,
      expectedVersion: 1,
      manifest,
      chunks,
      weight,
      stats,
    });
  }

  console.log('Seed completed: 2 categories, 3 entries, 1 image created successfully.');
}

if (import.meta.main || process.argv[1]?.endsWith('db-seed.ts')) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const targetDb = args.find((a) => !a.startsWith('--'));

  runSeed(targetDb, force)
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exit(1);
    });
}
