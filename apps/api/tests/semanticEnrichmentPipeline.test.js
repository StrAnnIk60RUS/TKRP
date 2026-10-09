import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndNormalizeSemanticBatchResult } from '../src/modules/enrichment/services/semanticEnrichmentPipeline.js';

function batchWithPosts(ids) {
  return {
    competitors: [
      {
        posts: ids.map((source_post_id) => ({ source_post_id }))
      }
    ]
  };
}

test('validateAndNormalizeSemanticBatchResult accepts complete matching batch', () => {
  const expected = batchWithPosts(['comp_post_0', 'comp_post_1']);
  const parsed = {
    competitors: [
      {
        posts: [
          {
            source_post_id: 'comp_post_0',
            topic: 'Тема A',
            tone: 'нейтральный',
            objective: 'inform',
            target_audience: ['b2b'],
            summary: 'Кратко о продукте.',
            key_entities: ['сервис']
          },
          {
            source_post_id: 'comp_post_1',
            topic: 'Тема B',
            tone: 'экспертный',
            objective: 'educate',
            target_audience: ['it'],
            summary: 'Обучающий материал.',
            key_entities: ['api']
          }
        ]
      }
    ]
  };
  const r = validateAndNormalizeSemanticBatchResult(expected, parsed);
  assert.equal(r.valid, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.posts_by_id.size, 2);
  assert.equal(r.posts_by_id.get('comp_post_0')?.objective, 'inform');
});

test('validateAndNormalizeSemanticBatchResult fails on missing source_post_id', () => {
  const expected = batchWithPosts(['a_post_0']);
  const parsed = {
    competitors: [
      {
        posts: [
          { topic: 'x', tone: 'y', objective: 'inform' }
        ]
      }
    ]
  };
  const r = validateAndNormalizeSemanticBatchResult(expected, parsed);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /не содержит source_post_id/i.test(e)));
});

test('validateAndNormalizeSemanticBatchResult fails on duplicate ids', () => {
  const expected = batchWithPosts(['dup_post_0', 'dup_post_1']);
  const parsed = {
    competitors: [
      {
        posts: [
          {
            source_post_id: 'dup_post_0',
            topic: 't',
            tone: 'n',
            objective: 'inform',
            summary: 's',
            key_entities: []
          },
          {
            source_post_id: 'dup_post_0',
            topic: 't2',
            tone: 'n',
            objective: 'engage',
            summary: 's2',
            key_entities: []
          }
        ]
      }
    ]
  };
  const r = validateAndNormalizeSemanticBatchResult(expected, parsed);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /Дублирующийся source_post_id/i.test(e)));
});

test('validateAndNormalizeSemanticBatchResult fails when expected id missing in response', () => {
  const expected = batchWithPosts(['need_post_0', 'need_post_1']);
  const parsed = {
    competitors: [
      {
        posts: [
          {
            source_post_id: 'need_post_0',
            topic: 't',
            tone: 'n',
            objective: 'inform',
            summary: 's',
            key_entities: []
          }
        ]
      }
    ]
  };
  const r = validateAndNormalizeSemanticBatchResult(expected, parsed);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /отсутствует пост need_post_1/.test(e)));
  assert.ok(r.errors.some((e) => /Количество постов в ответе не совпадает/.test(e)));
});

test('validateAndNormalizeSemanticBatchResult rejects invalid objective', () => {
  const expected = batchWithPosts(['bad_obj_post_0']);
  const parsed = {
    competitors: [
      {
        posts: [
          {
            source_post_id: 'bad_obj_post_0',
            topic: 't',
            tone: 'n',
            objective: 'not_a_real_objective',
            summary: 's',
            key_entities: []
          }
        ]
      }
    ]
  };
  const r = validateAndNormalizeSemanticBatchResult(expected, parsed);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /недопустимый objective/i.test(e)));
  assert.equal(r.posts_by_id.get('bad_obj_post_0')?.objective, 'inform');
});
