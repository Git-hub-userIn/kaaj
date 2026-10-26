import path from 'node:path';
import { LocalFolderBackupTarget } from '../apps/api/src/backup/local-backup-target.js';
import { GoogleDriveBackupTarget } from '../apps/api/src/backup/google-drive-backup-target.js';
import { checkBackupRepository } from '../apps/api/src/backup/backup-check.js';

async function main() {
  const args = process.argv.slice(2);
  const sampleArg = args.find((a) => a.startsWith('--sample='));
  const sampleRate = sampleArg ? Number(sampleArg.split('=')[1]) : 1.0;

  const targetArg = args.find((a) => !a.startsWith('-') && !a.includes('=')) || 'local';

  let target;
  if (targetArg === 'google-drive') {
    const tokenFilePath =
      process.env.GOOGLE_TOKEN_FILE || path.resolve(process.cwd(), 'data', 'google-oauth.json');
    target = new GoogleDriveBackupTarget({ tokenFilePath });
  } else {
    const backupDir = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'data', 'backup-snapshots');
    target = new LocalFolderBackupTarget(backupDir);
  }

  console.log(`[CHECK] Verifying backup repository on "${target.name}" (Sample rate: ${sampleRate * 100}%)...`);

  const result = await checkBackupRepository(target, { sampleRate });

  console.log(`\n=== CHECK RESULTS ===`);
  console.log(`Repository status: ${result.ok ? 'HEALTHY' : 'ERRORS DETECTED'}`);
  console.log(`Total packs: ${result.totalPacks}`);
  console.log(`Total indexes: ${result.totalIndexes}`);
  console.log(`Total indexed blobs: ${result.totalBlobs}`);
  console.log(`Sampled packs checked: ${result.sampledPacksChecked}`);

  if (result.errors.length > 0) {
    console.error(`\nErrors found (${result.errors.length}):`);
    for (const err of result.errors) {
      console.error(` - ${err}`);
    }
    process.exit(1);
  } else {
    console.log('\nAll index entries point to valid packs and all sampled blobs match their SHA-256 hashes.');
  }
}

main().catch((err) => {
  console.error(`[CHECK ERROR] ${err.message}`);
  process.exit(1);
});
