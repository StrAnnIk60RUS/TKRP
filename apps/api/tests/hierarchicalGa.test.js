import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStage2LockedFields,
  repairPlanConstraints
} from '../src/modules/planning/services/evolutionary/hierarchicalGa.js';

test('buildStage2LockedFields omits null has_cta/targetToneIndex (bridge null bug fix)', () => {
  const result = buildStage2LockedFields(
    { has_cta: null, targetToneIndex: null, platforms: ['telegram'] },
    { cta_share: 0.5, avg_creativity: 0.3, unique_tones: 2 }
  );
  assert.equal('has_cta' in result, false);
  assert.equal('targetToneIndex' in result, false);
  assert.equal(result.platforms.join(','), 'telegram');
  assert.equal(result.targetCtaShare, 0.5);
  assert.equal(result.targetUniqueTones, 2);
});

test('buildStage2LockedFields preserves explicitly locked cta/tone', () => {
  const result = buildStage2LockedFields(
    { has_cta: true, targetToneIndex: 1 },
    { cta_share: 0.5, avg_creativity: 0.3, unique_tones: 2 }
  );
  assert.equal(result.has_cta, true);
  assert.equal(result.targetToneIndex, 1);
});

test('repairPlanConstraints clamps out-of-horizon dates and snaps unknown platforms', () => {
  const plan = {
    planning_horizon: { start_date: '2026-01-01', end_date: '2026-01-07' },
    platforms: ['telegram', 'vk'],
    publications: [
      { publication_id: 'pub_001', planned_date: '2026-02-05T12:00:00', platform: 'instagram' },
      { publication_id: 'pub_002', planned_date: '2026-01-03', platform: 'telegram' }
    ]
  };
  const repaired = repairPlanConstraints(plan, { date_min: '2026-01-01', date_max: '2026-01-07' });
  assert.equal(repaired.publications[0].planned_date, '2026-01-07T12:00:00');
  assert.equal(repaired.publications[0].platform, 'telegram');
  assert.equal(repaired.publications[1].planned_date, '2026-01-03');
  assert.equal(repaired.publications[1].platform, 'telegram');
  assert.equal(repaired.repairs.length, 2);
  assert.equal(repaired.unfixable.length, 0);
});

test('repairPlanConstraints pads publications up to min_publications', () => {
  const plan = {
    platforms: ['telegram'],
    publications: [{ publication_id: 'pub_001', platform: 'telegram' }]
  };
  const repaired = repairPlanConstraints(plan, { min_publications: 3 });
  assert.equal(repaired.unfixable.length, 0);
  assert.equal(repaired.publications.length, 3);
  assert.equal(repaired.publications[0].publication_id, 'pub_001');
  assert.match(repaired.publications[1].publication_id, /_pad_/);
  assert.equal(repaired.repairs.length, 2);
});

test('repairPlanConstraints cannot pad an empty plan', () => {
  const repaired = repairPlanConstraints({ publications: [] }, { min_publications: 2 });
  assert.equal(repaired.unfixable.length, 1);
  assert.match(repaired.unfixable[0], /min_publications: 0 < 2/);
});
