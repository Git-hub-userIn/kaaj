import type { ScopedPrismaClient } from './client.js';
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
 * HOT PATH 1: Version-Checked Entry Metadata Update (User-Scoped)
 * -----------------------------------------------------------------------------
 */
export async function hotPathVersionCheckedUpdateEntry(
  prisma: ScopedPrismaClient | any,
  params: {
    userId: string;
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
  return await prisma.$transaction(async (tx: any) => {
    // 1. Check existing entry to distinguish 404 from 409, strictly filtered by userId
    const existing = await tx.$queryRaw<Array<{ id: string; version: number; deletedAt: Date | null }>>`
      SELECT "id", "version", "deletedAt" FROM "Entry" WHERE "id" = ${params.id} AND "userId" = ${params.userId} LIMIT 1
    `;

    if (!existing || existing.length === 0 || existing[0].deletedAt !== null) {
      return null; // Not found
    }

    if (existing[0].version !== params.version) {
      throw new ConcurrencyConflictError(
        `Version conflict: provided version ${params.version} does not match current version ${existing[0].version}.`
      );
    }

    // 2. Perform atomic version increment update scoped to userId
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
      WHERE "id" = ${params.id} AND "userId" = ${params.userId} AND "version" = ${params.version}
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
 * HOT PATH 2: Chunk + Manifest + Entry Weight Saved in ONE Transaction (User-Scoped)
 * -----------------------------------------------------------------------------
 */
export async function hotPathSaveChunkedEntry(
  prisma: ScopedPrismaClient | any,
  params: {
    userId: string;
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
  return await prisma.$transaction(async (tx: any) => {
    // a. Lock entry row FOR UPDATE, strictly verifying userId
    const lockedRows = await tx.$queryRaw<Array<{ id: string; version: number }>>`
      SELECT "id", "version" FROM "Entry" WHERE "id" = ${params.entryId} AND "userId" = ${params.userId} FOR UPDATE
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

    // c. Write chunks with canonical content hash, strictly storing userId
    for (let i = 0; i < params.chunks.length; i++) {
      const c = params.chunks[i];
      const chunkId = c.chunkId;
      activeChunkIds.push(chunkId);

      const canonical = canonicalDocJson(c.blocks);
      const checksum = params.manifest.chunks.find((m) => m.id === chunkId)?.checksum || computeContentHash(c.blocks);
      const payloadJson = JSON.stringify(c.blocks);
      const byteSize = Buffer.byteLength(canonical, 'utf8');
      const order = c.order ?? i;

      await tx.$executeRaw`
        INSERT INTO "Chunk" (
          "id", "entryId", "userId", "order", "version", "checksum", "bytes", "blockCount", "payload", "createdAt", "updatedAt"
        ) VALUES (
          ${chunkId}, ${params.entryId}, ${params.userId}, ${order}, ${nextVersion}, ${checksum}, ${byteSize}, ${c.blocks.length}, ${payloadJson}::jsonb, NOW(), NOW()
        )
        ON CONFLICT ("entryId", "id") DO UPDATE SET
          "userId" = EXCLUDED."userId",
          "order" = EXCLUDED."order",
          "version" = EXCLUDED."version",
          "checksum" = EXCLUDED."checksum",
          "bytes" = EXCLUDED."bytes",
          "blockCount" = EXCLUDED."blockCount",
          "payload" = EXCLUDED."payload",
          "updatedAt" = NOW();
      `;
    }

    // d. Prune orphaned chunks for this entry and user
    if (activeChunkIds.length > 0) {
      await tx.$executeRaw`
        DELETE FROM "Chunk"
        WHERE "entryId" = ${params.entryId}
          AND "userId" = ${params.userId}
          AND NOT ("id" = ANY(${activeChunkIds}))
      `;
    }

    // e. Upsert EntryManifest scoped to userId
    const manifestStatsJson = params.stats ? JSON.stringify(params.stats) : null;
    const manifestChunksJson = JSON.stringify(params.manifest.chunks);

    await tx.$executeRaw`
      INSERT INTO "EntryManifest" (
        "id", "entryId", "userId", "schemaVersion", "version", "totalBlocks", "chunkCount", "stats", "chunks", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, ${params.entryId}, ${params.userId}, 2, ${nextVersion}, ${params.manifest.totalBlocks}, ${params.manifest.chunkCount},
        ${manifestStatsJson}::jsonb, ${manifestChunksJson}::jsonb, NOW(), NOW()
      )
      ON CONFLICT ("entryId") DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "schemaVersion" = 2,
        "version" = ${nextVersion},
        "totalBlocks" = EXCLUDED."totalBlocks",
        "chunkCount" = EXCLUDED."chunkCount",
        "stats" = EXCLUDED."stats",
        "chunks" = EXCLUDED."chunks",
        "updatedAt" = NOW();
    `;

    // f. Update Entry weight, version, stats, and updatedAt scoped to userId
    await tx.$executeRaw`
      UPDATE "Entry"
      SET
        "version" = ${nextVersion},
        "weight" = ${params.weight},
        "stats" = ${manifestStatsJson}::jsonb,
        "updatedAt" = NOW()
      WHERE "id" = ${params.entryId} AND "userId" = ${params.userId};
    `;

    return { nextVersion };
  });
}

/**
 * -----------------------------------------------------------------------------
 * HOT PATH 3: Cooperative Job Lease (User-Scoped)
 * -----------------------------------------------------------------------------
 */
export class JobLeaseManager {
  private prisma: any;
  private userId: string;
  private leaseName: string;
  private activeHolder: string | null = null;
  private activeToken: bigint | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(prisma: any, userId = 'dev-owner-user', leaseName = 'backup_maintenance') {
    this.prisma = prisma;
    this.userId = userId;
    this.leaseName = leaseName;
  }

  async acquire(holder: string, ttlMs = 60000): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ token: bigint }>>`
      INSERT INTO "JobLease" ("name", "userId", "holder", "token", "acquiredAt", "expiresAt", "updatedAt")
      VALUES (${this.leaseName}, ${this.userId}, ${holder}, 1, NOW(), NOW() + (${ttlMs} || ' milliseconds')::interval, NOW())
      ON CONFLICT ("userId", "name") DO UPDATE
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

    const interval = Math.max(1000, Math.floor(ttlMs / 3));
    this.startHeartbeat(interval, ttlMs);

    return Number(token);
  }

  async heartbeat(ttlMs = 60000): Promise<boolean> {
    if (!this.activeHolder || this.activeToken === null) return false;

    const rows = await this.prisma.$queryRaw<Array<{ token: bigint }>>`
      UPDATE "JobLease"
      SET
        "expiresAt" = NOW() + (${ttlMs} || ' milliseconds')::interval,
        "updatedAt" = NOW()
      WHERE "name" = ${this.leaseName}
        AND "userId" = ${this.userId}
        AND "holder" = ${this.activeHolder}
        AND "token" = ${this.activeToken}
        AND "expiresAt" >= NOW()
      RETURNING "token";
    `;

    return rows.length > 0;
  }

  async validateFencingToken(token: number): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ token: bigint; expiresAt: Date }>>`
      SELECT "token", "expiresAt" FROM "JobLease"
      WHERE "name" = ${this.leaseName}
        AND "userId" = ${this.userId}
        AND "token" = ${BigInt(token)}
        AND "expiresAt" >= NOW()
      LIMIT 1;
    `;
    return rows.length > 0;
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    if (!this.activeHolder || this.activeToken === null) return;

    try {
      await this.prisma.$executeRaw`
        UPDATE "JobLease"
        SET "expiresAt" = NOW(), "updatedAt" = NOW()
        WHERE "name" = ${this.leaseName}
          AND "userId" = ${this.userId}
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
 * HOT PATH 4: Row-Locking Helper (FOR UPDATE) - User-Scoped
 * -----------------------------------------------------------------------------
 */
export async function queryRowForUpdate<T = any>(
  prisma: any,
  tableName: 'Category' | 'Entry' | 'MaintenanceState',
  id: string,
  userId = 'dev-owner-user'
): Promise<T | null> {
  let rows: T[] = [];
  if (tableName === 'Category') {
    rows = await prisma.$queryRaw<T[]>`
      SELECT * FROM "Category" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE
    `;
  } else if (tableName === 'Entry') {
    rows = await prisma.$queryRaw<T[]>`
      SELECT * FROM "Entry" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE
    `;
  } else if (tableName === 'MaintenanceState') {
    rows = await prisma.$queryRaw<T[]>`
      SELECT * FROM "MaintenanceState" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE
    `;
  }
  return rows.length > 0 ? rows[0] : null;
}

/**
 * -----------------------------------------------------------------------------
 * HOT PATH 5: Full-Text Search via Postgres tsvector (User-Scoped)
 * -----------------------------------------------------------------------------
 */
export async function hotPathSearchEntries(
  prisma: ScopedPrismaClient | any,
  params: {
    userId: string;
    query: string;
    limit?: number;
  }
) {
  const cleanQuery = params.query.trim();
  if (!cleanQuery) return [];

  const limit = params.limit ?? 20;

  return await prisma.$queryRaw`
    SELECT
      e.id,
      e."categoryId",
      e.title,
      e."updatedAt",
      c.title AS "categoryTitle",
      c.color AS "categoryColor"
    FROM "Entry" e
    JOIN "Category" c ON e."categoryId" = c.id AND c."userId" = ${params.userId} AND c."deletedAt" IS NULL
    LEFT JOIN "Chunk" ch ON ch."entryId" = e.id AND ch."userId" = ${params.userId}
    WHERE e."userId" = ${params.userId}
      AND e."deletedAt" IS NULL
      AND (
        to_tsvector('english', e.title) @@ plainto_tsquery('english', ${cleanQuery})
        OR to_tsvector('english', c.title) @@ plainto_tsquery('english', ${cleanQuery})
        OR to_tsvector('english', ch.payload::text) @@ plainto_tsquery('english', ${cleanQuery})
        OR e.title ILIKE '%' || ${cleanQuery} || '%'
      )
    GROUP BY e.id, c.id
    ORDER BY e."updatedAt" DESC
    LIMIT ${limit};
  `;
}
