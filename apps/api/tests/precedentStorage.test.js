import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStorageBackend } from '../src/modules/precedents/repositories/precedentRepository.js';

test('resolveStorageBackend defaults to pg', () => {
  assert.equal(resolveStorageBackend({}), 'pg');
});

test('resolveStorageBackend honors explicit PRECEDENT_STORAGE=pg', () => {
  assert.equal(resolveStorageBackend({ PRECEDENT_STORAGE: 'pg' }), 'pg');
});

test('resolveStorageBackend rejects json (dev)', () => {
  try {
    resolveStorageBackend({ PRECEDENT_STORAGE: 'json' });
    assert.fail('expected throw');
  } catch (error) {
    assert.match(error.message, /PRECEDENT_STORAGE=json is removed/);
  }
});

test('resolveStorageBackend back-compat USE_DATABASE=true selects pg', () => {
  assert.equal(resolveStorageBackend({ USE_DATABASE: 'true' }), 'pg');
});

test('resolveStorageBackend production default selects pg', () => {
  assert.equal(resolveStorageBackend({ APP_ENV: 'production' }), 'pg');
});

test('resolveStorageBackend rejects json in production', () => {
  try {
    resolveStorageBackend({ PRECEDENT_STORAGE: 'json', APP_ENV: 'production' });
    assert.fail('expected throw');
  } catch (error) {
    assert.match(error.message, /PRECEDENT_STORAGE=json is removed/);
  }
});

test('resolveStorageBackend rejects unknown PRECEDENT_STORAGE value', () => {
  try {
    resolveStorageBackend({ PRECEDENT_STORAGE: 'db' });
    assert.fail('expected throw');
  } catch (error) {
    assert.match(error.message, /Unknown PRECEDENT_STORAGE value: db/);
  }
});