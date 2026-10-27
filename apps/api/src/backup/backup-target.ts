export interface BackupFileRecord {
  path: string;
  bytes: number;
  checksum: string; // sha256 hex
  md5Checksum?: string;
  httpRequestsCount?: number;
  updatedAt: string;
}

export interface BackupTarget {
  readonly name: string;
  put(relativePath: string, data: Buffer | Uint8Array, mimeType?: string): Promise<BackupFileRecord>;
  get(relativePath: string): Promise<Buffer | null>;
  list(prefix?: string): Promise<BackupFileRecord[]>;
  delete?(relativePath: string): Promise<void>;
  exists?(relativePath: string): Promise<boolean>;
  has?(relativePath: string, checksum: string): Promise<boolean>;
}
