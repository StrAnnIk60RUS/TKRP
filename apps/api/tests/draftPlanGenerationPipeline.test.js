import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFT_PLAN_PIPELINE_TEST_UTILS,
  sanitizeUserFacingSummary
} from '../src/modules/planning/services/draftPlanGenerationPipeline.js';
import {
  scoreGeneTopicDraftAlignment,
  scorePlanDraftGeneAlignment,
  normalizePublicationTopicForUi,
  keyMessageAngleMismatchesTopic,
  dedupeKeyMessagesAcrossPublications,
  getCompactTopicForMessage,
  stripMisalignedSummaryLead,
  reconcilePublicationKeyMessageWithTopic
} from '../src/modules/planning/services/contentOutputUtils.js';

const {
  hasSemanticOverlap,
  buildGeneratedPublicationContextItem,
  buildDraftSemanticCore,
  sanitizeTopicTitle,
  buildNaturalTopicVariation,
  buildObjectiveCta,
  calibrateExpectedKpi,
  choosePreferredTopic,
  choosePreferredKeyMessage,
  choosePreferredSummary,
  repairSkeleton,
  buildSummaryRepairFromTopic,
  repairPublicationSemanticCoherence
} = DRAFT_PLAN_PIPELINE_TEST_UTILS;

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

test('sanitizeTopicTitle strips machine angle suffixes', () => {
  assert.equal(
    sanitizeTopicTitle('Сервис и калибровка: мы всегда рядом (риски: внедрение на практике)'),
    'Сервис и калибровка: мы всегда рядом'
  );
});

