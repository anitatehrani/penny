import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_LAYOUT, WIDGETS as CLIENT_WIDGETS } from '../../client/src/prefsLogic.js';
import { ADMIN_NAV, MOBILE_PRIMARY, NAV } from '../../client/src/layout/nav.js';
import { KIND_ICON } from '../../client/src/components/notifMeta.js';
import { KIND_PREF, KINDS } from '../src/lib/notifications.js';
import { ROUTES, WIDGETS } from '../src/routes/preferences.js';

// Lists that the server and the browser each keep their own copy of must say the same thing.
describe('the browser and the server agree', () => {
  it('on the dashboard widgets, in the same order', () => {
    assert.deepEqual(CLIENT_WIDGETS, WIDGETS);
    assert.deepEqual([...DEFAULT_LAYOUT.order].sort(), [...WIDGETS].sort());
    assert.deepEqual(Object.keys(DEFAULT_LAYOUT.sizes).sort(), [...WIDGETS].sort());
  });

  it('on the menu items a person may pin: every item of the menu is accepted, and nothing else is', () => {
    assert.deepEqual(NAV.map((n) => n.id).sort(), [...ROUTES].sort());
    assert.ok(!ROUTES.includes(ADMIN_NAV.id), 'the admin link is not pinnable');
    for (const id of MOBILE_PRIMARY) assert.ok(NAV.some((n) => n.id === id), `${id} is in the bottom bar and in the menu`);
  });

  it('on the kinds of notification: each has an icon and a switch (or none on purpose)', () => {
    for (const kind of KINDS) {
      assert.ok(KIND_ICON[kind], `${kind} has an icon`);
      assert.ok(kind in KIND_PREF);
    }
    for (const kind of Object.keys(KIND_ICON)) assert.ok(KINDS.includes(kind), `${kind} is a real kind`);
  });
});
