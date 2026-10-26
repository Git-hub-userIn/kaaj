import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

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
}

export class LocalDiskAssetStore implements AssetStore {
  private baseDir: string;
  private thumbsDir: string;
  private metaMap: Map<string, AssetRecord> = new Map();

  private metaFile: string;
  private initialized = false;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.thumbsDir = path.join(baseDir, 'thumbs');
    this.metaFile = path.join(baseDir, 'meta.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.mkdir(this.thumbsDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.metaFile, 'utf8');
      const records = JSON.parse(raw);
      if (Array.isArray(records)) {
        for (const record of records) {
          if (record && record.id) {
            this.metaMap.set(record.id, record);
          }
        }
      }
    } catch {
      // meta.json may not exist yet
    }
    this.initialized = true;
  }

  private async persistMeta(): Promise<void> {
    try {
      const records = Array.from(this.metaMap.values());
      const tmpPath = `${this.metaFile}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(records, null, 2), 'utf8');
      await fs.rename(tmpPath, this.metaFile);
    } catch (err) {
      console.warn('Failed to persist asset meta.json:', err);
    }
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

    this.metaMap.set(id, asset);
    await this.persistMeta();
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
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const filePath = path.join(this.baseDir, storageKey);
    await fs.unlink(filePath).catch(() => {});
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.baseDir, storageKey));
      return true;
    } catch {
      return false;
    }
  }

  getRecord(id: string): AssetRecord | undefined {
    const existing = this.metaMap.get(id);
    if (existing) return existing;

    for (const ext of ['png', 'jpg', 'webp', 'gif']) {
      const storageKey = `${id}.${ext}`;
      const filePath = path.join(this.baseDir, storageKey);
      try {
        if (fsSync.existsSync(filePath)) {
          const mime = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/gif';
          const stat = fsSync.statSync(filePath);
          const recovered: AssetRecord = {
            id,
            storageKey,
            mime,
            bytes: stat.size,
            checksum: '',
            createdAt: stat.birthtime.toISOString(),
          };
          this.metaMap.set(id, recovered);
          return recovered;
        }
      } catch {
        // ignore
      }
    }
    return undefined;
  }
}
