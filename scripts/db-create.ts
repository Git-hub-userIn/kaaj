import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

export async function createDatabaseIfNotExists(dbName: string, adminUrl?: string): Promise<boolean> {
  const connectionUrl = adminUrl || process.env.DATABASE_URL;
  if (!connectionUrl) {
    throw new Error('DATABASE_URL is not set in environment or .env');
  }

  // Connect to base administrative database (e.g. postgres)
  const url = new URL(connectionUrl);
  url.pathname = '/postgres';

  const client = new Client({ connectionString: url.toString() });
  await client.connect();

  try {
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (res.rowCount === 0) {
      if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
        throw new Error(`Invalid database name: ${dbName}`);
      }
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database "${dbName}" created successfully.`);
      return true;
    } else {
      console.log(`Database "${dbName}" already exists.`);
      return false;
    }
  } finally {
    await client.end();
  }
}

// Direct execution
if (import.meta.main || process.argv[1]?.endsWith('db-create.ts')) {
  const targetDb = process.argv[2] || 'kaaj_dev';
  createDatabaseIfNotExists(targetDb).catch((err) => {
    console.error('Failed to create database:', err.message);
    process.exit(1);
  });
}
