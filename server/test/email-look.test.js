import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accountDeletedEmail, alertEmail, contactReplyEmail, passwordChangedEmail, passwordResetEmail, testEmail, verificationEmail } from '../src/lib/emailTemplates.js';

// The look shared by every e-mail Penny sends (docs/DESIGN.md section 39).
const LINK = 'https://penny-budget.app/reset-password?token=abc123';
const mails = {
  alert: alertEmail({ name: 'Alex Morgan', today: '2026-10-10', unsubscribeUrl: 'https://penny-budget.app/unsubscribe?token=x', items: [{ kind: 'payment_overdue', title: 'Rent', body: '', data: { description: 'Rent', amount: 900, currency: 'EUR', date: '2026-10-08' } }] }),
  test: testEmail({ name: 'Alex Morgan', unsubscribeUrl: 'https://penny-budget.app/unsubscribe?token=x' }),
  verification: verificationEmail({ name: 'Alex Morgan', link: LINK }),
  reset: passwordResetEmail({ name: 'Alex Morgan', link: LINK }),
  changed: passwordChangedEmail({ name: 'Alex Morgan' }),
  deleted: accountDeletedEmail({ name: 'Alex Morgan' }),
  reply: contactReplyEmail({ name: 'Alex Morgan', reply: 'Thanks for writing.\nIt is fixed.', original: 'Something is wrong', topic: 'Something is wrong' }),
};

describe('every e-mail has the same frame', () => {
  for (const [name, m] of Object.entries(mails)) {
    it(`${name}: a complete page with the brand header, the colour strip, a dark version and a line that shows beside the subject`, () => {
      assert.match(m.html, /^<!doctype html>/i);
      assert.match(m.html, /<html lang="en">/);
      assert.match(m.html, /name="viewport"/, 'readable on a phone');
      assert.match(m.html, /name="color-scheme" content="light dark"/);
      assert.match(m.html, /@media \(prefers-color-scheme: dark\)/, 'a dark version');
      assert.match(m.html, />Penny</, 'the brand name in the header');
      assert.match(m.html, /\/icon-192\.png/, "Penny's icon");
      assert.match(m.html, /linear-gradient\(90deg,#6a4fc9,#e8409a 60%,#ff7a45\)/, 'the colour strip');
      const pre = /<div style="display:none;[^"]*">([^<]*)/.exec(m.html)?.[1].replace(/&#8199;|&zwnj;/g, '').trim();
      assert.ok(pre && pre.length > 8, `a hidden preview line, got: ${pre}`);
      assert.ok(!/<script/i.test(m.html), 'no scripts');
      assert.ok(!/<[a-z][^>]*>/i.test(m.text), 'the plain-text version has no markup');
    });
  }

  it('the layout does not depend on the page styles: the card, heading and button carry their own inline styles', () => {
    for (const m of Object.values(mails)) {
      assert.match(m.html, /<h1 class="h1 ink" style="[^"]*font-size:24px/);
      assert.match(m.html, /class="card" style="background:#ffffff;border:1px solid/);
    }
    assert.match(mails.reset.html, /<a href="[^"]*" style="display:inline-block;padding:14px 28px;color:#ffffff/, 'the button is a link with its own style');
  });

  it('links that matter also appear in full under the button, for programs that do not show buttons', () => {
    for (const name of ['verification', 'reset']) {
      const visible = mails[name].html.replace(/<[^>]*>/g, ' ');
      assert.ok(visible.includes(LINK) || visible.includes('verify-email') || visible.includes('abc123'), `${name}: the address is written out`);
      assert.match(mails[name].html, /The button not working\?/);
    }
    assert.ok(mails.verification.html.includes('Paste this address'));
  });

  it('text inside a tinted box stays readable in the dark version (it takes the page text colour)', () => {
    for (const name of ['changed', 'deleted']) assert.match(mails[name].html, /class="warn ink2"/, name);
  });

  it('every e-mail still says what it is for, and its subject', () => {
    assert.equal(mails.verification.subject, 'Confirm your e-mail address');
    assert.equal(mails.reset.subject, 'Reset your Penny password');
    assert.equal(mails.changed.subject, 'Your Penny password was changed');
    assert.equal(mails.deleted.subject, 'Your Penny account was deleted');
    assert.equal(mails.test.subject, 'Test alert from Penny');
    assert.equal(mails.reply.subject, 'Re: your message to Penny (Something is wrong)');
    assert.match(mails.alert.subject, /1 overdue payment/);
  });

  it('what a person typed is shown as text, never as markup, in every place it can appear', () => {
    const evil = '<img src=x onerror=alert(1)> & "q"';
    const r = contactReplyEmail({ name: 'A', reply: evil, original: evil, topic: 'Q' });
    const a = alertEmail({ name: 'A', today: '2026-10-10', items: [{ kind: 'ai_insight', title: evil, body: evil }] });
    for (const m of [r, a]) {
      const body = m.html.replace(/<img src="[^"]*\/icon-192\.png"[^>]*>/, '');
      assert.ok(!/<img src=x/i.test(body), 'no live tag');
      assert.ok(body.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;'));
    }
    assert.ok(!/<img src=x/i.test(alertEmail({ name: evil, today: '2026-10-10', items: [{ kind: 'ai_insight', title: 'x', body: '' }] }).html.replace(/<img src="[^"]*\/icon-192\.png"[^>]*>/, '')), 'the name in the heading too');
  });

  it('the alert groups items under coloured labels with a count, and shows each as a name with its details underneath', () => {
    const html = alertEmail({
      name: 'Alex',
      today: '2026-10-10',
      items: [
        { kind: 'payment_overdue', title: 'x', body: '', data: { description: 'Rent', amount: 900, currency: 'EUR', date: '2026-10-08', workspace: 'Home' } },
        { kind: 'payment_due', title: 'x', body: '', data: { description: 'Netflix', amount: 12.99, currency: 'EUR', date: '2026-10-12' } },
        { kind: 'payment_due', title: 'x', body: '', data: { description: 'Gym', amount: 30, currency: 'EUR', date: '2026-10-13' } },
      ],
    }).html;
    assert.match(html, /Overdue · 1/);
    assert.match(html, /Coming up · 2/);
    assert.match(html, />Rent<\/div><div[^>]*>€900\.00 · 2 days overdue \(Thu, Oct 8\) · Home</);
    assert.ok(html.indexOf('Overdue ·') < html.indexOf('Coming up ·'), 'overdue first');
  });
});
