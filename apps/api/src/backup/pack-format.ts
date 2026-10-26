import crypto from 'node:crypto';

export type BlobType = 'chunk' | 'manifest' | 'db' | 'asset' | 'asset_meta';

export interface PackBlobInput {
  hash: string;
  data: Buffer | Uint8Array;
  type: BlobType;
}

export interface PackBlobEntry {
  hash: string;
  offset: number;
  length: number;
  type: BlobType;
}

export interface PackFooter {
  version: 1;
  blobs: PackBlobEntry[];
}

export interface PackBuildResult {
  packId: string;
  buffer: Buffer;
  entries: PackBlobEntry[];
  totalBytes: number;
}

/**
 * Creates a self-contained restic-style pack file from multiple blobs.
 * Appends a JSON footer listing all blobs and a 4-byte big-endian footer length.
 */
export function createPack(blobs: PackBlobInput[]): PackBuildResult {
  const dataChunks: Buffer[] = [];
  const entries: PackBlobEntry[] = [];
  let currentOffset = 0;

  for (const b of blobs) {
    const buf = Buffer.isBuffer(b.data) ? b.data : Buffer.from(b.data);
    entries.push({
      hash: b.hash,
      offset: currentOffset,
      length: buf.length,
      type: b.type,
    });
    dataChunks.push(buf);
    currentOffset += buf.length;
  }

  const footer: PackFooter = {
    version: 1,
    blobs: entries,
  };

  const footerBuffer = Buffer.from(JSON.stringify(footer), 'utf8');
  const footerLenBuffer = Buffer.alloc(4);
  footerLenBuffer.writeUInt32BE(footerBuffer.length, 0);

  const fullPackBuffer = Buffer.concat([...dataChunks, footerBuffer, footerLenBuffer]);
  const packId = crypto.createHash('sha256').update(fullPackBuffer).digest('hex');

  return {
    packId,
    buffer: fullPackBuffer,
    entries,
    totalBytes: fullPackBuffer.length,
  };
}

/**
 * Reads and parses the footer of a pack file buffer.
 */
export function readPackFooter(packBuffer: Buffer): PackFooter {
  if (packBuffer.length < 4) {
    throw new Error('Invalid pack file: size is less than minimum 4 bytes.');
  }

  const footerLength = packBuffer.readUInt32BE(packBuffer.length - 4);
  const footerStart = packBuffer.length - 4 - footerLength;

  if (footerStart < 0) {
    throw new Error(`Corrupted pack file: footer length (${footerLength}) exceeds pack size.`);
  }

  const footerJsonRaw = packBuffer.subarray(footerStart, footerStart + footerLength).toString('utf8');
  const footer: PackFooter = JSON.parse(footerJsonRaw);

  if (!footer || !Array.isArray(footer.blobs)) {
    throw new Error('Corrupted pack file: footer does not contain a valid blobs array.');
  }

  return footer;
}

/**
 * Extracts a specific blob from a pack buffer and verifies its SHA-256 hash.
 */
export function extractBlobFromPack(
  packBuffer: Buffer,
  offset: number,
  length: number,
  expectedHash?: string
): Buffer {
  if (offset + length > packBuffer.length) {
    throw new Error(
      `Blob bounds out of range: offset ${offset} + length ${length} exceeds pack size ${packBuffer.length}.`
    );
  }

  const blobData = packBuffer.subarray(offset, offset + length);

  if (expectedHash) {
    const actualHash = crypto.createHash('sha256').update(blobData).digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error(
        `Blob checksum mismatch: expected ${expectedHash}, received ${actualHash}.`
      );
    }
  }

  return Buffer.from(blobData);
}
