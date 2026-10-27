import type { PrismaClient } from '../generated/client/index.js';
import { canonicalDocJson, computeContentHash, type ChunkMetadata, type EntryManifest, type TopLevelBlock } from '@kaaj/doc-model';
import crypto from 'node:crypto';

export class ConcurrencyConflictError extends Error {
  public statusCode = 409;
  constructor(message = 'Resource version conflict (If-Match pre-condition failed).') {
    super(message);
    this.name = 'ConcurrencyConflictError';
  }
}

/**
 * -----------------------------------------------------------------------------
 * HOT PATH 1: Version-Checked Entry Metadata Update
 * -----------------------------------------------------------------------------
 * Executes an atomic version-checked update:
 *   UPDATE "Entry" ... WHERE id = $1 AND version = $2
 * If zero rows are returned, it verifies whether the entry exists with a different
 * version (conflict) or was deleted/missing. Zero updated rows triggers a 409 Conflict.
 */
export async function hotPathVersionCheckedUpdateEntry(
  prisma: PrismaClient,
  params: {
    id: string;
    version: number;
    title?: string;
    categoryId?: string;
    color?: string | null;
    pinned?: boolean;
    sortOrder?: number;
    spine?: any;
  }
) {
  return await prisma.$transaction(async (tx) => {
    // 1. Check existing entry to distinguish 404 from 409
    const existing = await tx.$queryRaw<Array<{ id: string; version: number; deletedAt: Date | null }>>`
      SELECT "id", "version", "deletedAt" FROM "Entry" WHERE "id" = ${params.id} LIMIT 1
    `;

    if (!existing || existing.length === 0 || existing[0].deletedAt !== null) {
      return null; // Not found
    }

    if (existing[0].version !== params.version) {
      throw new ConcurrencyConflictError(
        `Version conflict: provided version ${params.version} does not match current version ${existing[0].version}.`
      );
    }

    // 2. Perform atomic version increment update
    const updated = await tx.$queryRaw<any[]>`
      UPDATE "Entry"
      SET
        "title" = COALESCE(${params.title ?? null}, "title"),
        "categoryId" = COALESCE(${params.categoryId ?? null}, "categoryId"),
        "color" = CASE WHEN ${params.color !== undefined} THEN ${params.color} ELSE "color" END,
        "pinned" = COALESCE(${params.pinned ?? null}, "pinned"),
        "sortOrder" = COALESCE(${params.sortOrder ?? null}, "sortOrder"),
        "spine" = CASE WHEN ${params.spine !== undefined} THEN ${params.spine ? JSON.stringify(params.spine) : null}::jsonb ELSE "spine" END,
        "version" = "version" + 1,
        "updatedAt" = NOW()
      WHERE "id" = ${params.id} AND "version" = ${params.version}
      RETURNING *;
    `;

    if (updated.length === 0) {
      throw new ConcurrencyConflictError('Version conflict: concurrent modification detected during atomic update.');
    }

    return updated[0];
  });
}

/**
 * -----------------------------------------------------------------------------
 * HOT PATH 2: Chunk + Manifest + Entry Weight Saved in ONE Transaction
 * -----------------------------------------------------------------------------
 * TRANSACTION ORDER & ISOLATION LEVEL:
 * 1. Isolation Level: READ COMMITTED with pessimistic row-locking (FOR UPDATE).
 *    PostgreSQL's READ COMMITTED combined with `FOR UPDATE` prevents concurrent
 *    interleaved writers on the same entry without the abort-and-retry penalty
 *    of SERIALIZABLE isolation.
 * 2. Execution Order:
 *    a. Lock the Entry row: SELECT "id", "version" FROM "Entry" WHERE id = $1 FOR UPDATE.
 *    b. Validate version check: if expectedVersion != current version, throw 409 Conflict.
 *    c. Upsert new Chunks: For each chunk, compute canonical content hash and persist payload as jsonb.
 *    d. Delete Orphan Chunks: Remove chunks belonging to this entry that are omitted from the new manifest.
 *    e. Upsert EntryManifest: Persist chunk metadata list, total block count, and content stats.
 *    f. Update Entry: Atomically bump version (version = version + 1), update weight, stats, and updatedAt.
 * -----------------------------------------------------------------------------
 */
