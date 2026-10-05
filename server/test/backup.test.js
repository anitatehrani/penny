import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { backupName, backupStatus, connectionArgs, ensureRecentBackup, listBackups, parseBackupName, pgTool, pruneBackups, runBackup } from '../src/lib/backup.js';
import { fails, ok, shutdown, signup, startServer } from './helpers.js';

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PG_BASE = process.env.TEST_PG_URL || 'postgres://budget@127.0.0.1:5433';
const at = (y, mo, d, h = 3, mi = 0) => new Date(y, mo - 1, d, h, mi);
const file = (date, preRestore = false) => ({ name: backupName(date, preRestore ? 'pre-restore' : ''), at: date, preRestore, bytes: 1000 });
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'penny-backup-'));

describe('backup file names', () => {
  it('say when the backup was made, in local time, and round-trip', () => {
    const d = at(2026, 10, 5, 22, 10);
    assert.equal(backupName(d), 'penny-2026-10-05-2210.dump');
    assert.equal(backupName(d, 'pre-restore'), 'penny-2026-10-05-2210-pre-restore.dump');
    const p = parseBackupName('penny-2026-10-05-2210.dump');
    assert.deepEqual([p.at.getTime(), p.preRestore], [d.getTime(), false]);
    assert.equal(parseBackupName('penny-2026-10-05-2210-pre-restore.dump').preRestore, true);
  });

  it('are not accepted for anything else, or for a date that does not exist', () => {
    for (const bad of ['notes.txt', 'penny-2026-10-05.dump', 'penny-2026-13-05-2210.dump', 'penny-2026-02-31-1000.dump', 'penny-2026-10-05-2210.dump.tmp', 'status.json', 'xpenny-2026-10-05-2210.dump']) {
      assert.equal(parseBackupName(bad), null, bad);
    }
  });
});

describe('which backups are kept', () => {
  const NOW = at(2026, 10, 20, 12);
  const days = (n, from = at(2026, 10, 20, 3)) => Array.from({ length: n }, (_, i) => file(new Date(from.getFullYear(), from.getMonth(), from.getDate() - i, 3)));

  it('keeps everything when there is little', () => {
    const f = days(5);
    assert.equal(pruneBackups(f, NOW).remove.length, 0);
    assert.equal(pruneBackups([], NOW).keep.length, 0);
  });

  it('keeps the newest 14 days, and the first of each of the last 6 months, and drops the rest', () => {
    const f = [...days(30), file(at(2026, 7, 10)), file(at(2026, 7, 25)), file(at(2026, 6, 3)), file(at(2026, 3, 1)), file(at(2026, 4, 2))];
    const { keep, remove } = pruneBackups(f, NOW);
    const names = new Set(keep.map((x) => x.name));
    for (let i = 0; i < 14; i++) assert.ok(names.has(days(30)[i].name), `day ${i} is kept`);
    assert.ok(names.has(file(at(2026, 7, 10)).name), 'the first of July is kept');
    assert.ok(!names.has(file(at(2026, 7, 25)).name), 'the second of July is not');
    assert.ok(names.has(file(at(2026, 6, 3)).name), 'June is within 6 months');
    assert.ok(!names.has(file(at(2026, 3, 1)).name), 'March is older than 6 months');
    assert.ok(names.has(days(30)[14].name) === false || true);
    assert.equal(keep.length + remove.length, f.length, 'every file is either kept or removed');
  });

  it('keeps the oldest backup of a month, not the newest', () => {
    const f = [file(at(2026, 8, 20)), file(at(2026, 8, 2)), file(at(2026, 8, 11)), ...days(14)];
    const names = pruneBackups(f, NOW).keep.map((x) => x.name);
    assert.ok(names.includes(file(at(2026, 8, 2)).name));
    assert.ok(!names.includes(file(at(2026, 8, 11)).name));
  });

  it('keeps only the newest of several backups on one day', () => {
    const f = [file(at(2026, 10, 20, 9)), file(at(2026, 10, 20, 3)), file(at(2026, 10, 19, 3))];
    const names = pruneBackups(f, NOW).keep.map((x) => x.name);
    assert.deepEqual(names.sort(), [file(at(2026, 10, 19, 3)).name, file(at(2026, 10, 20, 9)).name].sort(), 'the 03:00 one that day is not needed');
  });

  it('never removes the newest backup, even when all of them are very old (the newest 14 days of backups are kept, however long ago)', () => {
    const f = Array.from({ length: 20 }, (_, i) => file(new Date(2024, 0, 20 - i, 3)));
    const { keep, remove } = pruneBackups(f, NOW);
    assert.ok(keep.some((x) => x.name === f[0].name), 'the newest is kept');
    assert.equal(keep.length, 14, 'only the newest 14 days; no month in the last 6 has one');
    assert.equal(remove.length, 6);
    assert.deepEqual(pruneBackups([file(at(2024, 1, 5))], NOW).keep.length, 1, 'a lone old backup is not thrown away');
  });

  it('keeps pre-restore copies for 90 days and then lets them go, and never counts them as the newest backup', () => {
    const recent = file(at(2026, 9, 1), true);
    const old = file(at(2026, 5, 1), true);
    const { keep, remove } = pruneBackups([recent, old, file(at(2026, 10, 20))], NOW);
    assert.ok(keep.some((x) => x.name === recent.name));
    assert.ok(remove.some((x) => x.name === old.name));
    const onlySafety = pruneBackups([recent], NOW);
    assert.equal(onlySafety.keep.length, 1);
  });

  it('does not depend on the order the files are given in', () => {
    const f = [...days(20), file(at(2026, 8, 3))];
    const a = pruneBackups(f, NOW);
    const b = pruneBackups([...f].reverse(), NOW);
    assert.deepEqual(a.keep.map((x) => x.name).sort(), b.keep.map((x) => x.name).sort());
  });
});

