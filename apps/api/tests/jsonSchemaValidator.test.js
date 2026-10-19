import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAgainstJsonSchema,
  assertValidAgainstJsonSchema
} from '../src/shared/utils/jsonSchemaValidator.js';

test('accepts conforming object with extra properties', () => {
  const schema = {
    type: 'object',
    required: ['platform', 'topic'],
    properties: {
      platform: { type: 'string', enum: ['vk', 'linkedin'] },
      topic: { type: 'string', minLength: 1 }
    }
  };
  const result = validateAgainstJsonSchema({ platform: 'vk', topic: 'x', extra: 1 }, schema);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('reports missing required and type mismatches with paths', () => {
  const schema = {
    type: 'object',
    required: ['publications'],
    properties: {
      publications: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['platform'],
          properties: { platform: { type: 'string' } }
        }
      }
    }
  };
  const result = validateAgainstJsonSchema({ publications: [{ topic: 5 }] }, schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('publications[0].platform: required property missing')));
});

test('validates numbers with min/max and strings with pattern', () => {
  const result = validateAgainstJsonSchema(
    { score: 1.5, date: '2026-1-5' },
    {
      type: 'object',
      properties: {
        score: { type: 'number', minimum: 0, maximum: 1 },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
      }
    }
  );
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});

test('assertValidAgainstJsonSchema throws with validation_errors and raw_value', () => {
  try {
    assertValidAgainstJsonSchema({ platform: 7 }, {
      type: 'object',
      properties: { platform: { type: 'string' } }
    }, 'draft plan');
    assert.fail('expected throw');
  } catch (error) {
    assert.match(error.message, /^draft plan failed schema validation/);
    assert.ok(Array.isArray(error.validation_errors));
    assert.equal(typeof error.raw_value, 'string');
  }
});

test('assertValidAgainstJsonSchema passes through valid values', () => {
  const value = { publications: [{ platform: 'vk', topic: 'a' }] };
  const returned = assertValidAgainstJsonSchema(value, {
    type: 'object',
    required: ['publications'],
    properties: {
      publications: { type: 'array', items: { type: 'object', required: ['platform', 'topic'] } }
    }
  }, 'draft plan');
  assert.equal(returned, value);
});

test('native JSON schemas in enrichment and planning validate conforming payloads', async () => {
  const { SEMANTIC_ENRICHMENT_BATCH_JSON_SCHEMA } = await import(
    '../src/modules/enrichment/services/semanticEnrichmentPipeline.js'
  );
  const { PLAN_SKELETON_JSON_SCHEMA, PLAN_MONTH_BATCH_JSON_SCHEMA } = await import(
    '../src/modules/planning/services/draftPlanGenerationPipeline.js'
  );
  const { POST_CONTENT_JSON_SCHEMA } = await import(
    '../src/modules/planning/services/llmPostGeneration.js'
  );
  const { PLAN_DIVERSITY_REWRITE_JSON_SCHEMA } = await import(
    '../src/modules/planning/services/planDiversityLlmPass.js'
  );

  // 1. Enrichment schema
  const enrichmentPayload = {
    competitors: [
      {
        competitor_id: 'comp_1',
        posts: [
          {
            source_post_id: 'post_1',
            topic: 'AI Architecture',
            tone: 'expert',
            objective: 'educate',
            summary: 'Comprehensive guide to AI design patterns'
          }
        ]
      }
    ]
  };
  assert.equal(validateAgainstJsonSchema(enrichmentPayload, SEMANTIC_ENRICHMENT_BATCH_JSON_SCHEMA).valid, true);

  // 2. Skeleton schema
  const skeletonPayload = {
    title: 'Q1 AI Content Plan',
    planning_horizon: {
      start_date: '2026-03-01',
      end_date: '2026-03-31'
    }
  };
  assert.equal(validateAgainstJsonSchema(skeletonPayload, PLAN_SKELETON_JSON_SCHEMA).valid, true);

  // 3. Month batch schema
  const monthBatchPayload = {
    publications: [
      {
        topic: 'Machine Learning Pipelines',
        key_message: 'Automate model training with proper validation.',
        summary: 'Step by step walkthrough of robust ML pipelines.'
      }
    ]
  };
  assert.equal(validateAgainstJsonSchema(monthBatchPayload, PLAN_MONTH_BATCH_JSON_SCHEMA).valid, true);

  // 4. Post content schema
  const postPayload = {
    key_message: 'Key takeaway for our B2B clients',
    summary: 'Detailed summary of product release features.',
    cta: 'Learn more on our website'
  };
  assert.equal(validateAgainstJsonSchema(postPayload, POST_CONTENT_JSON_SCHEMA).valid, true);

  // 5. Diversity rewrite schema
  const rewritePayload = {
    publications: [
      {
        publication_id: 'pub_1',
        key_message: 'Fresh perspective on developer tooling',
        summary: 'Rewritten body for higher reader engagement.'
      }
    ]
  };
  assert.equal(validateAgainstJsonSchema(rewritePayload, PLAN_DIVERSITY_REWRITE_JSON_SCHEMA).valid, true);
});

