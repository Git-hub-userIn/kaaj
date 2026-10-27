import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BackupTarget, BackupFileRecord } from './backup-target.js';
import { fetchWithRetry } from './drive-retry.js';

export interface GoogleDriveConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  tokenFilePath: string; // Stored server-side, gitignored
  folderName?: string; // Default: 'Kaaj'
  cacheFilePath?: string; // Gitignored file-id cache (default: drive-file-cache.json)
}

export interface DriveCacheEntry {
  fileId: string;
  checksum: string;
  parentFolderId?: string;
}

export function generateGoogleAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ refreshToken: string; accessToken: string; expiresAt: number }> {
  const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token. Make sure prompt=consent was passed.');
  }
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

interface StoredTokens {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number; // epoch ms
  userEmail?: string;
}

export const DEFAULT_DRIVE_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB default chunk size
export const DRIVE_CHUNK_MULTIPLE = 256 * 1024; // 256 KiB multiple required by Drive API

export function getDriveUploadChunkSize(): number {
  const envVal = Number(process.env.DRIVE_UPLOAD_CHUNK_SIZE);
  if (envVal && !isNaN(envVal) && envVal > 0) {
    return Math.max(DRIVE_CHUNK_MULTIPLE, Math.floor(envVal / DRIVE_CHUNK_MULTIPLE) * DRIVE_CHUNK_MULTIPLE);
  }
  return DEFAULT_DRIVE_CHUNK_SIZE;
}

export class GoogleDriveBackupTarget implements BackupTarget {
  readonly name = 'google-drive';
  private config: GoogleDriveConfig;
  private rootFolderId: string | null = null;
  private folderCache: Map<string, string> = new Map(); // path -> folderId
  private driveFileCache: Map<string, DriveCacheEntry> = new Map(); // relPath -> DriveCacheEntry
  private cacheFilePath: string;

  constructor(config: GoogleDriveConfig) {
    this.config = {
      folderName: 'Kaaj',
      ...config,
    };
    this.cacheFilePath =
      config.cacheFilePath ||
      path.resolve(path.dirname(this.config.tokenFilePath), 'drive-file-cache.json');
    this.loadCacheSync();
  }

  /**
   * Loads Drive file-id cache synchronously during initialization.
   */
  private loadCacheSync(): void {
    try {
      if (fsSync.existsSync(this.cacheFilePath)) {
        const raw = fsSync.readFileSync(this.cacheFilePath, 'utf8');
        const data: Record<string, DriveCacheEntry> = JSON.parse(raw);
        for (const [key, val] of Object.entries(data)) {
          if (val && typeof val.fileId === 'string') {
            this.driveFileCache.set(key, val);
          }
        }
      }
    } catch {
      this.driveFileCache.clear();
    }
  }

