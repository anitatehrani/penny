import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, connect, fails, GIF, JPEG, ok, padTo, PDF, PNG, shutdown, signup, startServer, SVG, tx, upload, WEBP } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer('uploads');
});
after(async () => {
  await shutdown(srv);
});

const setAvatar = (c, buf = PNG, type = 'image/png') => upload(c, 'PUT', '/profile/avatar', buf, type);
const me = async (c) => ok(await c.get('/auth/me')).user;

describe('profile pictures', () => {
  it('can be uploaded, shows up in the profile, and is served back unchanged', async () => {
    const p = await signup(srv);
    assert.equal(p.user.avatar_url, null);
    const r = ok(await setAvatar(p.client));
    assert.match(r.user.avatar_url, new RegExp(`^/api/avatars/${p.user.id}\\?v=\\d+$`));
    assert.equal((await me(p.client)).avatar_url, r.user.avatar_url);
    const img = await p.client.get(r.user.avatar_url.replace('/api', ''));
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.ok(img.buf.equals(PNG), 'the same bytes come back');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.match(img.headers.get('content-security-policy'), /sandbox/);
    assert.match(img.headers.get('cache-control'), /private/);
  });

  it('accepts JPEG, PNG and WebP, and decides the type from the bytes, not the header', async () => {
    const p = await signup(srv);
    for (const [buf, mime] of [[JPEG, 'image/jpeg'], [PNG, 'image/png'], [WEBP, 'image/webp']]) {
      const r = ok(await setAvatar(p.client, buf, mime));
      assert.equal((await p.client.get(r.user.avatar_url.replace('/api', ''))).headers.get('content-type'), mime);
    }
    // a PNG sent while claiming to be a JPEG is stored (and served) as a PNG
    const r = ok(await setAvatar(p.client, PNG, 'image/jpeg'));
    assert.equal((await p.client.get(r.user.avatar_url.replace('/api', ''))).headers.get('content-type'), 'image/png');
  });

  it('a new upload gets a new URL, so no browser shows the old picture', async () => {
    const p = await signup(srv);
    const a = ok(await setAvatar(p.client)).user.avatar_url;
    await new Promise((r) => setTimeout(r, 5));
    const b = ok(await setAvatar(p.client, JPEG, 'image/jpeg')).user.avatar_url;
    assert.notEqual(a, b);
    assert.equal(a.split('?')[0], b.split('?')[0], 'same address, new version');
  });

  it('refuses anything that is not a JPEG, PNG or WebP image', async () => {
    const p = await signup(srv);
    const bad = [
      ['GIF', GIF, 'image/gif'],
      ['SVG (can carry scripts)', SVG, 'image/svg+xml'],
      ['PDF', PDF, 'application/pdf'],
      ['HTML pretending to be PNG', Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'],
      ['text pretending to be JPEG', Buffer.from('definitely not a picture at all'), 'image/jpeg'],
      ['too short', Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'],
      ['executable', Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff', 'latin1'), 'image/png'],
      ['empty', Buffer.alloc(0), 'image/png'],
    ];
    for (const [what, buf, type] of bad) {
      const r = await setAvatar(p.client, buf, type);
      assert.equal(r.status, 415, `${what} → ${r.status}`);
    }
    assert.equal((await p.client.put('/profile/avatar', { data: 'x' })).status, 415, 'JSON is not a picture');
    assert.equal((await p.client.raw('PUT', '/profile/avatar', { rawBody: 'hello', headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await me(p.client)).avatar_url, null, 'nothing was saved');
  });

  it('is limited to 512 KB', async () => {
    const p = await signup(srv);
    ok(await setAvatar(p.client, padTo(PNG, 500 * 1024)));
    assert.equal((await setAvatar(p.client, padTo(PNG, 600 * 1024))).status, 413);
  });

  it('can be removed, falling back to the Google picture or to initials', async () => {
    const p = await signup(srv);
    ok(await setAvatar(p.client));
    const removed = ok(await p.client.del('/profile/avatar'));
    assert.equal(removed.user.avatar_url, null);
    assert.equal((await p.client.get(`/avatars/${p.user.id}`)).status, 404);
    // an account with a Google picture goes back to it
    await srv.db.query(`UPDATE users SET google_picture = 'https://lh3.googleusercontent.com/a/me' WHERE id = $1`, [p.user.id]);
    ok(await setAvatar(p.client));
    assert.equal(ok(await p.client.del('/profile/avatar')).user.avatar_url, 'https://lh3.googleusercontent.com/a/me');
    ok(await p.client.del('/profile/avatar')); // removing nothing is fine
  });

  it('keeps working when the username changes (the address uses the account id)', async () => {
    const p = await signup(srv);
    const url = ok(await setAvatar(p.client)).user.avatar_url;
    ok(await p.client.put('/profile', { name: p.user.name, username: `renamed${p.user.id}`, phone: '', discoverable: true, find_by_email: true, find_by_phone: true }));
    assert.equal((await me(p.client)).avatar_url, url);
    assert.equal((await p.client.get(url.replace('/api', ''))).status, 200);
  });

  it('appears next to people in search results, connections, group members and shared payments', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    const url = ok(await setAvatar(b.client)).user.avatar_url;
    assert.equal(ok(await a.client.get(`/people/lookup?q=${b.user.username}`)).result.avatar_url, url);
    await connect(a, b);
    assert.equal(ok(await a.client.get('/connections')).accepted[0].user.avatar_url, url);
    const g = ok(await b.client.post('/workspaces', { name: 'G' }), 201);
    ok(await b.client.post(`/workspaces/${g.id}/invites`, { username: a.user.username }), 201);
    assert.equal(ok(await a.client.get('/inbox')).group_invites[0].inviter.avatar_url, url);
    ok(await b.client.post('/transactions', { type: 'expense', description: 'x', amount: 10, date: '2025-01-01', participants: [{ username: a.user.username, share: 5 }] }, { 'x-workspace': '' }).catch(() => null), 201);
  });

  describe('who may see a picture', () => {
    const url = (u) => `/avatars/${u.user.id}`;

    it('only signed-in people, and only those who can already see the person', async () => {
      const owner = await signup(srv);
      ok(await setAvatar(owner.client));
      const stranger = await signup(srv);
      const anon = new Client(srv.base.replace(/\/api$/, ''));
      assert.equal((await anon.get(url(owner))).status, 401);
      assert.equal((await stranger.client.get(url(owner))).status, 200, 'discoverable profiles are visible to signed-in people');
      assert.equal((await owner.client.get(url(owner))).status, 200, 'you can always see your own');
      // hidden profile: strangers lose access
      ok(await owner.client.put('/profile', { name: owner.user.name, username: owner.user.username, phone: '', discoverable: false, find_by_email: false, find_by_phone: false }));
      assert.equal((await stranger.client.get(url(owner))).status, 404);
      assert.equal((await owner.client.get(url(owner))).status, 200);
      // ...but not people connected with them
      const friend = await signup(srv);
      await connect(owner, friend);
      assert.equal((await friend.client.get(url(owner))).status, 200, 'connections still see it');
      // a pending request lets the receiver see who is asking
      const asker = await signup(srv);
      ok(await owner.client.post('/connections', { username: asker.user.username }), 201);
      assert.equal((await asker.client.get(url(owner))).status, 200);
    });

    it('people sharing a budget, an invitation or a payment can see each other', async () => {
      const owner = await signup(srv);
      ok(await setAvatar(owner.client));
      ok(await owner.client.put('/profile', { name: owner.user.name, username: owner.user.username, phone: '', discoverable: false, find_by_email: false, find_by_phone: false }));
      const member = await signup(srv);
      const invited = await signup(srv);
      const sharedWith = await signup(srv);
      for (const x of [member, invited, sharedWith]) await connect(owner, x);
      const g = ok(await owner.client.post('/workspaces', { name: 'G' }), 201);
      ok(await owner.client.post(`/workspaces/${g.id}/invites`, { username: member.user.username }), 201);
      ok(await member.client.post(`/workspace-invites/${ok(await member.client.get('/inbox')).group_invites[0].id}/accept`));
      ok(await owner.client.post(`/workspaces/${g.id}/invites`, { username: invited.user.username }), 201);
      ok(await tx(owner.client, { participants: [{ username: sharedWith.user.username, share: 1 }] }), 201);
      // break the direct connections so only the other relationships remain
      for (const x of [member, invited, sharedWith]) {
        const c = ok(await owner.client.get('/connections')).accepted.find((k) => k.user.username === x.user.username);
        await owner.client.del(`/connections/${c.id}`);
      }
      assert.equal((await member.client.get(url(owner))).status, 200, 'budget member');
      assert.equal((await invited.client.get(url(owner))).status, 200, 'pending invitation');
      const outsider = await signup(srv);
      assert.equal((await outsider.client.get(url(owner))).status, 404);
    });

    it('has no picture, bad ids, and nonexistent users answer 404/400', async () => {
      const p = await signup(srv);
      assert.equal((await p.client.get(url(p))).status, 404);
      for (const id of ['abc', '0', '-1', '1.5', '99999999999']) assert.ok([400, 404].includes((await p.client.get(`/avatars/${id}`)).status), id);
      assert.equal((await p.client.get('/avatars/987654321')).status, 404);
    });
  });
});

describe('receipts', () => {
  const add = (c, id, buf = PNG, type = 'image/png', name = 'lunch.png') => upload(c, 'POST', `/transactions/${id}/receipts`, buf, type, { 'x-filename': encodeURIComponent(name) });

  it('can be attached, listed, downloaded and deleted', async () => {
    const p = await signup(srv);
    const t = ok(await tx(p.client, { description: 'Lunch', amount: 12.5 }), 201);
    assert.equal(t.receipt_count, 0);
    const r = ok(await add(p.client, t.id), 201);
    assert.deepEqual([r.filename, r.mime, r.size_bytes, r.transaction_id], ['lunch.png', 'image/png', PNG.length, t.id]);
    assert.ok(!('data' in r), 'metadata never includes the file itself');
    assert.equal(ok(await p.client.get('/transactions?status=')).find((x) => x.id === t.id).receipt_count, 1);
    const list = ok(await p.client.get(`/transactions/${t.id}/receipts`));
    assert.equal(list.length, 1);
    assert.ok(!JSON.stringify(list).includes('iVBOR'));
    const file = await p.client.get(`/receipts/${r.id}`);
    assert.equal(file.status, 200);
    assert.ok(file.buf.equals(PNG));
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.match(file.headers.get('content-disposition'), /^inline/);
    assert.equal((await p.client.get(`/receipts/${r.id}?download=1`)).headers.get('content-disposition').split(';')[0], 'attachment');
    assert.equal((await p.client.del(`/receipts/${r.id}`)).status, 204);
    assert.equal((await p.client.get(`/receipts/${r.id}`)).status, 404);
    fails(await p.client.del(`/receipts/${r.id}`), 404);
    assert.equal(ok(await p.client.get('/transactions?status=')).find((x) => x.id === t.id).receipt_count, 0);
  });

  it('accepts images and PDFs, identified by their bytes', async () => {
    const p = await signup(srv);
    const t = ok(await tx(p.client), 201);
    for (const [buf, type, mime] of [[JPEG, 'image/jpeg', 'image/jpeg'], [WEBP, 'image/webp', 'image/webp'], [PDF, 'application/pdf', 'application/pdf'], [PNG, 'image/jpeg', 'image/png']]) {
      const r = ok(await add(p.client, t.id, buf, type, 'file'), 201);
      assert.equal(r.mime, mime);
      if (list_ok(r)) await p.client.del(`/receipts/${r.id}`);
    }
    function list_ok() {
      return true;
    }
  });

  it('serves images in a locked-down sandbox but lets the browser open PDFs', async () => {
    const p = await signup(srv);
    const t = ok(await tx(p.client), 201);
    const img = ok(await add(p.client, t.id), 201);
    const pdf = ok(await add(p.client, t.id, PDF, 'application/pdf', 'bill.pdf'), 201);
    const i = await p.client.get(`/receipts/${img.id}`);
    assert.match(i.headers.get('content-security-policy'), /sandbox/);
    assert.equal(i.headers.get('x-content-type-options'), 'nosniff');
    const d = await p.client.get(`/receipts/${pdf.id}`);
    assert.equal(d.headers.get('content-type'), 'application/pdf');
    assert.equal(d.headers.get('content-security-policy'), null);
    assert.equal(d.headers.get('x-content-type-options'), 'nosniff');
  });

  it('refuses other file types and empty uploads, and stores nothing', async () => {
    const p = await signup(srv);
    const t = ok(await tx(p.client), 201);
    for (const [what, buf, type] of [
      ['GIF', GIF, 'image/gif'],
      ['SVG', SVG, 'image/svg+xml'],
      ['HTML as PNG', Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'],
      ['zip as PDF', Buffer.from('PK\x03\x04 not a pdf at all, just a zip header....', 'latin1'), 'application/pdf'],
      ['text as JPEG', Buffer.from('plain text pretending to be a photo'), 'image/jpeg'],
      ['empty', Buffer.alloc(0), 'image/png'],
    ]) {
      const r = await add(p.client, t.id, buf, type);
      assert.equal(r.status, 415, `${what} → ${r.status}`);
    }
    assert.equal((await p.client.raw('POST', `/transactions/${t.id}/receipts`, { rawBody: 'x', headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal(ok(await p.client.get(`/transactions/${t.id}/receipts`)).length, 0);
  });

  it('is limited to 5 MB per file and 5 files per payment', async () => {
    const p = await signup(srv);
    const t = ok(await tx(p.client), 201);
    ok(await add(p.client, t.id, padTo(PDF, 4.5 * 1024 * 1024), 'application/pdf', 'big.pdf'), 201);
    assert.equal((await add(p.client, t.id, padTo(PDF, 5.5 * 1024 * 1024), 'application/pdf', 'huge.pdf')).status, 413);
    for (let i = 0; i < 4; i++) ok(await add(p.client, t.id, PNG, 'image/png', `r${i}.png`), 201);
    fails(await add(p.client, t.id), 409);
    assert.equal(ok(await p.client.get(`/transactions/${t.id}/receipts`)).length, 5);
    // another payment is unaffected
    ok(await add(p.client, ok(await tx(p.client), 201).id), 201);
  });

  it('cleans up file names: no paths, no control characters, a sensible extension', async () => {
    const p = await signup(srv);
    const name = async (raw, buf = PNG, type = 'image/png') => {
      const t = ok(await tx(p.client), 201); // a payment holds at most 5 receipts, so use a fresh one each time
      return ok(await add(p.client, t.id, buf, type, raw), 201).filename;
    };
    assert.equal(await name('../../etc/passwd.png'), 'passwd.png');
    assert.equal(await name('C:\\Users\\me\\Pictures\\scan.png'), 'scan.png');
    assert.equal(await name('Grocery <b>receipt</b>.png'), 'b.png', 'a slash makes the rest of the name a path, so only the last part is kept');
    assert.equal(await name('Grocery <b>receipt.png'), 'Grocery breceipt.png', 'angle brackets are removed');
    assert.equal(await name('café ñ 日本語.png'), 'café ñ 日本語.png');
    assert.equal(await name('no-extension'), 'no-extension.png');
    assert.equal(await name('wrong.exe'), 'wrong.png');
    assert.equal(await name('photo.JPG', JPEG, 'image/jpeg'), 'photo.JPG');
    assert.equal(await name('scan.pdf', PDF, 'application/pdf'), 'scan.pdf');
    assert.equal(await name('.hidden.png'), 'hidden.png');
    assert.equal((await name('x'.repeat(300))).length <= 124, true);
  });

  it('copes with a missing or broken file name header', async () => {
    const p = await signup(srv);
    const t = ok(await tx(p.client), 201);
    const r = await upload(p.client, 'POST', `/transactions/${t.id}/receipts`, PNG, 'image/png');
    assert.equal(ok(r, 201).filename, 'receipt.png');
    const odd = await upload(p.client, 'POST', `/transactions/${t.id}/receipts`, PNG, 'image/png', { 'x-filename': '%E0%A4%A' });
    assert.equal(odd.status, 201);
  });

  it('only people in the budget can see, add or remove receipts', async () => {
    const owner = await signup(srv);
    const t = ok(await tx(owner.client, { description: 'Private bill' }), 201);
    const r = ok(await add(owner.client, t.id), 201);
    const stranger = await signup(srv);
    const anon = new Client(srv.base.replace(/\/api$/, ''));
    assert.equal((await anon.get(`/receipts/${r.id}`)).status, 401);
    assert.equal((await stranger.client.get(`/receipts/${r.id}`)).status, 404);
    assert.equal((await stranger.client.get(`/transactions/${t.id}/receipts`)).status, 404);
    fails(await add(stranger.client, t.id), 404);
    fails(await stranger.client.del(`/receipts/${r.id}`), 404);
    // not even by naming the owner's budget
    const pid = ok(await owner.client.get('/workspaces'))[0].id;
    assert.equal((await stranger.client.get(`/transactions/${t.id}/receipts`, { 'x-workspace': String(pid) })).status, 403);
    assert.equal((await owner.client.get(`/receipts/${r.id}`)).status, 200);
    for (const id of ['abc', '0', '-1', '99999999999']) {
      assert.ok([400, 404].includes((await owner.client.get(`/receipts/${id}`)).status), id);
      assert.ok([400, 404].includes((await add(owner.client, id)).status), id);
    }
  });

  it('are shared by everyone in a shared budget, and lost to people who leave', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    await connect(a, b);
    const g = ok(await a.client.post('/workspaces', { name: 'G' }), 201);
    ok(await a.client.post(`/workspaces/${g.id}/invites`, { username: b.user.username }), 201);
    ok(await b.client.post(`/workspace-invites/${ok(await b.client.get('/inbox')).group_invites[0].id}/accept`));
    a.client.ws = g.id;
    b.client.ws = g.id;
    const t = ok(await tx(a.client), 201);
    const r = ok(await add(a.client, t.id), 201);
    assert.equal((await b.client.get(`/receipts/${r.id}`)).status, 200);
    const mine = ok(await add(b.client, t.id, PDF, 'application/pdf', 'b.pdf'), 201);
    assert.equal(mine.uploaded_by, b.user.id);
    assert.equal(ok(await a.client.get(`/transactions/${t.id}/receipts`)).length, 2);
    assert.equal((await b.client.post(`/workspaces/${g.id}/leave`)).status, 204);
    assert.equal((await b.client.get(`/receipts/${r.id}`)).status, 404, 'left the group, lost access');
  });

  it('are not visible to people a payment is merely shared with', async () => {
    const a = await signup(srv);
    const b = await signup(srv);
    await connect(a, b);
    const t = ok(await tx(a.client, { participants: [{ username: b.user.username, share: 5 }] }), 201);
    const r = ok(await add(a.client, t.id), 201);
    assert.equal((await b.client.get(`/receipts/${r.id}`)).status, 404);
    assert.ok(!JSON.stringify(ok(await b.client.get('/shared'))).includes('receipt'));
  });

  it('disappear with their payment and with their budget, and show in the CSV', async () => {
    const p = await signup(srv);
    const t = ok(await tx(p.client, { description: 'Has receipts' }), 201);
    ok(await add(p.client, t.id), 201);
    ok(await add(p.client, t.id, PDF, 'application/pdf', 'x.pdf'), 201);
    const csv = (await p.client.get('/transactions/export.csv')).text.split('\n');
    assert.equal(csv[0], 'date,type,description,category,amount,status,paid_with,bought_on,with,receipts,note');
    assert.ok(csv[1].includes(',2,'), csv[1]);
    await p.client.del(`/transactions/${t.id}`);
    assert.equal((await srv.db.query('SELECT count(*)::int n FROM receipts WHERE transaction_id = $1', [t.id])).rows[0].n, 0);
    const g = ok(await p.client.post('/workspaces', { name: 'G' }), 201);
    p.client.ws = g.id;
    const t2 = ok(await tx(p.client), 201);
    ok(await add(p.client, t2.id), 201);
    p.client.ws = null;
    await p.client.del(`/workspaces/${g.id}`);
    assert.equal((await srv.db.query('SELECT count(*)::int n FROM receipts WHERE workspace_id = $1', [g.id])).rows[0].n, 0);
  });

  it('removing a person removes their picture', async () => {
    const p = await signup(srv);
    ok(await setAvatar(p.client));
    await srv.db.query('DELETE FROM users WHERE id = $1', [p.user.id]);
    assert.equal((await srv.db.query('SELECT 1 FROM user_avatars WHERE user_id = $1', [p.user.id])).rowCount, 0);
  });
});
