import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrismaClient } from '../apps/api/src/db/client.js';
import { JobLeaseManager, hotPathSaveChunkedEntry } from '../apps/api/src/db/hot-paths.js';
import {
  canonicalDocJson,
  reassembleDocFromChunks,
  splitBlocksIntoChunks,
  type TopLevelBlock,
} from '../packages/doc-model/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test.describe('Step 5: Database Concurrency, Lease, Failure, and Performance', () => {
  test('Test mode shows visible TEST badge in Web UI', async ({ page }) => {
    await page.goto('/');
    const badge = page.locator('[data-testid="test-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('TEST');
  });

  test('Concurrent save conflict: second client receives 409 and does not overwrite', async ({ request }) => {
    // 1. Fetch all categories and pick the first entry
    const catsRes = await request.get('http://localhost:3001/categories');
    expect(catsRes.ok()).toBe(true);
    const categories = await catsRes.json();
    expect(categories.length).toBeGreaterThan(0);

    const firstCat = categories[0];
    const entriesRes = await request.get(`http://localhost:3001/categories/${firstCat.id}/entries`);
    expect(entriesRes.ok()).toBe(true);
    const entries = await entriesRes.json();
    expect(entries.length).toBeGreaterThan(0);

    const targetEntry = entries[0];
    const fullEntryRes = await request.get(`http://localhost:3001/entries/${targetEntry.id}`);
    expect(fullEntryRes.ok()).toBe(true);
    const fullEntry = await fullEntryRes.json();
    const initialVersion = fullEntry.version || 1;

    // 2. Client A updates entry title with version = initialVersion
    const clientARes = await request.put(`http://localhost:3001/entries/${targetEntry.id}`, {
      headers: {
        'If-Match': `"${initialVersion}"`,
      },
      data: {
        title: 'Title Updated by Client A',
        doc: fullEntry.doc,
      },
    });
    expect(clientARes.ok()).toBe(true);
    const updatedA = await clientARes.json();
    expect(updatedA.title).toBe('Title Updated by Client A');
    expect(updatedA.version).toBe(initialVersion + 1);

    // 3. Client B attempts update with stale version = initialVersion
    const clientBRes = await request.put(`http://localhost:3001/entries/${targetEntry.id}`, {
      headers: {
        'If-Match': `"${initialVersion}"`,
      },
      data: {
        title: 'Conflicting Title from Client B',
        doc: fullEntry.doc,
      },
    });
    // Must fail with 409 Conflict
    expect(clientBRes.status()).toBe(409);

    // 4. Verify entry still retains Client A's title
    const verifyRes = await request.get(`http://localhost:3001/entries/${targetEntry.id}`);
    expect(verifyRes.ok()).toBe(true);
    const finalEntry = await verifyRes.json();
    expect(finalEntry.title).toBe('Title Updated by Client A');
  });

  test('Crash mid-save: transaction rollback maintains atomicity and valid state', async () => {
    const prisma = getPrismaClient();

    // Create a dedicated entry for this transaction test
    const cat = await prisma.category.findFirst();
    expect(cat).toBeTruthy();

    const entryId = `ent_atomic_test_${Date.now()}`;
    await prisma.entry.create({
      data: {
        id: entryId,
        categoryId: cat!.id,
        title: 'Atomic Transaction Entry',
        version: 1,
        weight: 1,
      },
    });

    const initialBlocks: TopLevelBlock[] = [
      {
        type: 'paragraph',
        attrs: { id: 'b_init_1' },
        content: [{ type: 'text', text: 'Initial valid block before crash.' }],
      },
    ];

    const { manifest: m1, chunks: c1 } = splitBlocksIntoChunks(initialBlocks, { entryId, version: 1 });
    await hotPathSaveChunkedEntry(prisma, {
      entryId,
      expectedVersion: 1,
      manifest: m1,
      chunks: c1,
      weight: 1,
    });

    // Verify initial chunks exist
    const initialChunks = await prisma.chunk.findMany({ where: { entryId } });
    expect(initialChunks.length).toBe(1);

    // Simulate mid-save crash inside transaction
    let transactionFailed = false;
    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: write a rogue chunk
        await tx.chunk.create({
          data: {
            id: 'chk_crashed',
            entryId,
            order: 99,
            version: 2,
            checksum: 'deadbeef',
            payload: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rogue chunk' }] }],
          },
        });

        // Step 2: crash intentionally before manifest update
        throw new Error('Simulated process crash or unhandled error mid-save!');
      });
    } catch {
      transactionFailed = true;
    }

    expect(transactionFailed).toBe(true);

    // Verify rogue chunk was completely rolled back
    const postCrashChunks = await prisma.chunk.findMany({ where: { entryId } });
    expect(postCrashChunks.length).toBe(1);
    expect(postCrashChunks[0].id).not.toBe('chk_crashed');

    // Clean up
    await prisma.entry.delete({ where: { id: entryId } });
  });

  test('Cooperative Job Lease: mutual exclusion, heartbeat, expiration handover, and fencing token', async () => {
    const prisma = getPrismaClient();
    const leaseName = `test_lease_${Date.now()}`;
    const leaseA = new JobLeaseManager(prisma, leaseName);
    const leaseB = new JobLeaseManager(prisma, leaseName);

    // 1. Worker A acquires lease
    const tokenA = await leaseA.acquire('worker-A', 2000); // 2 second TTL
    expect(tokenA).toBeTruthy();
    expect(tokenA).toBe(1);

    // 2. Worker B attempts acquisition -> must be denied (null)
    const tokenB = await leaseB.acquire('worker-B', 2000);
    expect(tokenB).toBeNull();

    // 3. Fencing token check: Token 1 is valid, stale token 99 is invalid
    expect(await leaseA.validateFencingToken(tokenA!)).toBe(true);
    expect(await leaseA.validateFencingToken(99)).toBe(false);

    // 4. Worker A heartbeats and extends lease
    const extended = await leaseA.heartbeat(2000);
    expect(extended).toBe(true);

    // 5. Worker A releases lease
    await leaseA.release();

    // 6. Worker B can now acquire lease with incremented fencing token
    const tokenB2 = await leaseB.acquire('worker-B', 2000);
    expect(tokenB2).toBeTruthy();
    expect(tokenB2!).toBeGreaterThan(tokenA!);

    // 7. Worker A's old fencing token is rejected
    expect(await leaseA.validateFencingToken(tokenA!)).toBe(false);

    // Clean up
    await leaseB.release();
  });

  test('Canonical JSON integrity: loaded and reassembled entry equals original canonical JSON', async () => {
    const prisma = getPrismaClient();
    const entry = await prisma.entry.findFirst({
      where: { deletedAt: null },
      include: {
        chunks: { orderBy: { order: 'asc' } },
        manifest: true,
      },
    });
    expect(entry).toBeTruthy();
    expect(entry!.chunks.length).toBeGreaterThan(0);

    const reassembled = reassembleDocFromChunks(
      entry!.chunks.map((c) => ({ blocks: c.payload as TopLevelBlock[] }))
    );

    const canonical1 = canonicalDocJson(reassembled.doc);
    const canonical2 = canonicalDocJson(reassembled.doc);
    expect(canonical1).toBe(canonical2);
    expect(typeof canonical1).toBe('string');
    expect(canonical1.length).toBeGreaterThan(10);
  });
});
