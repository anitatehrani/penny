import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { alertEmail, testEmail, verificationEmail } from '../src/lib/emailTemplates.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));

/** Every file under a folder (relative paths, '/' separators), skipping dependencies and build output. */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (['node_modules', 'dist', 'mail-preview'].includes(e.name)) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/** The subset of .dockerignore syntax this project uses: plain paths, `**\/name`, and `*.ext`. */
function ignoredBy(patterns, file) {
  return patterns.some((raw) => {
    const p = raw.replace(/\/$/, '');
    if (p.startsWith('**/')) return file.split('/').includes(p.slice(3));
    if (p.startsWith('*.')) return file.endsWith(p.slice(1));
    return file === p || file.startsWith(`${p}/`);
  });
}

describe('the app is called Penny', () => {
  it('has no trace of the old name in the code that users see', () => {
    const files = [...walk('server/src'), ...walk('client/src'), 'client/index.html', 'server/test/helpers.js'];
    const stale = files.filter((f) => /Budget Planner|budget-planner/i.test(read(f)));
    assert.deepEqual(stale, []);
  });

  it('uses it for the page title, package names and README heading', () => {
    assert.match(read('client/index.html'), /<title>Penny<\/title>/);
    assert.match(read('README.md'), /^# Penny\b/);
    for (const [file, name] of [['package.json', 'penny'], ['client/package.json', 'penny-client'], ['server/package.json', 'penny-server'], ['e2e/package.json', 'penny-e2e']]) {
      assert.equal(JSON.parse(read(file)).name, name, file);
    }
  });

  it('signs every e-mail as Penny: subject, header, button and footer', () => {
    const unsubscribeUrl = 'http://localhost:3001/unsubscribe?token=x';
    const mails = {
      test: testEmail({ name: 'Alex Morgan', unsubscribeUrl }),
      verification: verificationEmail({ name: 'Alex Morgan', link: 'http://localhost:3001/verify?token=x' }),
      alert: alertEmail({ name: 'Alex Morgan', today: '2026-10-03', unsubscribeUrl, items: [{ kind: 'payment_overdue', title: 'Rent', body: '', data: { description: 'Rent', amount: 900, currency: 'EUR', date: '2026-10-01' } }] }),
      digestWithoutUnsubscribe: alertEmail({ name: 'Alex', today: '2026-10-03', items: [{ kind: 'ai_insight', title: 'Spending is up', body: '12% higher than last month' }] }),
    };
    for (const [name, m] of Object.entries(mails)) {
      assert.match(m.html, />Penny</, `${name}: the header says Penny`);
      assert.doesNotMatch(`${m.subject}${m.html}${m.text}`, /Budget Planner/, name);
    }
    assert.equal(mails.test.subject, 'Test alert from Penny');
    assert.match(mails.alert.html, /Open Penny/);
    assert.match(mails.alert.text, /Open Penny: /);
    assert.match(mails.test.html, /in your Penny settings/);
    assert.match(mails.verification.html, /so Penny can send you payment alerts/);
    assert.match(mails.verification.text, /so Penny can send you payment alerts/);
  });
});

describe('Docker packaging', () => {
  const dockerfile = read('Dockerfile');
  const compose = read('docker-compose.yml');
  const ignore = read('.dockerignore').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  it('does not leave out anything the running server or the client build needs', () => {
    const needed = [
      ...walk('server/src'),
      ...walk('server/scripts'),
      ...walk('client/src'),
      'server/package.json',
      'server/package-lock.json',
      'client/package.json',
      'client/package-lock.json',
      'client/index.html',
      'client/vite.config.js',
    ];
    assert.ok(needed.includes('server/src/schema.sql'), 'the schema is read from disk at start-up');
    assert.deepEqual(needed.filter((f) => ignoredBy(ignore, f)), []);
  });

  it('keeps secrets, local databases, logs and dependencies out of the build context', () => {
    for (const f of ['server/.env', '.env', '.pgdata/PG_VERSION', 'server/node_modules/pg/package.json', 'client/node_modules/react/package.json', 'server/api.out.log', 'server/mail-preview/a.html']) {
      assert.ok(ignoredBy(ignore, f), `${f} should be ignored`);
    }
  });

  it('puts the built client where the server looks for it (../../client/dist from server/src)', () => {
    const index = read('server/src/index.js');
    assert.match(index, /'\.\.\/\.\.\/client\/dist'/);
    assert.match(dockerfile, /^WORKDIR \/app$/m);
    assert.match(dockerfile, /COPY server\/src \.\/server\/src/);
    assert.match(dockerfile, /COPY --from=client \/build\/client\/dist \.\/client\/dist/);
    assert.match(dockerfile, /CMD \["node", "src\/index\.js"\]/);
  });

  it('installs from the lock files and runs as an unprivileged user', () => {
    assert.match(dockerfile, /npm ci --omit=dev/);
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/health/);
    assert.ok(exists('client/package-lock.json') && exists('server/package-lock.json'));
  });

  it('wires every setting in .env.docker.example into the compose file', () => {
    const names = read('.env.docker.example')
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z_]+)=/)?.[1])
      .filter(Boolean);
    assert.ok(names.length >= 10);
    const missing = names.filter((n) => !new RegExp(`\\$\\{${n}[:}-]`).test(compose));
    assert.deepEqual(missing, []);
  });

  it('passes the server every environment variable it reads, or says why not', () => {
    const used = new Set();
    for (const f of walk('server/src').filter((x) => x.endsWith('.js'))) for (const m of read(f).matchAll(/process\.env\.([A-Z_]+)/g)) used.add(m[1]);
    // Not wired on purpose: PORT is fixed inside the container (the host port is mapped instead), the rest are set in the Dockerfile,
    // are test-only, or are developer switches. BACKUP_DIR is fixed to /backups inside the container (the host folder is mounted
    // there, see BACKUP_HOST_DIR); BACKUP_COPY_DIR and PG_BIN are for running outside Docker (pg_dump is on the PATH in the image).
    const notNeeded = new Set(['PORT', 'MAIL_PREVIEW_DIR', 'ALERT_SCAN_MINUTES', 'SMTP_IGNORE_TLS', 'NODE_ENV', 'BACKUP_DIR', 'BACKUP_COPY_DIR', 'PG_BIN']);
    const unwired = [...used].filter((n) => !notNeeded.has(n) && !compose.includes(`${n}:`));
    assert.deepEqual(unwired, [], 'a new setting was added to the server but not to docker-compose.yml');
    assert.ok(used.has('DATABASE_URL') && used.has('SMTP_HOST'), 'the scan itself is working');
  });

  it('keeps the app\'s own daily backups ON in the container: pg_dump is in the image and /backups is a folder of the computer', () => {
    assert.match(dockerfile, /apk add --no-cache postgresql17-client/);
    assert.match(dockerfile, /ENV BACKUP_DIR=\/backups/);
    const prod = compose.split('# ---- development')[0];
    assert.match(prod, /BACKUP_DIR: \/backups/);
    assert.match(prod, /\$\{BACKUP_HOST_DIR:-\.\/backups\}:\/backups/);
    assert.doesNotMatch(prod, /BACKUPS: "off"/, 'the real app must back itself up');
    assert.match(dockerfile, /mkdir -p \/data\/mail-preview \/backups && chown -R node:node/);
  });

  it('keeps the backups folder out of the build context (it holds real financial data)', () => {
    assert.ok(ignoredBy(ignore, 'backups/penny-2026-10-05-2151.dump'));
    assert.ok(read('.gitignore').split(/\r?\n/).includes('backups/'));
  });

  it('has a development profile: the backend and the frontend as separate containers that reload on change', () => {
    const dev = compose.split('# ---- development')[1];
    assert.match(dev, /api:\s+profiles: \["dev"\]/);
    assert.match(dev, /web:\s+profiles: \["dev"\]/);
    assert.match(dev, /nodemon --legacy-watch --watch src --ext js,json,sql src\/index\.js/);
    assert.match(dev, /API_URL: http:\/\/api:3001/);
    assert.match(read('client/vite.config.js'), /process\.env\.API_URL/);
    assert.match(dockerfile, /AS dev/);
    // The production image stays the last stage, so a plain `docker build .` makes it.
    assert.ok(dockerfile.lastIndexOf('FROM node:22-alpine\n') > dockerfile.indexOf('AS dev'));
  });

  it('gives a project name of its own, so its volumes do not depend on the folder name', () => {
    assert.match(compose, /^name: penny$/m);
  });

  it('points the app at the db service and waits for it to be healthy', () => {
    assert.match(compose, /DATABASE_URL: postgres:\/\/penny:\$\{DB_PASSWORD:-penny\}@db:5432\/penny/);
    assert.match(compose, /depends_on:\s+db:\s+condition: service_healthy/);
    assert.match(compose, /pg_isready/);
    assert.match(dockerfile, /MAIL_PREVIEW_DIR=\/data\/mail-preview/);
    assert.match(compose, /penny-mail:\/data\/mail-preview/);
  });

  it('publishes Postgres on the loopback interface only, and not on a port other projects use', () => {
    const published = compose.match(/- "([^"]*:\d+)"\s+# loopback/)?.[1] ?? '';
    assert.match(published, /^127\.0\.0\.1:/);
    assert.doesNotMatch(published, /:5433:/);
    assert.doesNotMatch(compose, /ports:\s+- "(?!127\.0\.0\.1)[^"]*:5432"/);
  });
});