export async function hotPathSaveChunkedEntry(
  prisma: PrismaClient,
  params: {
    entryId: string;
    expectedVersion?: number;
    manifest: EntryManifest;
    chunks: Array<{
      chunkId: string;
      entryId: string;
      order?: number;
      blocks: TopLevelBlock[];
    }>;
    weight: number;
    stats?: { words: number; images: number; charCount?: number };
  }
) {
  return await prisma.$transaction(async (tx) => {
    // a. Lock entry row FOR UPDATE
    const lockedRows = await tx.$queryRaw<Array<{ id: string; version: number }>>`
      SELECT "id", "version" FROM "Entry" WHERE "id" = ${params.entryId} FOR UPDATE
    `;

    if (!lockedRows || lockedRows.length === 0) {
      throw new Error(`Entry "${params.entryId}" not found.`);
    }

    const currentVersion = lockedRows[0].version;

    // b. Validate version pre-condition if supplied
    if (params.expectedVersion !== undefined && params.expectedVersion !== currentVersion) {
      throw new ConcurrencyConflictError(
        `Version conflict: expected version ${params.expectedVersion} but current database version is ${currentVersion}.`
      );
    }

    const nextVersion = currentVersion + 1;
    const activeChunkIds: string[] = [];

    // c. Write chunks with canonical content hash
    for (let i = 0; i < params.chunks.length; i++) {
      const c = params.chunks[i];
      const chunkId = c.chunkId;
      activeChunkIds.push(chunkId);

      // Compute canonical JSON representation and hash before storage
      const canonical = canonicalDocJson(c.blocks);
      const checksum = params.manifest.chunks.find((m) => m.id === chunkId)?.checksum || computeContentHash(c.blocks);
      const payloadJson = JSON.stringify(c.blocks);
      const byteSize = Buffer.byteLength(canonical, 'utf8');
      const order = c.order ?? i;

      await tx.$executeRaw`
        INSERT INTO "Chunk" (
          "id", "entryId", "order", "version", "checksum", "bytes", "blockCount", "payload", "createdAt", "updatedAt"
        ) VALUES (
          ${chunkId}, ${params.entryId}, ${order}, ${nextVersion}, ${checksum}, ${byteSize}, ${c.blocks.length}, ${payloadJson}::jsonb, NOW(), NOW()
        )
        ON CONFLICT ("entryId", "id") DO UPDATE SET
          "order" = EXCLUDED."order",
          "version" = EXCLUDED."version",
          "checksum" = EXCLUDED."checksum",
          "bytes" = EXCLUDED."bytes",
          "blockCount" = EXCLUDED."blockCount",
          "payload" = EXCLUDED."payload",
          "updatedAt" = NOW();
      `;
    }

    // d. Prune orphaned chunks for this entry
    if (activeChunkIds.length > 0) {
      await tx.$executeRaw`
        DELETE FROM "Chunk"
        WHERE "entryId" = ${params.entryId}
          AND NOT ("id" = ANY(${activeChunkIds}))
      `;
    }

    // e. Upsert EntryManifest
    const manifestStatsJson = params.stats ? JSON.stringify(params.stats) : null;
    const manifestChunksJson = JSON.stringify(params.manifest.chunks);

    await tx.$executeRaw`
      INSERT INTO "EntryManifest" (
        "id", "entryId", "schemaVersion", "version", "totalBlocks", "chunkCount", "stats", "chunks", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, ${params.entryId}, 2, ${nextVersion}, ${params.manifest.totalBlocks}, ${params.manifest.chunkCount},
        ${manifestStatsJson}::jsonb, ${manifestChunksJson}::jsonb, NOW(), NOW()
      )
      ON CONFLICT ("entryId") DO UPDATE SET
        "schemaVersion" = 2,
        "version" = ${nextVersion},
        "totalBlocks" = EXCLUDED."totalBlocks",
        "chunkCount" = EXCLUDED."chunkCount",
        "stats" = EXCLUDED."stats",
        "chunks" = EXCLUDED."chunks",
        "updatedAt" = NOW();
    `;

    // f. Update Entry weight, version, stats, and updatedAt
    await tx.$executeRaw`
      UPDATE "Entry"
      SET
        "version" = ${nextVersion},
        "weight" = ${params.weight},
        "stats" = ${manifestStatsJson}::jsonb,
        "updatedAt" = NOW()
      WHERE "id" = ${params.entryId};
    `;

    return { nextVersion };
  });
}

/**
 * -----------------------------------------------------------------------------
 * HOT PATH 3: Cooperative Job Lease with Heartbeat and Monotonic Fencing Token
 * -----------------------------------------------------------------------------
 * ARCHITECTURAL CHOICE:
 * A PostgreSQL durable table row (`JobLease`) is used instead of session advisory
 * locks (`pg_advisory_lock`).
 * 
 * WHY NOT PG ADVISORY LOCKS?
 * 1. Session advisory locks tie ownership to a specific physical TCP connection.
 *    In pooled environments (`pg.Pool`), connections must be freed back to the pool
 *    promptly. Holding an exclusive advisory lock for multi-minute operations starves
 *    the connection pool.
 * 2. Transaction advisory locks (`pg_advisory_xact_lock`) release as soon as a transaction
 *    commits, preventing long-running background tasks across multiple HTTP/CLI cycles.
 * 3. A durable database lease row with an expiration timestamp (`expiresAt`), holder ID,
 *    and strictly monotonic fencing token (`token`) safely supports heartbeats, crash recovery,
 *    and prevents split-brain writes through monotonic fencing tokens.
 * -----------------------------------------------------------------------------
 */
