import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Backups of the database (docs/DESIGN.md section 29): `pg_dump` in its compressed custom format, named penny-YYYY-MM-DD-HHMM.dump,
 * kept by a simple rule and checked after they are written. Nothing here is reachable from the web except a read-only status.
 */

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAME = /^penny-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(-pre-restore)?\.dump$/;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const KEEP_DAYS = 14;
export const KEEP_MONTHS = 6;
const KEEP_SAFETY_DAYS = 90; // the "pre-restore" copies made just before a restore are kept longer than the daily ones

export const enabled = () => String(process.env.BACKUPS ?? '').toLowerCase() !== 'off';
export const backupDir = () => path.resolve(process.env.BACKUP_DIR || path.join(SERVER_DIR, '..', 'backups'));

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d) => ymd(d).slice(0, 7);

/** The file name for a backup made at `at` (local time), `label` '' or 'pre-restore'. */
export const backupName = (at, label = '') => `penny-${ymd(at)}-${pad(at.getHours())}${pad(at.getMinutes())}${label ? `-${label}` : ''}.dump`;

/** What a file name says: when it was made (local time) and whether it is a pre-restore copy; null for anything else. */
export function parseBackupName(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(at.getTime()) || at.getMonth() !== Number(m[2]) - 1) return null;
  return { name, at, preRestore: !!m[6] };
}

/** The backups in a folder, newest first (files that are not ours are ignored). */
export function listBackups(dir = backupDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => {
      const p = parseBackupName(name);
      return p && { ...p, bytes: fs.statSync(path.join(dir, name)).size };
    })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

/**
 * Which backups to keep (a pure rule, so it is tested): the newest backup of each of the newest 14 days, the first backup of each of
 * the last 6 months, the newest one always, and pre-restore copies for 90 days. Everything else can go.
 */
export function pruneBackups(files, now = new Date()) {
  const regular = files.filter((f) => !f.preRestore).sort((a, b) => b.at - a.at);
  const keep = new Set();
  const days = new Map();
  for (const f of regular) if (!days.has(ymd(f.at))) days.set(ymd(f.at), f); // newest of each day
  for (const f of [...days.values()].slice(0, KEEP_DAYS)) keep.add(f.name);
  const first = new Map();
  for (const f of [...regular].reverse()) if (!first.has(ym(f.at))) first.set(ym(f.at), f); // oldest of each month
  const earliest = new Date(now.getFullYear(), now.getMonth() - (KEEP_MONTHS - 1), 1);
  for (const [m, f] of first) if (m >= ym(earliest)) keep.add(f.name);
  if (regular[0]) keep.add(regular[0].name);
  for (const f of files) if (f.preRestore && now - f.at <= KEEP_SAFETY_DAYS * DAY) keep.add(f.name);
  return { keep: files.filter((f) => keep.has(f.name)), remove: files.filter((f) => !keep.has(f.name)) };
}

/** Where a PostgreSQL tool is: PG_BIN, the usual Windows folders, or just its name for the PATH. */
export function pgTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const dirs = [process.env.PG_BIN, ...[18, 17, 16, 15, 14].map((v) => `C:\\Program Files\\PostgreSQL\\${v}\\bin`)].filter(Boolean);
  for (const d of dirs) if (fs.existsSync(path.join(d, exe))) return path.join(d, exe);
  return exe;
}

/** The connection of DATABASE_URL as arguments for the PostgreSQL tools, with the password (if any) kept out of them. */
export function connectionArgs(url = process.env.DATABASE_URL || 'postgres://budget@127.0.0.1:5433/budget') {
  const u = new URL(url);
  return {
    args: ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username || 'postgres'), '-d', decodeURIComponent(u.pathname.slice(1))],
    env: u.password ? { PGPASSWORD: decodeURIComponent(u.password) } : {},
  };
}

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      reject(e);
      return;
    }
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? `${path.basename(cmd)} was not found. Install PostgreSQL's command-line tools or set PG_BIN.` : e.message)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `${path.basename(cmd)} exited with ${code}`))));
  });
}

