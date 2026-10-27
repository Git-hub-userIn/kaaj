import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;
import { createDatabaseIfNotExists } from './db-create.js';
import { runPrismaMigrate } from './db-migrate.js';
import { runSeed } from './db-seed.js';

export async function resetDatabase(dbName = 'kaaj_dev', options: { yes?: boolean; seed?: boolean } = {}): Promise<void> {
  if (!options.yes) {
    throw new Error('Refusing to reset database without --yes flag.');
  }

  if (!dbName.startsWith('kaaj')) {
    throw new Error(`Safety guard: Refusing to reset database "${dbName}" which does not start with "kaaj".`);
  }

  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  const url = new URL(adminUrl);
  url.pathname = '/postgres';

  const client = new Client({ connectionString: url.toString() });
  await client.connect();

  try {
    console.log(`Dropping database "${dbName}"...`);
    // Terminate existing connections first
    await client.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid()
    `, [dbName]);
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    console.log(`Database "${dbName}" dropped.`);
  } finally {
    await client.end();
  }

  console.log(`Creating database "${dbName}"...`);
  await createDatabaseIfNotExists(dbName, adminUrl);

  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${dbName}`;

  console.log(`Applying migrations to "${dbName}"...`);
  await runPrismaMigrate(targetUrl.toString());

  if (options.seed !== false) {
    console.log(`Seeding database "${dbName}"...`);
    await runSeed(targetUrl.toString());
  }

  console.log(`Database "${dbName}" reset successfully.`);
}

if (import.meta.main || process.argv[1]?.endsWith('db-reset.ts')) {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const targetDb = args.find((a) => !a.startsWith('--')) || 'kaaj_dev';

  resetDatabase(targetDb, { yes, seed: true })
    .then(async () => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Reset failed:', err.message);
      process.exit(1);
    });
}