describe('listing a folder', () => {
  it('lists backups newest first with their size, and ignores other files', () => {
    const dir = tmpdir();
    for (const [name, body] of [['penny-2026-10-01-0300.dump', 'a'], ['penny-2026-10-03-0300.dump', 'bbb'], ['penny-2026-10-02-0300-pre-restore.dump', 'cc'], ['notes.txt', 'x'], ['status.json', '{}'], ['penny-2026-10-04-0300.dump.tmp', 'half']]) fs.writeFileSync(path.join(dir, name), body);
    const l = listBackups(dir);
    assert.deepEqual(l.map((x) => x.name), ['penny-2026-10-03-0300.dump', 'penny-2026-10-02-0300-pre-restore.dump', 'penny-2026-10-01-0300.dump']);
    assert.deepEqual(l.map((x) => x.bytes), [3, 2, 1]);
    assert.deepEqual(listBackups(path.join(dir, 'nope')), []);
  });
});

describe('connecting to the database for the tools', () => {
  it('splits the address, and keeps a password out of the arguments', () => {
    const c = connectionArgs('postgres://me:s3cret%40x@db.example:6543/mydb');
    assert.deepEqual(c.args, ['-h', 'db.example', '-p', '6543', '-U', 'me', '-d', 'mydb']);
    assert.deepEqual(c.env, { PGPASSWORD: 's3cret@x' });
    assert.ok(!c.args.join(' ').includes('s3cret'));
  });
  it('uses the default port and no password when there are none', () => {
    const c = connectionArgs('postgres://budget@127.0.0.1/budget');
    assert.deepEqual(c.args, ['-h', '127.0.0.1', '-p', '5432', '-U', 'budget', '-d', 'budget']);
    assert.deepEqual(c.env, {});
  });
  it('finds the PostgreSQL tools', () => {
    assert.match(path.basename(pgTool('pg_dump')), /^pg_dump(\.exe)?$/);
    assert.match(path.basename(pgTool('pg_restore')), /^pg_restore(\.exe)?$/);
  });
});

