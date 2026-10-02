import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generatedSvg, illustratedSvg, rng } from '../src/components/avatar/art.js';
import { avatarTone, initialsOf } from '../src/components/avatar/identity.js';
import { DEFAULT_LAYOUT, normalizeLayout, WIDGETS } from '../src/prefsLogic.js';

describe('initials', () => {
  it('uses the first letter of the first two words', () => {
    assert.equal(initialsOf('Alex Morgan'), 'AM');
    assert.equal(initialsOf('priya nair'), 'PN');
    assert.equal(initialsOf('Sam'), 'S');
    assert.equal(initialsOf('Jean Luc Picard'), 'JL');
  });
  it('is not confused by the letter s, extra spaces or an empty name (an old bug split names on "s")', () => {
    assert.equal(initialsOf('Sasha Stevens'), 'SS');
    assert.equal(initialsOf('  Alex   Morgan  '), 'AM');
    assert.equal(initialsOf(''), '');
    assert.equal(initialsOf('   '), '');
    assert.equal(initialsOf(undefined), '');
  });
});

describe('avatar colour', () => {
  it('is stable for a person and always one of the eight tones', () => {
    assert.equal(avatarTone('alex'), avatarTone('alex'));
    for (const k of ['alex', 'sam', 'priya', 'jordan', 'x', '', '🙂', 'a'.repeat(500)]) {
      const t = avatarTone(k);
      assert.ok(Number.isInteger(t) && t >= 0 && t < 8, `${k.slice(0, 8)} -> ${t}`);
    }
  });
  it('spreads different people over several tones', () => {
    const tones = new Set(['alex', 'sam', 'priya', 'jordan', 'chris', 'dana', 'lee', 'kim', 'noor', 'omar'].map(avatarTone));
    assert.ok(tones.size >= 4);
  });
});

describe('generated and illustrated avatars', () => {
  it('the same seed always draws the same picture, different seeds differ', () => {
    assert.equal(generatedSvg('a-0-1'), generatedSvg('a-0-1'));
    assert.equal(illustratedSvg('a-0-1'), illustratedSvg('a-0-1'));
    assert.notEqual(generatedSvg('a-0-1'), generatedSvg('a-0-2'));
    assert.notEqual(illustratedSvg('a-0-1'), illustratedSvg('a-0-2'));
  });
  it('produce a self-contained, script-free SVG at the requested size', () => {
    for (const make of [generatedSvg, illustratedSvg]) {
      for (const seed of ['x', 'alex-0-3', '<script>', '"; onload="x']) {
        const svg = make(seed, 96);
        assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64" width="96" height="96"/);
        assert.doesNotMatch(svg, /<script|onload|onclick|href=|<image|<foreignObject/i, 'nothing executable or external, whatever the seed');
        assert.ok(svg.trimEnd().endsWith('</svg>'));
      }
    }
  });
  it('the random generator is deterministic and stays in range', () => {
    const a = rng('seed');
    const b = rng('seed');
    for (let i = 0; i < 50; i++) {
      const v = a();
      assert.equal(v, b());
      assert.ok(v >= 0 && v < 1);
    }
    assert.notEqual(rng('one')(), rng('two')());
  });
});

describe('dashboard layout', () => {
  it('starts from the default when nothing was saved', () => {
    assert.deepEqual(normalizeLayout(), DEFAULT_LAYOUT);
    assert.deepEqual(normalizeLayout({}), DEFAULT_LAYOUT);
    assert.deepEqual(normalizeLayout(null ?? undefined), DEFAULT_LAYOUT);
  });
  it('keeps a saved order, and appends widgets added since (so an old save never hides a new one)', () => {
    const out = normalizeLayout({ order: ['spending', 'hero'] });
    assert.deepEqual(out.order.slice(0, 2), ['spending', 'hero']);
    assert.equal(new Set(out.order).size, WIDGETS.length);
    assert.deepEqual([...out.order].sort(), [...WIDGETS].sort());
  });
  it('drops widgets that no longer exist and duplicates', () => {
    const out = normalizeLayout({ order: ['hero', 'ghost', 'hero', 'upcoming'], hidden: ['ghost', 'recurring', 'recurring'] });
    assert.ok(!out.order.includes('ghost'));
    assert.deepEqual(out.hidden, ['recurring']);
    assert.equal(out.order.filter((w) => w === 'hero').length, 1);
  });
  it('merges sizes over the defaults', () => {
    const out = normalizeLayout({ sizes: { hero: 's' } });
    assert.equal(out.sizes.hero, 's');
    assert.equal(out.sizes.upcoming, DEFAULT_LAYOUT.sizes.upcoming);
  });
  it('ignores values of the wrong type', () => {
    assert.deepEqual(normalizeLayout({ order: 'hero', hidden: 7 }).hidden, []);
    assert.equal(normalizeLayout({ order: 'hero' }).order.length, WIDGETS.length);
  });
});
