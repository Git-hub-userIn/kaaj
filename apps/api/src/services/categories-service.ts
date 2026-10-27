import path from 'node:path';
import crypto from 'node:crypto';
import type {
  Category,
  CategoryLightRow,
  DocumentEnvelope,
  EntryLightRow,
  SpineStyle,
  EntryStats,
  CategoryStats,
  MonthEntryCount,
  TodoItem,
} from '@kaaj/doc-model';
import {
  calculateWeight,
  calculateEntryStats,
  createEmptyDocument,
  migrateDocumentToV2,
  splitBlocksIntoChunks,
  reassembleDocFromChunks,
  canonicalDocJson,
  computeContentHash,
  type EntryManifest,
  type ChunkPayload,
  type ChunkMetadata,
  type DocumentEnvelopeV2,
  type TopLevelBlock,
} from '@kaaj/doc-model';
import type { LocalDiskAssetStore } from '../stores/asset-store.js';
import { prisma as defaultPrisma } from '../db/client.js';
import {
  hotPathSaveChunkedEntry,
  hotPathVersionCheckedUpdateEntry,
  ConcurrencyConflictError,
} from '../db/hot-paths.js';
import type { PrismaClient } from '../generated/client/index.js';

export interface EntryRecord {
  id: string;
  categoryId: string;
  title: string;
  sortOrder: number;
  color?: string | null;
  pinned: boolean;
  spine?: SpineStyle | null;
  stats?: EntryStats;
  weight: number;
  version: number;
  doc: DocumentEnvelope;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  lastOpenedAt?: string | null;
}

export class CategoriesService {
  private baseDataDir: string;
  private assetStore: LocalDiskAssetStore;
  private seedCoversDir: string;
  private prisma: PrismaClient;
  private initialized = false;

  constructor(
    baseDataDir: string,
    assetStore: LocalDiskAssetStore,
    seedCoversDir: string,
    prisma?: PrismaClient
  ) {
    this.baseDataDir = baseDataDir;
    this.assetStore = assetStore;
    this.seedCoversDir = seedCoversDir;
    this.prisma = prisma || defaultPrisma;
  }

