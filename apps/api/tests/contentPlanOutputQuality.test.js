import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findSummaryFirstSentenceEnd,
  stripMisalignedSummaryLead,
  buildNaturalKeyMessage,
  buildNaturalTopicVariation,
  KEY_MESSAGE_MAX_LENGTH,
  dedupeRepeatedProductBoilerplateInSummaries,
  ensureDistinctTopicTitles,
  normalizeTopicDedupKey,
  reconcilePublicationKeyMessageWithTopic
} from '../src/modules/planning/services/contentOutputUtils.js';
import { sanitizeUserFacingSummary } from '../src/modules/planning/services/draftPlanGenerationPipeline.js';

test('findSummaryFirstSentenceEnd skips list marker after variant number (…1. Комплексная…)', () => {
  const s =
    'Продукт про сварку: экспертный образ бренда 1. Комплексная система. Остальной текст для длины и проверки остатка который должен быть не короче сорока восьми символов здесь.';
  const end = findSummaryFirstSentenceEnd(s, 24, 320);
  assert.ok(end > 0);
  const lead = s.slice(0, end).trim();
  assert.match(lead, /Комплексная система/u);
  assert.doesNotMatch(lead, /бренда\s*1$/u);
});

test('stripMisalignedSummaryLead drops mis-angled first line when product stem matches', () => {
  const topic = 'Продукт про сварку: практический разбор 11';
  const summary =
    'Продукт про сварку: экспертный образ бренда 1. Комплексная система. Остальной текст для длины и проверки остатка который должен быть не короче сорока восьми символов здесь.';
  const out = stripMisalignedSummaryLead(topic, summary);
  assert.match(out, /^Комплексная система/u);
  assert.doesNotMatch(out, /экспертный образ бренда 1/u);
});

test('buildNaturalKeyMessage stays within KEY_MESSAGE_MAX_LENGTH without mid-word truncation', () => {
  const longTopic =
    'Очень длинное название продукта для сварочного контроля с подзаголовком и деталями интеграции в цех: узкий угол постановки';
  const km = buildNaturalKeyMessage({
    topic: longTopic,
    objective: 'convert',
    format: 'video',
    tone: 'friendly',
    index: 3
  });
  assert.ok(km.length <= KEY_MESSAGE_MAX_LENGTH);
  assert.doesNotMatch(km, /помо\.\.\.|перегру\.\.\./u);
});

test('sanitizeUserFacingSummary removes author-facing brief imperatives', () => {
  const topic = 'Регистратор: обновление';
  const filler = 'Описание и контекст для длины. '.repeat(45);
  const bad = `${topic}. ${filler}Сделай акцент на понятном рабочем сценарии, где тема влияет на скорость.`;
  const out = sanitizeUserFacingSummary(bad, topic, 'text', {}, 'inform');
  assert.ok(out.length >= 200);
  assert.doesNotMatch(out, /Сделай\s+акцент/u);
});

test('ensureDistinctTopicTitles makes duplicate topic strings differ', () => {
  const t = 'Acme: практический разбор — что важно учесть на старте';
  const pubs = [{ topic: t, objective: 'inform' }, { topic: t, objective: 'inform' }];
  const out = ensureDistinctTopicTitles(pubs);
  assert.notEqual(normalizeTopicDedupKey(out[0].topic), normalizeTopicDedupKey(out[1].topic));
});

test('buildNaturalTopicVariation does not repeat a suffix phrase already in the title', () => {
  const base =
    'Мобильный регистратор для контроля параметров сварочных процессов: обсуждение кейса — вопросы для обсуждения с командой';
  const out = buildNaturalTopicVariation(base, 'engage', 2, 0);
  const matches = out.match(/вопросы для обсуждения с командой/gi) || [];
  assert.equal(matches.length, 1);
});

test('reconcilePublicationKeyMessageWithTopic rebuilds when «…» cites another slot angle', () => {
  const canonical =
    'Мобильный регистратор для контроля параметров сварочных процессов: обсуждение кейса — где практика спорит с привычкой';
  const km =
    '«экспертный образ бренда — какую экспертизу это показывает» — повод показать экспертизу: не обещания, а логика.';
  const fixed = reconcilePublicationKeyMessageWithTopic(
    { topic: canonical, objective: 'engage', format: 'text', tone: 'expert', key_message: km },
    0
  );
  assert.doesNotMatch(fixed, /экспертный образ бренда/u);
  assert.match(fixed, /обсужден|практик|команд|процесс|сценар|вариант/i);
});

test('reconcilePublicationKeyMessageWithTopic rebuilds when quoted tail differs under same brand stem', () => {
  const canonical =
    'Мобильный регистратор для контроля параметров сварочных процессов: экспертный образ бренда — за счет чего решение выглядит зрелым';
  const km =
    '«экспертный образ бренда — какую экспертизу это показывает» — повод показать экспертизу: не обещания, а понятная инженерная логика.';
  const fixed = reconcilePublicationKeyMessageWithTopic(
    { topic: canonical, objective: 'convert', format: 'text', tone: 'official', key_message: km },
    0
  );
  assert.doesNotMatch(fixed, /какую экспертизу это показывает/u);
  assert.match(fixed, /зрел|эксперт|бренд|пилот|процесс|качеств/i);
});

test('dedupeRepeatedProductBoilerplateInSummaries keeps block only in first publication', () => {
  const block =
    'Комплексная система контроля сварочных процессов, включающая: регистратор с блоком датчиков для измерения параметров сварки, мобильное приложение для планшетов и веб-приложение для управления данными. Система обеспечивает идентификацию сварщиков. Комплексная оценка и документальное подтверждение качества сварки.';
  const tail =
    ' Сценарий на смене: где теряется время и какие проверки меняют исход. Добавляем уникальный текст, чтобы после вырезания RAG-блока осталось достаточно символов для сохранения разнообразия тел постов в плане и не откатываться к исходному дублю.';
  const pubs = [
    { topic: 'T1', summary: block + tail, objective: 'inform' },
    { topic: 'T2', summary: block + tail, objective: 'inform' }
  ];
  const out = dedupeRepeatedProductBoilerplateInSummaries(pubs);
  assert.match(out[0].summary, /Комплексная система контроля/u);
  assert.doesNotMatch(out[1].summary, /включающая: регистратор/u);
  assert.match(out[1].summary, /Сценарий на смене/u);
});

test('dedupeRepeatedProductBoilerplateInSummaries strips repeated lead with variable ending', () => {
  const head =
    'Комплексная система контроля сварочных процессов, включающая: регистратор с блоком датчиков для измерения параметров сварки, мобильное приложение для планшетов и веб-приложение для управления данными.';
  const changedTail =
    'Система обеспечивает идентификацию сварщиков, выдачу заданий и контроль трендов параметров в реальном времени с последующей аналитикой отклонений.';
  const uniqueTail =
    ' Сценарий на смене: где теряется время и какие проверки меняют исход. Добавляем уникальный текст, чтобы после вырезания RAG-блока осталось достаточно символов и не возник откат к повторному шаблону.';
  const pubs = [
    { topic: 'T1', summary: `${head} ${changedTail}${uniqueTail}`, objective: 'inform' },
    { topic: 'T2', summary: `${head} ${changedTail}${uniqueTail}`, objective: 'inform' }
  ];
  const out = dedupeRepeatedProductBoilerplateInSummaries(pubs);
  assert.match(out[0].summary, /Комплексная система контроля/u);
  assert.doesNotMatch(out[1].summary, /включающая: регистратор/u);
  assert.match(out[1].summary, /Сценарий на смене/u);
});
