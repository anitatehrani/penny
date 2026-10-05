import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backupLine } from '../src/backupLogic.js';

const when = (iso) => `<${iso}>`;

describe('the backups line in Settings', () => {
  it('says when the newest backup is from and how many are kept', () => {
    assert.deepEqual(backupLine({ enabled: true, last_at: '2026-10-05T20:10:00.000Z', count: 15, problem: null }, when), {
      tone: 'ok',
      text: 'Last automatic backup: <2026-10-05T20:10:00.000Z> · 15 kept',
    });
  });

  it('warns when there is a problem, and still says when the last good one was', () => {
    const l = backupLine({ enabled: true, last_at: '2026-10-01T03:00:00.000Z', count: 3, problem: 'The newest backup is more than 2 days old.' }, when);
    assert.equal(l.tone, 'warn');
    assert.equal(l.text, 'The newest backup is more than 2 days old. Last automatic backup: <2026-10-01T03:00:00.000Z> · 3 kept');
  });

  it('warns plainly when there is none yet', () => {
    assert.deepEqual(backupLine({ enabled: true, last_at: null, count: 0, problem: 'There is no backup yet.' }, when), { tone: 'warn', text: 'There is no backup yet.' });
  });

  it('says it is switched off, and does not call that a problem', () => {
    const l = backupLine({ enabled: false, last_at: null, count: 0, problem: null }, when);
    assert.equal(l.tone, 'off');
    assert.match(l.text, /switched off/);
  });

  it('copes with a status that is on but has nothing to report, and with no answer at all', () => {
    assert.deepEqual(backupLine({ enabled: true, last_at: null, count: 0, problem: null }, when), { tone: 'ok', text: 'Automatic backups are on.' });
    assert.equal(backupLine(null, when), null);
    assert.equal(backupLine(undefined, when), null);
  });
});
