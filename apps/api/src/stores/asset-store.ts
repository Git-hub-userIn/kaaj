import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import type { PrismaClient } from '../generated/client/index.js';
import { prisma as defaultPrisma } from '../db/client.js';

export interface AssetRecord {
  id: string;
  storageKey: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  originalName?: string;
  checksum: string;
  createdAt: string;
}

export interface AssetStore {
  put(buffer: Buffer, mime: string, originalName?: string): Promise<{ asset: AssetRecord; thumb320: Buffer; thumb960: Buffer }>;
  get(storageKey: string): Promise<Buffer | null>;
  getThumb(id: string, size: '320' | '960'): Promise<Buffer | null>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  getRecord(id: string): Promise<AssetRecord | null>;
  getAllRecords(): Promise<AssetRecord[]>;
}

export class LocalDiskAssetStore implements AssetStore {
  private baseDir: string;
  private thumbsDir: string;
  private prisma: PrismaClient;
  private initialized = false;

  constructor(baseDir: string, prismaClient?: PrismaClient) {
    this.baseDir = baseDir;
    this.thumbsDir = path.join(baseDir, 'thumbs');
    this.prisma = prismaClient || defaultPrisma;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.mkdir(this.thumbsDir, { recursive: true });
    this.initialized = true;
  }

  async put(buffer: Buffer, mime: string, originalName?: string): Promise<{ asset: AssetRecord; thumb320: Buffer; thumb960: Buffer }> {
    await this.init();

    // Verify magic bytes
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp = buffer.toString('utf8', 8, 12) === 'WEBP';
    const isGif = buffer.toString('utf8', 0, 3) === 'GIF';

    if (!isPng && !isJpeg && !isWebp && !isGif) {
      throw new Error('Unsupported image format. Allowed formats: JPEG, PNG, WebP, GIF.');
    }

    const id = `asset_${crypto.randomUUID()}`;
    const ext = isPng ? 'png' : isJpeg ? 'jpg' : isWebp ? 'webp' : 'gif';
    const storageKey = `${id}.${ext}`;
    const filePath = path.join(this.baseDir, storageKey);

    // Compute checksum
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // Extract image dimensions and strip EXIF using sharp
    const metadata = await sharp(buffer).metadata();
    const cleanBuffer = await sharp(buffer).rotate().toBuffer(); // strip exif and auto-orient

    // Generate WebP thumbnails (320px and 960px)
    const thumb320 = await sharp(cleanBuffer).resize(320).webp({ quality: 80 }).toBuffer();
    const thumb960 = await sharp(cleanBuffer).resize(960).webp({ quality: 80 }).toBuffer();

    // Write original and thumbnails to disk
    await fs.writeFile(filePath, cleanBuffer);
    await fs.writeFile(path.join(this.thumbsDir, `${id}_320.webp`), thumb320);
    await fs.writeFile(path.join(this.thumbsDir, `${id}_960.webp`), thumb960);

    const asset: AssetRecord = {
      id,
      storageKey,
      mime: isPng ? 'image/png' : isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/gif',
      bytes: cleanBuffer.length,
      width: metadata.width,
      height: metadata.height,
      originalName,
      checksum,
      createdAt: new Date().toISOString(),
    };

    // Store metadata in PostgreSQL
    await this.prisma.assetMeta.upsert({
      where: { id },
      create: {
        id: asset.id,
        storageKey: asset.storageKey,
        mime: asset.mime,
        bytes: asset.bytes,
        width: asset.width ?? null,
        height: asset.height ?? null,
        originalName: asset.originalName ?? null,
        checksum: asset.checksum,
        createdAt: new Date(asset.createdAt),
      },
      update: {
        storageKey: asset.storageKey,
        mime: asset.mime,
        bytes: asset.bytes,
        width: asset.width ?? null,
        height: asset.height ?? null,
        originalName: asset.originalName ?? null,
        checksum: asset.checksum,
      },
    });

    return { asset, thumb320, thumb960 };
  }

  async get(storageKey: string): Promise<Buffer | null> {
    try {
      const filePath = path.join(this.baseDir, storageKey);
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async getThumb(id: string, size: '320' | '960'): Promise<Buffer | null> {
    try {
      const filePath = path.join(this.thumbsDir, `${id}_${size}.webp`);
      try {
        return await fs.readFile(filePath);
      } catch {
        // On-demand generation if thumbnail is missing on disk
        const record = await this.getRecord(id);
        if (!record) return null;
        const orig = await this.get(record.storageKey);
        if (!orig) return null;
        const targetWidth = size === '960' ? 960 : 320;
        const generated = await sharp(orig).resize(targetWidth).webp({ quality: 80 }).toBuffer();
        await fs.writeFile(filePath, generated).catch(() => {});
        return generated;
      }
    } catch {
      return null;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const filePath = path.join(this.baseDir, storageKey);
    await fs.unlink(filePath).catch(() => {});
    await this.prisma.assetMeta.deleteMany({
      where: { storageKey },
    }).catch(() => {});
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.baseDir, storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async getRecord(id: string): Promise<AssetRecord | null> {
    try {
      const meta = await this.prisma.assetMeta.findUnique({
        where: { id },
      });
      if (meta) {
        return {
          id: meta.id,
          storageKey: meta.storageKey,
          mime: meta.mime,
          bytes: meta.bytes,
          width: meta.width ?? undefined,
          height: meta.height ?? undefined,
          originalName: meta.originalName ?? undefined,
          checksum: meta.checksum,
          createdAt: meta.createdAt.toISOString(),
        };
      }
    } catch {
      // ignore db errors in fallback
    }

    for (const ext of ['png', 'jpg', 'webp', 'gif']) {
      const storageKey = `${id}.${ext}`;
      const filePath = path.join(this.baseDir, storageKey);
      try {
        if (fsSync.existsSync(filePath)) {
          const mime = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/gif';
          const stat = fsSync.statSync(filePath);
          return {
            id,
            storageKey,
            mime,
            bytes: stat.size,
            checksum: '',
            createdAt: stat.birthtime.toISOString(),
          };
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  async getAllRecords(): Promise<AssetRecord[]> {
    const metas = await this.prisma.assetMeta.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return metas.map((meta) => ({
      id: meta.id,
      storageKey: meta.storageKey,
      mime: meta.mime,
      bytes: meta.bytes,
      width: meta.width ?? undefined,
      height: meta.height ?? undefined,
      originalName: meta.originalName ?? undefined,
      checksum: meta.checksum,
      createdAt: meta.createdAt.toISOString(),
    }));
  }
}
