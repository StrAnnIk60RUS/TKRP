import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIsoDateString,
  toIsoDateOnly,
  normalizeDraftPlanResponse,
  buildRagQueryFromForm,
  normalizePublicationFormatValue,
  normalizePublicationToneValue,
  normalizePlanPublicationsFormats,
  normalizePlanPublicationsFields
} from '../src/modules/planning/routes/shared/planUtils.js';

test('isIsoDateString validates exact yyyy-mm-dd only', () => {
  assert.equal(isIsoDateString('2026-04-06'), true);
  assert.equal(isIsoDateString('2026-4-6'), false);
  assert.equal(isIsoDateString('06-04-2026'), false);
});

test('toIsoDateOnly normalizes date-like values and rejects invalid input', () => {
  assert.equal(toIsoDateOnly('2026-04-06T10:30:00Z'), '2026-04-06');
  assert.equal(toIsoDateOnly('bad-date'), null);
  assert.equal(toIsoDateOnly(null), null);
});

test('normalizeDraftPlanResponse deduplicates publications, enforces ids and spreads dates', () => {
  const parsed = {
    draft_content_plan: {
      planning_horizon: { start_date: '2026-04-01', end_date: '2026-04-10' },
      schedule_preferences: { publication_day_mode: 'spread' },
      publications: [
        { publication_id: 'dup', platform: 'tg', planned_date: '2026-04-03', topic: 'AI', format: 'post', objective: 'inform' },
        { publication_id: 'dup', platform: 'tg', planned_date: '2026-04-03', topic: 'AI', format: 'post', objective: 'inform' },
        { platform: 'tg', planned_date: '2026-04-03', topic: 'ML', format: 'video', objective: 'educate' }
      ]
    }
  };

  const normalized = normalizeDraftPlanResponse(parsed, {
    publicationDayMode: 'spread'
  });

  const pubs = normalized.draft_content_plan.publications;
  assert.equal(pubs.length, 2);
  assert.ok(pubs[0].publication_id);
  assert.ok(pubs[1].publication_id);
  assert.notEqual(pubs[0].publication_id, pubs[1].publication_id);
  assert.notEqual(pubs[0].planned_date, pubs[1].planned_date);
  assert.equal(normalized.draft_content_plan.schedule_preferences.publication_day_mode, 'spread');
});

test('normalizeDraftPlanResponse applies requested platforms and horizon from form', () => {
  const parsed = {
    draft_content_plan: {
      planning_horizon: { start_date: '2026-01-01', end_date: '2026-01-15' },
      platforms: ['old'],
      publications: []
    }
  };
  const normalized = normalizeDraftPlanResponse(parsed, {
    contentPlanStartDate: '2026-05-01',
    contentPlanEndDate: '2026-05-20',
    platforms: ['vk', 'telegram']
  });
  assert.deepEqual(normalized.draft_content_plan.platforms, ['vk', 'telegram']);
  assert.deepEqual(normalized.draft_content_plan.planning_horizon, {
    start_date: '2026-05-01',
    end_date: '2026-05-20'
  });
});

test('normalizePublicationFormatValue maps legacy aliases to canonical formats', () => {
  assert.equal(normalizePublicationFormatValue('text_post'), 'text');
  assert.equal(normalizePublicationFormatValue('IMAGE_POST'), 'image');
  assert.equal(normalizePublicationFormatValue('video_post'), 'video');
  assert.equal(normalizePublicationFormatValue('carousel'), 'image');
  assert.equal(normalizePublicationFormatValue('unknown_xyz', 'combined'), 'combined');
});

test('normalizePlanPublicationsFormats normalizes each publication', () => {
  const next = normalizePlanPublicationsFormats([
    { publication_id: 'a', format: 'text_post' },
    { publication_id: 'b', format: 'video' }
  ]);
  assert.equal(next[0].format, 'text');
  assert.equal(next[1].format, 'video');
});

test('normalizePublicationToneValue maps Russian compound phrases', () => {
  assert.equal(normalizePublicationToneValue('деловой, информативный'), 'expert');
  assert.equal(normalizePublicationToneValue('Лояльный уверенный'), 'friendly');
  assert.equal(normalizePublicationToneValue('humorous'), 'humorous');
});

test('normalizePlanPublicationsFields normalizes format and tone', () => {
  const next = normalizePlanPublicationsFields([
    { publication_id: 'a', format: 'image_post', tone: 'деловой информативный' },
    { publication_id: 'b', format: 'video', tone: 'official' }
  ]);
  assert.equal(next[0].format, 'image');
  assert.equal(next[0].tone, 'expert');
  assert.equal(next[1].tone, 'official');
});

test('buildRagQueryFromForm includes only present meaningful sections', () => {
  const query = buildRagQueryFromForm({
    projectName: 'TKRP',
    projectDescription: 'Автоматизация продвижения',
    platforms: ['vk', 'telegram'],
    contentFormats: ['text', 'video']
  });
  assert.match(query, /IT-проект TKRP/);
  assert.match(query, /Платформы: vk, telegram/);
  assert.match(query, /Форматы: text, video/);
});