  async init(_subject?: string): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  async listCategories(_subject?: string): Promise<CategoryLightRow[]> {
    await this.init();

    const categories = await this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: {
            entries: {
              where: { deletedAt: null },
            },
          },
        },
      },
    });

    return categories.map((cat) => ({
      id: cat.id,
      title: cat.title,
      description: cat.description ?? undefined,
      coverAssetId: cat.coverAssetId ?? undefined,
      sortOrder: cat.sortOrder,
      color: cat.color ?? undefined,
      todo: (cat.todo as any as TodoItem[]) || [],
      version: cat.version,
      createdAt: cat.createdAt.toISOString(),
      updatedAt: cat.updatedAt.toISOString(),
      deletedAt: cat.deletedAt ? cat.deletedAt.toISOString() : null,
      entryCount: cat._count.entries,
    }));
  }

  async getCategory(id: string, _subject?: string): Promise<Category | null> {
    await this.init();
    const cat = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
    });
    if (!cat) return null;

    return {
      id: cat.id,
      title: cat.title,
      description: cat.description ?? undefined,
      coverAssetId: cat.coverAssetId ?? undefined,
      sortOrder: cat.sortOrder,
      color: cat.color ?? undefined,
      todo: (cat.todo as any as TodoItem[]) || [],
      version: cat.version,
      createdAt: cat.createdAt.toISOString(),
      updatedAt: cat.updatedAt.toISOString(),
      deletedAt: cat.deletedAt ? cat.deletedAt.toISOString() : null,
    };
  }

  async createCategory(
    title: string,
    coverAssetId?: string,
    color?: string,
    _subject?: string
  ): Promise<CategoryLightRow> {
    await this.init();
    const count = await this.prisma.category.count();
    const id = `cat_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const cat = await this.prisma.category.create({
      data: {
        id,
        title: title.trim(),
        description: '',
        coverAssetId: coverAssetId ?? null,
        color: color || 'terracotta',
        sortOrder: count,
        todo: [],
        version: 1,
      },
    });

    return {
      id: cat.id,
      title: cat.title,
      description: cat.description ?? undefined,
      coverAssetId: cat.coverAssetId ?? undefined,
      sortOrder: cat.sortOrder,
      color: cat.color ?? undefined,
      todo: [],
      version: 1,
      createdAt: cat.createdAt.toISOString(),
      updatedAt: cat.updatedAt.toISOString(),
      deletedAt: null,
      entryCount: 0,
    };
  }

  async updateCategory(
    id: string,
    updates: Partial<Pick<Category, 'title' | 'description' | 'coverAssetId' | 'color' | 'sortOrder' | 'todo'>>,
    expectedVersion?: number,
    _subject?: string
  ): Promise<{ category: Category } | { conflict: true; currentVersion: number } | null> {
    await this.init();

    const existing = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) return null;

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      return { conflict: true, currentVersion: existing.version };
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        title: updates.title !== undefined ? updates.title.trim() : undefined,
        description: updates.description !== undefined ? updates.description : undefined,
        coverAssetId: updates.coverAssetId !== undefined ? updates.coverAssetId : undefined,
        color: updates.color !== undefined ? updates.color : undefined,
        sortOrder: updates.sortOrder !== undefined ? updates.sortOrder : undefined,
        todo: updates.todo !== undefined ? (updates.todo as any) : undefined,
        version: { increment: 1 },
      },
    });

    return {
      category: {
        id: updated.id,
        title: updated.title,
        description: updated.description ?? undefined,
        coverAssetId: updated.coverAssetId ?? undefined,
        sortOrder: updated.sortOrder,
        color: updated.color ?? undefined,
        todo: (updated.todo as any as TodoItem[]) || [],
        version: updated.version,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        deletedAt: updated.deletedAt ? updated.deletedAt.toISOString() : null,
      },
    };
  }

  async getCategoryStats(categoryId: string, _subject?: string): Promise<CategoryStats | null> {
    await this.init();
    const cat = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
    });
    if (!cat) return null;

    const entries = await this.prisma.entry.findMany({
      where: { categoryId, deletedAt: null },
      select: {
        stats: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    let words = 0;
    let images = 0;
    let latestUpdatedAt = cat.createdAt.toISOString();

    for (const e of entries) {
      const stats = (e.stats as any as EntryStats) || { words: 0, images: 0 };
      words += stats.words || 0;
      images += stats.images || 0;
      const updatedIso = e.updatedAt.toISOString();
      if (updatedIso > latestUpdatedAt) {
        latestUpdatedAt = updatedIso;
      }
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const entriesPerMonth: MonthEntryCount[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const monthIndex = d.getMonth();
      const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
      const label = monthNames[monthIndex];
      entriesPerMonth.push({
        month: monthKey,
        label,
        count: 0,
      });
    }

    for (const e of entries) {
      const entryMonth = e.createdAt.toISOString().slice(0, 7);
      const bucket = entriesPerMonth.find((b) => b.month === entryMonth);
      if (bucket) {
        bucket.count++;
      }
    }

    return {
      entries: entries.length,
      words,
      images,
      createdAt: cat.createdAt.toISOString(),
      lastEditedAt: entries.length > 0 ? latestUpdatedAt : cat.updatedAt.toISOString(),
      entriesPerMonth,
    };
  }

  async deleteCategory(id: string, _subject?: string): Promise<boolean> {
    await this.init();
    const cat = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
    });
    if (!cat) return false;

    await this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return true;
  }

  async restoreCategory(id: string, _subject?: string): Promise<Category | null> {
    await this.init();
    const cat = await this.prisma.category.findFirst({
      where: { id, deletedAt: { not: null } },
    });
    if (!cat) return null;

    const restored = await this.prisma.category.update({
      where: { id },
      data: { deletedAt: null },
    });

    return {
      id: restored.id,
      title: restored.title,
      description: restored.description ?? undefined,
      coverAssetId: restored.coverAssetId ?? undefined,
      sortOrder: restored.sortOrder,
      color: restored.color ?? undefined,
      todo: (restored.todo as any as TodoItem[]) || [],
      version: restored.version,
      createdAt: restored.createdAt.toISOString(),
      updatedAt: restored.updatedAt.toISOString(),
      deletedAt: null,
    };
  }

  async listEntriesForCategory(categoryId: string, _subject?: string): Promise<EntryLightRow[]> {
    await this.init();
    const entries = await this.prisma.entry.findMany({
      where: { categoryId, deletedAt: null },
      orderBy: [{ pinned: 'desc' }, { sortOrder: 'asc' }],
      take: 500,
    });

    return entries.map((e) => ({
      id: e.id,
      categoryId: e.categoryId,
      title: e.title,
      weight: e.weight,
      sortOrder: e.sortOrder,
      color: e.color ?? null,
      pinned: e.pinned,
      spine: (e.spine as any as SpineStyle) ?? null,
      stats: (e.stats as any as EntryStats) ?? { words: 0, images: 0 },
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      lastOpenedAt: e.lastOpenedAt ? e.lastOpenedAt.toISOString() : null,
      deletedAt: null,
    }));
  }

  async runMigration(): Promise<any> {
    await this.init();
    return {
      totalEntries: await this.prisma.entry.count(),
      migratedEntries: 0,
      alreadyMigrated: await this.prisma.entry.count(),
      totalChunksCreated: await this.prisma.chunk.count(),
      durationMs: 0,
    };
  }

  async getEntryManifest(id: string, _subject?: string): Promise<EntryManifest | null> {
    await this.init();
    const manifest = await this.prisma.entryManifest.findUnique({
      where: { entryId: id },
    });
    if (!manifest) return null;

    return {
      entryId: manifest.entryId,
      schemaVersion: 2,
      version: manifest.version,
      totalBlocks: manifest.totalBlocks,
      chunkCount: manifest.chunkCount,
      stats: (manifest.stats as any) ?? { words: 0, images: 0 },
      chunks: (manifest.chunks as any as ChunkMetadata[]) || [],
      updatedAt: manifest.updatedAt.toISOString(),
    };
  }

  async getEntryChunk(entryId: string, chunkId: string, _subject?: string): Promise<ChunkPayload | null> {
    await this.init();
    const chunk = await this.prisma.chunk.findUnique({
      where: { entryId_id: { entryId, id: chunkId } },
    });
    if (!chunk) return null;

    return {
      chunkId: chunk.id,
      entryId: chunk.entryId,
      blocks: (chunk.payload as any as TopLevelBlock[]) || [],
    };
  }

  async saveEntryChunk(
    entryId: string,
    chunkId: string,
    blocks: TopLevelBlock[],
    expectedVersion?: number,
    _subject?: string
  ): Promise<
    | { conflict: true; currentVersion: number }
    | {
        success: true;
        chunkId: string;
        version: number;
        weight: number;
        stats?: EntryStats;
        manifest: EntryManifest;
      }
  > {
    await this.init();
    const entry = await this.prisma.entry.findUnique({
      where: { id: entryId },
    });
    if (!entry || entry.deletedAt) {
      throw new Error(`Entry "${entryId}" not found`);
    }

    if (expectedVersion !== undefined && entry.version !== expectedVersion) {
      return { conflict: true, currentVersion: entry.version };
    }

    const currentManifest = await this.getEntryManifest(entryId);
    if (!currentManifest) {
      throw new Error(`Failed to load manifest for entry "${entryId}"`);
    }

    // Load existing chunks for this entry
    const existingChunks = await this.prisma.chunk.findMany({
      where: { entryId },
      orderBy: { order: 'asc' },
    });

    const chunkMap = new Map<string, TopLevelBlock[]>();
    for (const c of existingChunks) {
      chunkMap.set(c.id, c.payload as any as TopLevelBlock[]);
    }

    // Replace the target chunk
    chunkMap.set(chunkId, blocks);

    // Flatten all blocks
    const allBlocks: TopLevelBlock[] = [];
    for (const cMeta of currentManifest.chunks) {
      const bList = chunkMap.get(cMeta.id) || [];
      allBlocks.push(...bList);
    }
    if (!chunkMap.has(chunkId)) {
      allBlocks.push(...blocks);
    }

    const weight = calculateWeight(allBlocks);
    const stats = calculateEntryStats(allBlocks);

    const { manifest, chunks } = splitBlocksIntoChunks(allBlocks, {
      entryId,
      version: entry.version + 1,
      existingChunks: currentManifest.chunks,
    });

    try {
      const { nextVersion } = await hotPathSaveChunkedEntry(this.prisma, {
        entryId,
        expectedVersion,
        manifest,
        chunks,
        weight,
        stats,
      });

      return {
        success: true,
        chunkId,
        version: nextVersion,
        weight,
        stats,
        manifest,
      };
    } catch (err: any) {
      if (err instanceof ConcurrencyConflictError || err.statusCode === 409) {
        const fresh = await this.prisma.entry.findUnique({ where: { id: entryId } });
        return { conflict: true, currentVersion: fresh?.version ?? entry.version };
      }
      throw err;
    }
  }

  async getEntry(id: string, _subject?: string): Promise<EntryRecord | null> {
    await this.init();
    const entry = await this.prisma.entry.findFirst({
      where: { id, deletedAt: null },
      include: {
        chunks: { orderBy: { order: 'asc' } },
        manifest: true,
      },
    });

    if (!entry) return null;

    const doc = reassembleDocFromChunks(
      entry.chunks.map((c) => ({ blocks: (c.payload as any as TopLevelBlock[]) || [] }))
    );

    // Update lastOpenedAt
    await this.prisma.entry.update({
      where: { id },
      data: { lastOpenedAt: new Date() },
    }).catch(() => {});

    return {
      id: entry.id,
      categoryId: entry.categoryId,
      title: entry.title,
      sortOrder: entry.sortOrder,
      color: entry.color,
      pinned: entry.pinned,
      spine: (entry.spine as any as SpineStyle) ?? null,
      stats: (entry.stats as any as EntryStats) ?? { words: 0, images: 0 },
      weight: entry.weight,
      version: entry.version,
      doc,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      deletedAt: null,
      lastOpenedAt: new Date().toISOString(),
    };
  }

  async createEntry(
    categoryId: string,
    title = 'Untitled',
    color?: string,
    pinned = false,
    spine?: SpineStyle,
    docInput?: DocumentEnvelope,
    _subject?: string
  ): Promise<EntryRecord> {
    await this.init();
    const entryId = `entry_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const cleanTitle = title.trim() || 'Untitled';

    const doc = docInput
      ? (docInput.schemaVersion === 2 ? docInput : migrateDocumentToV2(docInput).doc)
      : createEmptyDocument();
    const blocks: TopLevelBlock[] = (doc.doc?.content as any as TopLevelBlock[]) || [];
    const weight = calculateWeight(blocks);
    const stats = calculateEntryStats(blocks);

    const existingCount = await this.prisma.entry.count({
      where: { categoryId, deletedAt: null },
    });

    const entry = await this.prisma.entry.create({
      data: {
        id: entryId,
        categoryId,
        title: cleanTitle,
        sortOrder: existingCount,
        color: color || null,
        pinned,
        spine: (spine as any) || undefined,
        stats: stats as any,
        weight,
        version: 1,
        schemaVersion: 2,
        lastOpenedAt: new Date(),
      },
    });

    const { manifest, chunks } = splitBlocksIntoChunks(blocks, {
      entryId,
      version: 1,
    });

    await hotPathSaveChunkedEntry(this.prisma, {
      entryId,
      expectedVersion: 1,
      manifest,
      chunks,
      weight,
      stats,
    });

    return {
      id: entry.id,
      categoryId: entry.categoryId,
      title: entry.title,
      sortOrder: entry.sortOrder,
      color: entry.color,
      pinned: entry.pinned,
      spine: (entry.spine as any as SpineStyle) ?? null,
      stats,
      weight: entry.weight,
      version: 1,
      doc,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      deletedAt: null,
      lastOpenedAt: entry.lastOpenedAt ? entry.lastOpenedAt.toISOString() : null,
    };
  }

  async updateEntry(
    id: string,
    updates: {
      title?: string;
      categoryId?: string;
      color?: string | null;
      pinned?: boolean;
      sortOrder?: number;
      spine?: SpineStyle | null;
    },
    expectedVersion?: number,
    _subject?: string
  ): Promise<EntryRecord | null> {
    await this.init();

    if (expectedVersion !== undefined) {
      await hotPathVersionCheckedUpdateEntry(this.prisma, {
        id,
        version: expectedVersion,
        ...updates,
      });
    } else {
      await this.prisma.entry.update({
        where: { id },
        data: {
          title: updates.title !== undefined ? updates.title.trim() : undefined,
          categoryId: updates.categoryId,
          color: updates.color,
          pinned: updates.pinned,
          sortOrder: updates.sortOrder,
          spine: updates.spine ? (updates.spine as any) : undefined,
          version: { increment: 1 },
        },
      });
    }

    return await this.getEntry(id);
  }

  async saveEntryDoc(
    id: string,
    doc: DocumentEnvelope,
    expectedVersion?: number,
    title?: string,
    _subject?: string
  ): Promise<{ conflict: true; currentVersion: number } | { entry: EntryRecord; saved: boolean }> {
    await this.init();
    const entry = await this.prisma.entry.findUnique({ where: { id } });
    if (!entry || entry.deletedAt) {
      throw new Error('Entry not found');
    }

    if (expectedVersion !== undefined && entry.version !== expectedVersion) {
      return { conflict: true, currentVersion: entry.version };
    }

    const v2Doc = doc.schemaVersion === 2 ? doc : migrateDocumentToV2(doc).doc;
    const blocks: TopLevelBlock[] = (v2Doc.doc?.content as any as TopLevelBlock[]) || [];
    const weight = calculateWeight(blocks);
    const stats = calculateEntryStats(blocks);

    const currentManifest = await this.getEntryManifest(id);
    const { manifest, chunks } = splitBlocksIntoChunks(blocks, {
      entryId: id,
      version: (expectedVersion ?? entry.version) + 1,
      existingChunks: currentManifest?.chunks,
    });

    try {
      await hotPathSaveChunkedEntry(this.prisma, {
        entryId: id,
        expectedVersion,
        manifest,
        chunks,
        weight,
        stats,
      });

      if (title !== undefined && title.trim()) {
        await this.prisma.entry.update({
          where: { id },
          data: { title: title.trim() },
        });
      }

      const freshEntry = await this.getEntry(id);
      return { entry: freshEntry!, saved: true };
    } catch (err: any) {
      if (err instanceof ConcurrencyConflictError || err.statusCode === 409) {
        const fresh = await this.prisma.entry.findUnique({ where: { id } });
        return { conflict: true, currentVersion: fresh?.version ?? entry.version };
      }
      throw err;
    }
  }

  async deleteEntry(id: string, _subject?: string): Promise<boolean> {
    await this.init();
    const entry = await this.prisma.entry.findFirst({
      where: { id, deletedAt: null },
    });
    if (!entry) return false;

    await this.prisma.entry.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return true;
  }

  async restoreEntry(id: string, _subject?: string): Promise<EntryRecord | null> {
    await this.init();
    const entry = await this.prisma.entry.findFirst({
      where: { id, deletedAt: { not: null } },
    });
    if (!entry) return null;

    await this.prisma.entry.update({
      where: { id },
      data: { deletedAt: null },
    });
    return await this.getEntry(id);
  }
}
