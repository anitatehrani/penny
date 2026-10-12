import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ok, shutdown, signup, startServer } from './helpers.js';

// The language choice of a person (docs/DESIGN.md section 46) is kept with their other interface choices.
let srv;
before(async () => {
  srv = await startServer('language');
});
after(async () => {
  await shutdown(srv);
});

describe('the language in the account preferences', () => {
  it('starts with no choice (the app then follows the browser)', async () => {
    const p = await signup(srv);
    assert.equal((await ok(await p.client.get('/preferences'))).language, undefined);
  });

  it('keeps Italian and English, and gives them back on another device', async () => {
    const p = await signup(srv);
    assert.equal(ok(await p.client.put('/preferences', { language: 'it' })).language, 'it');
    assert.equal((await ok(await p.client.get('/preferences'))).language, 'it');
    assert.equal(ok(await p.client.put('/preferences', { language: 'en' })).language, 'en');
    assert.equal((await ok(await p.client.get('/preferences'))).language, 'en');
  });

  it('refuses a language that does not exist, or anything but a plain code', async () => {
    const p = await signup(srv);
    for (const bad of ['fr', 'IT', 'it-IT', '', null, 5, ['it'], { code: 'it' }]) assert.equal((await p.client.put('/preferences', { language: bad })).status, 400, JSON.stringify(bad));
    assert.equal((await ok(await p.client.get('/preferences'))).language, undefined, 'nothing was saved');
  });

  it('changes only the language and leaves the other choices alone', async () => {
    const p = await signup(srv);
    ok(await p.client.put('/preferences', { accent: 'rose', density: 'compact' }));
    const after = ok(await p.client.put('/preferences', { language: 'it' }));
    assert.deepEqual({ accent: after.accent, density: after.density, language: after.language }, { accent: 'rose', density: 'compact', language: 'it' });
  });

  it('is each person’s own, and is gone when the choices are reset', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    ok(await a.client.put('/preferences', { language: 'it' }));
    assert.equal((await ok(await b.client.get('/preferences'))).language, undefined);
    assert.equal((await a.client.del('/preferences')).status, 204);
    assert.equal((await ok(await a.client.get('/preferences'))).language, undefined);
  });

  it('needs a signed-in person', async () => {
    const r = await fetch(`${srv.base}/api/preferences`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'it' }) });
    assert.equal(r.status, 401);
  });
});
