/**
 * Put a backup back:  npm run restore -- latest --yes     or     npm run restore -- <file> --yes
 *
 * A restore REPLACES what is in the database with what was in the backup. So it refuses without --yes, first makes a "pre-restore"
 * backup of what is there now (so even a wrong restore can be undone), and does the whole change in one step: if anything fails,
 * the database is left as it was. STOP THE SERVER FIRST.
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
const { backupDir, connectionArgs, listBackups, pgTool, runBackup } = await import('../src/lib/backup.js');
const { spawn } = await import('node:child_process');

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('Say which backup: npm run restore -- latest --yes   or   npm run restore -- <file> --yes');
  process.exit(1);
}
const file = target === 'latest' ? listBackups().find((f) => !f.preRestore) && path.join(backupDir(), listBackups().find((f) => !f.preRestore).name) : path.resolve(fs.existsSync(target) ? target : path.join(backupDir(), target));
if (!file || !fs.existsSync(file)) {
  console.error(`Could not find that backup (${target}). Backups are in ${backupDir()}`);
  process.exit(1);
}
const conn = connectionArgs();
const dbName = conn.args[conn.args.length - 1];
console.log(`Backup:   ${file}`);
console.log(`Database: ${dbName} on ${conn.args[1]}:${conn.args[3]} (everything in it will be replaced)`);
if (!yes) {
  console.error('\nNothing was changed. Stop the server, then run it again with --yes to go ahead.');
  process.exit(1);
}

try {
  const safety = await runBackup({ label: 'pre-restore' });
  console.log(`Safety copy of what is there now: ${safety.path}`);
} catch (e) {
  console.error(`Could not make the safety copy, so nothing was changed: ${e.message}`);
  process.exit(1);
}

const code = await new Promise((resolve) => {
  const child = spawn(pgTool('pg_restore'), [...conn.args, '--clean', '--if-exists', '--no-owner', '--single-transaction', file], { env: { ...process.env, ...conn.env }, stdio: 'inherit' });
  child.on('error', (e) => {
    console.error(e.message);
    resolve(1);
  });
  child.on('close', resolve);
});
if (code !== 0) {
  console.error('\nThe restore failed and the database was left as it was (it is done in one step). Is the server stopped?');
  process.exit(1);
}
console.log('\nRestored. Start the server again.');
