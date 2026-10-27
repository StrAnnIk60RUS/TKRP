import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addBreadcrumb,
  getBreadcrumbs,
  clearBreadcrumbs
} from '../src/shared/lib/telemetry/breadcrumbs.js';

test('addBreadcrumb stores events and limits to max ring buffer size', () => {
  clearBreadcrumbs();

  addBreadcrumb({ category: 'ui', message: 'clicked button#1' });
  addBreadcrumb({ category: 'http', message: 'GET /api/test' });

  const crumbs = getBreadcrumbs();
  assert.equal(crumbs.length, 2);
  assert.equal(crumbs[0].category, 'ui');
  assert.equal(crumbs[1].category, 'http');

  // Fill beyond 25 entries
  for (let i = 0; i < 30; i++) {
    addBreadcrumb({ category: 'loop', message: `msg-${i}` });
  }

  const overflowCrumbs = getBreadcrumbs();
  assert.equal(overflowCrumbs.length, 25);
  assert.equal(overflowCrumbs[overflowCrumbs.length - 1].message, 'msg-29');

  clearBreadcrumbs();
  assert.equal(getBreadcrumbs().length, 0);
});
