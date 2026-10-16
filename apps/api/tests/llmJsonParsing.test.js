import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonObjectFromLlmContent } from '../src/shared/utils/llmJsonParsing.js';

test('parseJsonObjectFromLlmContent parses strict JSON', () => {
  const result = parseJsonObjectFromLlmContent('{"ok":true,"n":3}');
  assert.deepEqual(result, { ok: true, n: 3 });
});

test('parseJsonObjectFromLlmContent extracts object from noisy wrapper', () => {
  const content = 'Some preface text\n```json\n{"status":"ok","items":[1,2]}\n```\npostfix';
  const result = parseJsonObjectFromLlmContent(content);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.items, [1, 2]);
});

test('parseJsonObjectFromLlmContent throws on empty content', () => {
  assert.throws(
    () => parseJsonObjectFromLlmContent(''),
    /Пустой ответ от LLM/
  );
});

test('parseJsonObjectFromLlmContent throws when no object braces exist', () => {
  assert.throws(
    () => parseJsonObjectFromLlmContent('not json and no object'),
    /LLM не вернул JSON объект/
  );
});
