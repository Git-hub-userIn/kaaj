import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client/index.js';

export { PrismaClient };

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

let prismaInstance: PrismaClient | null = null;
let poolInstance: pg.Pool | null = null;

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

let currentPoolUrl: string | null = null;
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

let currentPrismaUrl: string | null = null;
export function getPrismaClient(connectionString?: string): PrismaClient {
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

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const instance = getPrismaClient();
    const value = (instance as any)[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});

/**
 * Checks if PostgreSQL is reachable at application startup.
 * On failure, prints clear diagnostics and troubleshooting instructions.
 */
export async function checkPostgresReachable(targetPrisma?: PrismaClient): Promise<void> {
  const p = targetPrisma || prisma;
  try {
    await p.$queryRaw`SELECT 1 as reachable`;
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error('================================================================================');
    console.error('CRITICAL: Unable to connect to PostgreSQL database.');
    console.error(`Error details: ${message}`);
    console.error('Likely fixes:');
    console.error('  1. Verify the PostgreSQL Windows service is running (e.g. net start postgresql-x64-17).');
    console.error('  2. Verify that localhost:5432 is accessible.');
    console.error('  3. Check credentials in your .env file (DATABASE_URL).');
    console.error('  4. Ensure target database exists (run: bun run db:create).');
    console.error('================================================================================');
    throw new Error(`PostgreSQL connectivity check failed: ${message}`);
  }
}

/**
 * Graceful shutdown closing Prisma client and pool connections.
 */
export async function closeDb(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
