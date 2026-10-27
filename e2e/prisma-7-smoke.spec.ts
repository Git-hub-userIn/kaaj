import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test.describe('Prisma 7 Official CLI Smoke Test', () => {
  test('prisma --version succeeds and reports 7.10.1', () => {
    const res = spawnSync('bun', ['run', 'prisma', '-v'], {
      cwd: rootDir,
      encoding: 'utf8',
      shell: true,
    });
    expect(res.status).toBe(0);
    const cleaned = (res.stdout + res.stderr).replace(/\u001b\[[0-9;]*m/g, '');
    expect(cleaned).toContain('7.10.1');
    expect(cleaned).toContain('prisma');
  });

  test('prisma generate succeeds against schema.prisma', () => {
    const res = spawnSync('bun', ['run', 'prisma', 'generate'], {
      cwd: rootDir,
      encoding: 'utf8',
      shell: true,
    });
    expect(res.status).toBe(0);
    const cleanedOutput = (res.stdout + res.stderr).replace(/\u001b\[[0-9;]*m/g, '');
    expect(cleanedOutput).toContain('Generated Prisma Client');
  });

  test('db:create and migrate against a throwaway kaaj_test_* database', async () => {
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const throwawayDb = `kaaj_test_smoke_${randomSuffix}`;

    const adminUrl = process.env.DATABASE_URL;
    expect(adminUrl).toBeTruthy();

    const base = new URL(adminUrl!);
    base.pathname = '/postgres';

    // 1. Create database
    const createRes = spawnSync('bun', ['scripts/db-create.ts', throwawayDb], {
      cwd: rootDir,
      encoding: 'utf8',
      shell: true,
      env: { ...process.env, DATABASE_URL: base.toString() },
    });
    expect(createRes.status).toBe(0);

    const targetUrl = new URL(adminUrl!);
    targetUrl.pathname = `/${throwawayDb}`;

    // 2. Migrate database
    const migrateRes = spawnSync('bun', ['scripts/db-migrate.ts', targetUrl.toString()], {
      cwd: rootDir,
      encoding: 'utf8',
      shell: true,
      env: { ...process.env, DATABASE_URL: targetUrl.toString() },
    });
    expect(migrateRes.status).toBe(0);

    // 3. Drop throwaway database cleanly (Strict safety check: prefix must match)
    expect(throwawayDb.startsWith('kaaj_test_')).toBe(true);
    const client = new Client({ connectionString: base.toString() });
    await client.connect();
    try {
      await client.query(`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `, [throwawayDb]);
      await client.query(`DROP DATABASE IF EXISTS "${throwawayDb}"`);
    } finally {
      await client.end();
    }
  });
});