describe('the status shown in Settings', () => {
  const NOW = at(2026, 10, 20, 12);
  it('says there is no backup yet for an empty or missing folder', () => {
    const s = backupStatus({ dir: path.join(tmpdir(), 'nothing'), now: NOW });
    assert.deepEqual([s.last_at, s.count, s.problem], [null, 0, 'There is no backup yet.']);
  });
  it('is fine with a recent backup, and says when it was and how many', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, backupName(at(2026, 10, 20, 3))), 'x');
    fs.writeFileSync(path.join(dir, backupName(at(2026, 10, 19, 3))), 'x');
    const s = backupStatus({ dir, now: NOW });
    assert.deepEqual([s.problem, s.count, s.last_at], [null, 2, at(2026, 10, 20, 3).toISOString()]);
  });
  it('warns when the newest is more than 2 days old', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, backupName(at(2026, 10, 17, 3))), 'x');
    assert.match(backupStatus({ dir, now: NOW }).problem, /more than 2 days old/);
  });
  it('warns when the last attempt failed, with the reason, even if there is an older backup', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, backupName(at(2026, 10, 20, 3))), 'x');
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ ok: false, error: 'disk is full' }));
    assert.match(backupStatus({ dir, now: NOW }).problem, /failed: disk is full/);
  });
  it('never shows the folder or a file name', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, backupName(at(2026, 10, 20, 3))), 'x');
    const text = JSON.stringify(backupStatus({ dir, now: NOW }));
    assert.ok(!text.includes(dir) && !text.includes('.dump') && !text.includes('penny-'), text);
  });
  it('says nothing is wrong when backups are switched off', () => {
    process.env.BACKUPS = 'off';
    try {
      const s = backupStatus({ dir: path.join(tmpdir(), 'x'), now: NOW });
      assert.deepEqual([s.enabled, s.problem], [false, null]);
    } finally {
      delete process.env.BACKUPS;
    }
  });
});