export class JobLeaseManager {
  private prisma: PrismaClient;
  private leaseName: string;
  private activeHolder: string | null = null;
  private activeToken: bigint | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(prisma: PrismaClient, leaseName = 'backup_maintenance') {
    this.prisma = prisma;
    this.leaseName = leaseName;
  }

  /**
   * Attempts to acquire the lease. Returns fencing token as number if acquired, null if held.
   */
  async acquire(holder: string, ttlMs = 60000): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ token: bigint }>>`
      INSERT INTO "JobLease" ("name", "holder", "token", "acquiredAt", "expiresAt", "updatedAt")
      VALUES (${this.leaseName}, ${holder}, 1, NOW(), NOW() + (${ttlMs} || ' milliseconds')::interval, NOW())
      ON CONFLICT ("name") DO UPDATE
      SET
        "holder" = ${holder},
        "token" = "JobLease"."token" + 1,
        "acquiredAt" = NOW(),
        "expiresAt" = NOW() + (${ttlMs} || ' milliseconds')::interval,
        "updatedAt" = NOW()
      WHERE "JobLease"."expiresAt" < NOW() OR "JobLease"."holder" = ${holder}
      RETURNING "token";
    `;

    if (rows.length === 0) {
      return null;
    }

    const token = rows[0].token;
    this.activeHolder = holder;
    this.activeToken = token;

    // Start automated heartbeat
    const interval = Math.max(1000, Math.floor(ttlMs / 3));
    this.startHeartbeat(interval, ttlMs);

    return Number(token);
  }

  /**
   * Extends the active lease heartbeat if the fencing token matches.
   */
  async heartbeat(ttlMs = 60000): Promise<boolean> {
    if (!this.activeHolder || this.activeToken === null) return false;

    const rows = await this.prisma.$queryRaw<Array<{ token: bigint }>>`
      UPDATE "JobLease"
      SET
        "expiresAt" = NOW() + (${ttlMs} || ' milliseconds')::interval,
        "updatedAt" = NOW()
      WHERE "name" = ${this.leaseName}
        AND "holder" = ${this.activeHolder}
        AND "token" = ${this.activeToken}
        AND "expiresAt" >= NOW()
      RETURNING "token";
    `;

    return rows.length > 0;
  }

  /**
   * Validates if a fencing token is still current and unexpired.
   */
  async validateFencingToken(token: number): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ token: bigint; expiresAt: Date }>>`
      SELECT "token", "expiresAt" FROM "JobLease"
      WHERE "name" = ${this.leaseName}
        AND "token" = ${BigInt(token)}
        AND "expiresAt" >= NOW()
      LIMIT 1;
    `;
    return rows.length > 0;
  }

  /**
   * Releases the lease immediately by setting expiresAt to NOW().
   */
  async release(): Promise<void> {
    this.stopHeartbeat();
    if (!this.activeHolder || this.activeToken === null) return;

    try {
      await this.prisma.$executeRaw`
        UPDATE "JobLease"
        SET "expiresAt" = NOW(), "updatedAt" = NOW()
        WHERE "name" = ${this.leaseName}
          AND "holder" = ${this.activeHolder}
          AND "token" = ${this.activeToken};
      `;
    } finally {
      this.activeHolder = null;
      this.activeToken = null;
    }
  }

  private startHeartbeat(intervalMs: number, ttlMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        const ok = await this.heartbeat(ttlMs);
        if (!ok) {
          console.warn(`[JobLease] Heartbeat extension lost for lease ${this.leaseName}.`);
          this.stopHeartbeat();
        }
      } catch (err) {
        console.error(`[JobLease] Heartbeat error for lease ${this.leaseName}:`, err);
      }
    }, intervalMs);
    // Unref so timer does not prevent process exit
    if (this.heartbeatTimer && typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/**
 * -----------------------------------------------------------------------------
 * HOT PATH 4: Row-Locking Helper (FOR UPDATE)
 * -----------------------------------------------------------------------------
 * Provides atomic pessimistic locking for critical read-modify-write sequences.
 */
export async function queryRowForUpdate<T = any>(
  prisma: PrismaClient,
  tableName: 'Category' | 'Entry' | 'MaintenanceState',
  id: string
): Promise<T | null> {
  let rows: T[] = [];
  if (tableName === 'Category') {
    rows = await prisma.$queryRaw<T[]>`
      SELECT * FROM "Category" WHERE "id" = ${id} FOR UPDATE
    `;
  } else if (tableName === 'Entry') {
    rows = await prisma.$queryRaw<T[]>`
      SELECT * FROM "Entry" WHERE "id" = ${id} FOR UPDATE
    `;
  } else if (tableName === 'MaintenanceState') {
    rows = await prisma.$queryRaw<T[]>`
      SELECT * FROM "MaintenanceState" WHERE "id" = ${id} FOR UPDATE
    `;
  }
  return rows.length > 0 ? rows[0] : null;
}
