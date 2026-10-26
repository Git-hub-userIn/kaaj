import path from 'node:path';
import { LocalFolderBackupTarget } from '../apps/api/src/backup/local-backup-target.js';
import { GoogleDriveBackupTarget } from '../apps/api/src/backup/google-drive-backup-target.js';
import { pruneBackups } from '../apps/api/src/backup/backup-prune.js';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const keepArg = args.find((a) => a.startsWith('--keep='));
  const keepLast = keepArg ? Number(keepArg.split('=')[1]) : 5;

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

  console.log(`[PRUNE] Running prune on target "${target.name}" (Keep last: ${keepLast}, Apply: ${apply})...`);

  const result = await pruneBackups(target, { keepLast, apply });

  console.log(`\n=== PRUNE RESULTS (${apply ? 'APPLIED' : 'DRY-RUN'}) ===`);
  console.log(`Total snapshots evaluated: ${result.totalSnapshots}`);
  console.log(`Retained snapshots: ${result.retainedSnapshots}`);
  console.log(`Snapshots to delete (${result.snapshotsToDelete.length}):`, result.snapshotsToDelete);
  console.log(`Packs to delete (${result.packsToDelete.length}):`, result.packsToDelete);

  if (!apply && (result.snapshotsToDelete.length > 0 || result.packsToDelete.length > 0)) {
    console.log('\nPass --apply to permanently delete unreferenced snapshots and packs.');
  }
}

main().catch((err) => {
  console.error(`[PRUNE ERROR] ${err.message}`);
  process.exit(1);
});
