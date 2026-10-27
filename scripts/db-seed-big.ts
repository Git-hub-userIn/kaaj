import 'dotenv/config';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPrismaClient, closeDb } from '../apps/api/src/db/client.js';
import { hotPathSaveChunkedEntry } from '../apps/api/src/db/hot-paths.js';
import {
  calculateWeight,
  calculateEntryStats,
  splitBlocksIntoChunks,
  type TopLevelBlock,
} from '../packages/doc-model/src/index.js';

const SAMPLE_PARAGRAPHS = [
  'The tactile nature of physical manuscripts grounds human cognition in spatial orientation. Every volume retains memory of handling, environmental moisture, and the steady passage of decades.',
  'Systematic indexation enables nonlinear exploration of knowledge. When ideas are fragmented into discrete observations, connections emerge naturally across seemingly disparate categories.',
  'Material choices dictate longevity. Rag paper made from cotton fibers remains stable for half a millennium, outliving digital magnetic tapes and commercial optical discs.',
  'The discipline of concise documentation forces clarity of thought. Unnecessary adjectives cloud technical insight and produce fragile operational procedures.',
  'Local-first software architectures restore user sovereignty. Data stored in transparent, open structures survives vendor liquidation and network disruptions.',
];

export async function runBigSeed(targetDbUrl?: string, force = false): Promise<void> {
  const prisma = getPrismaClient(targetDbUrl);

  const existingCategories = await prisma.category.count();
  const existingEntries = await prisma.entry.count();

  if ((existingCategories > 0 || existingEntries > 0) && !force) {
    throw new Error('Refusing to seed non-empty database without --force flag.');
  }

  console.log('Seeding large dataset (~250 entries with several 50k-word documents)...');

  // 1. Create 8 categories
  const categoryNames = [
    { title: 'Philosophy of Craft', color: '#8c3a1e' },
    { title: 'Architectural Studies', color: '#344c39' },
    { title: 'Bookbinding Guilds', color: '#2e414c' },
    { title: 'Typographic Specimen', color: '#7a4813' },
    { title: 'Natural Pigments', color: '#4e2d3f' },
    { title: 'Archival Restoration', color: '#9e563a' },
    { title: 'Local-First Systems', color: '#263449' },
    { title: 'Marginalia & Fragments', color: '#2c2825' },
  ];

  const createdCategories: string[] = [];

  for (let i = 0; i < categoryNames.length; i++) {
    const c = categoryNames[i];
    const cat = await prisma.category.create({
      data: {
        id: `cat_big_${i + 1}`,
        title: c.title,
        color: c.color,
        sortOrder: i,
        version: 1,
      },
    });
    createdCategories.push(cat.id);
  }

  // 2. Generate ~250 entries
  const totalEntries = 250;
  console.log(`Generating ${totalEntries} entries across ${createdCategories.length} categories...`);

  // We select 3 entries to be ~50k words (approx 500 paragraphs with ~100 words each = 50,000 words)
  const largeEntryIndices = new Set([10, 75, 180]);

  for (let i = 0; i < totalEntries; i++) {
    const isLarge = largeEntryIndices.has(i);
    const categoryId = createdCategories[i % createdCategories.length];
    const entryId = `ent_big_${String(i + 1).padStart(3, '0')}`;
    const title = isLarge
      ? `Comprehensive Treatise on Archival Epistemology (Vol. ${i})`
      : `Journal Entry No. ${i + 1}: Studies in Field Craft`;

    const blocks: TopLevelBlock[] = [];

    if (isLarge) {
      // 50k words ~ 500 paragraphs of 100 words
      const paragraphCount = 500;
      for (let p = 0; p < paragraphCount; p++) {
        const textChunk = `${SAMPLE_PARAGRAPHS[p % SAMPLE_PARAGRAPHS.length]} Repeat segment ${p + 1}: ${SAMPLE_PARAGRAPHS[(p + 1) % SAMPLE_PARAGRAPHS.length]}`;
        blocks.push({
          type: 'paragraph',
          attrs: { id: `b_${entryId}_${p}` },
          content: [{ type: 'text', text: textChunk }],
        });
      }
    } else {
      // Normal entry: 2 to 5 paragraphs
      const pCount = (i % 4) + 2;
      for (let p = 0; p < pCount; p++) {
        blocks.push({
          type: 'paragraph',
          attrs: { id: `b_${entryId}_${p}` },
          content: [{ type: 'text', text: SAMPLE_PARAGRAPHS[(i + p) % SAMPLE_PARAGRAPHS.length] }],
        });
      }
    }

    const weight = calculateWeight(blocks);
    const stats = calculateEntryStats(blocks);

    await prisma.entry.create({
      data: {
        id: entryId,
        categoryId,
        title,
        weight,
        sortOrder: i,
        pinned: i % 15 === 0,
        version: 1,
        schemaVersion: 2,
        stats: stats as any,
      },
    });

    const { manifest, chunks } = splitBlocksIntoChunks(blocks, {
      entryId,
      version: 1,
    });

    await hotPathSaveChunkedEntry(prisma, {
      entryId,
      expectedVersion: 1,
      manifest,
      chunks,
      weight,
      stats,
    });

    if ((i + 1) % 50 === 0) {
      console.log(`  Seeded ${i + 1} / ${totalEntries} entries...`);
    }
  }

  console.log(`Big seed complete: ${createdCategories.length} categories, ${totalEntries} entries created.`);
}

if (import.meta.main || process.argv[1]?.endsWith('db-seed-big.ts')) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const targetDb = args.find((a) => !a.startsWith('--'));

  runBigSeed(targetDb, force)
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Big seed failed:', err.message);
      process.exit(1);
    });
}
