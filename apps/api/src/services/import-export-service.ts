import JSZip from 'jszip';
import path from 'node:path';
import crypto from 'node:crypto';
import { forUser, type ScopedPrismaClient } from '../db/client.js';
import {
  splitBlocksIntoChunks,
  reassembleDocFromChunks,
  type TopLevelBlock,
  type DocumentEnvelopeV2,
} from '@kaaj/doc-model';
import type { LocalDiskAssetStore } from '../stores/asset-store.js';

export class ImportExportService {
  private prisma: ScopedPrismaClient;
  private userId: string;
  private assetStore: ReturnType<LocalDiskAssetStore['forUser']>;

  constructor(userId: string, assetStore: LocalDiskAssetStore, prisma?: ScopedPrismaClient) {
    this.userId = userId;
    this.prisma = prisma || forUser(userId);
    this.assetStore = assetStore.forUser(userId);
  }

  /**
   * Convert Kaaj document blocks to standard Markdown text.
   */
  static docToMarkdown(doc: any): string {
    if (!doc || !Array.isArray(doc.content)) return '';
    const lines: string[] = [];

    for (const block of doc.content) {
      if (block.type === 'heading') {
        const level = block.attrs?.level || 1;
        const prefix = '#'.repeat(level);
        const text = (block.content || []).map((c: any) => c.text || '').join('');
        lines.push(`${prefix} ${text}\n`);
      } else if (block.type === 'paragraph') {
        const text = (block.content || []).map((c: any) => c.text || '').join('');
        lines.push(`${text}\n`);
      } else if (block.type === 'blockquote') {
        const text = (block.content || [])
          .map((p: any) => (p.content || []).map((c: any) => c.text || '').join(''))
          .join('\n');
        lines.push(`> ${text}\n`);
      } else if (block.type === 'codeBlock') {
        const lang = block.attrs?.language || '';
        const code = (block.content || []).map((c: any) => c.text || '').join('');
        lines.push(`\`\`\`${lang}\n${code}\n\`\`\`\n`);
      } else if (block.type === 'taskList') {
        for (const item of block.content || []) {
          const checked = item.attrs?.checked ? 'x' : ' ';
          const text = (item.content || [])
            .map((p: any) => (p.content || []).map((c: any) => c.text || '').join(''))
            .join(' ');
          lines.push(`- [${checked}] ${text}`);
        }
        lines.push('');
      } else if (block.type === 'bulletList') {
        for (const item of block.content || []) {
          const text = (item.content || [])
            .map((p: any) => (p.content || []).map((c: any) => c.text || '').join(''))
            .join(' ');
          lines.push(`- ${text}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n').trim();
  }

  /**
   * Convert Markdown text into Kaaj document envelope.
   */
  static markdownToDoc(markdown: string): DocumentEnvelopeV2 {
    const rawLines = markdown.split(/\r?\n/);
    const content: TopLevelBlock[] = [];
    let inCodeBlock = false;
    let codeBuffer: string[] = [];
    let codeLang = '';

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];

      // Handle Code Block fence
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLang = line.slice(3).trim();
          codeBuffer = [];
        } else {
          inCodeBlock = false;
          content.push({
            type: 'codeBlock',
            attrs: { language: codeLang || null, id: null },
            content: [{ type: 'text', text: codeBuffer.join('\n') }],
          });
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      // Headings
      if (trimmed.startsWith('#')) {
        const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (match) {
          const level = Math.min(3, Math.max(1, match[1].length)) as 1 | 2 | 3;
          content.push({
            type: 'heading',
            attrs: { level, id: null, textAlign: 'left' },
            content: [{ type: 'text', text: match[2] }],
          });
          continue;
        }
      }

      // Blockquotes
      if (trimmed.startsWith('>')) {
        const text = trimmed.replace(/^>\s*/, '');
        content.push({
          type: 'blockquote',
          attrs: { id: null },
          content: [
            {
              type: 'paragraph',
              attrs: { id: null, textAlign: 'left' },
              content: [{ type: 'text', text }],
            },
          ],
        });
        continue;
      }

      // Task List items
      if (trimmed.startsWith('- [ ] ') || trimmed.startsWith('- [x] ')) {
        const checked = trimmed.startsWith('- [x] ');
        const text = trimmed.slice(6);
        content.push({
          type: 'taskList',
          attrs: { id: null },
          content: [
            {
              type: 'taskItem',
              attrs: { checked, id: null },
              content: [
                {
                  type: 'paragraph',
                  attrs: { id: null, textAlign: 'left' },
                  content: [{ type: 'text', text }],
                },
              ],
            },
          ],
        });
        continue;
      }

      // Standard Paragraph
      content.push({
        type: 'paragraph',
        attrs: { id: null, textAlign: 'left' },
        content: [{ type: 'text', text: trimmed }],
      });
    }

    if (content.length === 0) {
      content.push({
        type: 'paragraph',
        attrs: { id: null, textAlign: 'left' },
        content: [{ type: 'text', text: '' }],
      });
    }

    return {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content,
      },
    };
  }

  /**
   * Parse YAML frontmatter from raw markdown.
   */
  static parseFrontmatter(raw: string): { metadata: Record<string, any>; body: string } {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('---')) {
      return { metadata: {}, body: raw };
    }

    const secondIndex = trimmed.indexOf('\n---', 3);
    if (secondIndex === -1) {
      return { metadata: {}, body: raw };
    }

    const yamlBlock = trimmed.slice(3, secondIndex).trim();
    const body = trimmed.slice(secondIndex + 4).trim();
    const metadata: Record<string, any> = {};

    for (const line of yamlBlock.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        let val = line.slice(colonIdx + 1).trim();
        // Strip quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        metadata[key] = val;
      }
    }

    return { metadata, body };
  }

  /**
   * Export single entry as Markdown with YAML frontmatter.
   */
  async exportEntryMarkdown(entryId: string): Promise<string | null> {
    const entry = await this.prisma.entry.findFirst({
      where: { id: entryId, deletedAt: null },
    });
    if (!entry) return null;

    const chunks = await this.prisma.chunk.findMany({
      where: { entryId },
      orderBy: { order: 'asc' },
    });

    const reassembled = reassembleDocFromChunks(
      chunks.map((c: any) => ({ blocks: c.payload as TopLevelBlock[] }))
    );

    const tags = await this.prisma.entryTag.findMany({
      where: { entryId },
      include: { tag: true },
    });
    const tagNames = tags.map((t) => t.tag.name);

    const markdownBody = ImportExportService.docToMarkdown(reassembled.doc);

    const frontmatter = [
      '---',
      `title: "${entry.title}"`,
      `entryId: "${entry.id}"`,
      `categoryId: "${entry.categoryId}"`,
      `version: ${entry.version}`,
      `tags: [${tagNames.map((t) => `"${t}"`).join(', ')}]`,
      `createdAt: "${entry.createdAt.toISOString()}"`,
      `updatedAt: "${entry.updatedAt.toISOString()}"`,
      '---',
      '',
      markdownBody,
    ].join('\n');

    return frontmatter;
  }

  /**
   * Export all user data as structured ZIP archive.
   */
  async exportZip(): Promise<Buffer> {
    const zip = new JSZip();

    // 1. Fetch categories
    const categories = await this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    zip.file('categories.json', JSON.stringify(categories, null, 2));

    // 2. Fetch entries, chunks, tags
    const entries = await this.prisma.entry.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });

    const entriesFolder = zip.folder('entries');
    const mdFolder = zip.folder('markdown');

    for (const entry of entries) {
      const chunks = await this.prisma.chunk.findMany({
        where: { entryId: entry.id },
        orderBy: { order: 'asc' },
      });

      const reassembled = reassembleDocFromChunks(
        chunks.map((c: any) => ({ blocks: c.payload as TopLevelBlock[] }))
      );

      const tags = await this.prisma.entryTag.findMany({
        where: { entryId: entry.id },
        include: { tag: true },
      });

      const entryPayload = {
        entry: {
          id: entry.id,
          categoryId: entry.categoryId,
          title: entry.title,
          color: entry.color,
          pinned: entry.pinned,
          sortOrder: entry.sortOrder,
          version: entry.version,
          createdAt: entry.createdAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString(),
        },
        doc: reassembled.doc,
        tags: tags.map((t) => t.tag.name),
      };

      entriesFolder?.file(`${entry.id}.json`, JSON.stringify(entryPayload, null, 2));

      // Markdown file with YAML frontmatter
      const mdContent = await this.exportEntryMarkdown(entry.id);
      if (mdContent) {
        mdFolder?.file(`${entry.id}.md`, mdContent);
      }
    }

    // 3. Attachments
    const attachmentsFolder = zip.folder('attachments');
    const assets = await this.prisma.assetMeta.findMany({
      where: { userId: this.userId },
    });

    for (const asset of assets) {
      const data = await this.assetStore.get(asset.storageKey);
      if (data) {
        const ext = asset.mime.includes('png')
          ? 'png'
          : asset.mime.includes('webp')
          ? 'webp'
          : 'jpg';
        attachmentsFolder?.file(`${asset.id}.${ext}`, data);
      }
    }

    // 4. Manifest
    const manifest = {
      version: 1,
      userId: this.userId,
      exportedAt: new Date().toISOString(),
      categoryCount: categories.length,
      entryCount: entries.length,
      assetCount: assets.length,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return zipBuffer;
  }

  /**
   * Import data from ZIP archive into user's vault.
   */
  async importZip(zipBuffer: Buffer): Promise<{
    categoriesImported: number;
    entriesImported: number;
    assetsImported: number;
  }> {
    const MAX_ZIP_BYTES = 50 * 1024 * 1024; // 50 MB
    if (zipBuffer.length > MAX_ZIP_BYTES) {
      const err: any = new Error('Archive exceeds maximum allowed size of 50 MB.');
      err.statusCode = 413;
      throw err;
    }

    const zip = await JSZip.loadAsync(zipBuffer);

    // Zip-slip protection: reject any path containing traversal patterns or absolute targets
    for (const relativePath of Object.keys(zip.files)) {
      const normalized = path.normalize(relativePath).replace(/\\/g, '/');
      if (
        normalized.startsWith('../') ||
        normalized.includes('/../') ||
        normalized.startsWith('/') ||
        path.isAbsolute(relativePath)
      ) {
        const err: any = new Error(`Malicious zip entry detected: ${relativePath}`);
        err.statusCode = 400;
        throw err;
      }
    }

    let categoriesImported = 0;
    let entriesImported = 0;
    let assetsImported = 0;

    const assetIdMap = new Map<string, string>();
    const categoryIdMap = new Map<string, string>();
    const entryIdMap = new Map<string, string>();

    // 1. Import Attachments first to build assetIdMap
    const attachmentsFolder = zip.folder('attachments');
    if (attachmentsFolder) {
      const files: any[] = [];
      attachmentsFolder.forEach((relativePath, file) => {
        if (!file.dir) files.push({ path: relativePath, file });
      });

      for (const item of files) {
        const buffer = await item.file.async('nodebuffer');
        const oldAssetId = path.basename(item.path, path.extname(item.path));
        const mime = item.path.endsWith('.png')
          ? 'image/png'
          : item.path.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';

        const { asset: newAsset } = await this.assetStore.put(buffer, mime, item.path);
        assetIdMap.set(oldAssetId, newAsset.id);
        assetsImported++;
      }
    }

    // 2. Import Categories and remap coverAssetId
    const catFile = zip.file('categories.json');
    if (catFile) {
      const catRaw = await catFile.async('string');
      const cats = JSON.parse(catRaw);
      for (const cat of cats) {
        const remappedCoverId = cat.coverAssetId
          ? assetIdMap.get(cat.coverAssetId) || cat.coverAssetId
          : null;
        const createdCat = await this.prisma.category.create({
          data: {
            userId: this.userId,
            title: cat.title,
            description: cat.description,
            color: cat.color,
            sortOrder: cat.sortOrder || 0,
            coverAssetId: remappedCoverId,
          },
        });
        categoryIdMap.set(cat.id, createdCat.id);
        categoriesImported++;
      }
    }

    // 3. Pre-scan entries to build entryIdMap for wikilink remapping
    const entriesFolder = zip.folder('entries');
    const rawEntryFiles: any[] = [];
    if (entriesFolder) {
      entriesFolder.forEach((relativePath, file) => {
        if (!file.dir && relativePath.endsWith('.json')) {
          rawEntryFiles.push(file);
        }
      });
    }

    const parsedEntries: any[] = [];
    for (const file of rawEntryFiles) {
      const raw = await file.async('string');
      const data = JSON.parse(raw);
      const newEntryId = `entry_${crypto.randomUUID()}`;
      if (data?.entry?.id) {
        entryIdMap.set(data.entry.id, newEntryId);
      }
      parsedEntries.push({ data, newEntryId });
    }

    // Helper to remap IDs inside document blocks (wikilinks, asset refs)
    const remapDocContent = (blocks: TopLevelBlock[]): TopLevelBlock[] => {
      let jsonStr = JSON.stringify(blocks);

      // Remap asset IDs
      for (const [oldAssetId, newAssetId] of assetIdMap.entries()) {
        jsonStr = jsonStr.replaceAll(oldAssetId, newAssetId);
      }

      // Remap entry IDs in wikilinks: [[oldEntryId]] -> [[newEntryId]]
      for (const [oldEntryId, newEntryId] of entryIdMap.entries()) {
        jsonStr = jsonStr.replaceAll(`[[${oldEntryId}]]`, `[[${newEntryId}]]`);
      }

      return JSON.parse(jsonStr);
    };

    // 4. Create Entries with remapped content
    for (const { data, newEntryId } of parsedEntries) {
      const { entry, doc, tags } = data;

      let targetCategoryId = categoryIdMap.get(entry.categoryId);
      if (!targetCategoryId) {
        const fallbackCat = await this.prisma.category.findFirst({
          where: { deletedAt: null },
        });
        if (fallbackCat) {
          targetCategoryId = fallbackCat.id;
        } else {
          const newCat = await this.prisma.category.create({
            data: {
              userId: this.userId,
              title: 'Imported Archive',
              color: '#6366f1',
            },
          });
          targetCategoryId = newCat.id;
        }
      }

      const rawBlocks = (doc?.content || []) as TopLevelBlock[];
      const remappedBlocks = remapDocContent(rawBlocks);
      const { manifest, chunks } = splitBlocksIntoChunks(remappedBlocks, {
        existingChunks: [],
        entryId: newEntryId,
        version: 1,
      });

      // Create Entry
      await this.prisma.entry.create({
        data: {
          id: newEntryId,
          userId: this.userId,
          categoryId: targetCategoryId,
          title: entry.title || 'Imported Entry',
          color: entry.color,
          pinned: entry.pinned || false,
          sortOrder: entry.sortOrder || 0,
          version: 1,
        },
      });

      // Write Chunks
      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        const meta = manifest.chunks[idx];
        await this.prisma.chunk.create({
          data: {
            id: chunk.chunkId,
            entryId: newEntryId,
            userId: this.userId,
            order: meta ? meta.order : idx,
            checksum: meta ? meta.checksum : '',
            bytes: meta ? meta.bytes : 0,
            blockCount: meta ? meta.blockCount : chunk.blocks.length,
            payload: chunk.blocks as any,
            version: 1,
          },
        });
      }

      // Write Manifest
      await this.prisma.entryManifest.create({
        data: {
          userId: this.userId,
          entryId: newEntryId,
          version: manifest.version,
          totalBlocks: manifest.totalBlocks,
          chunkCount: manifest.chunkCount,
          chunks: manifest.chunks as any,
          stats: manifest.stats as any,
        },
      });

      // Tags
      if (Array.isArray(tags)) {
        for (const tagName of tags) {
          const cleanName = tagName.trim().toLowerCase().replace(/^#/, '');
          if (!cleanName) continue;
          const tag = await this.prisma.tag.upsert({
            where: {
              userId_name: {
                userId: this.userId,
                name: cleanName,
              },
            },
            create: {
              userId: this.userId,
              name: cleanName,
            },
            update: {},
          });
          await this.prisma.entryTag.create({
            data: {
              userId: this.userId,
              entryId: newEntryId,
              tagId: tag.id,
            },
          });
        }
      }

      entriesImported++;
    }

    return {
      categoriesImported,
      entriesImported,
      assetsImported,
    };
  }

  /**
   * Import Markdown text with optional YAML frontmatter into a category.
   */
  async importMarkdown(
    categoryId: string,
    markdownRaw: string,
    filename?: string
  ): Promise<{ id: string; title: string }> {
    const { metadata, body } = ImportExportService.parseFrontmatter(markdownRaw);

    const title =
      metadata.title ||
      body.split('\n')[0].replace(/^#+\s*/, '').trim() ||
      (filename ? path.basename(filename, path.extname(filename)) : 'Imported Note');

    const envelope = ImportExportService.markdownToDoc(body);
    const entryId = `entry_${crypto.randomUUID()}`;

    const blocks = envelope.doc.content;
    const { manifest, chunks } = splitBlocksIntoChunks(blocks, {
      existingChunks: [],
      entryId,
      version: 1,
    });

    await this.prisma.entry.create({
      data: {
        id: entryId,
        userId: this.userId,
        categoryId,
        title,
        version: 1,
      },
    });

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      const meta = manifest.chunks[idx];
      await this.prisma.chunk.create({
        data: {
          id: chunk.chunkId,
          entryId,
          userId: this.userId,
          order: meta ? meta.order : idx,
          checksum: meta ? meta.checksum : '',
          bytes: meta ? meta.bytes : 0,
          blockCount: meta ? meta.blockCount : chunk.blocks.length,
          payload: chunk.blocks as any,
          version: 1,
        },
      });
    }

    await this.prisma.entryManifest.create({
      data: {
        userId: this.userId,
        entryId,
        version: manifest.version,
        totalBlocks: manifest.totalBlocks,
        chunkCount: manifest.chunkCount,
        chunks: manifest.chunks as any,
        stats: manifest.stats as any,
      },
    });

    // Handle tags in metadata (e.g. tags: [foo, bar] or tags: "foo, bar")
    let tagList: string[] = [];
    if (Array.isArray(metadata.tags)) {
      tagList = metadata.tags;
    } else if (typeof metadata.tags === 'string') {
      tagList = metadata.tags.split(',').map((t) => t.trim());
    }

    // Also scan for inline #tags
    const inlineTagMatches = Array.from(body.matchAll(/#([a-zA-Z0-9_\-]+)/g));
    for (const m of inlineTagMatches) {
      if (!tagList.includes(m[1])) {
        tagList.push(m[1]);
      }
    }

    for (const tagName of tagList) {
      const cleanName = tagName.trim().toLowerCase().replace(/^#/, '');
      if (!cleanName) continue;
      const tag = await this.prisma.tag.upsert({
        where: {
          userId_name: {
            userId: this.userId,
            name: cleanName,
          },
        },
        create: {
          userId: this.userId,
          name: cleanName,
        },
        update: {},
      });
      await this.prisma.entryTag.create({
        data: {
          userId: this.userId,
          entryId,
          tagId: tag.id,
        },
      });
    }

    return { id: entryId, title };
  }
}
