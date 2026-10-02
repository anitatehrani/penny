import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { timeAgo } from '../src/format.js';

const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

describe('timeAgo', () => {
  it('uses friendly wording for recent times', () => {
    assert.equal(timeAgo(ago(5)), 'just now');
    assert.equal(timeAgo(ago(44)), 'just now');
    assert.equal(timeAgo(ago(60)), '1 min ago');
    assert.equal(timeAgo(ago(50 * 60)), '50 min ago');
    assert.equal(timeAgo(ago(3 * 3600)), '3 h ago');
    assert.equal(timeAgo(ago(30 * 3600)), 'yesterday');
    assert.equal(timeAgo(ago(4 * 86400)), '4 days ago');
  });

  it('falls back to a date after a week, and never says "0 min ago"', () => {
    assert.match(timeAgo(ago(20 * 86400)), /\d/);
    assert.doesNotMatch(timeAgo(ago(20 * 86400)), /ago/);
    assert.doesNotMatch(timeAgo(ago(46)), /^0/);
  });

  it('treats a time slightly in the future (clock drift) as just now', () => {
    assert.equal(timeAgo(new Date(Date.now() + 5000).toISOString()), 'just now');
  });
});
