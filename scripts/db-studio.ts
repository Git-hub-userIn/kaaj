import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const prismaBin = path.resolve(rootDir, 'node_modules/prisma/build/index.js');

export function startStudio(targetDbUrl?: string): void {
  let dbUrl = targetDbUrl || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is not set.');
  }
  const url = new URL(dbUrl);
  if (url.pathname === '/' || url.pathname === '/postgres') {
    url.pathname = '/kaaj_dev';
  }

  console.log(`Starting Prisma Studio for database ${url.pathname}...`);
  const proc = spawn(
    process.execPath,
    [prismaBin, 'studio', '--url', url.toString()],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url.toString() },
    }
  );

  proc.on('close', (code) => {
    process.exit(code || 0);
  });
}

if (import.meta.main || process.argv[1]?.endsWith('db-studio.ts')) {
  startStudio();
}