  /**
   * Persists Drive file-id cache atomically to disk.
   */
  async saveCache(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
      const record: Record<string, DriveCacheEntry> = {};
      for (const [k, v] of this.driveFileCache.entries()) {
        record[k] = v;
      }
      const tmp = `${this.cacheFilePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
      await fs.rename(tmp, this.cacheFilePath);
    } catch (err: any) {
      console.warn('[Drive Target] Failed to save file cache to disk:', err.message || err);
    }
  }

  /**
   * Clears the in-memory and disk cache (used for cache loss verification).
   */
  async clearCache(): Promise<void> {
    this.driveFileCache.clear();
    try {
      if (fsSync.existsSync(this.cacheFilePath)) {
        await fs.unlink(this.cacheFilePath);
      }
    } catch {}
  }

  hasValidAuth(): boolean {
    try {
      if (!fsSync.existsSync(this.config.tokenFilePath)) return false;
      const raw = fsSync.readFileSync(this.config.tokenFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Boolean(parsed && parsed.refreshToken);
    } catch {
      return false;
    }
  }

  /**
   * Reads stored OAuth tokens from disk.
   */
  private async loadTokens(): Promise<StoredTokens | null> {
    try {
      if (!fsSync.existsSync(this.config.tokenFilePath)) return null;
      const raw = await fs.readFile(this.config.tokenFilePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Saves updated tokens to disk atomically. Never logs token contents.
   */
  async saveTokens(tokens: StoredTokens): Promise<void> {
    await fs.mkdir(path.dirname(this.config.tokenFilePath), { recursive: true });
    const tmp = `${this.config.tokenFilePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), 'utf8');
    await fs.rename(tmp, this.config.tokenFilePath);
  }

  /**
   * Obtains a valid access token, refreshing automatically if expired.
   */
  async getAccessToken(): Promise<string> {
    const tokens = await this.loadTokens();
    if (!tokens || !tokens.refreshToken) {
      throw new Error('Google Drive not authenticated. Please complete OAuth flow.');
    }

    const now = Date.now();
    if (tokens.accessToken && tokens.expiresAt && tokens.expiresAt > now + 60000) {
      return tokens.accessToken;
    }

    const clientId = this.config.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = this.config.clientSecret || process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables.');
    }

    const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Failed to refresh Google OAuth token (${res.status}): ${errText}`);
    }

    const data = await res.json();
    tokens.accessToken = data.access_token;
    tokens.expiresAt = now + (data.expires_in ?? 3600) * 1000;
    await this.saveTokens(tokens);

    if (!tokens.accessToken) {
      throw new Error('OAuth token refresh did not return access token.');
    }

    return tokens.accessToken;
  }

  /**
   * Resolves or creates root Kaaj folder and subfolders in Drive.
   */
  private async ensureFolder(folderPath: string): Promise<string> {
    const accessToken = await this.getAccessToken();
    const cleanPath = folderPath.replace(/^[/\\]+|[/\\]+$/g, '');
    if (!cleanPath) {
      return this.ensureRootFolder(accessToken);
    }

    if (this.folderCache.has(cleanPath)) {
      return this.folderCache.get(cleanPath)!;
    }

    const parts = cleanPath.split('/');
    let parentId = await this.ensureRootFolder(accessToken);
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (this.folderCache.has(currentPath)) {
        parentId = this.folderCache.get(currentPath)!;
        continue;
      }

      // Query for folder under parentId
      const q = `name = '${part}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const searchRes = await fetchWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        parentId = searchData.files[0].id;
      } else {
        // Create folder
        const createRes = await fetchWithRetry('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: part,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
          }),
        });
        const created = await createRes.json();
        parentId = created.id;
      }

      this.folderCache.set(currentPath, parentId);
    }

    return parentId;
  }

  private async ensureRootFolder(accessToken: string): Promise<string> {
    if (this.rootFolderId) return this.rootFolderId;

    const rootName = this.config.folderName || 'Kaaj';
    const q = `name = '${rootName}' and 'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchRes = await fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      this.rootFolderId = searchData.files[0].id;
      return this.rootFolderId!;
    }

    const createRes = await fetchWithRetry('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: rootName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['root'],
      }),
    });

    const created = await createRes.json();
    this.rootFolderId = created.id;
    return this.rootFolderId!;
  }

  /**
   * Fast check if a file already landed on Drive with matching checksum.
   */
  async has(relativePath: string, checksum: string): Promise<boolean> {
    const cleanRel = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const cached = this.driveFileCache.get(cleanRel);
    return Boolean(cached && cached.checksum === checksum);
  }

  async put(
    relativePath: string,
    data: Buffer | Uint8Array,
    mimeType = 'application/octet-stream'
  ): Promise<BackupFileRecord> {
    const accessToken = await this.getAccessToken();
    const cleanRel = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const folderPath = path.dirname(cleanRel);
    const fileName = path.basename(cleanRel);

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    let parentFolderId: string | undefined;
    let existingFileId: string | null = null;

    // 1. Check file-id cache first to skip exists-query
    const cached = this.driveFileCache.get(cleanRel);
    if (cached && cached.fileId) {
      existingFileId = cached.fileId;
      parentFolderId = cached.parentFolderId;
    }

    // Helper to upload either via resumable (>5MB) or multipart (<=5MB)
    const performUpload = async (
      targetFileId: string | null,
      parentId: string
    ): Promise<{ fileId: string; md5Checksum?: string; requestsCount: number }> => {
      if (buffer.length > 5 * 1024 * 1024) {
        // Resumable upload
        let requestsCount = 1; // 1 for initialization
        const initUrl = targetFileId
          ? `https://www.googleapis.com/upload/drive/v3/files/${targetFileId}?uploadType=resumable`
          : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
        const initMethod = targetFileId ? 'PATCH' : 'POST';

        const initRes = await fetchWithRetry(initUrl, {
          method: initMethod,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mimeType,
            'X-Upload-Content-Length': String(buffer.length),
          },
          body: JSON.stringify(targetFileId ? {} : { name: fileName, parents: [parentId] }),
        });

        if (targetFileId && initRes.status === 404) {
          throw new Error('DRIVE_FILE_NOT_FOUND_404');
        }

        const uploadUrl = initRes.headers.get('Location');
        if (!uploadUrl) {
          throw new Error('Google Drive resumable upload failed to provide Location header.');
        }

        const chunkSize = getDriveUploadChunkSize();
        let offset = 0;
        let finalFileId = targetFileId || '';
        let finalMd5: string | undefined = undefined;

        while (offset < buffer.length) {
          const end = Math.min(offset + chunkSize, buffer.length);
          const chunkSlice = buffer.subarray(offset, end);
          const isLast = end === buffer.length;

          requestsCount++;
          const uploadRes = await fetchWithRetry(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': String(chunkSlice.length),
              'Content-Range': `bytes ${offset}-${end - 1}/${buffer.length}`,
              'Content-Type': mimeType,
            },
            body: new Uint8Array(chunkSlice),
          });

          if (isLast) {
            const uploadJson = await uploadRes.json().catch(() => ({}));
            finalFileId = uploadJson.id || targetFileId || '';
            finalMd5 = uploadJson.md5Checksum;
            break;
          }
          offset = end;
        }

        return { fileId: finalFileId, md5Checksum: finalMd5, requestsCount };
      }

      // Multipart upload
      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const metadata = targetFileId
        ? { mimeType }
        : { name: fileName, parents: [parentId], mimeType };

      const multipartBody = Buffer.concat([
        Buffer.from(`${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`),
        Buffer.from(`${delimiter}Content-Type: ${mimeType}\r\n\r\n`),
        buffer,
        Buffer.from(closeDelimiter),
      ]);

      const uploadUrl = targetFileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${targetFileId}?uploadType=multipart`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
      const uploadMethod = targetFileId ? 'PATCH' : 'POST';

      const res = await fetchWithRetry(uploadUrl, {
        method: uploadMethod,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: new Uint8Array(multipartBody),
      });

      if (targetFileId && res.status === 404) {
        throw new Error('DRIVE_FILE_NOT_FOUND_404');
      }

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Drive file upload failed (${res.status}): ${err}`);
      }

      const resJson = await res.json().catch(() => ({}));
      return {
        fileId: resJson.id || targetFileId || '',
        md5Checksum: resJson.md5Checksum,
        requestsCount: 1,
      };
    };

    let uploadResult: { fileId: string; md5Checksum?: string; requestsCount: number } = {
      fileId: '',
      requestsCount: 0,
    };

    if (existingFileId) {
      try {
        // Fast path: use cached file-id directly
        uploadResult = await performUpload(existingFileId, parentFolderId || '');
      } catch (err: any) {
        if (err.message === 'DRIVE_FILE_NOT_FOUND_404') {
          // On 404 or mismatch: clear entry and re-query once
          this.driveFileCache.delete(cleanRel);
          existingFileId = null;
        } else {
          throw err;
        }
      }
    }

    if (!uploadResult.fileId) {
      // Slow path: resolve parent folder and query Drive
      if (!parentFolderId) {
        parentFolderId = await this.ensureFolder(folderPath === '.' ? '' : folderPath);
      }

      const q = `name = '${fileName}' and '${parentFolderId}' in parents and trashed = false`;
      const searchRes = await fetchWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const searchData = await searchRes.json();
      existingFileId = searchData.files?.[0]?.id || null;

      uploadResult = await performUpload(existingFileId, parentFolderId);
    }

    // Update cache with path/hash -> file id
    this.driveFileCache.set(cleanRel, {
      fileId: uploadResult.fileId,
      checksum,
      parentFolderId,
    });
    await this.saveCache();

    return {
      path: cleanRel,
      bytes: buffer.length,
      checksum,
      md5Checksum: uploadResult.md5Checksum,
      httpRequestsCount: uploadResult.requestsCount,
      updatedAt: new Date().toISOString(),
    };
  }

  async get(relativePath: string): Promise<Buffer | null> {
    try {
      const accessToken = await this.getAccessToken();
      const cleanRel = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      const folderPath = path.dirname(cleanRel);
      const fileName = path.basename(cleanRel);

      let fileId: string | null = null;
      const cached = this.driveFileCache.get(cleanRel);
      if (cached && cached.fileId) {
        fileId = cached.fileId;
      }

      if (fileId) {
        const res = await fetchWithRetry(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          return Buffer.from(arrayBuf);
        }
        if (res.status === 404) {
          this.driveFileCache.delete(cleanRel);
          fileId = null;
        }
      }

      // Fallback: search query once
      const parentFolderId = await this.ensureFolder(folderPath === '.' ? '' : folderPath);
      const q = `name = '${fileName}' and '${parentFolderId}' in parents and trashed = false`;
      const searchRes = await fetchWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const searchData = await searchRes.json();
      fileId = searchData.files?.[0]?.id || null;
      if (!fileId) return null;

      const res = await fetchWithRetry(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) return null;

      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const checksum = crypto.createHash('sha256').update(buf).digest('hex');
      this.driveFileCache.set(cleanRel, { fileId, checksum, parentFolderId });
      await this.saveCache();

      return buf;
    } catch {
      return null;
    }
  }

  async list(prefix = ''): Promise<BackupFileRecord[]> {
    const accessToken = await this.getAccessToken();
    const cleanPrefix = prefix.replace(/^[/\\]+/, '').replace(/\\/g, '/');

    // If prefix is empty, list packs, index, and snapshots
    if (!cleanPrefix) {
      const [packs, index, snapshots] = await Promise.all([
        this.list('packs'),
        this.list('index'),
        this.list('snapshots'),
      ]);
      return [...packs, ...index, ...snapshots];
    }

    const folderId = await this.ensureFolder(cleanPrefix);
    const records: BackupFileRecord[] = [];
    let pageToken: string | null = null;

    do {
      let url = `https://www.googleapis.com/drive/v3/files?pageSize=1000&fields=nextPageToken,files(id,name,size,md5Checksum,modifiedTime,mimeType)&q=${encodeURIComponent(
        `'${folderId}' in parents and trashed = false`
      )}`;
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      }

      const res = await fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      pageToken = data.nextPageToken || null;

      for (const f of data.files || []) {
        if (f.mimeType !== 'application/vnd.google-apps.folder') {
          const filePath = `${cleanPrefix}/${f.name}`;
          records.push({
            path: filePath,
            bytes: Number(f.size || 0),
            checksum: f.md5Checksum || '',
            updatedAt: f.modifiedTime || new Date().toISOString(),
          });
          // Cache the file ID for fast lookups
          this.driveFileCache.set(filePath, {
            fileId: f.id,
            checksum: f.md5Checksum || '',
            parentFolderId: folderId,
          });
        }
      }
    } while (pageToken);

    return records;
  }

  async delete(relativePath: string): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      const cleanRel = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      let fileId: string | null = null;

      const cached = this.driveFileCache.get(cleanRel);
      if (cached && cached.fileId) {
        fileId = cached.fileId;
      } else {
        const folderPath = path.dirname(cleanRel);
        const fileName = path.basename(cleanRel);
        const parentFolderId = await this.ensureFolder(folderPath === '.' ? '' : folderPath);
        const q = `name = '${fileName}' and '${parentFolderId}' in parents and trashed = false`;
        const searchRes = await fetchWithRetry(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const searchData = await searchRes.json();
        fileId = searchData.files?.[0]?.id || null;
      }

      if (fileId) {
        await fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        this.driveFileCache.delete(cleanRel);
        await this.saveCache();
      }
    } catch (err: any) {
      console.warn(`[Drive Target] Failed to delete file ${relativePath}:`, err.message || err);
    }
  }
}
