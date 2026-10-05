/**
 * Make a backup of the database now and tidy the old ones:  npm run backup
 * (The server also does this by itself once a day. See docs/DESIGN.md section 29 and the README.)
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
const { backupDir, listBackups, pruneFolder, runBackup } = await import('../src/lib/backup.js');

try {
  const r = await runBackup();
  const removed = pruneFolder();
  console.log(`Backup made: ${r.path} (${(r.bytes / 1024).toFixed(0)} KB)`);
  if (removed.length) console.log(`Removed ${removed.length} old backup${removed.length === 1 ? '' : 's'}.`);
  console.log(`${listBackups().length} backup${listBackups().length === 1 ? '' : 's'} in ${backupDir()}`);
  if (process.env.BACKUP_COPY_DIR) console.log(`A copy is in ${process.env.BACKUP_COPY_DIR}`);
} catch (e) {
  console.error('Backup failed:', e.message);
  process.exit(1);
}