const statusFile = (dir) => path.join(dir, 'status.json');
const writeStatus = (dir, status) => {
  try {
    fs.writeFileSync(statusFile(dir), JSON.stringify(status));
  } catch {
    /* the status is a convenience */
  }
};

let running = false;

/**
 * Make a backup now: dump to a temporary file, check that PostgreSQL can read it back (`pg_restore --list`), and only then give it
 * its final name. Optionally copy it to BACKUP_COPY_DIR (another drive or a synced folder). Returns { file, path, bytes }.
 */
export async function runBackup({ dir = backupDir(), now = new Date(), label = '', url } = {}) {
  if (running) throw new Error('A backup is already running.');
  running = true;
  fs.mkdirSync(dir, { recursive: true });
  const final = path.join(dir, backupName(now, label));
  const tmp = `${final}.tmp`;
  try {
    const conn = connectionArgs(url);
    await run(pgTool('pg_dump'), [...conn.args, '--format=custom', '--compress=6', '--no-owner', '--file', tmp], conn.env);
    const bytes = fs.statSync(tmp).size;
    if (bytes < 200) throw new Error('The backup came out empty.');
    await run(pgTool('pg_restore'), ['--list', tmp]); // the dump must be readable, or it is not a backup
    fs.renameSync(tmp, final);
    const copy = process.env.BACKUP_COPY_DIR;
    if (copy) {
      fs.mkdirSync(copy, { recursive: true });
      fs.copyFileSync(final, path.join(copy, path.basename(final)));
    }
    if (!label) writeStatus(dir, { ok: true, at: now.toISOString(), file: path.basename(final) });
    return { file: path.basename(final), path: final, bytes };
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if (!label) writeStatus(dir, { ok: false, at: now.toISOString(), error: err.message });
    throw err;
  } finally {
    running = false;
  }
}

/** Delete what the keeping rule lets go (never the newest). Returns the names removed. */
export function pruneFolder(dir = backupDir(), now = new Date()) {
  const { remove } = pruneBackups(listBackups(dir), now);
  for (const f of remove) fs.rmSync(path.join(dir, f.name), { force: true });
  return remove.map((f) => f.name);
}

/** Make a backup if there is none from the last 24 hours, then tidy up. Returns { ran, file? }. */
export async function ensureRecentBackup({ dir = backupDir(), now = new Date() } = {}) {
  const newest = listBackups(dir).find((f) => !f.preRestore);
  if (newest && now - newest.at < DAY) return { ran: false };
  const made = await runBackup({ dir, now });
  pruneFolder(dir, now);
  return { ran: true, file: made.file };
}

/** Make the automatic backups happen: shortly after start, then every hour. Off with BACKUPS=off. */
export function startBackupSchedule(log = console) {
  if (!enabled()) return null;
  const tick = () =>
    ensureRecentBackup()
      .then((r) => r.ran && log.log(`Backup made: ${r.file}`))
      .catch((e) => log.error('Backup failed:', e.message));
  setTimeout(tick, 15_000).unref(); // not while the server is still starting
  return setInterval(tick, HOUR).unref();
}

/**
 * What the Settings page shows: whether backups are on, when the newest is from, how many there are, and a problem if the last try failed
 * or the newest is old. Never the folder or the file names.
 */
export function backupStatus({ dir = backupDir(), now = new Date() } = {}) {
  const files = listBackups(dir).filter((f) => !f.preRestore);
  let last = null;
  try {
    last = JSON.parse(fs.readFileSync(statusFile(dir), 'utf8'));
  } catch {
    /* none yet */
  }
  const newest = files[0]?.at ?? null;
  const stale = !newest || now - newest > 2 * DAY;
  let problem = null;
  if (enabled()) {
    if (last && last.ok === false) problem = `The last attempt failed: ${last.error}`;
    else if (stale) problem = newest ? 'The newest backup is more than 2 days old.' : 'There is no backup yet.';
  }
  return { enabled: enabled(), last_at: newest ? newest.toISOString() : null, count: files.length, problem };
}
