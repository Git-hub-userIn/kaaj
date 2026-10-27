import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const prismaBin = path.resolve(rootDir, 'node_modules/prisma/build/index.js');
const migrationsDir = path.resolve(rootDir, 'apps/api/prisma/migrations');

export async function runPrismaMigrate(targetDbUrl?: string): Promise<void> {
  let dbUrl = targetDbUrl || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  // Ensure pointing to target DB (default kaaj_dev)
  const parsed = new URL(dbUrl);
  if (parsed.pathname === '/' || parsed.pathname === '/postgres') {
    parsed.pathname = '/kaaj_dev';
    dbUrl = parsed.toString();
  }

  const hasMigrations = fs.existsSync(migrationsDir) && fs.readdirSync(migrationsDir).some(f => !f.startsWith('.'));
  const commandArgs = hasMigrations
    ? [prismaBin, 'migrate', 'deploy']
    : [prismaBin, 'migrate', 'dev', '--name', 'init'];

  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath, // node or bun
      commandArgs,
      {
        cwd: rootDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          DATABASE_URL: dbUrl,
        },
      }
    );

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Prisma migrate failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

if (import.meta.main || process.argv[1]?.endsWith('db-migrate.ts')) {
  runPrismaMigrate().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}
