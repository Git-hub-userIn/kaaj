import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BackupTarget, BackupFileRecord } from './backup-target.js';

export class LocalFolderBackupTarget implements BackupTarget {
  readonly name = 'local-folder';
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async put(relativePath: string, data: Buffer | Uint8Array, _mimeType?: string): Promise<BackupFileRecord> {
    await this.init();
    const cleanRel = relativePath.replace(/^[/\\]+/, '');
    const fullPath = path.join(this.rootDir, cleanRel);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    const tmpPath = `${fullPath}.tmp`;
    await fs.writeFile(tmpPath, buffer);
    await fs.rename(tmpPath, fullPath);

    return {
      path: cleanRel.replace(/\\/g, '/'),
      bytes: buffer.length,
      checksum,
      updatedAt: new Date().toISOString(),
    };
  }

  async get(relativePath: string): Promise<Buffer | null> {
    const cleanRel = relativePath.replace(/^[/\\]+/, '');
    const fullPath = path.join(this.rootDir, cleanRel);
    try {
      return await fs.readFile(fullPath);
    } catch {
      return null;
    }
  }

  async list(prefix = ''): Promise<BackupFileRecord[]> {
    await this.init();
    const cleanPrefix = prefix.replace(/^[/\\]+/, '');
    const searchDir = cleanPrefix ? path.join(this.rootDir, cleanPrefix) : this.rootDir;

    const results: BackupFileRecord[] = [];

    const walk = async (dir: string) => {
      let entries: fsSync.Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(full);
        } else if (ent.isFile() && !ent.name.endsWith('.tmp')) {
          try {
            const stat = await fs.stat(full);
            const content = await fs.readFile(full);
            const checksum = crypto.createHash('sha256').update(content).digest('hex');
            const rel = path.relative(this.rootDir, full).replace(/\\/g, '/');
            results.push({
              path: rel,
              bytes: stat.size,
              checksum,
              updatedAt: stat.mtime.toISOString(),
            });
          } catch {
            // ignore read errors during walk
          }
        }
      }
    };

    await walk(searchDir);
    return results;
  }

  async exists(relativePath: string): Promise<boolean> {
    const cleanRel = relativePath.replace(/^[/\\]+/, '');
    const fullPath = path.join(this.rootDir, cleanRel);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async has(relativePath: string, checksum: string): Promise<boolean> {
    const cleanRel = relativePath.replace(/^[/\\]+/, '');
    const fullPath = path.join(this.rootDir, cleanRel);
    try {
      if (!fsSync.existsSync(fullPath)) return false;
      const buf = await fs.readFile(fullPath);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      return hash === checksum;
    } catch {
      return false;
    }
  }

  async delete(relativePath: string): Promise<void> {
    const cleanRel = relativePath.replace(/^[/\\]+/, '');
    const fullPath = path.join(this.rootDir, cleanRel);
    await fs.unlink(fullPath).catch(() => {});
  }
}
