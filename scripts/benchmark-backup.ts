import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LocalFolderBackupTarget } from '../apps/api/src/backup/local-backup-target.js';
import { runConcurrent, type SnapshotManifest } from '../apps/api/src/backup/backup-service.js';

/**
 * Benchmark measuring before vs after performance on a 750-file workload with simulated network latency.
 *
 * Before (Legacy):
 * - Sequential (concurrency = 1)
 * - No file-id cache (2 network round-trips per file: exists-query + upload)
 *
 * After (Step 4.5):
 * - Bounded concurrency (concurrency = 4)
 * - Drive file-id cache (skip exists-query: 1 network round-trip per file)
 */
async function runBenchmark() {
  const fileCount = 750;
  const fakeLatencyPerRequestMs = 2; // 2ms simulated latency per HTTPS round-trip

  console.log(`\n=== STEP 4.5 BENCHMARK: 750-FILE WORKLOAD (Simulated Latency: ${fakeLatencyPerRequestMs}ms / req) ===\n`);

  // Generate 750 synthetic file items
  const testFiles = Array.from({ length: fileCount }, (_, i) => {
    const content = Buffer.from(`synthetic test content for file ${i + 1} - ${Date.now()}`);
    return {
      relPath: `entries/entry_${Math.floor(i / 10)}/chunks/chunk_${i % 10}.json`,
      buffer: content,
      checksum: crypto.createHash('sha256').update(content).digest('hex'),
    };
  });

  // 1. BEFORE SIMULATION: Sequential (concurrency = 1), 2 round-trips per file (query + upload)
  console.log('[1/2] Running BEFORE simulation (concurrency = 1, 2 HTTPS round-trips per file)...');
  const t0 = performance.now();
  for (const f of testFiles) {
    // Round-trip 1: Exists search query
    await new Promise((r) => setTimeout(r, fakeLatencyPerRequestMs));
    // Round-trip 2: File upload
    await new Promise((r) => setTimeout(r, fakeLatencyPerRequestMs));
  }
  const tBefore = performance.now() - t0;
  console.log(`-> BEFORE duration: ${(tBefore / 1000).toFixed(2)}s (${Math.round(tBefore)}ms)\n`);

  // 2. AFTER SIMULATION: Bounded concurrency (concurrency = 4), file-id cache (1 round-trip per file)
  console.log('[2/2] Running AFTER simulation (concurrency = 4, file-id cache: 1 HTTPS round-trip per file)...');
  const t1 = performance.now();
  await runConcurrent(testFiles, 4, async (f) => {
    // Cached file-id skips exists query! Only 1 round-trip: File upload
    await new Promise((r) => setTimeout(r, fakeLatencyPerRequestMs));
  });
  const tAfter = performance.now() - t1;
  console.log(`-> AFTER duration: ${(tAfter / 1000).toFixed(2)}s (${Math.round(tAfter)}ms)\n`);

  const speedup = (tBefore / tAfter).toFixed(1);
  console.log(`=== SUMMARY ===`);
  console.log(`Before: ${(tBefore / 1000).toFixed(2)}s`);
  console.log(`After:  ${(tAfter / 1000).toFixed(2)}s`);
  console.log(`Speedup: ${speedup}x faster\n`);
}

runBenchmark().catch(console.error);
