import { buildPlanFeatureMap, buildPlanFeatureVector } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
import { predictPlanMetricsByFeatureVectors } from '../../../ml/services/relevancePredictionService.js';
import {
  buildOntologyFromSnapshot,
  mergeOntologyWithTrustedLlmAdditions
} from '../../../precedents/services/ontologyAggregationService.js';
import {
  buildOntologyLlmEnrichment,
  getOntologyLlmEnrichmentConfig
} from '../../../precedents/services/ontologyLlmEnrichmentService.js';
import { runAsyncGeneticAlgorithm } from './asyncGaCore.js';
import { cloneJson, onePointCrossoverArrays, randomReplaceMutation, twoPointCrossoverArrays, uniformCrossoverArrays } from './operators.js';
import { normalizePublicationToneValue } from '../../routes/shared/planUtils.js';
import {
  alignToneToObjective,
  buildDraftSemanticCore,
  buildNaturalKeyMessage,
  buildObjectiveCta,
  calibrateExpectedKpi,
  choosePreferredKeyMessage,
  choosePreferredSummary,
  choosePreferredTopic,
  dedupeKeyMessagesAcrossPublications,
  dedupeRepeatedProductBoilerplateInSummaries,
  ensureDistinctTopicTitles,
  normalizePublicationTopicForUi,
  reconcilePublicationKeyMessageWithTopic,
  sanitizeTopicTitle,
  scorePlanDraftGeneAlignment,
  shouldRewriteMachineKeyMessage,
  stripMisalignedSummaryLead,
  stripObjectiveMeta,
  summaryLeadAngleMismatchesTopic
} from '../contentOutputUtils.js';
import { sanitizeUserFacingSummary } from '../draftPlanGenerationPipeline.js';

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function clampProbability(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function hashString(value) {
  const input = String(value || '');
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function shouldEnableOntologyTrustedRollout(planId = '') {
  const percent = Math.max(0, Math.min(100, asNumber(process.env.ONTOLOGY_SCORING_ROLLOUT_PERCENT, 0)));
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const bucket = hashString(planId || 'unknown') % 100;
  return bucket < percent;
}

function resolveOntologyScoringGuard(ontology = {}) {
  const maxErrors = Math.max(0, asNumber(process.env.ONTOLOGY_SCORING_MAX_ENRICH_ERRORS, 0));
  const errorsCount = Array.isArray(ontology?.llm_enrichment?.errors) ? ontology.llm_enrichment.errors.length : 0;
  return errorsCount <= maxErrors;
}

function uniqueDomain(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value)))).slice(0, 80);
}

function uniqueDomainTopics(values = [], max = 100) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value)))).slice(0, max);
}

