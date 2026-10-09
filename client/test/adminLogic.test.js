import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agoText, checkSummary, messagePreview, replyHref, minutesLeft, viewAsProblem, deleteConfirmed, eventWho, formatBytes, percent, personBadges, rangeText, signInMethods, signupBars, uptimeText } from '../src/adminLogic.js';

describe('sizes and times', () => {
  it('writes sizes in units a person reads', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(-5), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5 MB');
    assert.equal(formatBytes(1024 ** 3 * 2.25), '2.3 GB');
    assert.equal(formatBytes('nonsense'), '0 B');
    assert.equal(formatBytes(null), '0 B');
  });
  it('writes how long the server has been up', () => {
    assert.equal(uptimeText(5), '5 s');
    assert.equal(uptimeText(200), '3 min');
    assert.equal(uptimeText(3600 * 3 + 60 * 20), '3 h 20 min');
    assert.equal(uptimeText(86400), '1 day 0 h');
    assert.equal(uptimeText(86400 * 2 + 3600 * 7), '2 days 7 h');
    assert.equal(uptimeText(-3), '0 s');
    assert.equal(uptimeText(undefined), '0 s');
  });
  it('says how long ago something was, or never', () => {
    const now = Date.parse('2026-10-08T12:00:00Z');
    const ago = (s) => new Date(now - s * 1000).toISOString();
    assert.equal(agoText(null, now), 'never');
    assert.equal(agoText(undefined, now), 'never');
    assert.equal(agoText(ago(10), now), 'just now');
    assert.equal(agoText(ago(300), now), '5 min ago');
    assert.equal(agoText(ago(3 * 3600), now), '3 h ago');
    assert.equal(agoText(ago(86400), now), 'yesterday');
    assert.equal(agoText(ago(5 * 86400), now), '5 days ago');
    assert.equal(agoText(ago(65 * 86400), now), '2 months ago');
    assert.equal(agoText(ago(400 * 86400), now), '1 year ago');
  });
});

describe('the sign-ups chart', () => {
  const days = [0, 2, 5, 1, 0].map((count, i) => ({ day: `2026-10-0${i + 1}`, count }));
  it('scales bars to the tallest day, keeps a day with people visible and an empty day empty', () => {
    const c = signupBars(days);
    assert.deepEqual(c.bars.map((b) => b.pct), [0, 40, 100, 20, 0]);
    assert.equal(c.max, 5);
    assert.equal(c.total, 8);
    assert.equal(c.busiest.day, '2026-10-03');
    const tiny = signupBars([{ day: 'a', count: 1 }, { day: 'b', count: 1000 }]);
    assert.equal(tiny.bars[0].pct, 4, 'a day with someone never shrinks to nothing');
  });
  it('copes with no data or only empty days', () => {
    assert.deepEqual(signupBars([]), { max: 0, total: 0, busiest: null, bars: [] });
    assert.deepEqual(signupBars(undefined), { max: 0, total: 0, busiest: null, bars: [] });
    const quiet = signupBars([{ day: 'a', count: 0 }, { day: 'b', count: 0 }]);
    assert.deepEqual([quiet.max, quiet.total, quiet.busiest, quiet.bars.map((b) => b.pct)], [0, 0, null, [0, 0]]);
  });
  it('turns strange counts into numbers', () => {
    assert.deepEqual(signupBars([{ day: 'a', count: '3' }, { day: 'b', count: null }]).bars.map((b) => b.count), [3, 0]);
  });
});

describe('lists', () => {
  it('says which part of a list is shown', () => {
    assert.equal(rangeText(1, 25, 61), 'Showing 1 to 25 of 61');
    assert.equal(rangeText(3, 25, 61), 'Showing 51 to 61 of 61');
    assert.equal(rangeText(1, 25, 1), 'Showing 1 to 1 of 1');
    assert.equal(rangeText(1, 25, 0), 'Nothing to show');
  });
});

describe('people', () => {
  const base = { is_admin: false, suspended: false, email_verified: true, has_password: true, google_linked: false };
  it('labels what and how a person is', () => {
    assert.deepEqual(personBadges(base), [{ label: 'Active', tone: 'ok' }]);
    assert.deepEqual(personBadges({ ...base, suspended: true }).map((b) => b.label), ['Suspended']);
    assert.deepEqual(personBadges({ ...base, email_verified: false }).map((b) => b.label), ['Active', 'E-mail not confirmed']);
    assert.deepEqual(personBadges({ ...base, is_admin: true }).map((b) => b.label), ['Admin', 'Active']);
    assert.deepEqual(personBadges({ ...base, is_admin: true, suspended: true, email_verified: false }).map((b) => b.label), ['Admin', 'Suspended', 'E-mail not confirmed']);
  });
  it('says how they sign in', () => {
    assert.equal(signInMethods(base), 'Password');
    assert.equal(signInMethods({ has_password: false, google_linked: true }), 'Google');
    assert.equal(signInMethods({ has_password: true, google_linked: true }), 'Password and Google');
    assert.equal(signInMethods({ has_password: false, google_linked: false }), 'None');
  });
  it('wants the username typed to delete, in any case', () => {
    assert.equal(deleteConfirmed('Anita', 'anita'), true);
    assert.equal(deleteConfirmed('  anita  ', 'anita'), true);
    assert.equal(deleteConfirmed('anit', 'anita'), false);
    assert.equal(deleteConfirmed('', 'anita'), false);
    assert.equal(deleteConfirmed(undefined, 'anita'), false);
    assert.equal(deleteConfirmed('anything', ''), false, 'nothing is confirmed against nothing');
  });
});

