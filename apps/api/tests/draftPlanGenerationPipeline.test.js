import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_PLAN_PIPELINE_TEST_UTILS } from '../src/modules/planning/services/draftPlanGenerationPipeline.js';

const { hasSemanticOverlap } = DRAFT_PLAN_PIPELINE_TEST_UTILS;

test('hasSemanticOverlap keeps long summary matched to short topic', () => {
  const topic = 'мобильный регистратор сварочных процессов';
  const summary = `Комплексная система контроля сварочных процессов включает регистратор с блоком датчиков,
мобильное приложение для планшета и веб-интерфейс для аналитики. Решение показывает параметры сварки в реальном
времени, автоматизирует отчеты и снижает стоимость внедрения за счет переноса части функционала в мобильное
устройство.`;

  assert.equal(hasSemanticOverlap(topic, summary), true);
});

test('hasSemanticOverlap returns false for unrelated texts', () => {
  const topic = 'контроль сварочных процессов';
  const summary = 'План публикаций о карьерном росте маркетологов и трендах в дизайне интерфейсов.';

  assert.equal(hasSemanticOverlap(topic, summary), false);
});