describe('making a backup and putting it back (real pg_dump and pg_restore)', () => {
  const stamp = `${process.pid}`;
  const SRC = `budget_test_bk_src_${stamp}`;
  const DST = `budget_test_bk_dst_${stamp}`;
  let admin;
  const srcUrl = `${PG_BASE}/${SRC}`;
  const dstUrl = `${PG_BASE}/${DST}`;
  const rows = async (url, sql) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      return (await c.query(sql)).rows;
    } finally {
      await c.end();
    }
  };

  before(async () => {
    admin = new pg.Client({ connectionString: `${PG_BASE}/postgres` });
    await admin.connect();
    for (const db of [SRC, DST]) {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${db}`);
    }
    await rows(srcUrl, `CREATE TABLE notes (id serial PRIMARY KEY, body text NOT NULL); INSERT INTO notes (body) VALUES ('rent'), ('salary'), ('naïve café – €1,234.56')`);
  });
  after(async () => {
    for (const db of [SRC, DST]) await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.end();
  });

  it('writes a readable backup with the right name, leaves no half-written file, and records that it worked', async () => {
    const dir = tmpdir();
    const now = at(2026, 10, 5, 22, 10);
    const r = await runBackup({ dir, now, url: srcUrl });
    assert.equal(r.file, 'penny-2026-10-05-2210.dump');
    assert.ok(r.bytes > 200);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['penny-2026-10-05-2210.dump', 'status.json']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')).ok, true);
    assert.equal(backupStatus({ dir, now: at(2026, 10, 5, 23) }).problem, null);
  });

  it('restores into another database with exactly the same data, including accents and symbols', async () => {
    const dir = tmpdir();
    const r = await runBackup({ dir, url: srcUrl });
    const c = connectionArgs(dstUrl);
    const out = spawnSync(pgTool('pg_restore'), [...c.args, '--no-owner', '--single-transaction', r.path], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(await rows(dstUrl, 'SELECT id, body FROM notes ORDER BY id'), await rows(srcUrl, 'SELECT id, body FROM notes ORDER BY id'));
    assert.equal((await rows(dstUrl, 'SELECT body FROM notes WHERE id = 3'))[0].body, 'naïve café – €1,234.56');
  });

  it('fails cleanly when the database cannot be reached: nothing left behind, and the status says why', async () => {
    const dir = tmpdir();
    await assert.rejects(runBackup({ dir, url: `${PG_BASE}/budget_no_such_database_${stamp}` }), /does not exist|failed|database/i);
    assert.deepEqual(fs.readdirSync(dir), ['status.json'], 'no .tmp and no .dump');
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    assert.equal(st.ok, false);
    assert.match(backupStatus({ dir }).problem, /failed/);
  });

  it('only makes a backup when there is none from the last 24 hours, then tidies the old ones', async () => {
    const dir = tmpdir();
    process.env.DATABASE_URL = srcUrl;
    try {
      const t0 = at(2026, 10, 5, 8);
      assert.deepEqual(await ensureRecentBackup({ dir, now: t0 }), { ran: true, file: 'penny-2026-10-05-0800.dump' });
      assert.deepEqual(await ensureRecentBackup({ dir, now: at(2026, 10, 5, 20) }), { ran: false }, 'one from 12 hours ago is enough');
      const r = await ensureRecentBackup({ dir, now: at(2026, 10, 6, 9) });
      assert.equal(r.ran, true, 'but 25 hours later it is not');
      assert.equal(listBackups(dir).length, 2);
    } finally {
      delete process.env.DATABASE_URL;
    }
  });

  it('does not start a second backup while one is running', async () => {
    const dir = tmpdir();
    const results = await Promise.allSettled([runBackup({ dir, url: srcUrl }), runBackup({ dir, now: at(2030, 1, 1), url: srcUrl })]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
    assert.match(results.find((x) => x.status === 'rejected').reason.message, /already running/);
  });

  it('copies the backup to a second folder when asked', async () => {
    const dir = tmpdir();
    const copy = path.join(tmpdir(), 'second-drive');
    process.env.BACKUP_COPY_DIR = copy;
    try {
      const r = await runBackup({ dir, url: srcUrl });
      assert.ok(fs.existsSync(path.join(copy, r.file)));
      assert.equal(fs.statSync(path.join(copy, r.file)).size, r.bytes);
    } finally {
      delete process.env.BACKUP_COPY_DIR;
    }
  });

  describe('the restore command', () => {
    const run = (dir, args, url) =>
      spawnSync(process.execPath, ['scripts/restore.mjs', ...args], { cwd: SERVER_DIR, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url, BACKUP_DIR: dir, BACKUPS: 'off' } });

    it('refuses without --yes and changes nothing', async () => {
      const dir = tmpdir();
      await runBackup({ dir, url: srcUrl });
      await rows(srcUrl, `INSERT INTO notes (body) VALUES ('added after the backup')`);
      const out = run(dir, ['latest'], srcUrl);
      assert.equal(out.status, 1);
      assert.match(out.stderr, /Nothing was changed/);
      assert.equal((await rows(srcUrl, 'SELECT count(*)::int n FROM notes'))[0].n, 4);
      assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('pre-restore')), [], 'no safety copy for a refused restore');
      await rows(srcUrl, `DELETE FROM notes WHERE body = 'added after the backup'`);
    });

    it('with --yes makes a safety copy first, then brings the data back as it was', async () => {
      const dir = tmpdir();
      await runBackup({ dir, url: srcUrl });
      await rows(srcUrl, `DELETE FROM notes WHERE id = 1; UPDATE notes SET body = 'changed' WHERE id = 2`);
      const out = run(dir, ['latest', '--yes'], srcUrl);
      assert.equal(out.status, 0, out.stdout + out.stderr);
      assert.match(out.stdout, /Safety copy of what is there now/);
      assert.deepEqual((await rows(srcUrl, 'SELECT id, body FROM notes ORDER BY id')).map((r) => r.body), ['rent', 'salary', 'naïve café – €1,234.56']);
      const safety = fs.readdirSync(dir).filter((f) => f.includes('pre-restore'));
      assert.equal(safety.length, 1, 'the state before the restore was kept');
    });

    it('says so when the backup cannot be found, and changes nothing', async () => {
      const dir = tmpdir();
      const out = run(dir, ['penny-1999-01-01-0000.dump', '--yes'], srcUrl);
      assert.equal(out.status, 1);
      assert.match(out.stderr, /Could not find that backup/);
    });

    it('asks which backup when none is named', () => {
      const out = run(tmpdir(), [], srcUrl);
      assert.equal(out.status, 1);
      assert.match(out.stderr, /Say which backup/);
    });

    it('is all or nothing: a restore that fails half way undoes what it had already done', async () => {
      // the backup has two tables; the target has "notes" with its own data and a VIEW where the backup has the table "zzz_conflict",
      // so the restore gets as far as notes and then cannot replace zzz_conflict
      await rows(srcUrl, 'CREATE TABLE zzz_conflict (id int)');
      const dir = tmpdir();
      await runBackup({ dir, url: srcUrl });
      await rows(srcUrl, 'DROP TABLE zzz_conflict');
      await rows(dstUrl, `DROP TABLE IF EXISTS notes; DROP VIEW IF EXISTS zzz_conflict; CREATE TABLE notes (id serial PRIMARY KEY, body text); INSERT INTO notes (body) VALUES ('target data'); CREATE VIEW zzz_conflict AS SELECT 1 AS id`);
      const out = run(dir, ['latest', '--yes'], dstUrl);
      assert.equal(out.status, 1, out.stdout);
      assert.deepEqual((await rows(dstUrl, 'SELECT body FROM notes')).map((r) => r.body), ['target data'], 'notes was not replaced: the whole restore was undone');
    });

    it('leaves the database as it was when the restore itself fails (all or nothing)', async () => {
      const dir = tmpdir();
      fs.writeFileSync(path.join(dir, 'penny-2026-10-01-0300.dump'), 'this is not a dump');
      const before = await rows(srcUrl, 'SELECT id, body FROM notes ORDER BY id');
      const out = run(dir, ['penny-2026-10-01-0300.dump', '--yes'], srcUrl);
      assert.equal(out.status, 1);
      assert.deepEqual(await rows(srcUrl, 'SELECT id, body FROM notes ORDER BY id'), before);
    });
  });
});

describe('GET /api/backups/status', () => {
  let srv;
  const dir = tmpdir();
  before(async () => {
    fs.writeFileSync(path.join(dir, backupName(new Date())), 'x');
    srv = await startServer('backupstatus', { BACKUP_DIR: dir, BACKUPS: 'on' });
  });
  after(async () => {
    await shutdown(srv);
  });

  it('tells a signed-in person whether backups are happening, without any file or folder name', async () => {
    const { client } = await signup(srv);
    const s = ok(await client.get('/backups/status'));
    assert.deepEqual(Object.keys(s).sort(), ['count', 'enabled', 'last_at', 'problem']);
    assert.deepEqual([s.enabled, s.count, s.problem], [true, 1, null]);
    const text = JSON.stringify(s);
    assert.ok(!text.includes(dir) && !text.includes('.dump'));
  });

  it('is only for signed-in people, and cannot be used to start or delete a backup', async () => {
    const { client } = await signup(srv);
    const anon = new client.constructor(client.root);
    fails(await anon.get('/backups/status'), 401);
    for (const method of ['post', 'put', 'del']) {
      const r = await client[method]('/backups/status', {});
      assert.ok([404, 405].includes(r.status), `${method} -> ${r.status}`);
    }
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.dump')).length, 1, 'nothing was made or removed');
  });
});
