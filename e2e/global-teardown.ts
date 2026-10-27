import dotenv from 'dotenv';
import pg from 'pg';
const { Client } = pg;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = path.resolve(__dirname, '.test-db-state.json');

// Ensure root .env is loaded
if (!process.env.DATABASE_URL) {
  const rootEnv = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  } else {
    dotenv.config();
  }
}

export default async function globalTeardown() {
  let testDbName: string | null = null;
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      testDbName = data.testDbName;
    } catch {}
    try {
      fs.unlinkSync(STATE_FILE);
    } catch {}
  }

  if (!testDbName) {
    testDbName = process.env.TEST_DB_NAME || null;
  }

  if (!testDbName) return;

  // STRICT GUARD: Never drop a DB without kaaj_test_ prefix
  if (!testDbName.startsWith('kaaj_test_')) {
    throw new Error(`CRITICAL SAFETY GUARD: Refusing to drop database without 'kaaj_test_' prefix: ${testDbName}`);
  }

  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) return;

  const base = new URL(adminUrl);
  base.pathname = '/postgres';

  const client = new Client({ connectionString: base.toString() });
  await client.connect();

  try {
    console.log(`[E2E_DB] Dropping test database: ${testDbName}...`);
    await client.query(
      `
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `,
      [testDbName]
    );
    await client.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
    console.log(`[E2E_DB] Dropped test database: ${testDbName}`);
  } catch (err: any) {
    console.error(`[E2E_DB] Failed to drop test DB ${testDbName}:`, err.message);
  } finally {
    await client.end();
  }
}
