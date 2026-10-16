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
