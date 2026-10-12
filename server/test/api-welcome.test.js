import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ok, shutdown, signup, startServer } from './helpers.js';

// The welcome questions (docs/DESIGN.md section 47): the answers are kept with the other interface choices.
let srv;
before(async () => {
  srv = await startServer('welcome');
});
after(async () => {
  await shutdown(srv);
});

describe('the answers to the welcome questions', () => {
  it('start empty, so a new person is asked', async () => {
    const p = await signup(srv);
    const prefs = await ok(await p.client.get('/preferences'));
    assert.equal(prefs.welcome_done, undefined);
    assert.equal(prefs.tone, undefined);
  });

  it('are kept and given back on another device', async () => {
    const p = await signup(srv);
    const saved = ok(await p.client.put('/preferences', { welcome_done: true, goals: ['budget', 'debts'], tone: 'plain', nudge: 'early', villain: 'dining' }));
    assert.deepEqual({ done: saved.welcome_done, goals: saved.goals, tone: saved.tone, nudge: saved.nudge, villain: saved.villain }, { done: true, goals: ['budget', 'debts'], tone: 'plain', nudge: 'early', villain: 'dining' });
    assert.equal((await ok(await p.client.get('/preferences'))).tone, 'plain');
  });

  it('refuse anything that is not one of the choices', async () => {
    const p = await signup(srv);
    const bad = [{ tone: 'loud' }, { nudge: 'daily' }, { villain: 'rent' }, { goals: ['world peace'] }, { goals: ['budget', 'budget'] }, { goals: 'budget' }, { welcome_done: 'yes' }];
    for (const body of bad) assert.equal((await p.client.put('/preferences', body)).status, 400, JSON.stringify(body));
    assert.deepEqual(await ok(await p.client.get('/preferences')), {}, 'nothing was saved');
  });

  it('leave the other choices alone, and the notification settings are changed through their own route', async () => {
    const p = await signup(srv);
    ok(await p.client.put('/preferences', { accent: 'rose' }));
    const after = ok(await p.client.put('/preferences', { tone: 'cheeky' }));
    assert.equal(after.accent, 'rose');
    const alerts = ok(await p.client.put('/notifications/settings', { lead_days: 7, weekly_summary: true }));
    assert.equal(alerts.lead_days, 7);
    assert.equal(alerts.weekly_summary, true);
  });
});