describe('the penny command file', () => {
  const script = read('penny.ps1');
  const cmd = read('penny.cmd');

  it('is a PowerShell file with a .cmd starter, so it runs without changing the script policy', () => {
    assert.match(cmd, /-ExecutionPolicy Bypass -File "%~dp0penny\.ps1" %\*/);
    assert.match(script, /^param\(/m);
  });

  it('has the everyday commands, each with a help line', () => {
    const defined = [...script.matchAll(/^Command (\S+) '([^']+)'/gm)].map((m) => m[1]);
    for (const c of ['help', 'install', 'up', 'down', 'stop', 'restart', 'build', 'rebuild', 'dev', 'status', 'logs', 'shell', 'psql', 'backup', 'restore', 'import-local', 'seed', 'test', 'e2e', 'stop-local', 'wipe']) {
      assert.ok(defined.includes(c), `${c} is a command`);
    }
    assert.equal(new Set(defined).size, defined.length, 'no command is defined twice');
  });

  it('has the short names, and each one points at a real command', () => {
    const defined = new Set([...script.matchAll(/^Command (\S+) '/gm)].map((m) => m[1]));
    const aliases = [...script.matchAll(/^Alias (\S+) (\S+)/gm)];
    assert.ok(aliases.some((m) => m[1] === 'bfu' && m[2] === 'up'), 'bfu starts everything');
    for (const [, short, target] of aliases) assert.ok(defined.has(target), `${short} -> ${target}`);
  });

  it('asks before anything that replaces or deletes data, and says what a restore does', () => {
    assert.match(script, /Command restore[\s\S]*?Ask 'Go ahead\?'/);
    assert.match(script, /Command import-local[\s\S]*?Ask 'Go ahead\?'/);
    assert.match(script, /Command wipe[\s\S]*?Type DELETE to go on/);
    assert.match(script, /A safety copy of what is there now is made first/);
  });

  it('makes a backup before it deletes the database, and never touches the old local database by itself', () => {
    assert.match(script, /Command wipe[\s\S]*?scripts\/backup\.mjs[\s\S]*?down -v/);
    assert.doesNotMatch(script, /pg_ctl|dropdb|DROP DATABASE|\.pgdata/);
  });

  it('keeps every setting the compose file reads in one place (.env), and creates it with a made-up password', () => {
    assert.match(script, /Copy-Item \.env\.docker\.example \.env/);
    assert.match(script, /DB_PASSWORD=\$password/);
  });
});