describe('events and checks', () => {
  it('names who an event is about and who did it', () => {
    assert.deepEqual(eventWho({ user_name: 'Sam', user_username: 'sam' }), { person: 'Sam (@sam)', actor: null });
    assert.deepEqual(eventWho({ user_name: 'Sam', user_username: 'sam', actor_name: 'Ann', actor_username: 'ann' }), { person: 'Sam (@sam)', actor: 'Ann (@ann)' });
    assert.equal(eventWho({ user_id: 7 }).person, 'A person');
    assert.equal(eventWho({}).person, 'No account');
    assert.equal(eventWho({ kind: 'login_failed' }).person, 'No account', 'a failed sign-in for someone who has no account');
    assert.equal(eventWho({ kind: 'signup' }).person, 'Deleted account', 'an event about a person who was deleted since');
    assert.equal(eventWho({ kind: 'admin_delete', actor_name: 'Ann', actor_username: 'ann' }).actor, 'Ann (@ann)');
  });
  it('counts the going-public checks', () => {
    assert.deepEqual(checkSummary([{ ok: true }, { ok: false }, { ok: true }]), { done: 2, total: 3, allOk: false });
    assert.deepEqual(checkSummary([{ ok: true }]), { done: 1, total: 1, allOk: true });
    assert.deepEqual(checkSummary([]), { done: 0, total: 0, allOk: false });
    assert.deepEqual(checkSummary(undefined), { done: 0, total: 0, allOk: false });
  });
  it('works out a share', () => {
    assert.equal(percent(12, 40), 30);
    assert.equal(percent(1, 3), 33);
    assert.equal(percent(5, 0), 0);
    assert.equal(percent(0, 10), 0);
  });
});

describe('viewing as someone', () => {
  it('counts the minutes left, rounding up and never going below nothing', () => {
    const now = Date.parse('2026-10-08T12:00:00Z');
    const at = (sec) => new Date(now + sec * 1000).toISOString();
    assert.equal(minutesLeft(at(30 * 60), now), 30);
    assert.equal(minutesLeft(at(29 * 60 + 1), now), 30, 'part of a minute counts as a minute');
    assert.equal(minutesLeft(at(61), now), 2);
    assert.equal(minutesLeft(at(1), now), 1);
    assert.equal(minutesLeft(at(0), now), 0);
    assert.equal(minutesLeft(at(-500), now), 0, 'time is up');
  });
  it('says what is missing before it can start: a reason, and the admin password when they have one', () => {
    assert.equal(viewAsProblem({ reason: '', password: 'x' }, true), 'Say why, in a few words.');
    assert.equal(viewAsProblem({ reason: '  abc ', password: 'x' }, true), 'Say why, in a few words.', 'spaces do not count');
    assert.equal(viewAsProblem({ reason: undefined, password: 'x' }, false), 'Say why, in a few words.');
    assert.equal(viewAsProblem({ reason: 'missing payment', password: '' }, true), 'Type your password to confirm it is you.');
    assert.equal(viewAsProblem({ reason: 'missing payment', password: 'x' }, true), null);
    assert.equal(viewAsProblem({ reason: 'missing payment', password: '' }, false), null, 'an admin who signs in with Google has no password to type');
  });
});

describe('messages from the contact form', () => {
  it('the closed row shows the first line, cut short with an ellipsis, on one line', () => {
    assert.equal(messagePreview('Hello there\nsecond line'), 'Hello there');
    assert.equal(messagePreview('\n\n  spaced   out \t words  \nmore'), 'spaced out words');
    assert.equal(messagePreview('x'.repeat(200), 20), `${'x'.repeat(19)}…`);
    assert.equal(messagePreview('exactly ten', 11), 'exactly ten');
    assert.equal(messagePreview(''), '');
    assert.equal(messagePreview(null), '');
  });

  it('the reply link is addressed to the writer, with a subject naming the topic, and nothing in it can break out', () => {
    assert.equal(replyHref({ email: 'sam@example.com', topic_label: 'Something is wrong' }), 'mailto:sam@example.com?subject=Re%3A%20your%20message%20to%20Penny%20(Something%20is%20wrong)');
    const h = replyHref({ email: 'a+b@example.com', topic_label: 'Q&A?' });
    assert.ok(h.startsWith('mailto:a%2Bb@example.com?subject='), h);
    assert.ok(!h.slice(h.indexOf('?') + 1).includes('&'), 'a topic cannot add a header such as bcc');
  });
});
