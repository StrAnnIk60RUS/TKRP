import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_MODEL_SPEC,
  normalizeCompetitorsContentData,
  normalizeContentPlanModel,
  normalizePublicationModel
} from '../src/shared/models/contentModels.js';

test('normalizePublicationModel builds stable publication model with inferred fields', () => {
  const competitor = { competitor_id: 'c1', platform: 'vk' };
  const post = {
    topic: 'AI roadmap',
    target_audience: ['founders', 'founders', 'cto'],
    attachments: { has_video: true },
    engagement_rate: 0.12,
    analysis: {
      content_meaning: { has_cta: 1, clarity: 2, arguments: 2 },
      structure: { value_density: 2 },
      tone_style: { emotional_level: 2 }
    },
    metrics: { likes: 12, comments: 3, shares: 2, views: 100 }
  };

  const model = normalizePublicationModel(post, competitor, 0);
  assert.equal(model.publication_id, 'c1_post_1');
  assert.equal(model.platform, 'vk');
  assert.equal(model.format, 'video');
  assert.equal(model.topic, 'AI roadmap');
  assert.deepEqual(model.audience_segments, ['founders', 'cto']);
  assert.equal(model.metrics_snapshot.likes, 12);
  assert.equal(model.spcj.vector.length, CONTENT_MODEL_SPEC.publication_model.spcj_dimensions.length);
  assert.ok(model.spcj.dimensions.cta_strength > 0);
  assert.ok(model.spcj.dimensions.clarity > 0);
});

test('normalizeContentPlanModel computes KPI and schedule from posts', () => {
  const competitor = {
    competitor_id: 'comp',
    platform: 'telegram',
    posts: [
      {
        datetime: '2026-04-01T10:00:00Z',
        engagement_rate: 0.1,
        publication_model: { topic: 'T1', format: 'text', objective: 'inform', publication_id: 'p1' }
      },
      {
        datetime: '2026-04-08T10:00:00Z',
        engagement_rate: 0.25,
        publication_model: { topic: 'T2', format: 'video', objective: 'convert', publication_id: 'p2' }
      }
    ]
  };

  const plan = normalizeContentPlanModel(competitor);
  assert.equal(plan.plan_id, 'comp_observed_content_plan');
  assert.equal(plan.platform, 'telegram');
  assert.equal(plan.total_publications, 2);
  assert.equal(plan.publication_schedule.length, 2);
  assert.ok(plan.posting_frequency_per_week > 0);
  assert.equal(plan.kpi_estimate.best_engagement_rate, 0.25);
  assert.equal(plan.planning_horizon_days, 8);
});

test('calculatePostingFrequencyPerWeek uses at least one week window for same-day posts', () => {
  const competitor = {
    competitor_id: 'burst',
    platform: 'vk',
    posts: Array.from({ length: 5 }, (_, i) => ({
      datetime: '2026-04-01T12:00:00Z',
      engagement_rate: 0.05,
      publication_model: { topic: `T${i}`, format: 'text', objective: 'inform', publication_id: `p${i}` }
    }))
  };
  const plan = normalizeContentPlanModel(competitor);
  assert.equal(plan.posting_frequency_per_week, 5);
});

test('metrics_snapshot.metrics_quality and deterministic SPCJ hints', () => {
  const competitor = { competitor_id: 'c1', platform: 'linkedin' };
  const post = {
    topic: 'x',
    objective: 'inform',
    metrics: { likes: 10, comments: 0, shares: 0, views: 0 },
    engagement_rate: 0.1667,
    metrics_quality: 'interaction_proxy',
    key_entities: ['a', 'b', 'c'],
    analysis: {
      structure: { has_paragraphs: 1, paragraph_count: 3, has_lists: 1 },
      headline: { length_words: 5, is_question: 1 },
      first_paragraph: { length_words: 20 },
      tone_style: { uses_you: 1 },
      literacy: { hashtags_count: 1 }
    }
  };
  const model = normalizePublicationModel(post, competitor, 0);
  assert.equal(model.metrics_snapshot.metrics_quality, 'interaction_proxy');
  assert.ok(model.spcj.dimensions.clarity > 0);
  assert.ok(model.spcj.dimensions.educational_value > 0);
  assert.ok(model.spcj.dimensions.audience_relevance > 0);
});

test('normalizeCompetitorsContentData normalizes nested competitors payload', () => {
  const input = {
    competitors: [
      {
        competitor_id: 'x',
        platform: 'vk',
        posts: [
          {
            url: 'https://post/1',
            topic: 'Topic A',
            target_audience: ['devs', 'devs'],
            metrics: { likes: 5, comments: 1, shares: 0, views: 10 },
            engagement_rate: 0.2
          }
        ]
      }
    ]
  };

  const normalized = normalizeCompetitorsContentData(input);
  assert.equal(Array.isArray(normalized.competitors), true);
  const competitor = normalized.competitors[0];
  assert.ok(competitor.content_strategy);
  assert.ok(competitor.content_plan_model);
  assert.equal(competitor.posts.length, 1);
  assert.ok(competitor.posts[0].publication_model);
  assert.equal(competitor.posts[0].publication_model.topic, 'Topic A');
});

test('normalizeCompetitorsContentData keeps non-object input unchanged shape', () => {
  assert.equal(normalizeCompetitorsContentData(null), null);
  assert.equal(normalizeCompetitorsContentData(undefined), undefined);
  assert.equal(normalizeCompetitorsContentData('x'), 'x');
});
