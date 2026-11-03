import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded regardless of current working directory
if (!process.env.DATABASE_URL) {
  const envCandidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(__dirname, '../../../../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];
  for (const p of envCandidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      if (process.env.DATABASE_URL) break;
    }
  }
}

// Base private client instances
let prismaInstance: PrismaClient | null = null;
let poolInstance: pg.Pool | null = null;
let currentPrismaUrl: string | null = null;
let currentPoolUrl: string | null = null;

const USER_OWNED_MODELS = new Set([
  'Category',
  'Entry',
  'EntryRevision',
  'EntryManifest',
  'Chunk',
  'AssetMeta',
  'MaintenanceState',
  'JobLease',
  'Tag',
  'EntryTag',
  'ShareLink',
]);

export function resolveDatabaseUrl(overrideUrl?: string): string {
  if (overrideUrl) return overrideUrl;
  if (process.env.TEST_DB_URL) return process.env.TEST_DB_URL;

  // In test mode, pick up fresh test database created by e2e global-setup
  if (process.env.APP_MODE === 'test') {
    const candidatePaths = [
      path.resolve(process.cwd(), '.test-db-state.json'),
      path.resolve(process.cwd(), 'e2e', '.test-db-state.json'),
      path.resolve(__dirname, '../../../../e2e/.test-db-state.json'),
      path.resolve(__dirname, '../../../e2e/.test-db-state.json'),
    ];
    for (const statePath of candidatePaths) {
      if (fs.existsSync(statePath)) {
        try {
          const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          if (state.testDbUrl) return state.testDbUrl;
        } catch {}
      }
    }
  }

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL environment variable is not defined in .env.');
  }
  const url = new URL(base);
  if (url.pathname === '/' || url.pathname === '/postgres') {
    url.pathname = '/kaaj_dev';
  }
  return url.toString();
}

export function getDbPool(connectionString?: string): pg.Pool {
  const connStr = connectionString || resolveDatabaseUrl();
  if (poolInstance && currentPoolUrl === connStr && !connectionString) {
    return poolInstance;
  }
  if (poolInstance && !connectionString) {
    try {
      poolInstance.end().catch(() => {});
    } catch {}
  }
  const pool = new pg.Pool({
    connectionString: connStr,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  if (!connectionString) {
    poolInstance = pool;
    currentPoolUrl = connStr;
  }
  return pool;
}

// Base PrismaClient stays private to this db module
function getBasePrismaClient(connectionString?: string): PrismaClient {
  const connStr = connectionString || resolveDatabaseUrl();
  if (prismaInstance && currentPrismaUrl === connStr && !connectionString) {
    return prismaInstance;
  }

  const config = {
    connectionString: connStr,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  const adapter = new PrismaPg(config);
  const client = new PrismaClient({ adapter });

  if (!connectionString) {
    prismaInstance = client;
    currentPrismaUrl = connStr;
  }
  return client;
}

function createScopedPrismaClient(userId: string, connectionString?: string) {
  const baseClient = getBasePrismaClient(connectionString);

  return baseClient.$extends({
    name: `scoped-user-${userId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !USER_OWNED_MODELS.has(model)) {
            return query(args);
          }

          const mutableArgs = (args || {}) as any;

          if (
            operation === 'findFirst' ||
            operation === 'findFirstOrThrow' ||
            operation === 'findMany' ||
            operation === 'count' ||
            operation === 'aggregate' ||
            operation === 'groupBy' ||
            operation === 'findUnique' ||
            operation === 'findUniqueOrThrow'
          ) {
            mutableArgs.where = { ...(mutableArgs.where || {}), userId };
          } else if (operation === 'create') {
            mutableArgs.data = { ...(mutableArgs.data || {}), userId };
          } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            if (Array.isArray(mutableArgs.data)) {
              mutableArgs.data = mutableArgs.data.map((item: any) => ({ ...item, userId }));
            } else if (mutableArgs.data) {
              mutableArgs.data = { ...mutableArgs.data, userId };
            }
          } else if (
            operation === 'update' ||
            operation === 'updateMany' ||
            operation === 'delete' ||
            operation === 'deleteMany'
          ) {
            mutableArgs.where = { ...(mutableArgs.where || {}), userId };
          } else if (operation === 'upsert') {
            mutableArgs.create = { ...(mutableArgs.create || {}), userId };
          }

          return query(mutableArgs);
        },
      },
    },
  });
}

export type ScopedPrismaClient = ReturnType<typeof createScopedPrismaClient>;

const scopedClientCache = new Map<string, ScopedPrismaClient>();
const knownUsers = new Set<string>();

export async function ensureUser(userId: string, connectionString?: string): Promise<void> {
  const cacheKey = `${connectionString || 'default'}:${userId}`;
  if (knownUsers.has(cacheKey)) return;
  const baseClient = getBasePrismaClient(connectionString);
  await baseClient.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email: `${userId}@kaaj.local`,
      name: userId,
    },
  });
  knownUsers.add(cacheKey);
}

/**
 * Returns a tenant-isolated Prisma client scoped to the specified userId.
 * Base PrismaClient remains private; all queries transparently enforce userId.
 */
export function forUser(userId: string, connectionString?: string): ScopedPrismaClient {
  const cacheKey = `${userId}::${connectionString || ''}`;
  let client = scopedClientCache.get(cacheKey);
  if (!client) {
    client = createScopedPrismaClient(userId, connectionString);
    scopedClientCache.set(cacheKey, client);
  }
  return client;
}

/**
 * Checks if PostgreSQL is reachable at application startup.
 */
export async function checkPostgresReachable(targetPrisma?: ScopedPrismaClient | PrismaClient): Promise<void> {
  const p = targetPrisma || getBasePrismaClient();
  try {
    await p.$queryRaw`SELECT 1 as reachable`;
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error('================================================================================');
    console.error('CRITICAL: Unable to connect to PostgreSQL database.');
    console.error(`Error details: ${message}`);
    console.error('================================================================================');
    throw new Error(`PostgreSQL connectivity check failed: ${message}`);
  }
}

/**
 * Locate a share link by token across the database (for public shared links).
 */
export async function findShareLinkByToken(token: string) {
  const base = getBasePrismaClient();
  return await base.shareLink.findUnique({
    where: { token },
    include: {
      entry: true,
    },
  });
}

/**
 * Graceful shutdown closing Prisma client and pool connections.
 */
export async function closeDb(): Promise<void> {
  scopedClientCache.clear();
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
