import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installNumberWheelGuard, wheelWouldChangeNumber } from '../src/numberInputs.js';

const input = (type = 'number') => ({ tagName: 'INPUT', type, blurred: 0, blur() { this.blurred += 1; } });

describe('a wheel over a focused number box', () => {
  it('would change it, so it is recognised', () => {
    const a = input();
    assert.equal(wheelWouldChangeNumber(a, a), true);
  });
  it('does nothing to a number box that is not focused, a text box, or nothing at all', () => {
    const a = input();
    assert.equal(wheelWouldChangeNumber(a, input()), false, 'another element has focus');
    const t = input('text');
    assert.equal(wheelWouldChangeNumber(t, t), false, 'a text box does not change on wheel');
    assert.equal(wheelWouldChangeNumber(null, null), false);
    assert.equal(wheelWouldChangeNumber(undefined, a), false);
    assert.equal(wheelWouldChangeNumber({ tagName: 'DIV', type: 'number' }, null), false);
  });
  it('is recognised whatever the case of the tag and type', () => {
    const a = { tagName: 'input', type: 'NUMBER' };
    assert.equal(wheelWouldChangeNumber(a, a), true);
  });
});

describe('the page-wide guard', () => {
  const fakeDoc = (active) => {
    const listeners = [];
    return {
      activeElement: active,
      addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }),
      removeEventListener: (type, fn) => {
        const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
        if (i >= 0) listeners.splice(i, 1);
      },
      listeners,
      fire: (type, event) => listeners.filter((l) => l.type === type).forEach((l) => l.fn(event)),
    };
  };

  it('lets go of the focused number box on wheel, and only that one', () => {
    const a = input();
    const b = input();
    const doc = fakeDoc(a);
    installNumberWheelGuard(doc);
    doc.fire('wheel', { target: b });
    assert.equal(b.blurred, 0, 'a box that is not focused is left alone');
    doc.fire('wheel', { target: a });
    assert.equal(a.blurred, 1);
  });

  it('listens early and passively, so scrolling is never held up, and can be switched off', () => {
    const doc = fakeDoc(null);
    const stop = installNumberWheelGuard(doc);
    assert.deepEqual(doc.listeners.map((l) => [l.type, l.opts.capture, l.opts.passive]), [['wheel', true, true]]);
    stop();
    assert.equal(doc.listeners.length, 0);
  });
});
