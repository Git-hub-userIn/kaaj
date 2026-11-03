import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { forUser, type ScopedPrismaClient } from '../db/client.js';

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
  userId?: string;
}

export const MAX_USER_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MB quota per user

export interface ScopedAssetStore {
  put(buffer: Buffer, mime: string, originalName?: string): Promise<{ asset: AssetRecord; thumb320: Buffer; thumb960: Buffer }>;
  get(storageKey: string): Promise<Buffer | null>;
  getThumb(id: string, size: '320' | '960'): Promise<Buffer | null>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  getRecord(id: string): Promise<AssetRecord | null>;
  getAllRecords(): Promise<AssetRecord[]>;
}

export class LocalDiskAssetStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private getUserVaultDir(userId: string): string {
    const parentDir = path.basename(this.baseDir) === 'storage' ? path.dirname(this.baseDir) : this.baseDir;
    return path.join(parentDir, 'vault', userId);
  }

  private getUserThumbsDir(userId: string): string {
    return path.join(this.getUserVaultDir(userId), 'thumbs');
  }

  async initUserVault(userId: string): Promise<void> {
    await fs.mkdir(this.getUserVaultDir(userId), { recursive: true });
    await fs.mkdir(this.getUserThumbsDir(userId), { recursive: true });
  }

  forUser(userId: string, prismaOverride?: ScopedPrismaClient): ScopedAssetStore {
    const prisma = prismaOverride || forUser(userId);
    const userVaultDir = this.getUserVaultDir(userId);
    const userThumbsDir = this.getUserThumbsDir(userId);

    return {
      put: async (buffer: Buffer, mime: string, originalName?: string) => {
        await this.initUserVault(userId);

        // Verify magic bytes
        const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
        const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
        const isWebp = buffer.toString('utf8', 8, 12) === 'WEBP';
        const isGif = buffer.toString('utf8', 0, 3) === 'GIF';

        if (!isPng && !isJpeg && !isWebp && !isGif) {
          throw new Error('Unsupported image format. Allowed formats: JPEG, PNG, WebP, GIF.');
        }

        // Check user quota (500 MB)
        const aggregate = await prisma.assetMeta.aggregate({
          _sum: { bytes: true },
          where: { userId },
        });
        const currentBytes = aggregate._sum.bytes || 0;
        if (currentBytes + buffer.length > MAX_USER_STORAGE_BYTES) {
          const err: any = new Error('Upload quota exceeded (500 MB limit).');
          err.statusCode = 413;
          throw err;
        }

        const id = `asset_${crypto.randomUUID()}`;
        const ext = isPng ? 'png' : isJpeg ? 'jpg' : isWebp ? 'webp' : 'gif';
        const storageKey = `${id}.${ext}`;
        const filePath = path.join(userVaultDir, storageKey);

        const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
        const metadata = await sharp(buffer).metadata();
        const cleanBuffer = await sharp(buffer).rotate().toBuffer(); // strip exif

        const thumb320 = await sharp(cleanBuffer).resize(320).webp({ quality: 80 }).toBuffer();
        const thumb960 = await sharp(cleanBuffer).resize(960).webp({ quality: 80 }).toBuffer();

        await fs.writeFile(filePath, cleanBuffer);
        await fs.writeFile(path.join(userThumbsDir, `${id}_320.webp`), thumb320);
        await fs.writeFile(path.join(userThumbsDir, `${id}_960.webp`), thumb960);

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
          userId,
        };

        await prisma.assetMeta.upsert({
          where: { id },
          create: {
            id: asset.id,
            userId,
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
      },

      get: async (storageKey: string): Promise<Buffer | null> => {
        try {
          // Ownership verification: ensure storageKey belongs to userId
          const meta = await prisma.assetMeta.findFirst({
            where: { storageKey, userId },
          });
          if (!meta) return null;

          const candidates = [
            path.join(userVaultDir, storageKey),
            path.join(this.baseDir, storageKey), // fallback legacy path
          ];
          for (const p of candidates) {
            if (fsSync.existsSync(p)) {
              return await fs.readFile(p);
            }
          }
          return null;
        } catch {
          return null;
        }
      },

      getThumb: async (id: string, size: '320' | '960'): Promise<Buffer | null> => {
        try {
          // Ownership verification: ensure id belongs to userId
          let hasAccess = false;
          let storageKey = '';
          const record = await prisma.assetMeta.findFirst({
            where: { id, userId },
          });
          if (record) {
            hasAccess = true;
            storageKey = record.storageKey;
          } else {
            const cat = await prisma.category.findFirst({
              where: { coverAssetId: id, userId },
            });
            if (cat) {
              hasAccess = true;
              storageKey = `${id}.png`;
            }
          }
          if (!hasAccess) return null;

          const thumbPath = path.join(userThumbsDir, `${id}_${size}.webp`);
          const legacyThumbPath = path.join(this.baseDir, 'thumbs', `${id}_${size}.webp`);

          if (fsSync.existsSync(thumbPath)) {
            return await fs.readFile(thumbPath);
          }
          if (fsSync.existsSync(legacyThumbPath)) {
            return await fs.readFile(legacyThumbPath);
          }

          // On-demand generation if missing
          const orig = await this.forUser(userId, prisma).get(storageKey);
          if (!orig) return null;

          const targetWidth = size === '960' ? 960 : 320;
          const generated = await sharp(orig).resize(targetWidth).webp({ quality: 80 }).toBuffer();
          await fs.writeFile(thumbPath, generated).catch(() => {});
          return generated;
        } catch {
          return null;
        }
      },

      delete: async (storageKey: string): Promise<void> => {
        const filePath = path.join(userVaultDir, storageKey);
        await fs.unlink(filePath).catch(() => {});
        const assetId = path.basename(storageKey, path.extname(storageKey));
        await fs.unlink(path.join(userThumbsDir, `${assetId}_320.webp`)).catch(() => {});
        await fs.unlink(path.join(userThumbsDir, `${assetId}_960.webp`)).catch(() => {});
        await prisma.assetMeta.deleteMany({
          where: { storageKey, userId },
        }).catch(() => {});
      },

      exists: async (storageKey: string): Promise<boolean> => {
        const meta = await prisma.assetMeta.findFirst({
          where: { storageKey, userId },
        });
        if (!meta) return false;
        return fsSync.existsSync(path.join(userVaultDir, storageKey)) || fsSync.existsSync(path.join(this.baseDir, storageKey));
      },

      getRecord: async (id: string): Promise<AssetRecord | null> => {
        const meta = await prisma.assetMeta.findFirst({
          where: { id, userId },
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
            userId: meta.userId,
          };
        }
        const cat = await prisma.category.findFirst({
          where: { coverAssetId: id, userId },
        });
        if (cat) {
          const candidates = [`${id}.png`, `${id}.jpg`, `${id}.webp`, id];
          for (const cand of candidates) {
            const p = path.join(userVaultDir, cand);
            const leg = path.join(this.baseDir, cand);
            const foundPath = fsSync.existsSync(p) ? p : (fsSync.existsSync(leg) ? leg : null);
            if (foundPath) {
              const stat = await fs.stat(foundPath).catch(() => null);
              return {
                id,
                storageKey: cand,
                mime: 'image/png',
                bytes: stat?.size || 0,
                checksum: '',
                createdAt: new Date().toISOString(),
                userId,
              };
            }
          }
        }
        return null;
      },

      getAllRecords: async (): Promise<AssetRecord[]> => {
        const metas = await prisma.assetMeta.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        });
        return metas.map((meta: any) => ({
          id: meta.id,
          storageKey: meta.storageKey,
          mime: meta.mime,
          bytes: meta.bytes,
          width: meta.width ?? undefined,
          height: meta.height ?? undefined,
          originalName: meta.originalName ?? undefined,
          checksum: meta.checksum,
          createdAt: meta.createdAt.toISOString(),
          userId: meta.userId,
        }));
      },
    };
  }

  // Backwards-compatible methods defaulting to 'dev-owner-user'
  async put(buffer: Buffer, mime: string, originalName?: string) {
    return this.forUser('dev-owner-user').put(buffer, mime, originalName);
  }

  async get(storageKey: string) {
    return this.forUser('dev-owner-user').get(storageKey);
  }

  async getThumb(id: string, size: '320' | '960') {
    return this.forUser('dev-owner-user').getThumb(id, size);
  }

  async getRecord(id: string) {
    return this.forUser('dev-owner-user').getRecord(id);
  }

  async getAllRecords() {
    return this.forUser('dev-owner-user').getAllRecords();
  }

  async init(): Promise<void> {
    await this.initUserVault('dev-owner-user');
  }
}
