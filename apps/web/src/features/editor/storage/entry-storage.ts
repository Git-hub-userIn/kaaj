import {
  DocumentEnvelopeSchema,
  migrateDocumentToV2,
  type DocumentEnvelopeV2,
  type EntryStats,
  type EntryManifest,
  type ChunkPayload,
  type TopLevelBlock,
} from '@kaaj/doc-model';
import { API_BASE_URL, AUTH_TOKEN } from '../../../config/api.js';

const API_BASE = API_BASE_URL;

export interface LoadedEntry {
  id: string;
  categoryId: string;
  title: string;
  version: number;
  weight: number;
  doc: DocumentEnvelopeV2;
  stats?: EntryStats;
  updatedAt?: string;
}

export interface SaveResult {
  id: string;
  version: number;
  weight: number;
  stats?: EntryStats;
  title?: string;
  saved: boolean;
  conflict?: boolean;
  currentVersion?: number;
}

/**
 * Loads an entry document by id.
 * Pure storage seam: no other editor code calls the API.
 */
export async function loadEntryDocument(entryId: string): Promise<LoadedEntry> {
  const response = await fetch(`${API_BASE}/entries/${entryId}`, {
    headers: {
      Authorization: AUTH_TOKEN,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Entry "${entryId}" not found`);
    }
    throw new Error(`Failed to load entry (HTTP ${response.status})`);
  }

  const data = await response.json();
  const parsedEnvelope = DocumentEnvelopeSchema.safeParse(data.doc);

  let v2Doc: DocumentEnvelopeV2;
  if (parsedEnvelope.success) {
    if (parsedEnvelope.data.schemaVersion === 2) {
      v2Doc = parsedEnvelope.data;
    } else {
      v2Doc = migrateDocumentToV2(parsedEnvelope.data).doc;
    }
  } else {
    // If envelope cannot be validated directly, migrate or build empty
    v2Doc = migrateDocumentToV2(data.doc).doc;
  }

  return {
    id: data.id,
    categoryId: data.categoryId,
    title: data.title || 'Untitled',
    version: typeof data.version === 'number' ? data.version : 1,
    weight: typeof data.weight === 'number' ? data.weight : 1,
    doc: v2Doc,
    stats: data.stats,
    updatedAt: data.updatedAt,
  };
}

/**
 * Saves an entry document with title and expected version concurrency check.
 * Supports keepalive for pagehide/visibilitychange events.
 */
export async function saveEntryDocument(
  entryId: string,
  doc: DocumentEnvelopeV2,
  expectedVersion: number,
  title?: string,
  options?: { keepalive?: boolean }
): Promise<SaveResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: AUTH_TOKEN,
    'If-Match': `"${expectedVersion}"`,
  };

  const response = await fetch(`${API_BASE}/entries/${entryId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ doc, title }),
    keepalive: options?.keepalive ?? false,
  });

  if (response.status === 409) {
    let currentVersion = expectedVersion + 1;
    try {
      const errData = await response.json();
      if (typeof errData.currentVersion === 'number') {
        currentVersion = errData.currentVersion;
      }
    } catch {
      // Ignore JSON parse errors on conflict
    }
    return {
      id: entryId,
      version: expectedVersion,
      weight: 0,
      saved: false,
      conflict: true,
      currentVersion,
    };
  }

  if (response.status === 422) {
    let errorMsg = 'Validation failed';
    try {
      const errData = await response.json();
      errorMsg = errData.error || errData.message || errorMsg;
    } catch {
      // Ignore
    }
    throw new Error(errorMsg);
  }

  if (!response.ok) {
    throw new Error(`Failed to save entry (HTTP ${response.status})`);
  }

  const result = await response.json();
  return {
    id: result.id,
    version: result.version,
    weight: result.weight,
    stats: result.stats,
    title: result.title,
    saved: true,
    conflict: false,
  };
}

/**
 * Loads entry chunk manifest.
 */
export async function loadEntryManifest(entryId: string): Promise<EntryManifest | null> {
  const response = await fetch(`${API_BASE}/entries/${entryId}/manifest`, {
    headers: {
      Authorization: AUTH_TOKEN,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to load manifest (HTTP ${response.status})`);
  }

  return response.json();
}

/**
 * Loads a single chunk payload.
 */
export async function loadEntryChunk(entryId: string, chunkId: string): Promise<ChunkPayload | null> {
  const response = await fetch(`${API_BASE}/entries/${entryId}/chunks/${chunkId}`, {
    headers: {
      Authorization: AUTH_TOKEN,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to load chunk (HTTP ${response.status})`);
  }

  return response.json();
}

/**
 * Saves a single chunk with concurrency validation.
 */
export async function saveEntryChunk(
  entryId: string,
  chunkId: string,
  blocks: TopLevelBlock[],
  expectedVersion: number
): Promise<SaveResult & { manifest?: EntryManifest }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: AUTH_TOKEN,
    'If-Match': `"${expectedVersion}"`,
  };

  const response = await fetch(`${API_BASE}/entries/${entryId}/chunks/${chunkId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ blocks }),
  });

  if (response.status === 409) {
    let currentVersion = expectedVersion + 1;
    try {
      const errData = await response.json();
      if (typeof errData.currentVersion === 'number') {
        currentVersion = errData.currentVersion;
      }
    } catch {}
    return {
      id: entryId,
      version: expectedVersion,
      weight: 0,
      saved: false,
      conflict: true,
      currentVersion,
    };
  }

  if (!response.ok) {
    let errorMsg = `Failed to save chunk (HTTP ${response.status})`;
    try {
      const errData = await response.json();
      errorMsg = errData.error || errData.message || errorMsg;
    } catch {}
    throw new Error(errorMsg);
  }

  const result = await response.json();
  return {
    id: entryId,
    version: result.version,
    weight: result.weight,
    stats: result.stats,
    saved: true,
    conflict: false,
    manifest: result.manifest,
  };
}