function readPlanGaEnvNumber(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Углы подачи темы (согласовано с банками вариаций тем в contentOutputUtils). */
const EVO_TOPIC_ANGLE_FOCUS = [
  'узкие места и риски',
  'метрики и KPI',
  'внедрение на практике',
  'сравнение сценариев',
  'типовые ошибки',
  'чек-лист для команды',
  'экономика решения',
  'интеграция в процесс'
];

function collectOntologyTopicPhrases(ontology, keywordSet) {
  if (!ontology || typeof ontology !== 'object') return [];
  const acc = [];
  const push = (raw) => {
    const t = String(raw || '').trim();
    if (t.length < 2 || t.length > 220) return;
    if (keywordSet?.size && scoreTextRelevance(t, keywordSet) < 0.18) return;
    acc.push(t);
  };
  const visitSynonyms = (arr) => {
    (arr || []).forEach((item) => {
      push(item?.synonym);
      push(item?.canonical_label);
    });
  };
  visitSynonyms(ontology.global?.synonyms);
  (ontology.contexts || []).forEach((ctx) => visitSynonyms(ctx.synonyms));
  (ontology.global?.entities || []).forEach((e) => push(e?.label));
  (ontology.global?.meta_entities || []).slice(0, 48).forEach((m) => push(m?.label));
  (ontology.global?.triples || []).slice(0, 72).forEach((tr) => {
    push(tr?.subject_label);
    push(tr?.object_label);
  });
  return acc;
}

function buildAngleDerivedTopics(seedTopics, keywordSet) {
  const seeds = uniqueDomainTopics(seedTopics, 18);
  const derived = [];
  const seen = new Set(seeds.map((s) => normalizeKey(s)));
  const focusCap = 3;
  seeds.forEach((base, si) => {
    const b = String(base || '').trim();
    if (!b) return;
    EVO_TOPIC_ANGLE_FOCUS.slice(0, focusCap).forEach((focus, fi) => {
      const tag = ['обзор', 'разбор', 'практика', 'риски', 'экономика'][(si + fi) % 5];
      const candidate = `${b} (${tag}: ${focus})`;
      const nk = normalizeKey(candidate);
      if (seen.has(nk)) return;
      if (keywordSet?.size && scoreTextRelevance(candidate, keywordSet) < 0.12) return;
      seen.add(nk);
      derived.push(candidate);
    });
  });
  return derived;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTitle(value) {
  const title = String(value || '').trim().replace(/\s+/g, ' ');
  return title || '';
}

function toReadablePhrase(value) {
  return String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildTitleContextTokenSet(publication = {}) {
  return new Set([
    ...tokenizeText(publication?.topic),
    ...tokenizeText(publication?.key_message),
    ...tokenizeText(publication?.objective)
  ]);
}

function titleMatchesPublicationContext(title, publication) {
  const titleTokens = tokenizeText(title);
  if (!titleTokens.length) return false;
  const contextTokens = buildTitleContextTokenSet(publication);
  if (!contextTokens.size) return true;
  const overlap = titleTokens.filter((token) => contextTokens.has(token)).length;
  return overlap / titleTokens.length >= 0.34;
}

function buildContextAwareTitle(publication, index) {
  const topic = normalizePublicationTopicForUi(publication?.topic || publication?.title);
  if (topic) return topic;
  return `Публикация ${index + 1}`;
}

function buildPublicationTitle(publication, index) {
  const currentTitle = normalizeTitle(publication?.title);
  if (currentTitle && titleMatchesPublicationContext(currentTitle, publication)) {
    return currentTitle;
  }

  return buildContextAwareTitle(publication, index);
}

/**
 * Заголовок в интерфейсе = тема публикации. Дубликаты названий допустимы: различие по дате, id и полям карточки.
 * Служебные суффиксы уникализации в title не добавляем.
 */
function assignPublicationDisplayTitles(publications = []) {
  return publications.map((publication, index) => ({
    ...publication,
    title: buildPublicationTitle(publication, index)
  }));
}

function uniqueNormalized(values = []) {
  return Array.from(new Set(values.map((value) => normalizeKey(value)).filter(Boolean)));
}

function buildFrequencyMap(values = []) {
  return values.reduce((acc, value) => {
    const key = normalizeKey(value);
    if (!key) return acc;
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());
}

function averageReliability(items = []) {
  const values = items.map((item) => asNumber(item?.reliability, NaN)).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function tokenizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-zа-я0-9\s_-]+/gi, ' ')
    .split(/[\s_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function buildKeywordSet(draftContentPlan, publications = []) {
  const sources = [
    draftContentPlan?.plan_id,
    draftContentPlan?.notes,
    draftContentPlan?.content_profile?.content_vertical,
    draftContentPlan?.content_profile?.industry,
    draftContentPlan?.content_profile?.brand_voice,
    ...(draftContentPlan?.target_audience || []),
    ...(draftContentPlan?.audience_segments || []),
    ...(draftContentPlan?.platforms || []),
    ...publications.flatMap((publication) => [
      publication?.topic,
      publication?.title,
      publication?.summary,
      publication?.key_message
    ])
  ];
  return new Set(sources.flatMap((value) => tokenizeText(value)));
}

function scoreTextRelevance(candidate, keywordSet) {
  const tokens = tokenizeText(candidate);
  if (!tokens.length || !keywordSet?.size) return 0;
  const overlap = tokens.filter((token) => keywordSet.has(token)).length;
  return overlap / tokens.length;
}

function normalizePrecedentPublication(item) {
  if (!item || typeof item !== 'object') return null;
  if (item?.data && typeof item.data === 'object') {
    return {
      data: item.data,
      reliability: asNumber(item.reliability, 0),
      score: asNumber(item.score, 0)
    };
  }
  return {
    data: item,
    reliability: asNumber(item.reliability, 0),
    score: asNumber(item.score, 0)
  };
}

async function buildPrecedentContext(precedentPublications = [], draftContentPlan = {}) {
  const normalized = precedentPublications.map(normalizePrecedentPublication).filter(Boolean);
  const rawPublications = normalized.map((item) => item.data).filter(Boolean);
  const snapshot = {
    publications: rawPublications,
    content_plans: []
  };
  const canonicalOntology = buildOntologyFromSnapshot(snapshot);
  const enrichmentConfig = getOntologyLlmEnrichmentConfig();
  const enrichment = await buildOntologyLlmEnrichment(canonicalOntology.contexts, canonicalOntology);
  const rolloutEnabled = shouldEnableOntologyTrustedRollout(draftContentPlan?.plan_id);
  const guardsOk = resolveOntologyScoringGuard({
    ...canonicalOntology,
    llm_enrichment: enrichment
  });
  const useTrustedAdditions = enrichmentConfig.mode === 'active' && rolloutEnabled && guardsOk;
  const ontology = useTrustedAdditions
    ? mergeOntologyWithTrustedLlmAdditions(snapshot, canonicalOntology, enrichment, {
        highConfidenceThreshold: enrichmentConfig.highConfidenceThreshold
      })
    : {
        ...canonicalOntology,
        llm_enrichment: enrichment
      };

  const reliablePublications = normalized.filter((item) => item.reliability >= 0.55 || item.score >= 0.6);

  return {
    normalized,
    rawPublications,
    reliablePublications: reliablePublications.length ? reliablePublications : normalized,
    avgReliability: averageReliability(normalized),
    ontology,
    ontologyRollout: {
      enabled: useTrustedAdditions,
      mode: enrichmentConfig.mode
    }
  };
}

function parseDate(value) {
  if (!value || typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function resolvePlanningHorizon(draftContentPlan, constraints = {}) {
  const startDate = constraints?.date_min || draftContentPlan?.planning_horizon?.start_date || null;
  const endDate = constraints?.date_max || draftContentPlan?.planning_horizon?.end_date || null;
  const explicitDuration = asNumber(draftContentPlan?.planning_horizon?.duration_days, 0) || asNumber(constraints?.duration_days, 0);

  const parsedStart = parseDate(startDate);
  const parsedEnd = parseDate(endDate);
  const derivedDuration = parsedStart && parsedEnd
    ? Math.max(1, Math.round((parsedEnd.getTime() - parsedStart.getTime()) / 86400000) + 1)
    : 0;

  return {
    start_date: startDate,
    end_date: endDate,
    duration_days: explicitDuration || derivedDuration || 30
  };
}

function resolveTargetPostCount(draftContentPlan, constraints = {}) {
  const horizonDays = resolvePlanningHorizon(draftContentPlan, constraints).duration_days;
  const postsPerWeek = asNumber(constraints.posts_per_week, 0);
  const minPublications = Math.max(0, asNumber(constraints.min_publications, 0));
  const requestedByWeek = postsPerWeek > 0 ? Math.max(1, Math.round((postsPerWeek * horizonDays) / 7)) : null;
  if (requestedByWeek !== null) {
    return Math.max(requestedByWeek, minPublications || 1);
  }
  return Math.max(1, minPublications || draftContentPlan?.publications?.length || 1);
}

function buildDomains(draftContentPlan, precedentContext = {}) {
  const draftPublications = Array.isArray(draftContentPlan?.publications) ? draftContentPlan.publications : [];
  const fromPrecedents = (precedentContext.reliablePublications || []).map((item) => item?.data?.publication_model || item?.data || {});
  const fromDraft = draftPublications;
  const draftTopics = uniqueDomain(fromDraft.map((item) => item.topic));
  const precedentTopics = uniqueDomain(fromPrecedents.map((item) => item.topic));
  const keywordSet = buildKeywordSet(draftContentPlan, fromDraft);
  const relevantPrecedentTopics = precedentTopics.filter((topic) => scoreTextRelevance(topic, keywordSet) >= 0.25);
  const ontologyPhrases = collectOntologyTopicPhrases(precedentContext.ontology, keywordSet);

  const baseTopics = draftTopics.length
    ? uniqueDomainTopics(
        [...draftTopics, ...relevantPrecedentTopics.slice(0, Math.max(6, draftTopics.length * 2))],
        72
      )
    : uniqueDomainTopics(relevantPrecedentTopics.length ? relevantPrecedentTopics : precedentTopics, 72);

  const angleSeeds = draftTopics.length ? draftTopics : baseTopics.slice(0, 14);
  const angleTopics = buildAngleDerivedTopics(angleSeeds, keywordSet);

  const topicDomain = uniqueDomainTopics(
    [...baseTopics, ...ontologyPhrases, ...angleTopics],
    100
  );

  return [
    topicDomain,
    uniqueDomain([...fromDraft.map((item) => item.format), ...fromPrecedents.map((item) => item.format)]),
    uniqueDomain([...fromDraft.map((item) => item.objective), ...fromPrecedents.map((item) => item.objective)]),
    uniqueDomain([...fromDraft.map((item) => item.tone), ...fromPrecedents.map((item) => item.tone)])
  ];
}

function expandBasePublications(draftContentPlan, targetCount) {
  const base = Array.isArray(draftContentPlan?.publications) ? draftContentPlan.publications : [];
  return Array.from({ length: targetCount }, (_, index) => {
    const source = cloneJson(base[index % Math.max(1, base.length)] || {});
    return {
      ...source,
      publication_id: source.publication_id || `evo_publication_${String(index + 1).padStart(3, '0')}`
    };
  });
}

const EVO_MIN_SUMMARY_LENGTH = {
  text: 650,
  combined: 650,
  image: 400,
  video: 400
};

const OBJECTIVE_HINT_RU = {
  inform: 'даём полезную информацию и контекст',
  educate: 'обучаем аудиторию и объясняем детали',
  engage: 'вовлекаем через практику и обсуждение',
  convert: 'показываем ценность и следующий шаг к сделке',
  retain: 'укрепляем доверие и долгосрочные отношения',
  brand_building: 'усиливаем узнаваемость и экспертный образ бренда'
};

const SUMMARY_PAD_VARIANTS = [
  ' Разбираем ограничения внедрения, роли команды и критерии готовности к пилоту.',
  ' Показываем, как измерить эффект до и после, и какие данные стоит собрать заранее.',
  ' Сопоставляем типовые сценарии: от диагностики до масштабирования на смежные участки.',
  ' Отдельно выделяем риски, точки контроля качества и вопросы к поставщику или интегратору.',
  ' Даём ориентиры по срокам, бюджету и компетенциям — без «магических обещаний».',
  ' Подкрепляем выводы примерами из практики и коротким чек-листом для читателя.',
  ' Объясняем, кому материал полезен в первую очередь и что делать на следующий день.',
  ' Сравниваем подход «быстро проверить гипотезу» и подход «сначала стандартизировать процесс».',
  ' Фокус на прикладных шагах: что уточнить у команды, клиента и исполнителей.',
  ' Приглашаем обсудить кейс в комментариях: какие нюансы важны именно у вас.'
];

function draftTextAlignsWithTopic(text, topic, minOverlapRatio = 0.28) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const bodyTokens = new Set(tokenizeText(raw));
  const topicTokens = tokenizeText(topic);
  if (!topicTokens.length) {
    const tk = normalizeKey(topic);
    if (tk.length < 4) return false;
    return normalizeKey(raw).includes(tk);
  }
  const hits = topicTokens.filter((t) => bodyTokens.has(t)).length;
  return hits / topicTokens.length >= minOverlapRatio;
}

const TOPIC_ALIGN_STOPWORDS = new Set([
  'без',
  'для',
  'как',
  'что',
  'это',
  'при',
  'над',
  'под',
  'или',
  'все',
  'вас',
  'нам',
  'наш',
  'ваш',
  'его',
  'еще',
  'уже',
  'так',
  'там',
  'тут',
  'где',
  'кто'
]);

const KNOWN_OBJECTIVE_IN_TEXT = new Set([
  'inform',
  'educate',
  'engage',
  'convert',
  'retain',
  'brand_building'
]);

/** Ядро темы без завершающего блока в скобках (угол подачи). */
export function topicCoreFromTopic(topic) {
  return String(topic || '')
    .trim()
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim();
}

function draftTextAlignsWithTopicCore(text, topic, minOverlapRatio = 0.42, minSignificantHits = 2) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const core = topicCoreFromTopic(topic);
  const bodyTokens = new Set(tokenizeText(raw));
  const significant = tokenizeText(core).filter((t) => t.length >= 4 && !TOPIC_ALIGN_STOPWORDS.has(t));
  if (!significant.length) {
    return draftTextAlignsWithTopic(raw, core, Math.max(minOverlapRatio, 0.35));
  }
  const hits = significant.filter((t) => bodyTokens.has(t)).length;
  const ratio = hits / significant.length;
  const needHits = Math.min(minSignificantHits, significant.length);
  return hits >= needHits && ratio >= minOverlapRatio;
}

function draftAlignsWithObjective(text, objective) {
  const hint = OBJECTIVE_HINT_RU[normalizeKey(objective)] || OBJECTIVE_HINT_RU.inform;
  const hintTokens = tokenizeText(hint).filter((t) => t.length >= 4);
  if (!hintTokens.length) return true;
  const body = new Set(tokenizeText(text));
  return hintTokens.some((t) => body.has(t));
}

function textDeclaresObjectiveMismatch(text, resolvedObjective) {
  const res = normalizeKey(resolvedObjective);
  const src = String(text);
  const re = /\(\s*цель\s*:\s*([a-z_]+)\s*\)/giu;
  let m;
  while ((m = re.exec(src)) !== null) {
    const declared = normalizeKey(m[1]);
    if (KNOWN_OBJECTIVE_IN_TEXT.has(declared) && declared !== res) return true;
  }
  return false;
}

function buildRepeatedDraftKeyMessageKeys(publications = []) {
  const freq = new Map();
  for (const p of publications) {
    const k = normalizeKey(String(p?.key_message || '').trim());
    if (k.length < 24) continue;
    freq.set(k, (freq.get(k) || 0) + 1);
  }
  const repeated = new Set();
  for (const [k, count] of freq.entries()) {
    if (count >= 2) repeated.add(k);
  }
  return repeated;
}

function buildRepeatedDraftSummaryPrefixes(publications = []) {
  const freq = new Map();
  for (const p of publications) {
    const sm = String(p?.summary || '').trim();
    if (sm.length < 120) continue;
    const pre = normalizeKey(sm.slice(0, 168));
    if (pre.length < 40) continue;
    freq.set(pre, (freq.get(pre) || 0) + 1);
  }
  const repeated = new Set();
  for (const [k, count] of freq.entries()) {
    if (count >= 2) repeated.add(k);
  }
  return repeated;
}

function shouldPreserveDraftKeyMessage(km, base, resolvedTopic, resolvedObjective, syncOptions = {}) {
  if (!km) return false;
  if (textDeclaresObjectiveMismatch(km, resolvedObjective)) return false;
  const objectiveChanged = normalizeKey(resolvedObjective) !== normalizeKey(base.objective);
  if (objectiveChanged && !draftAlignsWithObjective(km, resolvedObjective)) return false;
  if (!draftTextAlignsWithTopicCore(km, resolvedTopic, 0.42, 2)) return false;
  const nk = normalizeKey(km);
  if (nk.length >= 24 && syncOptions.repeatedDraftKeyMessages?.has(nk)) {
    const coreOld = topicCoreFromTopic(base.topic);
    const coreNew = topicCoreFromTopic(resolvedTopic);
    if (normalizeKey(coreOld) !== normalizeKey(coreNew)) return false;
  }
  return true;
}

function shouldPreserveDraftSummary(sm, base, resolvedTopic, resolvedObjective, syncOptions = {}) {
  if (!sm) return false;
  if (textDeclaresObjectiveMismatch(sm, resolvedObjective)) return false;
  if (summaryLeadAngleMismatchesTopic(resolvedTopic, sm)) return false;
  const objectiveChanged = normalizeKey(resolvedObjective) !== normalizeKey(base.objective);
  if (objectiveChanged && !draftAlignsWithObjective(sm, resolvedObjective)) return false;
  if (!draftTextAlignsWithTopicCore(sm, resolvedTopic, 0.26, 2)) return false;
  const nk = normalizeKey(sm);
  if (nk.length >= 48 && syncOptions.repeatedDraftKeyMessages?.has(nk)) {
    const coreOld = topicCoreFromTopic(base.topic);
    const coreNew = topicCoreFromTopic(resolvedTopic);
    if (normalizeKey(coreOld) !== normalizeKey(coreNew)) return false;
  }
  const pre = normalizeKey(sm.slice(0, 168));
  if (pre.length >= 40 && syncOptions.repeatedDraftSummaryPrefixes?.has(pre)) {
    const coreOld = topicCoreFromTopic(base.topic);
    const coreNew = topicCoreFromTopic(resolvedTopic);
    if (normalizeKey(coreOld) !== normalizeKey(coreNew)) return false;
  }
  return true;
}

const SERVICE_TOPIC_TONE_BLOCKLIST =
  /постгарант|гарантий|сервис|обслуживан|ремонт|sla|простой|запчаст/u;

const TECHNICAL_TOPIC_PATTERN =
  /характеристик|спецификац|регистратор|датчик|точност|калибр|сертификат|измерен|диапазон|чувствительн|аналогов|цифров|интерфейс\s*связи|specification|datasheet|calibration|sensor|accuracy|interface/u;

function normalizeFormatForSummary(format) {
  const f = String(format || 'text').toLowerCase();
  if (f === 'combined') return 'combined';
  if (f === 'image' || f === 'video') return f;
  return 'text';
}

function adjustToneForTopicContext(topic, tone) {
  const t = String(tone || 'expert').toLowerCase();
  if (t !== 'humorous') return tone;
  const topicStr = String(topic || '');
  if (SERVICE_TOPIC_TONE_BLOCKLIST.test(topicStr)) return 'expert';
  if (TECHNICAL_TOPIC_PATTERN.test(topicStr)) return 'expert';
  return tone;
}

function buildSyncedKeyMessage(resolvedTopic, resolvedObjective, index = 0, resolvedFormat = 'text', resolvedTone = '', variantKey = 0) {
  return buildNaturalKeyMessage({
    topic: sanitizeTopicTitle(resolvedTopic),
    objective: resolvedObjective,
    format: resolvedFormat,
    tone: alignToneToObjective(resolvedTopic, resolvedTone, resolvedObjective),
    index: (variantKey + index) % 11
  });
}

function padEvoSummaryBody(core, minLength, variantKey = 0) {
  let out = String(core || '').trim();
  if (!out) return out;
  let k = variantKey >>> 0;
  while (out.length < minLength) {
    const pad = SUMMARY_PAD_VARIANTS[k % SUMMARY_PAD_VARIANTS.length];
    k += 1;
    out = `${out}${pad}`;
  }
  return out.slice(0, 2200).trim();
}

function buildSyncedSummary(resolvedTopic, resolvedObjective, resolvedFormat, index = 0, resolvedTone = '', variantKey = 0) {
  const fmt = normalizeFormatForSummary(resolvedFormat);
  const minLen = EVO_MIN_SUMMARY_LENGTH[fmt] || EVO_MIN_SUMMARY_LENGTH.text;
  const topicPhrase = toReadablePhrase(resolvedTopic);
  const hint = OBJECTIVE_HINT_RU[normalizeKey(resolvedObjective)] || OBJECTIVE_HINT_RU.inform;
  const hintCap = hint.charAt(0).toUpperCase() + hint.slice(1);
  const mix = (variantKey + index * 17 + hashString(topicPhrase)) >>> 0;
  const formatLead =
    fmt === 'video'
      ? 'В видеоформате'
      : fmt === 'image'
        ? 'В графическом формате'
        : fmt === 'combined'
          ? 'В комбинированном формате'
          : 'В текстовом материале';
  const cores = [
    `${formatLead} разбираем тему: ${topicPhrase}. Цель публикации — ${hint}. Показываем контекст задачи, типовые боли аудитории и рабочий подход к решению. Даём ориентиры по внедрению и ожидаемый эффект для команды.`,
    `Практический разбор: ${topicPhrase}. Задача материала — ${hint}. Описываем прикладной контекст, этапы проверки гипотез и измеримый результат.`,
    `Погружаемся в «${topicPhrase}». ${hintCap}. Приводим прикладные примеры, ограничения и шаги, которые можно сделать без «большого проекта с нуля».`,
    `Тема недели — ${topicPhrase}. ${hintCap}. Собираем воедино факты, типовые ошибки и критерии, когда решение действительно окупается.`,
    `Читатель получит карту вопросов по ${topicPhrase.toLowerCase()}: что уточнить у команды, где чаще всего «ломается» внедрение, и как не потерять фокус. Цель — ${hint}.`,
    `Сценарный подход: сначала диагностика, затем пилот, затем масштабирование — на примере ${topicPhrase.toLowerCase()}. ${hintCap}.`,
    `Материал для тех, кто уже сталкивался с ${topicPhrase.toLowerCase()} и хочет системности. ${hintCap}.`,
    `Ставим ${topicPhrase.toLowerCase()} в связку с KPI, рисками и зрелостью процессов. Цель публикации — ${hint}.`,
    `Объясняем «зачем это сейчас» и «что меняется на местах» вокруг ${topicPhrase.toLowerCase()}. ${hintCap}.`,
    `Без перегруза терминами: ясные формулировки, чек-лист и ориентиры по теме «${topicPhrase}». ${hintCap}.`
  ];
  const core = cores[mix % cores.length];
  return padEvoSummaryBody(core, minLen, mix + 3);
}

function syncBodyFieldsAfterGeneChange(
  base,
  resolvedTopic,
  resolvedObjective,
  resolvedFormat,
  index,
  resolvedTone = '',
  syncOptions = {}
) {
  const topicChanged = normalizeKey(resolvedTopic) !== normalizeKey(base.topic);
  const objectiveChanged = normalizeKey(resolvedObjective) !== normalizeKey(base.objective);
  const formatChanged = normalizeKey(resolvedFormat) !== normalizeKey(base.format);

  if (!topicChanged && !objectiveChanged && !formatChanged) {
    return { key_message: base.key_message, summary: base.summary };
  }

  const variantKey = hashString(
    `${normalizeKey(resolvedTopic)}|${normalizeKey(resolvedObjective)}|${normalizeKey(resolvedFormat)}|${normalizeKey(resolvedTone)}|${index}`
  );

  const km = typeof base.key_message === 'string' ? base.key_message.trim() : '';
  const semanticCore = base?.semantic_core || buildDraftSemanticCore(base);
  const preservedOrGeneratedKeyMessage = shouldPreserveDraftKeyMessage(km, base, resolvedTopic, resolvedObjective, syncOptions)
    ? base.key_message
    : buildSyncedKeyMessage(resolvedTopic, resolvedObjective, index, resolvedFormat, resolvedTone, variantKey);
  const key_message = choosePreferredKeyMessage(
    semanticCore,
    preservedOrGeneratedKeyMessage,
    {
      topic: resolvedTopic,
      objective: resolvedObjective,
      format: resolvedFormat,
      tone: resolvedTone,
      index
    }
  );

  const fmt = normalizeFormatForSummary(resolvedFormat);
  const minLen = EVO_MIN_SUMMARY_LENGTH[fmt] || EVO_MIN_SUMMARY_LENGTH.text;
  const sm = typeof base.summary === 'string' ? base.summary.trim() : '';
  let summary;
  if (shouldPreserveDraftSummary(sm, base, resolvedTopic, resolvedObjective, syncOptions)) {
    summary = sm.length > 2200 ? sm.slice(0, 2200).trim() : sm;
    if (summary.length < minLen) {
      summary = padEvoSummaryBody(summary, minLen, variantKey + index);
    }
  } else {
    summary = buildSyncedSummary(
      resolvedTopic,
      resolvedObjective,
      resolvedFormat,
      index,
      resolvedTone,
      variantKey
    );
  }

  summary = choosePreferredSummary(
    semanticCore,
    summary,
    {
      topic: resolvedTopic,
      format: resolvedFormat,
      fallbackSummary: base?.summary || summary
    }
  );

  return { key_message, summary };
}

function diversifyDuplicateSummaryOpenings(publications = []) {
  if (!Array.isArray(publications) || publications.length <= 1) return publications;
  const prefixCounts = new Map();
  for (const pub of publications) {
    const sm = String(pub?.summary || '').trim();
    if (sm.length < 130) continue;
    const pre = normalizeKey(sm.slice(0, 168));
    if (pre.length < 48) continue;
    prefixCounts.set(pre, (prefixCounts.get(pre) || 0) + 1);
  }
  return publications.map((pub, index) => {
    const sm = String(pub?.summary || '').trim();
    if (sm.length < 130) return pub;
    const pre = normalizeKey(sm.slice(0, 168));
    if (pre.length < 48 || (prefixCounts.get(pre) || 0) < 2) return pub;
    const semanticCore = pub?.semantic_core || buildDraftSemanticCore(pub);
    const variantKey = (hashString(`${pre}|${index}|dedupeSummary`) >>> 0) + 61;
    const rebuilt = buildSyncedSummary(
      pub.topic,
      pub.objective,
      pub.format,
      index,
      pub.tone,
      variantKey
    );
    const summary = choosePreferredSummary(semanticCore, rebuilt, {
      topic: pub.topic,
      format: pub.format,
      fallbackSummary: pub.summary || rebuilt
    });
    return { ...pub, summary };
  });
}

function diversifyHighlySimilarSummaries(publications = []) {
  if (!Array.isArray(publications) || publications.length <= 1) return publications;
  const midKey = (sm) => {
    const t = stripObjectiveMeta(String(sm || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (t.length < 220) return '';
    const chunk = t.slice(100, Math.min(t.length, 380));
    return chunk.length >= 48 ? normalizeKey(chunk.slice(0, 140)) : '';
  };
  const counts = new Map();
  for (const p of publications) {
    const k = midKey(p?.summary);
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return publications.map((pub, index) => {
    const sm = String(pub?.summary || '').trim();
    const k = midKey(sm);
    if (!k || (counts.get(k) || 0) < 2) return pub;
    const semanticCore = pub?.semantic_core || buildDraftSemanticCore(pub);
    const variantKey = (hashString(`${k}|${index}|midDedup`) >>> 0) + 101;
    const rebuilt = buildSyncedSummary(
      pub.topic,
      pub.objective,
      pub.format,
      index,
      pub.tone,
      variantKey
    );
    const summary = choosePreferredSummary(semanticCore, rebuilt, {
      topic: pub.topic,
      format: pub.format,
      fallbackSummary: pub.summary || rebuilt
    });
    return { ...pub, summary };
  });
}

function applyGenomeToPlan(
  basePublications,
  draftContentPlan,
  genome,
  planningHorizon,
  precedentContext = {},
  bodySyncOptions = {}
) {
  const publications = genome.map((gene, index) => {
    const [topic, format, objective, tone, hasCta, creativity] = Array.isArray(gene) ? gene : [];
    const base = cloneJson(basePublications[index] || {});
    const semanticCore = base?.semantic_core || buildDraftSemanticCore(base);
    const nextCreativity = clamp01(creativity, asNumber(base?.ontology_features?.creativity, 0.5));
    const resolvedTopicRaw = choosePreferredTopic(
      semanticCore,
      topic ?? base.topic ?? `topic_${index + 1}`,
      objective ?? base.objective ?? 'inform',
      index
    );
    const displayTopic = normalizePublicationTopicForUi(resolvedTopicRaw);
    const resolvedFormat = format ?? base.format ?? 'text';
    const resolvedObjective = objective ?? base.objective ?? 'inform';
    const resolvedTone = normalizePublicationToneValue(
      adjustToneForTopicContext(displayTopic, tone ?? base.tone ?? 'expert'),
      'expert'
    );
    const { key_message, summary } = syncBodyFieldsAfterGeneChange(
      base,
      displayTopic,
      resolvedObjective,
      resolvedFormat,
      index,
      resolvedTone,
      bodySyncOptions
    );

    return {
      ...base,
      publication_id: base.publication_id || `evo_publication_${String(index + 1).padStart(3, '0')}`,
      topic: displayTopic,
      title: displayTopic,
      format: resolvedFormat,
      objective: resolvedObjective,
      tone: resolvedTone,
      key_message,
      summary,
      platform: base.platform || draftContentPlan?.platforms?.[0] || null,
      cta: hasCta ? base.cta || 'Свяжитесь с нами, чтобы получить детали.' : '',
      ontology_features: {
        ...(base.ontology_features || {}),
        has_cta: hasCta ? 1 : 0,
        creativity: nextCreativity
      },
      semantic_core: semanticCore
    };
  });
  const dedupedBodies = diversifyHighlySimilarSummaries(diversifyDuplicateSummaryOpenings(publications));
  const publicationsWithTitles = assignPublicationDisplayTitles(dedupedBodies);

  return {
    ...draftContentPlan,
    planning_horizon: {
      ...(draftContentPlan?.planning_horizon || {}),
      ...(planningHorizon || {})
    },
    publications: publicationsWithTitles
  };
}

function capPlanPredictedMetrics(predictedMetrics, metadata = null) {
  const [likes, shares, views] = predictedMetrics;
  const maxLikes = asNumber(metadata?.target_summary?.total_likes?.max, 0);
  const maxShares = asNumber(metadata?.target_summary?.total_shares?.max, 0);
  const maxViews = asNumber(metadata?.target_summary?.total_views?.max, 0);
  
  return {
    cappedLikes: maxLikes > 0 ? Math.min(likes, maxLikes) : likes,
    cappedShares: maxShares > 0 ? Math.min(shares, maxShares) : shares,
    cappedViews: maxViews > 0 ? Math.min(views, maxViews) : views
  };
}

function normalizeAgainstTarget(value, targetMax) {
  const safeValue = Math.max(0, asNumber(value, 0));
  const safeTarget = Math.max(0, asNumber(targetMax, 0));

  if (safeTarget > 0) {
    // Keep ranking sensitivity above historical max values instead of hard clipping to 1.
    return Math.min(1, Math.log1p(safeValue) / Math.log1p(safeTarget * 10));
  }
  return Math.tanh(Math.log1p(safeValue) / 8);
}

// Веса для фитнес-функции (можно вынести в конфиг)
const FITNESS_WEIGHTS = {
  likes: 0.5,
  shares: 0.3,
  views: 0.2
};

function buildNormalizedFrequencyMap(values = []) {
  const freq = buildFrequencyMap(values);
  const total = Array.from(freq.values()).reduce((sum, value) => sum + value, 0);
  return {
    freq,
    total
  };
}

function normalizedUniqueness(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return uniqueNormalized(values).length / values.length;
}

function normalizedEntropy(values = []) {
  if (!Array.isArray(values) || values.length <= 1) return 0;
  const { freq, total } = buildNormalizedFrequencyMap(values);
  const uniqueCount = freq.size;
  if (uniqueCount <= 1 || total <= 1) return 0;

  const entropy = Array.from(freq.values()).reduce((acc, count) => {
    const p = count / total;
    return acc - p * Math.log(p);
  }, 0);
  const maxEntropy = Math.log(uniqueCount);
  if (maxEntropy <= 0) return 0;
  return clamp01(entropy / maxEntropy, 0);
}

function maxRepeatSpread(values = []) {
  if (!Array.isArray(values) || values.length <= 1) return 1;
  const freq = buildFrequencyMap(values);
  const maxCount = Math.max(0, ...Array.from(freq.values()));
  return clamp01(1 - (maxCount - 1) / (values.length - 1), 0);
}

const CTA_MIN_SHARE = 0.7;
const CTA_MAX_SHARE = 0.8;
const CTA_TARGET_SHARE = 0.75;
const CTA_VARIANTS = [
  'Запросить демо',
  'Записаться на консультацию',
  'Заказать аудит участка',
  'Запустить пилот на 2 недели',
  'Получить расчёт окупаемости',
  'Скачать чек-лист внедрения',
  'Задать вопрос инженеру',
  'Посмотреть пример отчёта'
];

function calculateCtaBounds(totalPublications) {
  const minCount = Math.max(1, Math.ceil(totalPublications * CTA_MIN_SHARE));
  const maxCount = Math.max(minCount, Math.floor(totalPublications * CTA_MAX_SHARE));
  const targetCount = Math.min(
    maxCount,
    Math.max(minCount, Math.round(totalPublications * CTA_TARGET_SHARE))
  );
  return { minCount, maxCount, targetCount };
}

function buildEvolutionCtaText(objective = 'inform', slotIndex = 0) {
  const objectiveMap = {
    inform: 0,
    educate: 1,
    engage: 2,
    convert: 0,
    retain: 3,
    brand_building: 1
  };
  const variantIndex = objectiveMap[normalizeKey(objective)] ?? 0;
  const i = Math.max(0, Math.floor(Number(slotIndex)) || 0);
  return CTA_VARIANTS[(variantIndex + i * 2) % CTA_VARIANTS.length];
}

function enforceCtaCoverage(publications = [], lockedFields = {}) {
  if (!Array.isArray(publications) || publications.length === 0) return publications;
  if (lockedFields?.has_cta !== undefined) {
    const forceHasCta = lockedFields.has_cta ? 1 : 0;
    return publications.map((publication, index) => ({
      ...publication,
      cta: forceHasCta ? buildEvolutionCtaText(publication?.objective, index) : '',
      ontology_features: {
        ...(publication?.ontology_features || {}),
        has_cta: forceHasCta
      }
    }));
  }

  const { targetCount } = calculateCtaBounds(publications.length);
  const next = publications.map((publication) => ({ ...publication }));
  const activeIndices = [];
  const inactiveIndices = [];

  next.forEach((publication, index) => {
    const hasCta = asNumber(publication?.ontology_features?.has_cta, 0) > 0
      || Boolean(String(publication?.cta || '').trim());
    if (hasCta) activeIndices.push(index);
    else inactiveIndices.push(index);
  });

  while (activeIndices.length < targetCount && inactiveIndices.length) {
    activeIndices.push(inactiveIndices.shift());
  }
  while (activeIndices.length > targetCount) {
    inactiveIndices.unshift(activeIndices.pop());
  }

  const activeSet = new Set(activeIndices);
  return next.map((publication, index) => {
    const hasCta = activeSet.has(index);
    return {
      ...publication,
      cta: hasCta ? buildEvolutionCtaText(publication?.objective, index) : '',
      ontology_features: {
        ...(publication?.ontology_features || {}),
        has_cta: hasCta ? 1 : 0
      }
    };
  });
}

function scorePlanDiversity(publications = []) {
  if (!Array.isArray(publications) || publications.length <= 1) return 0;

  const topics = publications.map((item) => item?.topic);
  const topicCores = publications.map((item) => normalizeKey(topicCoreFromTopic(item?.topic)));
  const objectives = publications.map((item) => item?.objective);
  const formats = publications.map((item) => item?.format);
  const tones = publications.map((item) => item?.tone);
  const topicObjectiveFormatCombos = publications.map((item) =>
    [item?.topic, item?.objective, item?.format].map((part) => normalizeKey(part)).join('::')
  );

  const components = {
    topic_uniqueness: normalizedUniqueness(topics),
    topic_entropy: normalizedEntropy(topics),
    topic_repeat_spread: maxRepeatSpread(topics),
    topic_core_spread: maxRepeatSpread(topicCores),
    combo_uniqueness: normalizedUniqueness(topicObjectiveFormatCombos),
    objective_uniqueness: normalizedUniqueness(objectives),
    format_uniqueness: normalizedUniqueness(formats),
    tone_uniqueness: normalizedUniqueness(tones)
  };

  const diversityScore =
    components.topic_uniqueness * 0.25 +
    components.topic_entropy * 0.18 +
    components.topic_repeat_spread * 0.13 +
    components.topic_core_spread * 0.12 +
    components.combo_uniqueness * 0.15 +
    components.objective_uniqueness * 0.075 +
    components.format_uniqueness * 0.05 +
    components.tone_uniqueness * 0.025;

  return clamp01(diversityScore, 0);
}

function topicStemKey(topic) {
  const key = normalizeKey(topic);
  if (!key) return '';
  return key.length > 96 ? key.slice(0, 96) : key;
}

function scoreTopicStemSpread(publications = []) {
  if (!Array.isArray(publications) || publications.length <= 1) return 1;
  const stems = publications.map((item) => topicStemKey(item?.topic));
  const freq = buildFrequencyMap(stems);
  const maxRepeat = Math.max(0, ...Array.from(freq.values()));
  const n = publications.length;
  const concentration = (maxRepeat - 1) / Math.max(1, n - 1);
  return clamp01(1 - concentration * 0.55, 0);
}

function bodyTokenSet(publication = {}) {
  return new Set([...tokenizeText(publication?.key_message), ...tokenizeText(publication?.summary)]);
}

function jaccardTokenSimilarity(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set)) return 0;
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** 1 − средняя Jaccard-похожесть тел постов (key_message + summary) по парам слотов. */
function scorePlanBodyLexicalDiversity(publications = []) {
  if (!Array.isArray(publications) || publications.length <= 1) return 1;
  const sets = publications.map((p) => bodyTokenSet(p)).filter((s) => s.size >= 4);
  if (sets.length <= 1) return 0.55;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      sum += jaccardTokenSimilarity(sets[i], sets[j]);
      n += 1;
    }
  }
  const meanJ = n ? sum / n : 0;
  return clamp01(1 - meanJ, 0);
}

/** Штраф за одинаковые начала summary (клон «комплексной системы…» на все даты). */
function scorePlanSummaryPrefixDiversity(publications = [], prefixLen = 112) {
  if (!Array.isArray(publications) || publications.length <= 1) return 1;
  const stems = publications.map((p) => normalizeKey(String(p?.summary || '').slice(0, prefixLen)));
  const freq = buildFrequencyMap(stems.filter(Boolean));
  const maxRepeat = Math.max(0, ...Array.from(freq.values()));
  const n = publications.length;
  const concentration = (maxRepeat - 1) / Math.max(1, n - 1);
  return clamp01(1 - concentration * 0.72, 0);
}

function calculateFitness(predictedMetrics, metadata, publications = [], options = {}) {
  const { cappedLikes, cappedShares, cappedViews } = capPlanPredictedMetrics(predictedMetrics, metadata);
  
  const maxLikes = metadata?.target_summary?.total_likes?.max || 1;
  const maxShares = metadata?.target_summary?.total_shares?.max || 1;
  const maxViews = metadata?.target_summary?.total_views?.max || 1;
  
  const normLikes = normalizeAgainstTarget(cappedLikes, maxLikes);
  const normShares = normalizeAgainstTarget(cappedShares, maxShares);
  const normViews = normalizeAgainstTarget(cappedViews, maxViews);

  const kpiScore =
    FITNESS_WEIGHTS.likes * normLikes +
    FITNESS_WEIGHTS.shares * normShares +
    FITNESS_WEIGHTS.views * normViews;

  const diversityScore = scorePlanDiversity(publications);
  const stemSpreadScore = scoreTopicStemSpread(publications);
  const summaryPrefixScore = scorePlanSummaryPrefixDiversity(publications, 112);
  const bodyLexScore = scorePlanBodyLexicalDiversity(publications);
  const textBlend = clamp01(asNumber(options?.textDiversityBlend, 0.08), 0.08);
  const structuralBlend = 1 - textBlend;
  const blendedStructural = clamp01(
    diversityScore * 0.66 + stemSpreadScore * 0.17 + summaryPrefixScore * 0.17,
    0
  );
  const blendedDiversity = clamp01(blendedStructural * structuralBlend + bodyLexScore * textBlend, 0);
  const diversityWeight = clampProbability(options?.diversityWeight, 0.68);
  const kpiWeight = 1 - diversityWeight;

  const ontologyConsistencyBonus = clamp01(asNumber(options?.ontologyConsistencyBonus, 0), 0);
  const ontologyWeight = clampProbability(options?.ontologyWeight, 0.08);
  const baseScore = kpiWeight * kpiScore + diversityWeight * blendedDiversity;
  const draftAlignment = scorePlanDraftGeneAlignment(options?.genome, options?.basePublications);
  const draftWeight = clampProbability(options?.draftPreservationWeight ?? undefined, 0.11);
  const scoreWithDraft = clamp01((1 - draftWeight) * baseScore + draftWeight * draftAlignment, 0);
  return (1 - ontologyWeight) * scoreWithDraft + ontologyWeight * ontologyConsistencyBonus;
}

export async function optimizeContentPlanEvolution(draftContentPlan, config = {}) {
  const {
    precedentPublications = [],
    constraints = {},
    ga = {},
    lockedFields = {}
  } = config;
  const diversityWeight = clampProbability(
    ga?.diversityWeight ??
      constraints?.diversity_weight ??
      draftContentPlan?.constraints?.diversity_weight ??
      readPlanGaEnvNumber('PLAN_GA_DIVERSITY_WEIGHT'),
    0.68
  );
  const textDiversityBlend = clampProbability(
    ga?.textDiversityBlend ?? constraints?.text_diversity_blend ?? readPlanGaEnvNumber('PLAN_GA_TEXT_DIVERSITY_BLEND'),
    0.08
  );
  const draftPreservationWeight = clampProbability(
    ga?.draftPreservationWeight ??
      constraints?.draft_preservation_weight ??
      readPlanGaEnvNumber('PLAN_GA_DRAFT_PRESERVATION_WEIGHT') ??
      undefined,
    0.11
  );

  const crossoverMethod = ga.crossoverMethod || 'one_point';
  const mutationMethod = ga.mutationMethod || 'random_replace';

  let crossoverFn;
  switch (crossoverMethod) {
    case 'two_point':
      crossoverFn = twoPointCrossoverArrays;
      break;
    case 'uniform':
      crossoverFn = uniformCrossoverArrays;
      break;
    case 'one_point':
    default:
      crossoverFn = onePointCrossoverArrays;
  }

  let mutateFn;
  switch (mutationMethod) {
    case 'inversion':
      mutateFn = (individual, rng) => inversionMutation(individual, rng);
      break;
    case 'random_replace':
    default:
      mutateFn = (individual, rng) => {
        if (!Array.isArray(individual) || individual.length === 0) return cloneJson(individual);
        const slotIndex = Math.floor(rng() * individual.length);
        const next = cloneJson(individual);
        next[slotIndex] = randomReplaceMutation(next[slotIndex], geneDomains, rng);
        return next;
      };
  }

  const precedentContext = await buildPrecedentContext(precedentPublications, draftContentPlan);
  const planningHorizon = resolvePlanningHorizon(draftContentPlan, constraints);
  const targetPostCount = resolveTargetPostCount(draftContentPlan, constraints);
  
  const domains = buildDomains(draftContentPlan, precedentContext);
  const basePublications = expandBasePublications(draftContentPlan, targetPostCount);
  const draftPubs = Array.isArray(draftContentPlan?.publications) ? draftContentPlan.publications : [];
  const repeatedDraftKm = buildRepeatedDraftKeyMessageKeys(draftPubs);
  const repeatedDraftSummaryPrefixes = buildRepeatedDraftSummaryPrefixes(draftPubs);
  const bodySyncOptions = { repeatedDraftKeyMessages: repeatedDraftKm, repeatedDraftSummaryPrefixes };

  const allowedFormats = lockedFields.formats || (Array.isArray(draftContentPlan?.allowed_formats) ? draftContentPlan.allowed_formats : []);
  const allowedPlatforms = lockedFields.platforms || (Array.isArray(draftContentPlan?.platforms) ? draftContentPlan.platforms : []);
  
  const CTA_GENE_VALUES = [0, 1];
  const CREATIVITY_GENE_VALUES = [0.25, 0.5, 0.75, 1];
  const geneDomains = [...domains, CTA_GENE_VALUES, CREATIVITY_GENE_VALUES];

  const createPublicationGene = (rng, fallback = {}) => {
    let topic = domains[0][Math.floor(rng() * Math.max(1, domains[0].length))] || fallback.topic || 'unspecified';
    let format = domains[1][Math.floor(rng() * Math.max(1, domains[1].length))] || fallback.format || 'text';
    let objective = domains[2][Math.floor(rng() * Math.max(1, domains[2].length))] || fallback.objective || 'inform';
    let tone = domains[3][Math.floor(rng() * Math.max(1, domains[3].length))] || fallback.tone || 'expert';
    let hasCta = CTA_GENE_VALUES[Math.floor(rng() * CTA_GENE_VALUES.length)] ?? (fallback?.ontology_features?.has_cta ? 1 : 0);
    let creativity = CREATIVITY_GENE_VALUES[Math.floor(rng() * CREATIVITY_GENE_VALUES.length)] ?? clamp01(fallback?.ontology_features?.creativity, 0.5);
    
    // Принудительно устанавливаем заблокированные поля
    if (lockedFields.topic && fallback.topic) topic = fallback.topic;
    if (lockedFields.format && fallback.format && allowedFormats.includes(fallback.format)) format = fallback.format;
    if (lockedFields.platform && fallback.platform && allowedPlatforms.includes(fallback.platform)) {
      // platform не в геноме, но проверяем при создании
    }
    if (lockedFields.objective && fallback.objective) objective = fallback.objective;
    if (lockedFields.tone && fallback.tone) tone = fallback.tone;
    if (lockedFields.has_cta !== undefined) hasCta = lockedFields.has_cta ? 1 : 0;
    if (lockedFields.creativity !== undefined) creativity = lockedFields.creativity;
    
    return [topic, format, objective, tone, hasCta, creativity];
  };

  const createIndividual = (rng) => basePublications.map((publication) => createPublicationGene(rng, publication));
  const cloneIndividual = (individual) => cloneJson(individual);
  const crossover = (left, right, rng) => crossoverFn(left, right, rng);
  const applyLockedFieldsToGene = (gene, slotIndex) => {
    const nextGene = Array.isArray(gene) ? cloneJson(gene) : cloneJson(createPublicationGene(Math.random, basePublications[slotIndex]));
    if (lockedFields.topic && basePublications[slotIndex]?.topic) {
      nextGene[0] = basePublications[slotIndex].topic;
    }
    if (
      lockedFields.format &&
      basePublications[slotIndex]?.format &&
      allowedFormats.includes(basePublications[slotIndex].format)
    ) {
      nextGene[1] = basePublications[slotIndex].format;
    }
    if (lockedFields.objective && basePublications[slotIndex]?.objective) {
      nextGene[2] = basePublications[slotIndex].objective;
    }
    if (lockedFields.tone && basePublications[slotIndex]?.tone) {
      nextGene[3] = basePublications[slotIndex].tone;
    }
    if (lockedFields.has_cta !== undefined) {
      nextGene[4] = lockedFields.has_cta ? 1 : 0;
    }
    if (lockedFields.creativity !== undefined) {
      nextGene[5] = lockedFields.creativity;
    }
    return nextGene;
  };
  const mutate = (individual, rng) => {
    if (!Array.isArray(individual) || individual.length === 0) return cloneJson(individual);
    const slotIndex = Math.floor(rng() * individual.length);
    const next = cloneJson(individual);
    next[slotIndex] = mutateFn(next[slotIndex], rng);
    next[slotIndex] = applyLockedFieldsToGene(next[slotIndex], slotIndex);
    return next;
  };

  const traces = [];
  
  const result = await runAsyncGeneticAlgorithm({
    direction: 'max',
    seed: ga.seed ?? null,
    populationSize: ga.populationSize ?? 64,
    maxGenerations: ga.maxGenerations ?? 80,
    stagnationGenerations: ga.stagnationGenerations ?? 20,
    eliteSize: ga.eliteSize ?? 4,
    tournamentSize: ga.tournamentSize ?? 5,
    crossoverProbability: ga.crossoverProbability ?? 0.9,
    mutationProbability:
      ga.mutationProbability ?? readPlanGaEnvNumber('PLAN_GA_MUTATION_PROBABILITY') ?? 0.12,
    selectionMethod: ga.selectionMethod || 'tournament',
    createIndividual,
    cloneIndividual,
    crossover,
    mutate,
    cacheKeyForIndividual: (individual) => JSON.stringify(individual),
    minImprovementEpsilon: ga.minImprovementEpsilon ?? 1e-4,
    minImprovementGenerations: ga.minImprovementGenerations ?? 4,
    scorePopulation: async (population) => {
      const candidatePlans = population.map((genome) =>
        applyGenomeToPlan(
          basePublications,
          draftContentPlan,
          genome,
          planningHorizon,
          precedentContext,
          bodySyncOptions
        )
      );
      
      const featureVectors = candidatePlans.map((plan) => buildPlanFeatureVector(plan.publications, {
        durationDays: planningHorizon.duration_days,
        startDate: planningHorizon.start_date,
        endDate: planningHorizon.end_date,
        expectedPlatforms: lockedFields.platforms || draftContentPlan?.platforms || [],
        targetAudience: draftContentPlan?.target_audience || []
      }));
      
      const predictionResult = await predictPlanMetricsByFeatureVectors(featureVectors, { forceTrain: false });
      
      return predictionResult.predictions.map((predictedMetrics, index) => {
        const trustedTemplates = precedentContext?.ontology?.trusted_llm_additions?.relation_templates_count || 0;
        const trustedSynonyms = precedentContext?.ontology?.trusted_llm_additions?.synonyms_count || 0;
        const ontologyConsistencyBonus = precedentContext?.ontologyRollout?.enabled
          ? clamp01((trustedTemplates * 0.2 + trustedSynonyms * 0.05) / 5, 0)
          : 0;
        const fitness = calculateFitness(
          predictedMetrics,
          predictionResult.metadata,
          candidatePlans[index]?.publications || [],
          {
            diversityWeight,
            ontologyConsistencyBonus,
            textDiversityBlend,
            draftPreservationWeight,
            genome: population[index],
            basePublications
          }
        );
        
        return {
          score: fitness,
          meta: {
            predicted_likes: predictedMetrics[0],
            predicted_shares: predictedMetrics[1],
            predicted_views: predictedMetrics[2],
            fitness
          }
        };
      });
    },
    onGeneration: (entry) => {
      traces.push(entry);
      console.log('[GA:content-plan]', JSON.stringify({
        generation: entry.generation,
        best_score: entry.best_score,
        generation_best_score: entry.generation_best_score,
        avg_score: entry.generation_avg_score,
        summary: entry.best_meta
      }));
    }
  });

  const optimizedPlan = applyGenomeToPlan(
    basePublications,
    draftContentPlan,
    result.best || createIndividual(Math.random),
    planningHorizon,
    precedentContext,
    bodySyncOptions
  );
  optimizedPlan.publications = enforceCtaCoverage(optimizedPlan.publications, lockedFields);
  
  const featureMap = buildPlanFeatureMap(optimizedPlan.publications, {
    durationDays: planningHorizon.duration_days,
    startDate: planningHorizon.start_date,
    endDate: planningHorizon.end_date,
    expectedPlatforms: lockedFields.platforms || draftContentPlan?.platforms || [],
    targetAudience: draftContentPlan?.target_audience || []
  });

  return {
    optimizedPlan,
    planFeatureMap: featureMap,
    predictedLikes: asNumber(result.best_meta?.predicted_likes, 0),
    predictedShares: asNumber(result.best_meta?.predicted_shares, 0),
    predictedViews: asNumber(result.best_meta?.predicted_views, 0),
    ga: {
      ...result,
      history: traces
    }
  };
}

/** Финальная проверка: key_message согласован с topic/objective (после fill / LLM). */
export function sanitizePlanPublicationsBodies(publications = []) {
  if (!Array.isArray(publications)) return publications;
  const pass1 = publications.map((pub, index) => {
    const km = typeof pub?.key_message === 'string' ? pub.key_message.trim() : '';
    const topic = normalizePublicationTopicForUi(pub?.topic);
    const canonical = normalizePublicationTopicForUi(pub?.title || pub?.topic) || topic;
    const objective = pub?.objective;
    const format = pub?.format ?? 'text';
    const tone = alignToneToObjective(topic, normalizePublicationToneValue(pub?.tone, 'expert'), objective);
    const variantKey = hashString(`${normalizeKey(topic)}|${normalizeKey(objective)}|${index}|sanitize`);
    const semanticCore = pub?.semantic_core || buildDraftSemanticCore(pub);
    let sanitizedSummary = choosePreferredSummary(semanticCore, stripObjectiveMeta(pub?.summary || ''), {
      topic: canonical,
      format,
      fallbackSummary: pub?.summary || ''
    });
    sanitizedSummary = stripMisalignedSummaryLead(canonical, sanitizedSummary);
    sanitizedSummary = sanitizeUserFacingSummary(
      sanitizedSummary,
      canonical,
      format,
      {},
      typeof objective === 'string' ? objective : 'inform'
    );
    const cta = pub?.cta
      ? buildObjectiveCta(pub?.objective, '', topic, index)
      : '';
    const keyMeta = { topic: canonical, objective, format, tone, index };
    const finalizeKm = (raw) =>
      reconcilePublicationKeyMessageWithTopic({ ...pub, topic, title: pub?.title, key_message: raw }, index);

    if (!km) {
      const raw =
        choosePreferredKeyMessage(semanticCore, '', keyMeta) ||
        buildSyncedKeyMessage(canonical, objective, index, format, tone, variantKey);
      return {
        ...pub,
        topic,
        tone,
        summary: sanitizedSummary,
        cta,
        key_message: finalizeKm(raw),
        expected_kpi: calibrateExpectedKpi(pub?.expected_kpi, { objective, format, tone, cta }),
        semantic_core: semanticCore
      };
    }
    if (
      !shouldRewriteMachineKeyMessage(km) &&
      draftTextAlignsWithTopicCore(km, topic, 0.42, 2) &&
      draftAlignsWithObjective(km, objective) &&
      !textDeclaresObjectiveMismatch(km, objective)
    ) {
      return {
        ...pub,
        topic,
        tone,
        summary: sanitizedSummary,
        key_message: finalizeKm(choosePreferredKeyMessage(semanticCore, stripObjectiveMeta(km), keyMeta)),
        cta,
        expected_kpi: calibrateExpectedKpi(pub?.expected_kpi, { objective, format, tone, cta }),
        semantic_core: semanticCore
      };
    }
    return {
      ...pub,
      topic,
      tone,
      summary: sanitizedSummary,
      cta,
      key_message: finalizeKm(
        choosePreferredKeyMessage(
          semanticCore,
          buildSyncedKeyMessage(canonical, objective, index, format, tone, variantKey),
          keyMeta
        )
      ),
      expected_kpi: calibrateExpectedKpi(pub?.expected_kpi, { objective, format, tone, cta }),
      semantic_core: semanticCore
    };
  });
  const pass2 = dedupeKeyMessagesAcrossPublications(pass1);
  const pass3 = pass2.map((pub, index) => ({
    ...pub,
    key_message: reconcilePublicationKeyMessageWithTopic(pub, index)
  }));
  const pass4 = dedupeRepeatedProductBoilerplateInSummaries(pass3);
  const pass5 = pass4.map((pub, index) => ({
    ...pub,
    key_message: reconcilePublicationKeyMessageWithTopic(pub, index)
  }));
  return ensureDistinctTopicTitles(pass5);
}