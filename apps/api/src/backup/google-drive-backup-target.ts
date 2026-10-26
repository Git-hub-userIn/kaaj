import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BackupTarget, BackupFileRecord } from './backup-target.js';

export interface GoogleDriveConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  tokenFilePath: string; // Stored server-side, gitignored
  folderName?: string; // Default: 'Kaaj'
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
  const res = await fetch('https://oauth2.googleapis.com/token', {
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

export class GoogleDriveBackupTarget implements BackupTarget {
  readonly name = 'google-drive';
  private config: GoogleDriveConfig;
  private rootFolderId: string | null = null;
  private folderCache: Map<string, string> = new Map(); // path -> folderId

  constructor(config: GoogleDriveConfig) {
    this.config = {
      folderName: 'Kaaj',
      ...config,
    };
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

    const res = await fetch('https://oauth2.googleapis.com/token', {
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
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        parentId = searchData.files[0].id;
      } else {
        // Create folder
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
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
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      this.rootFolderId = searchData.files[0].id;
      return this.rootFolderId!;
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
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

  async put(relativePath: string, data: Buffer | Uint8Array, mimeType = 'application/octet-stream'): Promise<BackupFileRecord> {
    const accessToken = await this.getAccessToken();
    const cleanRel = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const folderPath = path.dirname(cleanRel);
    const fileName = path.basename(cleanRel);
    const parentFolderId = await this.ensureFolder(folderPath === '.' ? '' : folderPath);

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // Check if file already exists in target folder
    const q = `name = '${fileName}' and '${parentFolderId}' in parents and trashed = false`;
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const searchData = await searchRes.json();
    const existingFileId = searchData.files?.[0]?.id;

    // Resumable upload for files > 5MB, multipart for smaller
    if (buffer.length > 5 * 1024 * 1024) {
      // Initiate resumable upload
      const initUrl = existingFileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=resumable`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
      const initMethod = existingFileId ? 'PATCH' : 'POST';

      const initRes = await fetch(initUrl, {
        method: initMethod,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(buffer.length),
        },
        body: JSON.stringify(existingFileId ? {} : { name: fileName, parents: [parentFolderId] }),
      });

      const uploadUrl = initRes.headers.get('Location');
      if (!uploadUrl) {
        throw new Error('Google Drive resumable upload failed to provide Location header.');
      }

      await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(buffer.length),
          'Content-Type': mimeType,
        },
        body: new Uint8Array(buffer),
      });
    } else {
      // Multipart upload
      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const metadata = existingFileId
        ? { mimeType }
        : { name: fileName, parents: [parentFolderId], mimeType };

      const multipartBody = Buffer.concat([
        Buffer.from(`${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`),
        Buffer.from(`${delimiter}Content-Type: ${mimeType}\r\n\r\n`),
        buffer,
        Buffer.from(closeDelimiter),
      ]);

      const uploadUrl = existingFileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
      const uploadMethod = existingFileId ? 'PATCH' : 'POST';

      const res = await fetch(uploadUrl, {
        method: uploadMethod,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: new Uint8Array(multipartBody),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Drive file upload failed (${res.status}): ${err}`);
      }
    }

    return {
      path: cleanRel,
      bytes: buffer.length,
      checksum,
      updatedAt: new Date().toISOString(),
    };
  }

  async get(relativePath: string): Promise<Buffer | null> {
    try {
      const accessToken = await this.getAccessToken();
      const cleanRel = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      const folderPath = path.dirname(cleanRel);
      const fileName = path.basename(cleanRel);
      const parentFolderId = await this.ensureFolder(folderPath === '.' ? '' : folderPath);

      const q = `name = '${fileName}' and '${parentFolderId}' in parents and trashed = false`;
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const searchData = await searchRes.json();
      const fileId = searchData.files?.[0]?.id;
      if (!fileId) return null;

      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;

      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch {
      return null;
    }
  }

  async list(prefix = ''): Promise<BackupFileRecord[]> {
    const accessToken = await this.getAccessToken();
    const cleanPrefix = prefix.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const folderId = await this.ensureFolder(cleanPrefix);

    const q = `'${folderId}' in parents and trashed = false`;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,md5Checksum,modifiedTime,mimeType)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const data = await res.json();
    const records: BackupFileRecord[] = [];

    for (const f of data.files || []) {
      if (f.mimeType !== 'application/vnd.google-apps.folder') {
        const filePath = cleanPrefix ? `${cleanPrefix}/${f.name}` : f.name;
        records.push({
          path: filePath,
          bytes: Number(f.size || 0),
          checksum: f.md5Checksum || '',
          updatedAt: f.modifiedTime || new Date().toISOString(),
        });
      }
    }

    return records;
  }
}
