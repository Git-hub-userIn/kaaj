import dotenv from 'dotenv';
import pg from 'pg';
const { Client } = pg;
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPrismaMigrate } from '../scripts/db-migrate.js';
import { importFilesToPostgres } from '../scripts/db-import-files.js';

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

export default async function globalSetup() {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error('DATABASE_URL is required in .env for e2e tests.');
  }

  const base = new URL(adminUrl);
  base.pathname = '/postgres';

  const client = new Client({ connectionString: base.toString() });
  await client.connect();

  try {
    // 1. Leftover-DB guard: find and clean up any stale kaaj_test_* databases
    const res = await client.query(`
      SELECT datname FROM pg_database WHERE datname LIKE 'kaaj_test_%'
    `);
    const staleDbs = res.rows.map((r: any) => r.datname);
    if (staleDbs.length > 0) {
      console.log(`[LEFTOVER_DB_GUARD] Found ${staleDbs.length} stale test database(s). Cleaning up...`);
      for (const stale of staleDbs) {
        if (!stale.startsWith('kaaj_test_')) {
          throw new Error(`SAFETY ERROR: Refusing to drop database without 'kaaj_test_' prefix: ${stale}`);
        }
        await client.query(
          `
          SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()
        `,
          [stale]
        );
        await client.query(`DROP DATABASE IF EXISTS "${stale}"`);
        console.log(`[LEFTOVER_DB_GUARD] Cleaned up stale database: ${stale}`);
      }
    }

    // 2. Create fresh database for this run
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const testDbName = `kaaj_test_${randomSuffix}`;

    if (!testDbName.startsWith('kaaj_test_')) {
      throw new Error(`SAFETY ERROR: Test DB name does not have 'kaaj_test_' prefix: ${testDbName}`);
    }

    console.log(`[E2E_DB] Creating fresh test database: ${testDbName}...`);
    await client.query(`CREATE DATABASE "${testDbName}"`);

    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${testDbName}`;

    // 3. Migrate and seed test database
    console.log(`[E2E_DB] Applying migrations to ${testDbName}...`);
    await runPrismaMigrate(testUrl.toString());

    console.log(`[E2E_DB] Importing full dataset into ${testDbName}...`);
    await importFilesToPostgres({ targetDbUrl: testUrl.toString() });

    // Persist test state
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ testDbName, testDbUrl: testUrl.toString() }),
      'utf8'
    );

    process.env.TEST_DB_NAME = testDbName;
    process.env.TEST_DB_URL = testUrl.toString();
    process.env.DATABASE_URL = testUrl.toString();
    process.env.APP_MODE = 'test';
    process.env.BACKUP_DRIVE_FOLDER_NAME = 'Kaaj-test';
  } finally {
    await client.end();
  }
}