test('buildNaturalTopicVariation rewrites duplicate topics without meta tags', () => {
  const topic = buildNaturalTopicVariation('Методика измерения: почему 10 кГц имеют значение', 'educate', 2, 1);
  assert.match(topic, /Методика измерения/);
  assert.doesNotMatch(topic, /\((разбор|обзор|риски):/);
});

test('buildObjectiveCta varies CTA by objective', () => {
  const convertCta = buildObjectiveCta('convert', 'TKRP', 'Расчет окупаемости', 0);
  const retainCta = buildObjectiveCta('retain', 'TKRP', 'Сервис и поддержка', 1);

  assert.notEqual(convertCta, retainCta);
  assert.ok(convertCta.length > 0);
  assert.ok(retainCta.length > 0);
});

test('calibrateExpectedKpi returns bounded relative scores and bands', () => {
  const calibrated = calibrateExpectedKpi(
    { engagement_rate: 0.7, conversion_potential: 0.4, reach_potential: 0.8 },
    { objective: 'convert', format: 'video', tone: 'expert', cta: 'Запросить демонстрацию решения' }
  );

  assert.ok(calibrated.engagement_rate <= 0.085);
  assert.ok(calibrated.conversion_potential <= 0.14);
  assert.ok(calibrated.reach_potential <= 0.78);
  assert.equal(calibrated.scoring_mode, 'relative_model_score');
  assert.match(calibrated.engagement_band, /low|baseline|medium|high/);
});

test('calibrateExpectedKpi preserves non-calibrated fields like predicted metrics', () => {
  const calibrated = calibrateExpectedKpi(
    {
      engagement_rate: 0.7,
      conversion_potential: 0.4,
      reach_potential: 0.8,
      predicted_likes: 35,
      predicted_shares: 5,
      predicted_views: 2166,
      predicted_likes_source: 'ml_post_metrics_prediction',
      engagement_rate_source: 'ml_post_metrics_calculated'
    },
    { objective: 'convert', format: 'video', tone: 'expert', cta: 'Запросить демонстрацию решения' }
  );

  assert.equal(calibrated.predicted_likes, 35);
  assert.equal(calibrated.predicted_shares, 5);
  assert.equal(calibrated.predicted_views, 2166);
  assert.equal(calibrated.predicted_likes_source, 'ml_post_metrics_prediction');
  assert.equal(calibrated.engagement_rate_source, 'ml_post_metrics_calculated');
});

test('buildGeneratedPublicationContextItem keeps summary for next-month anti-repeat context', () => {
  const slot = {
    slot_id: 'slot_001',
    planned_date: '2026-05-06',
    platform: 'telegram',
    objective: 'inform',
    format: 'text'
  };
  const resolved = {
    objective: 'convert',
    format: 'image',
    topic: '  Мобильный регистратор: обновление продукта  ',
    key_message: '  Следующий шаг к пилоту и окупаемости  ',
    summary: '  Комплексная система контроля... уникальный хвост для следующего месяца  '
  };
  const out = buildGeneratedPublicationContextItem(slot, resolved);
  assert.equal(out.publication_id, 'slot_001');
  assert.equal(out.objective, 'convert');
  assert.equal(out.format, 'image');
  assert.equal(out.topic, 'Мобильный регистратор: обновление продукта');
  assert.equal(out.key_message, 'Следующий шаг к пилоту и окупаемости');
  assert.equal(
    out.summary,
    'Комплексная система контроля... уникальный хвост для следующего месяца'
  );
});

test('semantic core prefers strong draft topic over generic optimized label', () => {
  const semanticCore = buildDraftSemanticCore({
    topic: 'Методика контроля температуры околошовной зоны',
    key_message: 'Автоматизированный контроль температуры околошовной зоны исключает риск появления дефектов из-за нарушения термоцикла.',
    summary: 'Соблюдение температурного режима при сварке ответственных конструкций критично для предотвращения холодных трещин и брака.'
  });

  const preferred = choosePreferredTopic(
    semanticCore,
    'Пост про «Методика контроля температуры околошовной зоны (экономика: узкие места и риски)» (inform)',
    'inform',
    0
  );

  assert.equal(preferred, 'Методика контроля температуры околошовной зоны');
});

test('semantic core prefers draft key message when optimized one becomes generic', () => {
  const semanticCore = buildDraftSemanticCore({
    topic: 'RFID-идентификация: порядок на сварочном участке',
    key_message: 'RFID-идентификация устраняет потери в маркировке швов и делает маршрут изделия прозрачным.',
    summary: 'RFID-метка помогает фиксировать, кто выполнил операцию и где возникло отклонение.'
  });

  const preferred = choosePreferredKeyMessage(
    semanticCore,
    'RFID-идентификация: показываем, где в процессе скрыты потери и на что смотреть в первую очередь.',
    { topic: 'RFID-идентификация: порядок на сварочном участке', objective: 'inform', format: 'image', tone: 'expert', index: 0 }
  );

  assert.match(preferred, /маркировк|маршрут/i);
  assert.doesNotMatch(preferred, /скрыты потери и на что смотреть/i);
});

test('semantic core prefers more concrete draft summary over generic optimized body', () => {
  const semanticCore = buildDraftSemanticCore({
    topic: 'Регламент калибровки измерительных блоков БРУ',
    key_message: 'Регламент калибровки поддерживает заявленную погрешность измерений.',
    summary: 'Для поддержания погрешности в 1.5% необходимо соблюдать ежегодную калибровку датчиков тока и напряжения и фиксировать результаты проверки.'
  });

  const preferred = choosePreferredSummary(
    semanticCore,
    'Показываем реальный рабочий сценарий, где тема влияет на скорость, качество или стоимость процесса. Разбираем ограничения внедрения, роли команды и критерии готовности к пилоту.',
    { topic: 'Регламент калибровки измерительных блоков БРУ', format: 'text', fallbackSummary: '' }
  );

  assert.match(preferred, /1\.5%|датчик|калибров/i);
  assert.doesNotMatch(preferred, /ограничения внедрения, роли команды и критерии готовности к пилоту/i);
});

test('GA draft-alignment: gene topic matching draft scores at ceiling', () => {
  const semanticCore = buildDraftSemanticCore({
    topic: 'Методика контроля температуры околошовной зоны',
    key_message: 'Контроль температуры снижает риск дефектов.',
    summary: 'Термоцикл и паспорт шва связывают измерения с ответственностью участка.'
  });
  const s = scoreGeneTopicDraftAlignment(
    'Методика контроля температуры околошовной зоны',
    semanticCore,
    'inform',
    0
  );
  assert.ok(s >= 0.99);
});

test('GA draft-alignment: off-topic or generic gene scores low vs strong core', () => {
  const semanticCore = buildDraftSemanticCore({
    topic: 'Методика контроля температуры околошовной зоны',
    key_message: 'Контроль температуры снижает риск дефектов.',
    summary: 'Термоцикл и паспорт шва связывают измерения с ответственностью участка.'
  });
  const generic = scoreGeneTopicDraftAlignment(
    'Пост про карьерный рост маркетологов (inform)',
    semanticCore,
    'inform',
    0
  );
  const unrelated = scoreGeneTopicDraftAlignment(
    'План публикаций о дизайне интерфейсов',
    semanticCore,
    'inform',
    0
  );
  assert.ok(generic < 0.45);
  assert.ok(unrelated < 0.45);
});

test('normalizePublicationTopicForUi strips English objective tails and prefixes', () => {
  assert.equal(
    normalizePublicationTopicForUi('Мобильный регистратор — convert'),
    'Мобильный регистратор'
  );
  assert.equal(
    normalizePublicationTopicForUi('retain: Мобильный регистратор для контроля'),
    'Мобильный регистратор для контроля'
  );
});

test('keyMessageAngleMismatchesTopic detects different case numbers', () => {
  assert.equal(
    keyMessageAngleMismatchesTopic(
      'Продукт: обсуждение кейса 3',
      'На примере кейса 19 предлагаем обсудить варианты'
    ),
    true
  );
  assert.equal(
    keyMessageAngleMismatchesTopic('Кейс 5 для обсуждения', 'Разбор кейса 5 и последствия'),
    false
  );
});

test('getCompactTopicForMessage keeps angle when product stem is long', () => {
  const full =
    'Мобильный регистратор для контроля параметров сварочных процессов: практический разбор 11';
  assert.equal(getCompactTopicForMessage(full), 'практический разбор 11');
  assert.equal(getCompactTopicForMessage('Короткое имя: угол'), 'Короткое имя: угол');
});

test('stripMisalignedSummaryLead drops stale topic sentence with same product stem', () => {
  const canonical =
    'Мобильный регистратор для контроля параметров сварочных процессов: практический разбор 11';
  const summary = `${canonical.replace('11', '1')}. Комплексная система контроля сварочных процессов включает регистратор и приложение.`;
  const out = stripMisalignedSummaryLead(canonical, summary);
  assert.ok(out.startsWith('Комплексная система'));
  assert.doesNotMatch(out, /экспертный образ бренда 1|практический разбор 1/i);
});

test('reconcilePublicationKeyMessageWithTopic rebuilds key message on angle number drift', () => {
  const canonical = 'Мобильный регистратор: развитие сервиса 14';
  const bad =
    '«Мобильный регистратор: развитие сервиса 20» на сопровождении: что мониторить, чтобы эффект не растаял.';
  const fixed = reconcilePublicationKeyMessageWithTopic(
    {
      topic: canonical,
      objective: 'retain',
      format: 'video',
      tone: 'neutral',
      key_message: bad
    },
    3
  );
  assert.ok(!/развитие сервиса 20/i.test(fixed));
  assert.ok(/развитие сервиса 14|сервис|сопровожден/i.test(fixed));
});

test('reconcilePublicationKeyMessageWithTopic shortens quoted full topic to compact angle', () => {
  const canonical =
    'Мобильный регистратор для контроля параметров сварочных процессов: обновление продукта 10';
  const km =
    'Экспертный тон по «Мобильный регистратор для контроля параметров сварочных процессов: обновление продукта 10»: факты и ограничения.';
  const out = reconcilePublicationKeyMessageWithTopic(
    { topic: canonical, objective: 'brand_building', format: 'text', tone: 'expert', key_message: km },
    0
  );
  assert.match(out, /«обновление продукта 10»/);
  assert.doesNotMatch(out, /Мобильный регистратор для контроля параметров сварочных процессов: обновление продукта 10»/);
});

test('keyMessageAngleMismatchesTopic catches service / product angle numbers', () => {
  assert.equal(
    keyMessageAngleMismatchesTopic(
      'Мобильный регистратор: развитие сервиса 14',
      '«развитие сервиса 20» на сопровождении: что мониторить'
    ),
    true
  );
  assert.equal(
    keyMessageAngleMismatchesTopic(
      'Мобильный регистратор: обновление продукта 10',
      'Ключевое про обновление продукта 10 и регламент'
    ),
    false
  );
});

test('dedupeKeyMessagesAcrossPublications rewrites duplicate key_message texts', () => {
  const dup =
    'Экспертный тон по «Мобильный регистратор для контроля параметров сварочных процессов: обновление продукта 10»: факты, ограничения и честные формулировки без пустых обещаний.';
  const pubs = [
    {
      topic: 'Мобильный регистратор: обновление продукта 10 — inform',
      objective: 'brand_building',
      format: 'text',
      tone: 'friendly',
      key_message: dup
    },
    {
      topic: 'Мобильный регистратор: практический разбор 6 — inform',
      objective: 'inform',
      format: 'text',
      tone: 'expert',
      key_message: dup
    }
  ];
  const out = dedupeKeyMessagesAcrossPublications(pubs);
  assert.notEqual(normalizeKey(out[0].key_message), normalizeKey(out[1].key_message));
});

function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

test('choosePreferredKeyMessage keeps concrete draft over built-in template', () => {
  const semanticCore = buildDraftSemanticCore({
    topic: 'Мобильный регистратор для контроля параметров сварки',
    key_message:
      'Регистратор с блоком датчиков передаёт параметры сварки по Wi‑Fi; на сервере формируется паспорт шва.',
    summary: 'Комплексная система включает регистратор, планшет и веб-интерфейс.'
  });
  const templateCandidate =
    'Материал про «Мобильный регистратор для контроля параметров сварки» связывает практический сценарий с бизнес-эффектом и точкой входа в проект.';
  const preferred = choosePreferredKeyMessage(semanticCore, templateCandidate, {
    topic: semanticCore.topic_core,
    objective: 'convert',
    format: 'text',
    tone: 'expert',
    index: 0
  });
  assert.match(preferred, /датчик|wi|паспорт|сервер/i);
  assert.doesNotMatch(preferred, /связывает практический сценарий с бизнес-эффектом/i);
});

test('GA draft-alignment: plan-level average reflects mixed genomes', () => {
  const core0 = buildDraftSemanticCore({
    topic: 'RFID на сварочном участке',
    key_message: 'RFID убирает путаницу в маркировке.',
    summary: 'Метка фиксирует исполнителя и время операции.'
  });
  const core1 = buildDraftSemanticCore({
    topic: 'Калибровка датчиков БРУ',
    key_message: 'Регламент калибровки держит погрешность в норме.',
    summary: 'Ежегодная проверка каналов тока и напряжения обязательна.'
  });
  const pubs = [{ semantic_core: core0 }, { semantic_core: core1 }];
  const genome = [
    ['RFID на сварочном участке', 'text', 'inform', 'expert', 1, 0.5],
    ['Пост про абстрактный успех (inform)', 'text', 'inform', 'expert', 1, 0.5]
  ];
  const avg = scorePlanDraftGeneAlignment(genome, pubs);
  assert.ok(avg > 0.45 && avg < 0.85);
});

test('repairSkeleton extracts publication slots from LLM calendar_plan schema', () => {
  const rawSkeleton = {
    planning_horizon: { start_date: '2026-04-01', end_date: '2026-04-30' },
    platforms: ['vk'],
    calendar_plan: [
      {
        month: '2026-04',
        slots: [
          {
            slot_id: 'slot_001',
            planned_date: '2026-04-05',
            platform: 'vk',
            format: 'video',
            objective: 'convert',
            tone: 'inspirational'
          },
          {
            slot_id: 'slot_002',
            planned_date: '2026-04-12',
            platform: 'vk',
            format: 'image',
            objective: 'educate',
            tone: 'casual'
          }
        ]
      }
    ]
  };
  const formInput = {
    platforms: ['vk'],
    timeline: { start_date: '2026-04-01', end_date: '2026-04-30' }
  };
  const repaired = repairSkeleton(rawSkeleton, formInput, 2, {});
  assert.equal(repaired.publication_slots.length, 2);
  assert.equal(repaired.publication_slots[0].format, 'video');
  assert.equal(repaired.publication_slots[0].objective, 'convert');
  assert.equal(repaired.publication_slots[0].tone, 'inspiring');
  assert.equal(repaired.publication_slots[1].format, 'image');
  assert.equal(repaired.publication_slots[1].objective, 'educate');
  assert.equal(repaired.publication_slots[1].tone, 'friendly');
});

test('hasSemanticOverlap matches Russian inflected forms and ё/е normalization', () => {
  const topic = 'почему ребёнок отвечает невпопад на онлайн-уроке';
  const summary =
    'Когда ребенок во время дистанционного урока теряет концентрацию и начинает отвечать наугад, причина часто кроется в перегрузке восприятия.';
  assert.equal(hasSemanticOverlap(topic, summary, { minSharedTokens: 2, minOverlapRatio: 0.1 }), true);
});

test('repairPublicationSemanticCoherence preserves usable LLM summary instead of overwriting with fallback', () => {
  const llmSummary =
    'Когда школьник на дистанционном занятии теряет нить разговора и даёт случайные ответы, преподавателю важно переключить внимание коротким интерактивным вопросом и снизить темп объяснения материала.';
  const pub = {
    topic: 'почему ребёнок отвечает невпопад на онлайн-уроке',
    format: 'text',
    objective: 'educate',
    tone: 'friendly',
    key_message: 'Дистанционные занятия требуют коротких пауз для удержания внимания ученика.',
    summary: llmSummary
  };
  const fallback = {
    topic: pub.topic,
    summary: 'Fallback summary'
  };
  const { publication } = repairPublicationSemanticCoherence(pub, fallback, {
    consumerCategory: 'B2C',
    projectBenefits: 'сочетание инновационных технологий обучения с индивидуальным подходом'
  });
  assert.equal(publication.summary, llmSummary);
  assert.doesNotMatch(publication.summary, /Аудитория слота:/i);
  assert.doesNotMatch(publication.summary, /достаточно одного рабочего эпизода/i);
});

test('buildSummaryRepairFromTopic and sanitizeUserFacingSummary do not emit Аудитория слота or editor imperatives', () => {
  const formInput = {
    consumerCategory: 'B2C',
    projectBenefits: 'сочетание инновационных технологий обучения с индивидуальным подходом'
  };
  const repaired = buildSummaryRepairFromTopic(
    'почему ребёнок отвечает невпопад на онлайн-уроке',
    'text',
    formInput
  );
  assert.doesNotMatch(repaired, /Аудитория слота/i);
  assert.doesNotMatch(repaired, /достаточно одного рабочего эпизода/i);
  assert.doesNotMatch(repaired, /Назовите, что меняется/i);
  assert.doesNotMatch(repaired, /Отдельно стоит назвать ограничение/i);
  assert.doesNotMatch(repaired, /В конце оставьте читателю один вопрос/i);
  assert.match(repaired, /Сочетание инновационных технологий обучения с индивидуальным подходом\./);

  const polluted =
    'По теме «почему ребёнок отвечает невпопад на онлайн-уроке» достаточно одного рабочего эпизода, а не полного описания продукта. сочетание инновационных технологий обучения с индивидуальным подходом Аудитория слота: B2C. Назовите, что меняется после этого шага и как это проверить без пересказа остальных публикаций плана. Отдельно стоит назвать ограничение: где метод не подходит и какой сигнал говорит, что пора сменить подход.';
  const sanitized = sanitizeUserFacingSummary(
    polluted,
    'почему ребёнок отвечает невпопад на онлайн-уроке',
    'text',
    formInput,
    'educate'
  );
  assert.doesNotMatch(sanitized, /Аудитория слота/i);
  assert.doesNotMatch(sanitized, /достаточно одного рабочего эпизода/i);
  assert.doesNotMatch(sanitized, /Назовите, что меняется/i);
  assert.doesNotMatch(sanitized, /Отдельно стоит назвать ограничение/i);
});


