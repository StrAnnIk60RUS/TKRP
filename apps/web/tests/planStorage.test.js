import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLocalSnapshotToken,
  getCurrentPlanState,
  loadPlanFromHistory
} from '../src/features/content-plan/model/planStorage.js';

// Setup mock localStorage in Node.js environment
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, val) => storage.set(key, String(val)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  get length() {
    return storage.size;
  },
  key: (i) => Array.from(storage.keys())[i] ?? null
};

test('isLocalSnapshotToken correctly identifies local tokens', () => {
  assert.equal(isLocalSnapshotToken('local_1792852405268'), true);
  assert.equal(isLocalSnapshotToken('local_abc'), true);
  assert.equal(isLocalSnapshotToken('558eab0bb73b4613be8d1a48ed583140'), false);
  assert.equal(isLocalSnapshotToken(null), false);
  assert.equal(isLocalSnapshotToken(''), false);
});

test('getCurrentPlanState loads local snapshot directly without server call', async () => {
  storage.clear();
  storage.set('tkrp_user_id', 'test_user_1');
  const samplePlan = {
    plan_id: 'test_local_plan',
    display_name: 'Test Plan',
    publications: [{ id: 'p1', topic: 'Topic 1' }]
  };
  const token = 'local_1792852405268';

  storage.set('currentContentPlanSnapshotToken:test_user_1', JSON.stringify(token));
  storage.set(`demoPlanSnapshot:${token}`, JSON.stringify({ plan: samplePlan, optimization: null }));

  const state = await getCurrentPlanState();
  assert.ok(state);
  assert.equal(state.token, token);
  assert.equal(state.plan.plan_id, 'test_local_plan');
  assert.equal(state.plan.display_name, 'Test Plan');
});

test('loadPlanFromHistory loads local snapshot from localStorage without error', async () => {
  storage.clear();
  storage.set('tkrp_user_id', 'test_user_1');
  const samplePlan = {
    plan_id: 'test_history_plan',
    display_name: 'History Plan',
    publications: []
  };
  const token = 'local_1792852405268';
  const entry = {
    id: 'test_history_plan',
    type: 'draft',
    saved_at: '2026-10-30T10:00:00.000Z',
    snapshot_token: token,
    summary: { plan_id: 'test_history_plan' }
  };

  storage.set('contentPlanHistory:test_user_1', JSON.stringify([entry]));
  storage.set(`demoPlanSnapshot:${token}`, JSON.stringify({ plan: samplePlan, optimization: null }));

  const res = await loadPlanFromHistory('test_history_plan', 'draft', '2026-10-30T10:00:00.000Z');
  assert.ok(res);
  assert.equal(res.plan.plan_id, 'test_history_plan');
});
