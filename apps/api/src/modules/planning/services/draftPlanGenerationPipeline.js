import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callOpenRouterChat } from '../../../../openrouter.js';
import { predictEngagementRatesForGeneratedPublications } from '../../ml/services/relevancePredictionService.js';
import { parseJsonObjectFromLlmContent } from '../../../shared/utils/llmJsonParsing.js';
import { runPipelineStage } from '../../../shared/utils/pipelineErrorHandler.js';
import { normalizePublicationFormatValue, normalizePublicationToneValue } from '../routes/shared/planUtils.js';
import {
  alignToneToObjective,
  buildDraftSemanticCore,
  buildNaturalKeyMessage,
  buildNaturalTopicVariation,
  buildObjectiveCta,
  calibrateExpectedKpi,
  choosePreferredKeyMessage,
  choosePreferredSummary,
  choosePreferredTopic,
  assignDistinctCtas,
  dedupeKeyMessagesAcrossPublications,
  dedupeRepeatedProductBoilerplateInSummaries,
  diversifyRepeatedSummaryOpenings,
  ensureDistinctTopicTitles,
  normalizePublicationTopicForUi,
  reconcilePublicationKeyMessageWithTopic,
  sanitizeTopicTitle,
  shouldRewriteMachineKeyMessage,
  stripMisalignedSummaryLead,
  stripObjectiveMeta
} from './contentOutputUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKELETON_PROMPT_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'shared',
  'prompts',
  'articleDraftPlanSkeletonPrompt.txt'
);
const BATCH_PROMPT_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'shared',
  'prompts',
  'articleDraftPlanBatchPrompt.txt'
);

const ALLOWED_PLATFORMS = ['vk', 'linkedin', 'instagram'];
const ALLOWED_OBJECTIVES = ['inform', 'educate', 'engage', 'convert', 'retain', 'brand_building'];
const DEFAULT_FORMATS = ['text', 'image', 'video', 'combined'];
const ALLOWED_TONES = ['expert', 'friendly', 'official', 'inspiring', 'humorous', 'neutral'];
const CTA_MIN_SHARE = 0.7;
const CTA_MAX_SHARE = 0.8;
const CTA_TARGET_SHARE = 0.75;
const MIN_SUMMARY_LENGTH = {
  text: 650,
  combined: 650,
  image: 400,
  video: 400
};
const MAX_SUMMARY_LENGTH = 2200;
const SEMANTIC_STOP_WORDS = new Set([
  'и', 'или', 'но', 'а', 'в', 'во', 'на', 'по', 'к', 'ко', 'с', 'со', 'от', 'до', 'для', 'из', 'у',
  'о', 'об', 'при', 'над', 'под', 'за', 'как', 'что', 'это', 'этот', 'эта', 'эти', 'который', 'которая',
  'которые', 'мы', 'вы', 'они', 'он', 'она', 'оно', 'их', 'его', 'ее', 'так', 'же', 'ли', 'бы', 'не',
  'да', 'нет', 'the', 'and', 'or', 'for', 'with', 'from', 'into', 'your', 'our', 'this', 'that', 'are', 'is'
]);

export const PLAN_SKELETON_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    planning_horizon: {
      type: 'object',
      properties: {
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        duration_days: { type: 'number' },
        duration_weeks: { type: 'number' },
        posts_per_week: { type: 'number' }
      },
      required: ['start_date', 'end_date']
    },
    platforms: {
      type: 'array',
      items: { type: 'string' }
    },
    content_strategy: {
      type: 'object',
      properties: {
        brand_voice: { type: 'string' },
        target_audience: { type: 'string' },
        primary_objectives: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    },
    calendar_plan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          month: { type: 'string' },
          slots: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slot_id: { type: 'string' },
                planned_date: { type: 'string' },
                platform: { type: 'string' },
                format: { type: 'string' },
                objective: { type: 'string' },
                tone: { type: 'string' }
              }
            }
          }
        }
      }
    }
  },
  required: ['planning_horizon']
};

export const PLAN_MONTH_BATCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    publications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slot_id: { type: 'string' },
          publication_id: { type: 'string' },
          planned_date: { type: 'string' },
          platform: { type: 'string' },
          format: { type: 'string' },
          topic: { type: 'string' },
          objective: { type: 'string' },
          tone: { type: 'string' },
          key_message: { type: 'string' },
          summary: { type: 'string' },
          cta: { type: 'string' },
          creativity: { type: 'number' }
        },
        required: ['topic', 'key_message', 'summary']
      }
    }
  },
  required: ['publications']
};

function normalizePublicationDayMode(value) {
  return value === 'shared' ? 'shared' : 'spread';
}

function readPromptFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function extractJsonFromLlmContent(content) {
  return parseJsonObjectFromLlmContent(content);
}

function isIsoDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toIsoDateOnly(value) {
  if (!value) return null;
  if (isIsoDateString(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetweenInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const diff = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return diff >= 0 ? diff + 1 : 0;
}

function addDaysIso(startDate, daysToAdd) {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
}

function asNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  const seen = new Set();
  return values
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildVerticalContext(formInput = {}) {
  const vertical = typeof formInput.content_vertical === 'string' && formInput.content_vertical.trim()
    ? formInput.content_vertical.trim()
    : typeof formInput.industry === 'string' && formInput.industry.trim()
      ? formInput.industry.trim()
      : typeof formInput.consumerCategory === 'string' && formInput.consumerCategory.trim()
        ? formInput.consumerCategory.trim()
        : '';
  const subVertical = typeof formInput.subIndustry === 'string' && formInput.subIndustry.trim()
    ? formInput.subIndustry.trim()
    : typeof formInput.niche === 'string' && formInput.niche.trim()
      ? formInput.niche.trim()
      : '';
  const audience = uniqueStrings([
    formInput.consumerCategory,
    ...String(formInput.consumerDemographics || '')
      .split(/[,\n;]/)
      .map((item) => item.trim()),
    ...String(formInput.consumerPurchaseGoal || '')
      .split(/[,\n;]/)
      .map((item) => item.trim())
  ]).slice(0, 8);
  const brandVoice = typeof formInput.brandVoice === 'string' && formInput.brandVoice.trim()
    ? formInput.brandVoice.trim()
    : typeof formInput.tonePreference === 'string' && formInput.tonePreference.trim()
      ? formInput.tonePreference.trim()
      : '';

  return {
    vertical,
    sub_vertical: subVertical,
    audience,
    brand_voice: brandVoice
  };
}

function buildVerticalStylePack(formInput = {}) {
  const ctx = buildVerticalContext(formInput);
  const fragments = [];
  if (ctx.vertical) fragments.push(`Вертикаль: ${ctx.vertical}.`);
  if (ctx.sub_vertical) fragments.push(`Подниша: ${ctx.sub_vertical}.`);
  if (ctx.audience.length) fragments.push(`Аудитория: ${ctx.audience.join(', ')}.`);
  if (ctx.brand_voice) fragments.push(`Желаемый голос бренда: ${ctx.brand_voice}.`);
  fragments.push('Пиши в терминах и примерах, естественных для этой ниши, без подмены отрасли на IT или производство, если это не указано во входных данных.');
  return fragments.join(' ');
}

function normalizePlatform(value, fallback = 'linkedin') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ALLOWED_PLATFORMS.includes(normalized) ? normalized : fallback;
}

function normalizeObjective(value, fallback = 'inform') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ALLOWED_OBJECTIVES.includes(normalized) ? normalized : fallback;
}

function normalizeFormat(value, fallback = 'text') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const mapped = {
    text_post: 'text',
    image_post: 'image',
    video_post: 'video',
    reel: 'video',
    short_video: 'video',
    infographic: 'image',
    carousel: 'image'
  };
  const resolved = mapped[normalized] || normalized;
  return DEFAULT_FORMATS.includes(resolved) ? resolved : fallback;
}

const normalizeTone = normalizePublicationToneValue;

function getMinSummaryLengthByFormat(format = 'text') {
  const normalized = normalizeFormat(format, 'text');
  return MIN_SUMMARY_LENGTH[normalized] || MIN_SUMMARY_LENGTH.text;
}

const SUMMARY_PAD_SENTENCES = [
  ' Такой подход помогает быстрее увидеть практический результат и избежать типичных ошибок на старте.',
  ' Важно заранее определить понятные ориентиры качества, чтобы оценивать прогресс по реальным изменениям.',
  ' На практике это снижает лишнюю нагрузку и делает каждый следующий шаг предсказуемым и прозрачным.',
  ' Когда ключевые детали выстроены последовательно, результат становится заметен уже в первые недели.',
  ' Особое внимание стоит уделить обратной связи и регулярной проверке того, как решение работает в жизни.',
  ' Это позволяет вовремя скорректировать детали и адаптировать процесс под индивидуальные задачи.',
  ' В итоге складывается устойчивая система, которая опирается на практику, а не на общие обещания.',
  ' Главное — двигаться от конкретной задачи к измеримому эффекту, сохраняя комфорт и вовлечённость.'
];

function formatSentenceFragment(value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const capitalized = clean.charAt(0).toUpperCase() + clean.slice(1);
  return /[.!?…]$/u.test(capitalized) ? capitalized : `${capitalized}.`;
}

function ensureTextLength(value, minLength, maxLength = MAX_SUMMARY_LENGTH) {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) return '';
  if (normalized.length >= minLength) return normalized.slice(0, maxLength);
  let seed = 0;
  const sample = normalized.slice(0, 80);
  for (let i = 0; i < sample.length; i += 1) {
    seed = (seed * 33 + sample.charCodeAt(i)) >>> 0;
  }
  let extended = /[.!?…]$/u.test(normalized) ? normalized : `${normalized}.`;
  let steps = 0;
  while (extended.length < minLength && steps < SUMMARY_PAD_SENTENCES.length) {
    const candidate = SUMMARY_PAD_SENTENCES[(seed + steps) % SUMMARY_PAD_SENTENCES.length];
    if (!extended.includes(candidate.trim())) {
      extended = `${extended}${candidate}`;
    }
    steps += 1;
  }
  return extended.slice(0, maxLength).trim();
}

function excerptForSlot(text, maxLen, salt = 0) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentences = clean.split(/(?<=[.!?])\s+/u).map((part) => part.trim()).filter(Boolean);
  const source = sentences.length ? sentences[Math.abs(salt) % sentences.length] : clean;
  if (source.length <= maxLen) return source;
  const cut = source.slice(0, maxLen);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`;
}

function nicheDetailForVariant(formInput = {}, variant = 0) {
  const fields = [formInput.projectDescription, formInput.projectBenefits, formInput.projectGoals, formInput.consumerPurchaseGoal]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  if (!fields.length) {
    return 'В основе подхода — опора на реальные задачи аудитории и понятный практический результат.';
  }
  return formatSentenceFragment(excerptForSlot(fields[Math.abs(variant) % fields.length], 170, variant));
}

const RU_INFLECTION_SUFFIX_RE =
  /(?:ами|ями|ого|его|ому|ему|ыми|ими|ость|ости|ение|ения|ание|ания|ться|тся|ешь|ете|ают|яют|ите|ать|ять|ить|еть|ов|ев|ей|ам|ям|ах|ях|ом|ем|ою|ею|ую|юю|ый|ий|ой|ая|яя|ое|ее|ые|ие|а|я|о|е|ы|и|у|ю|ь)$/i;

function stemSemanticToken(token) {
  const normalized = String(token || '').toLowerCase().replace(/ё/g, 'е').trim();
  if (normalized.length <= 4) return normalized;
  const stripped = normalized.replace(RU_INFLECTION_SUFFIX_RE, '');
  return stripped.length >= 3 ? stripped : normalized.slice(0, 4);
}

function tokensMatchSemantically(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const stemLeft = stemSemanticToken(left);
  const stemRight = stemSemanticToken(right);
  if (stemLeft === stemRight) return true;
  const minLen = Math.min(stemLeft.length, stemRight.length);
  if (minLen >= 5) {
    return stemLeft.slice(0, 5) === stemRight.slice(0, 5);
  }
  return false;
}

function tokenizeSemanticText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s_-]+/gi, ' ')
    .split(/[\s_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !SEMANTIC_STOP_WORDS.has(token));
}

function hasSemanticOverlap(source, target, options = {}) {
  const {
    minSharedTokens = 1,
    minOverlapRatio = 0.1
  } = options;
  const sourceTokens = tokenizeSemanticText(source);
  const targetTokens = tokenizeSemanticText(target);
  if (!sourceTokens.length || !targetTokens.length) return false;
  const sourceUnique = Array.from(new Set(sourceTokens));
  const targetUnique = Array.from(new Set(targetTokens));
  const sharedCount = targetUnique.filter((targetToken) =>
    sourceUnique.some((sourceToken) => tokensMatchSemantically(sourceToken, targetToken))
  ).length;
  const overlapBase = Math.max(1, Math.min(sourceUnique.length, targetUnique.length));
  return sharedCount >= minSharedTokens && sharedCount / overlapBase >= minOverlapRatio;
}

const COHERENCE_TOPIC_KEY_OVERLAP = { minSharedTokens: 1, minOverlapRatio: 0.12 };
const COHERENCE_TOPIC_BODY_OVERLAP = { minSharedTokens: 1, minOverlapRatio: 0.08 };

function topicAnchorsInKeyMessage(topic, keyMessage) {
  const anchors = tokenizeSemanticText(topic).filter((token) => token.length >= 4);
  if (!anchors.length) return true;
  const keyTokens = tokenizeSemanticText(keyMessage);
  return anchors.some((anchor) => keyTokens.some((keyToken) => tokensMatchSemantically(anchor, keyToken)));
}

function buildSummaryRepairFromTopic(topic, format, formInput) {
  const minLength = getMinSummaryLengthByFormat(format);
  const safeTopic = sanitizeTopicTitle(topic) || 'ключевая тема публикации';
  const detail = nicheDetailForVariant(formInput, summarySanitizeSeed(safeTopic, format, 'inform', safeTopic));
  const core = `Разбираем тему «${safeTopic}» на конкретном жизненном примере: почему возникает эта ситуация и какие детали важно заметить вовремя. ${detail} Показываем простые и понятные шаги, которые помогают мягко скорректировать процесс и получить устойчивый результат на практике.`;
  return ensureTextLength(core, minLength, MAX_SUMMARY_LENGTH);
}

function summaryOpeningNormalizer(text) {
  return stripObjectiveMeta(String(text || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

function isGenericComplexSystemOpening(text) {
  const t = stripObjectiveMeta(String(text || '')).trim().toLowerCase();
  if (t.length < 24) return false;
  const head = t.slice(0, 220);
  return (
    /^комплексн[а-я]*\s+систем[а-я]*\s+(контроля|учёта|учета|управления)/i.test(t) ||
    /комплексн[а-я]*\s+систем[а-я]*,?\s*включающ/i.test(head)
  );
}

function buildSummaryOpeningsToAvoidList(publications = [], limit = 14) {
  const keys = new Set();
  const out = [];
  for (const p of [...toArray(publications)].reverse()) {
    const k = summaryOpeningNormalizer(p?.summary || '');
    if (k.length < 48) continue;
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(k.slice(0, 100));
    if (out.length >= limit) break;
  }
  return out;
}

function buildMonthlySlotSummaryHints(slots = [], monthIndex = 0) {
  const hints = [
    'практическая ситуация и разрыв с ожиданиями',
    'жизненный пример и роли участников',
    'наглядный показатель или ориентир',
    'вопрос читателю из практики',
    'сравнение двух подходов',
    'типичная ошибка и как её избежать',
    'частый миф и проверка фактами',
    'мини-история из опыта'
  ];
  return toArray(slots).map((slot, i) => ({
    slot_id: slot.slot_id,
    suggested_summary_entry_type: hints[(i + monthIndex * 3) % hints.length]
  }));
}

/** ТЗ автору / повелительное наклонение / старые синтетические вставки вместо текста для ленты (без \b — кириллица). */
const AUTHOR_BRIEF_PHRASE_RE =
  /(?:^|[\s,.;:!?«»(])(?:Сделай\s+акцент|Добавь\s+спорн[а-я]*|Покажи,\s+в\s+каком\s+месте|Объясни,\s+как\s+удерживать|Аудитория\s+слота\s*:|достаточно\s+одного\s+рабочего\s+эпизода,\s+а\s+не\s+полного\s+описания\s+продукта|Назовите,\s+что\s+меняется\s+после\s+этого\s+шага|без\s+пересказа\s+остальных\s+публикаций\s+плана|Отдельно\s+стоит\s+назвать\s+ограничение:\s+где\s+метод\s+не\s+подходит|В\s+конце\s+оставьте\s+читателю\s+один\s+вопрос)/iu;

function summarySanitizeSeed(topic, format, objective, summarySnippet) {
  let h = 2166136261;
  const pack = `${topic}|${format}|${objective}|${summarySnippet.slice(0, 64)}`;
  for (let i = 0; i < pack.length; i += 1) {
    h ^= pack.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function sanitizeUserFacingSummary(summary, topic, format, formInput = {}, objective = 'inform') {
  const minLength = getMinSummaryLengthByFormat(format);
  let normalized = stripObjectiveMeta(summary)
    .replace(/\b(?:в\s+фокусе|коротко\s+о\s+главном|для\s+команды\s+на\s+местах)\s*:\s*/giu, '')
    .replace(/Аудитория\s+слота\s*:\s*[^.?!]+[.?!]?/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  normalized = stripMisalignedSummaryLead(topic, normalized);
  if (!normalized) {
    return buildSummaryRepairFromTopic(topic, format, formInput);
  }
  const keptSentences = normalized
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (!sentence) return false;
      if (/\b(?:цель\s+публикации|задача\s+материала|читатель\s+получит|структура\s+материала)\b/iu.test(sentence)) {
        return false;
      }
      if (AUTHOR_BRIEF_PHRASE_RE.test(sentence)) return false;
      return true;
    });
  if (keptSentences.length) {
    normalized = keptSentences.join(' ');
  } else {
    normalized = '';
  }
  const stillInstruction =
    /\b(?:цель\s+публикации|задача\s+материала|читатель\s+получит|структура\s+материала)\b/iu.test(normalized) ||
    AUTHOR_BRIEF_PHRASE_RE.test(normalized);
  if (stillInstruction || normalized.length < Math.min(120, minLength)) {
    const obj = normalizeObjective(objective, 'inform');
    const seed = summarySanitizeSeed(topic, format, obj, normalized);
    return buildDiversifiedSummaryForSlot({ topic, format, objective: obj }, formInput, seed);
  }
  return normalized.slice(0, MAX_SUMMARY_LENGTH).trim();
}

function buildDiversifiedSummaryForSlot(slot, formInput, variantSeed = 0) {
  const idx = Math.abs(Number(variantSeed)) || 0;
  const topic =
    sanitizeTopicTitle(slot?.topic) || buildFallbackTopic(slot, formInput, (idx % 17) + 1);
  const format = slot?.format || 'text';
  const minLength = getMinSummaryLengthByFormat(format);
  const objective = normalizeObjective(slot?.objective, 'inform');
  const detail = nicheDetailForVariant(formInput, idx + 3);
  const objectiveLine =
    objective === 'convert'
      ? 'Разбираем, с какого простого шага удобно начать и как быстро увидеть первые результаты.'
      : objective === 'retain'
        ? 'Показываем, как закрепить полученный прогресс и поддерживать стабильное качество в долгую.'
        : objective === 'engage'
          ? 'Сопоставляем два подхода из практики, вокруг которых чаще всего возникают вопросы и обсуждения.'
          : objective === 'brand_building'
            ? 'Делимся внутренней логикой работы и принципами, которые помогают держать высокую планку качества.'
            : 'Разбираем типичные причины проблемы и понятные решения, которые работают в реальных условиях.';
  const v = idx % 8;
  const bodies = [
    `В теме «${topic}» важно выделить главное: на что обратить внимание в первую очередь. ${objectiveLine} ${detail} Это позволяет выстроить понятную последовательность действий без лишнего стресса.`,
    `Частая ситуация вокруг «${topic}»: мелкие сигналы остаются без внимания, пока не начинают влиять на общий результат. ${objectiveLine} ${detail}`,
    `Когда речь заходит о «${topic}», обычно выбирают между быстрым точечным решением и системной перестройкой подхода. ${objectiveLine} ${detail}`,
    `На практике «${topic}» проверяется в конкретных ежедневных ситуациях, когда стандартные шаблоны перестают работать. ${objectiveLine} ${detail}`,
    `Решение задачи «${topic}» строится на внимании к деталям и обратной связи. ${objectiveLine} ${detail} Такой формат помогает сразу заметить положительную динамику.`,
    `Что меняется на практике, когда вопрос «${topic}» решается системно и последовательно? ${objectiveLine} ${detail}`,
    `Наглядный ориентир в теме «${topic}» — это реальные изменения в качестве процесса и вовлечённости. ${objectiveLine} ${detail}`,
    `Там, где «${topic}» выстроена грамотно, ключевую роль играет чёткое взаимодействие и понятный ритм работы. ${objectiveLine} ${detail}`
  ];
  const body = bodies[v];
  return ensureTextLength(body, minLength, MAX_SUMMARY_LENGTH);
}

function summaryMiddleFingerprint(text) {
  const t = stripObjectiveMeta(String(text || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (t.length < 220) return '';
  const mid = t.slice(110, Math.min(t.length, 400));
  return mid.length >= 52 ? mid.slice(0, 140) : '';
}

function applyDraftBatchSummaryDeduplication(publications = [], slots = [], formInput = {}, monthIndex = 0) {
  const slotList = toArray(slots);
  if (!slotList.length) return toArray(publications);
  const byId = new Map(toArray(publications).map((p) => [p.slot_id, { ...p }]));
  const seenOpeningKeys = new Set();
  const seenMidKeys = new Set();
  let complexSystemUsed = false;
  let rewriteSalt = monthIndex * 13;

  for (let idx = 0; idx < slotList.length; idx += 1) {
    const slot = slotList[idx];
    const pub = byId.get(slot.slot_id);
    if (!pub) continue;
    const merged = {
      ...slot,
      topic: pub.topic || slot.topic,
      format: pub.format || slot.format,
      objective: pub.objective || slot.objective
    };
    const rawSummary = String(pub.summary || '');
    const openingKey = summaryOpeningNormalizer(rawSummary);
    const midKey = summaryMiddleFingerprint(rawSummary);
    const complex = isGenericComplexSystemOpening(rawSummary);
    const dupOpening = openingKey.length >= 48 && seenOpeningKeys.has(openingKey);
    const dupMid = midKey.length >= 52 && seenMidKeys.has(midKey);
    const dupComplex = complex && complexSystemUsed;

    if (dupOpening || dupComplex || dupMid) {
      rewriteSalt += 1;
      pub.summary = buildDiversifiedSummaryForSlot(merged, formInput, idx * 17 + rewriteSalt);
    }
    const finalKey = summaryOpeningNormalizer(pub.summary);
    if (finalKey.length >= 48) seenOpeningKeys.add(finalKey);
    const finalMid = summaryMiddleFingerprint(pub.summary);
    if (finalMid.length >= 52) seenMidKeys.add(finalMid);
    if (isGenericComplexSystemOpening(pub.summary)) complexSystemUsed = true;
  }

  return toArray(publications).map((orig) => byId.get(orig.slot_id) || orig);
}

function slugify(value, fallback = 'draft_plan') {
  const source = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const slug = source
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

function mergeUsageStats(usageItems = []) {
  return usageItems.reduce(
    (acc, usage) => ({
      prompt_tokens: acc.prompt_tokens + (Number(usage?.prompt_tokens) || 0),
      completion_tokens: acc.completion_tokens + (Number(usage?.completion_tokens) || 0),
      total_tokens: acc.total_tokens + (Number(usage?.total_tokens) || 0)
    }),
    {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  );
}

function getPublicationCountRangeByFrequency(formInput = {}) {
  const start = toIsoDateOnly(formInput.contentPlanStartDate);
  const end = toIsoDateOnly(formInput.contentPlanEndDate);
  if (!start || !end) {
    return { min: 8, max: 8, recommended: 8, hasFrequency: false };
  }

  const horizonDays = daysBetweenInclusive(start, end);
  if (horizonDays <= 0) {
    return { min: 8, max: 8, recommended: 8, hasFrequency: false };
  }

  const weeks = horizonDays / 7;
  const frequency = typeof formInput.publicationFrequency === 'string'
    ? formInput.publicationFrequency.trim().toLowerCase()
    : '';
  const perWeekRangeMap = {
    daily: { min: 7, max: 7, recommended: 7 },
    '3-4_per_week': { min: 3, max: 4, recommended: 3.5 },
    '2-3_per_week': { min: 2, max: 3, recommended: 2.5 },
    weekly: { min: 1, max: 1, recommended: 1 },
    '2_per_week': { min: 2, max: 2, recommended: 2 }
  };
  const perWeek = perWeekRangeMap[frequency];
  if (!perWeek) {
    const fallback = Math.max(1, Math.round(weeks));
    return { min: fallback, max: fallback, recommended: fallback, hasFrequency: false };
  }

  const recommended = Math.max(1, Math.round(weeks * perWeek.recommended));
  return { min: recommended, max: recommended, recommended, hasFrequency: true };
}

function getRequestedPublicationCount(formInput = {}) {
  const range = getPublicationCountRangeByFrequency(formInput);
  return range.recommended;
}

function getTargetPublicationCount(formInput = {}) {
  const requestedCount = getRequestedPublicationCount(formInput);
  const publicationDayMode = normalizePublicationDayMode(formInput.publicationDayMode);
  if (publicationDayMode !== 'shared') return requestedCount;

  const platformsCount = uniqueStrings(toArray(formInput.platforms).map((value) => normalizePlatform(value)))
    .filter((value) => ALLOWED_PLATFORMS.includes(value)).length;

  if (platformsCount <= 1) return requestedCount;
  return Math.max(platformsCount, Math.ceil(requestedCount / platformsCount) * platformsCount);
}

function buildCompactPublicationContext(item = {}) {
  const data = item?.data || {};
  const model = data?.publication_model || {};
  const kpi = model?.kpi_estimate || {};
  return {
    publication_id: model.publication_id || data.publication_id || null,
    platform: data.platform || model.platform || null,
    topic: model.topic || data.topic || null,
    format: normalizeFormat(model.format || data.format || 'text'),
    objective: normalizeObjective(model.objective || data.objective || 'inform'),
    tone: normalizeTone(model.tone || data.tone || 'expert'),
    audience_segments: uniqueStrings(model.audience_segments || data.target_audience || []),
    summary: model.summary || data.summary || null,
    reliability: clamp01(item?.reliability ?? 0),
    retrieval_score: clamp01(item?.score ?? 0),
    expected_kpi: {
      engagement_rate: clamp01(kpi.expected_engagement_rate ?? data.engagement_rate ?? 0.04),
      conversion_potential: clamp01(kpi.expected_conversion_potential ?? 0.1),
      reach_potential: clamp01(kpi.expected_reach_potential ?? 0.3)
    }
  };
}

function buildCompactPlanContext(item = {}) {
  const data = item?.data || {};
  const model = data?.content_plan_model || {};
  const kpi = model?.kpi_estimate || {};
  return {
    plan_id: data.plan_id || model.plan_id || null,
    platform: data.platform || model.platform || null,
    audience_segments: uniqueStrings(model.audience_segments || []),
    total_publications: asNumber(model.total_publications, null),
    posting_frequency_per_week: asNumber(model.posting_frequency_per_week, null),
    reliability: clamp01(item?.reliability ?? 0),
    retrieval_score: clamp01(item?.score ?? 0),
    avg_engagement_rate: clamp01(kpi.avg_engagement_rate ?? 0.04),
    estimated_conversion_potential: clamp01(kpi.estimated_conversion_potential ?? 0.1)
  };
}

function jaccardTokenSets(left, right) {
  if (!left.size && !right.size) return 1;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  const union = left.size + right.size - shared;
  return union ? shared / union : 0;
}

function pickDiverseByMmr(items, limit, textOf) {
  const ranked = toArray(items);
  if (ranked.length <= limit) return ranked;
  const selected = [ranked[0]];
  const rest = ranked.slice(1);
  while (selected.length < limit && rest.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    const selectedSets = selected.map((item) => new Set(tokenizeSemanticText(textOf(item))));
    for (let index = 0; index < rest.length; index += 1) {
      const relevance = (Number(rest[index]?.score) || 0) * 0.65 + (Number(rest[index]?.reliability) || 0) * 0.35;
      const candidateSet = new Set(tokenizeSemanticText(textOf(rest[index])));
      let maxSimilarity = 0;
      for (const selectedSet of selectedSets) {
        maxSimilarity = Math.max(maxSimilarity, jaccardTokenSets(candidateSet, selectedSet));
      }
      const mmr = relevance * 0.62 - maxSimilarity * 0.38;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIndex = index;
      }
    }
    selected.push(rest.splice(bestIndex, 1)[0]);
  }
  return selected;
}

function ragPublicationText(item = {}) {
  const data = item?.data || {};
  const model = data?.publication_model || {};
  return `${model.topic || data.topic || ''} ${model.summary || data.summary || ''}`;
}

function ragPlanText(item = {}) {
  const data = item?.data || {};
  const model = data?.content_plan_model || {};
  return `${model.plan_id || data.plan_id || ''} ${(model.audience_segments || []).join(' ')} ${data.summary || ''}`;
}

export function buildCompactRagContext(ragResults = {}) {
  const rankedPublications = toArray(ragResults.publications)
    .slice()
    .sort(
      (left, right) =>
        ((right?.score || 0) * 0.65 + (right?.reliability || 0) * 0.35) -
        ((left?.score || 0) * 0.65 + (left?.reliability || 0) * 0.35)
    );
  const publications = pickDiverseByMmr(rankedPublications, 8, ragPublicationText).map(buildCompactPublicationContext);
  const rankedPlans = toArray(ragResults.content_plans)
    .slice()
    .sort(
      (left, right) =>
        ((right?.score || 0) * 0.65 + (right?.reliability || 0) * 0.35) -
        ((left?.score || 0) * 0.65 + (left?.reliability || 0) * 0.35)
    );
  const contentPlans = pickDiverseByMmr(rankedPlans, 5, ragPlanText).map(buildCompactPlanContext);

  const precedentIds = uniqueStrings([
    ...publications.map((item) => item.publication_id),
    ...contentPlans.map((item) => item.plan_id)
  ]);

  return {
    retrieval: ragResults.retrieval || null,
    summary: {
      publications_count: publications.length,
      content_plans_count: contentPlans.length,
      total_publications_searched: ragResults.total_publications_searched || 0,
      total_content_plans_searched: ragResults.total_content_plans_searched || 0,
      precedent_ids: precedentIds
    },
    publications,
    content_plans: contentPlans
  };
}

function averagePrecedentKpi(compactRagContext = {}) {
  const publicationItems = toArray(compactRagContext.publications);
  if (!publicationItems.length) {
    return {
      engagement_rate: 0.045,
      conversion_potential: 0.12,
      reach_potential: 0.35
    };
  }

  const totals = publicationItems.reduce(
    (acc, item) => ({
      engagement_rate: acc.engagement_rate + clamp01(item?.expected_kpi?.engagement_rate ?? 0) * Math.max(0.2, clamp01(item?.reliability ?? 0)),
      conversion_potential: acc.conversion_potential + clamp01(item?.expected_kpi?.conversion_potential ?? 0) * Math.max(0.2, clamp01(item?.reliability ?? 0)),
      reach_potential: acc.reach_potential + clamp01(item?.expected_kpi?.reach_potential ?? 0) * Math.max(0.2, clamp01(item?.reliability ?? 0)),
      weight: acc.weight + Math.max(0.2, clamp01(item?.reliability ?? 0))
    }),
    {
      engagement_rate: 0,
      conversion_potential: 0,
      reach_potential: 0,
      weight: 0
    }
  );
  const totalWeight = Math.max(1, totals.weight);

  return {
    engagement_rate: clamp01(totals.engagement_rate / totalWeight),
    conversion_potential: clamp01(totals.conversion_potential / totalWeight),
    reach_potential: clamp01(totals.reach_potential / totalWeight)
  };
}

function buildRequestedConstraints(_formInput = {}, targetPublicationCount) {
  return {
    min_publications: targetPublicationCount
  };
}

function buildRequestedAudience(formInput = {}) {
  return uniqueStrings([
    formInput.consumerCategory,
    ...String(formInput.consumerDemographics || '')
      .split(/[,\n;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3)
  ]);
}

function buildSpreadSchedule(startDate, endDate, count) {
  if (!isIsoDateString(startDate) || !isIsoDateString(endDate) || count <= 0) {
    return Array.from({ length: count }, () => null);
  }

  const spanDays = daysBetweenInclusive(startDate, endDate);
  if (spanDays <= 0) {
    return Array.from({ length: count }, () => startDate);
  }

  if (count === 1) return [startDate];

  return Array.from({ length: count }, (_, idx) => {
    const offset = Math.round((idx * (spanDays - 1)) / Math.max(1, count - 1));
    return addDaysIso(startDate, offset);
  });
}

function buildDefaultSchedule(startDate, endDate, count, publicationDayMode = 'spread', platformsCount = 1) {
  const normalizedMode = normalizePublicationDayMode(publicationDayMode);
  if (normalizedMode !== 'shared' || platformsCount <= 1) {
    return buildSpreadSchedule(startDate, endDate, count);
  }

  const sharedDateCount = Math.max(1, Math.ceil(count / platformsCount));
  const sharedDates = buildSpreadSchedule(startDate, endDate, sharedDateCount);
  return sharedDates.flatMap((date) => Array.from({ length: platformsCount }, () => date)).slice(0, count);
}

function getMonthKey(dateString) {
  const iso = toIsoDateOnly(dateString);
  return iso ? iso.slice(0, 7) : 'unknown-month';
}

function groupSlotsByMonth(slots = []) {
  const monthMap = new Map();
  slots.forEach((slot) => {
    const monthKey = getMonthKey(slot?.planned_date);
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, []);
    }
    monthMap.get(monthKey).push(slot);
  });
  return Array.from(monthMap.entries()).map(([monthKey, monthSlots]) => ({
    monthKey,
    slots: monthSlots
  }));
}

function buildGeneratedPublicationsContext(publications = []) {
  return publications
    .slice(-20)
    .map((item) => ({
      publication_id: item.publication_id,
      planned_date: item.planned_date,
      platform: item.platform,
      objective: item.objective,
      format: item.format,
      topic: item.topic,
      key_message: typeof item.key_message === 'string' ? item.key_message.slice(0, 180) : '',
      summary_opening: summaryOpeningNormalizer(item.summary || '').slice(0, 100)
    }));
}

function buildSlotFallback(idx, config) {
  const platform = config.platforms[idx % config.platforms.length] || 'linkedin';
  const objective = ALLOWED_OBJECTIVES[idx % ALLOWED_OBJECTIVES.length];
  const format = config.formats[idx % config.formats.length] || 'text';
  const toneRotation = ['expert', 'friendly', 'official', 'inspiring', 'neutral'];
  const tone = toneRotation[idx % toneRotation.length];
  return {
    slot_id: `slot_${String(idx + 1).padStart(3, '0')}`,
    planned_date: config.schedule[idx] || config.startDate,
    platform,
    objective,
    format,
    tone
  };
}

function rebalanceSlotsByObjective(slots = []) {
  if (!Array.isArray(slots) || slots.length < 4) return slots;
  const next = slots.map((slot) => ({ ...slot }));
  const requiredObjectives = next.length >= 9
    ? ['inform', 'educate', 'engage', 'convert', 'retain', 'brand_building']
    : ['inform', 'educate', 'engage', 'convert', 'retain'];
  const getCounts = () =>
    next.reduce((acc, slot) => {
      acc[slot.objective] = (acc[slot.objective] || 0) + 1;
      return acc;
    }, {});

  const counts = getCounts();
  requiredObjectives.forEach((objective) => {
    if (counts[objective]) return;
    const donorObjective = Object.entries(counts)
      .filter(([key, count]) => key !== objective && count > 1)
      .sort((left, right) => right[1] - left[1])[0]?.[0];
    if (!donorObjective) return;
    const donorIndex = next.findIndex((slot) => slot.objective === donorObjective);
    if (donorIndex >= 0) {
      next[donorIndex].objective = objective;
      counts[donorObjective] -= 1;
      counts[objective] = (counts[objective] || 0) + 1;
    }
  });

  const maxShare = Math.max(2, Math.ceil(next.length * 0.35));
  for (let index = 2; index < next.length; index += 1) {
    const current = next[index].objective;
    const countsNow = getCounts();
    const repeatedRun =
      next[index - 1].objective === current && next[index - 2].objective === current;
    const overloaded = (countsNow[current] || 0) > maxShare;
    if (!repeatedRun && !overloaded) continue;
    const replacement = requiredObjectives
      .filter((candidate) => candidate !== current)
      .sort((left, right) => (countsNow[left] || 0) - (countsNow[right] || 0))[0];
    if (!replacement) continue;
    next[index].objective = replacement;
  }

  return next;
}

function rebalanceSlotsByFormat(slots = [], allowedFormats = DEFAULT_FORMATS) {
  if (!Array.isArray(slots) || slots.length < 4 || allowedFormats.length < 2) return slots;
  const next = slots.map((slot) => ({ ...slot }));
  for (let index = 2; index < next.length; index += 1) {
    const current = next[index].format;
    const repeatedRun = next[index - 1].format === current && next[index - 2].format === current;
    if (!repeatedRun) continue;
    const replacement = allowedFormats.find((format) => format !== current) || current;
    next[index].format = replacement;
  }
  return next;
}

function repairSkeleton(rawSkeleton = {}, formInput = {}, targetPublicationCount, compactRagContext = {}) {
  const projectName = typeof formInput.projectName === 'string' && formInput.projectName.trim()
    ? formInput.projectName.trim()
    : typeof formInput.brandName === 'string' && formInput.brandName.trim()
      ? formInput.brandName.trim()
      : 'Project';
  const requestedStart = toIsoDateOnly(formInput.contentPlanStartDate) || toIsoDateOnly(rawSkeleton?.planning_horizon?.start_date) || new Date().toISOString().slice(0, 10);
  const requestedEnd = toIsoDateOnly(formInput.contentPlanEndDate) || toIsoDateOnly(rawSkeleton?.planning_horizon?.end_date) || requestedStart;
  const publicationDayMode = normalizePublicationDayMode(
    formInput.publicationDayMode ?? rawSkeleton?.schedule_preferences?.publication_day_mode
  );
  const requestedPlatforms = uniqueStrings(toArray(formInput.platforms).map((value) => normalizePlatform(value)))
    .filter((value) => ALLOWED_PLATFORMS.includes(value));
  const normalizedPlatforms = requestedPlatforms.length
    ? requestedPlatforms
    : uniqueStrings(toArray(rawSkeleton.platforms).map((value) => normalizePlatform(value))).filter(Boolean);
  const platforms = normalizedPlatforms.length ? normalizedPlatforms : ['linkedin'];
  const formats = uniqueStrings(toArray(formInput.contentFormats).map((value) => normalizeFormat(value))).filter(Boolean);
  const resolvedFormats = formats.length ? formats : DEFAULT_FORMATS;
  const schedule = buildDefaultSchedule(
    requestedStart,
    requestedEnd,
    targetPublicationCount,
    publicationDayMode,
    platforms.length
  );
  const requestedPublicationCount = getRequestedPublicationCount(formInput);

  const calendarSlots = toArray(rawSkeleton.calendar_plan).flatMap((m) => toArray(m?.slots));
  const rawSlots = toArray(rawSkeleton.publication_slots).length > 0
    ? toArray(rawSkeleton.publication_slots)
    : calendarSlots;
  const config = {
    platforms,
    formats: resolvedFormats,
    defaultTone: 'expert',
    schedule,
    startDate: requestedStart,
    publicationDayMode
  };

  let repairedSlots = Array.from({ length: targetPublicationCount }, (_, idx) => {
    const source = rawSlots[idx] || {};
    const fallback = buildSlotFallback(idx, config);
    return {
      slot_id: `slot_${String(idx + 1).padStart(3, '0')}`,
      planned_date: (() => {
        if (publicationDayMode === 'shared') return fallback.planned_date;
        const candidate = toIsoDateOnly(source.planned_date);
        if (!candidate) return fallback.planned_date;
        if (candidate < requestedStart) return requestedStart;
        if (candidate > requestedEnd) return requestedEnd;
        return candidate;
      })(),
      platform: (() => {
        const normalized = publicationDayMode === 'shared'
          ? fallback.platform
          : normalizePlatform(source.platform, fallback.platform);
        const requested = Array.isArray(config.platforms) ? config.platforms : [];
        if (requested.length && !requested.includes(normalized)) return fallback.platform;
        return normalized;
      })(),
      objective: normalizeObjective(source.objective, fallback.objective),
      format: normalizeFormat(source.format, fallback.format),
      tone: normalizeTone(source.tone, fallback.tone)
    };
  });
  repairedSlots = rebalanceSlotsByObjective(repairedSlots);
  repairedSlots = rebalanceSlotsByFormat(repairedSlots, resolvedFormats);

  const avgKpi = averagePrecedentKpi(compactRagContext);
  const requestedConstraints = buildRequestedConstraints(formInput, targetPublicationCount);

  return {
    plan_id: rawSkeleton.plan_id || `draft_${slugify(projectName, 'it_project')}_001`,
    planning_horizon: {
      start_date: requestedStart,
      end_date: requestedEnd
    },
    platforms,
    target_audience: uniqueStrings([
      ...toArray(rawSkeleton.target_audience),
      ...buildRequestedAudience(formInput)
    ]),
    constraints: requestedConstraints,
    kpi_targets: {
      avg_engagement_rate: clamp01(
        rawSkeleton?.kpi_targets?.avg_engagement_rate ?? avgKpi.engagement_rate
      ),
      estimated_conversions: Math.max(
        0,
        Math.round(asNumber(rawSkeleton?.kpi_targets?.estimated_conversions, targetPublicationCount * 1.1) || 0)
      )
    },
    notes: typeof rawSkeleton.notes === 'string' && rawSkeleton.notes.trim()
      ? rawSkeleton.notes.trim()
      : `Черновой план для ${projectName}, собранный по частям на основе компактного RAG-контекста.`,
    content_profile: buildVerticalContext(formInput),
    schedule_preferences: {
      ...(rawSkeleton?.schedule_preferences && typeof rawSkeleton.schedule_preferences === 'object'
        ? rawSkeleton.schedule_preferences
        : {}),
      publication_day_mode: publicationDayMode,
      requested_publications: requestedPublicationCount,
      generated_publications: targetPublicationCount,
      platform_bundle_size: platforms.length
    },
    publication_slots: repairedSlots
  };
}

function calculateCtaBounds(totalPublications) {
  const minCount = Math.max(1, Math.ceil(totalPublications * CTA_MIN_SHARE));
  const maxCount = Math.max(minCount, Math.floor(totalPublications * CTA_MAX_SHARE));
  const targetCount = Math.min(
    maxCount,
    Math.max(minCount, Math.round(totalPublications * CTA_TARGET_SHARE))
  );
  return { minCount, maxCount, targetCount };
}

function enforceCtaCoverage(publications = [], projectName = '') {
  if (!Array.isArray(publications) || publications.length === 0) return publications;
  const { targetCount } = calculateCtaBounds(publications.length);
  const next = publications.map((item) => ({ ...item }));

  const activeIndices = [];
  const inactiveIndices = [];
  next.forEach((publication, index) => {
    const cta = typeof publication?.cta === 'string' ? publication.cta.trim() : '';
    if (cta) activeIndices.push(index);
    else inactiveIndices.push(index);
  });

  while (activeIndices.length < targetCount && inactiveIndices.length) {
    activeIndices.push(inactiveIndices.shift());
  }
  while (activeIndices.length > targetCount) {
    inactiveIndices.unshift(activeIndices.pop());
  }

  const activeSet = new Set(activeIndices);
  next.forEach((publication, index) => {
    const hasCta = activeSet.has(index);
    if (!hasCta) {
      publication.cta = '';
      return;
    }
    const existing = typeof publication.cta === 'string' ? publication.cta.trim() : '';
    if (existing) {
      publication.cta = existing;
      return;
    }
    const objective = normalizeObjective(publication?.objective, 'inform');
    publication.cta = buildObjectiveCta(objective, projectName, publication.topic || '', index);
  });

  return next;
}

function buildFallbackTopic(slot, formInput, index) {
  const projectName = typeof formInput.projectName === 'string' && formInput.projectName.trim()
    ? formInput.projectName.trim()
    : typeof formInput.brandName === 'string' && formInput.brandName.trim()
      ? formInput.brandName.trim()
      : 'проект';
  const topicByObjective = {
    inform: 'обновление продукта',
    educate: 'практический разбор',
    engage: 'обсуждение кейса',
    convert: 'бизнес-эффект решения',
    retain: 'развитие сервиса',
    brand_building: 'экспертный образ бренда'
  };
  const stem = `${projectName}: ${topicByObjective[slot.objective] || 'экспертный материал'}`;
  return buildNaturalTopicVariation(stem, normalizeObjective(slot.objective, 'inform'), 2, index);
}

function buildFallbackSummary(slot, formInput) {
  const topic = sanitizeTopicTitle(slot?.topic) || buildFallbackTopic(slot, formInput, 0);
  const minLength = getMinSummaryLengthByFormat(slot?.format);
  const detail = nicheDetailForVariant(
    formInput,
    summarySanitizeSeed(topic, slot?.format || 'text', slot?.objective || 'inform', topic)
  );
  const scenarioLine =
    slot?.objective === 'convert'
      ? 'Показываем, с какого шага удобно начать знакомство с решением и какой результат можно увидеть в короткие сроки.'
      : slot?.objective === 'retain'
        ? 'Разбираем, как выстроенное сопровождение и внимание к деталям помогают удерживать стабильное качество.'
        : slot?.objective === 'engage'
          ? 'Сравниваем два распространённых подхода из практики и разбираем, в каких случаях каждый из них работает лучше.'
          : 'Разбираем типичную ситуацию на практике: почему возникает проблема и какое решение помогает изменить результат.';
  const base = `«${topic}». ${detail} ${scenarioLine}`;
  return ensureTextLength(base, minLength, MAX_SUMMARY_LENGTH);
}

function buildFallbackKeyMessage(formInput, slot = {}) {
  const slotTopic = sanitizeTopicTitle(slot?.topic);
  if (slotTopic) {
    return buildNaturalKeyMessage({
      topic: slotTopic,
      objective: normalizeObjective(slot?.objective, 'inform'),
      format: normalizeFormat(slot?.format, 'text'),
      tone: alignToneToObjective(slotTopic, slot?.tone || 'expert', slot?.objective || 'inform'),
      index: 0
    });
  }
  const source = typeof formInput.projectBenefits === 'string' && formInput.projectBenefits.trim()
    ? formInput.projectBenefits.trim()
    : typeof formInput.projectGoals === 'string' && formInput.projectGoals.trim()
      ? formInput.projectGoals.trim()
      : 'Проект помогает аудитории решать прикладные задачи и быстрее принимать решения.';
  return `${source.slice(0, 180)}${source.length > 180 ? '...' : ''}`;
}

function buildFallbackPublication(slot, formInput = {}, compactRagContext, skeleton, index) {
  const safeForm = formInput || {};
  const projectName = typeof safeForm.projectName === 'string' && safeForm.projectName.trim()
    ? safeForm.projectName.trim()
    : typeof safeForm.brandName === 'string' && safeForm.brandName.trim()
      ? safeForm.brandName.trim()
      : 'Project';
  const avgKpi = averagePrecedentKpi(compactRagContext);
  const precedentIds = toArray(compactRagContext?.summary?.precedent_ids).slice(0, 2);
  const topic = buildFallbackTopic(slot, safeForm, index);
  const tone = alignToneToObjective(topic, slot.tone, slot.objective);
  const cta = buildObjectiveCta(slot.objective, projectName, topic, index);
  const basePublication = {
    topic,
    format: slot.format,
    objective: slot.objective,
    tone,
    summary: buildFallbackSummary(slot, safeForm),
    key_message: buildNaturalKeyMessage({
      topic,
      objective: slot.objective,
      format: slot.format,
      tone,
      index
    }),
    cta,
    expected_kpi: calibrateExpectedKpi(avgKpi, {
      objective: slot.objective,
      format: slot.format,
      tone,
      cta
    }),
    used_precedent_ids: precedentIds
  };
  return {
    ...basePublication,
    semantic_core: buildDraftSemanticCore(basePublication)
  };
}

function publicationSemanticCoherenceOk(pub) {
  const topicToSummaryOk = hasSemanticOverlap(pub?.topic, pub?.summary, COHERENCE_TOPIC_BODY_OVERLAP);
  const keyToSummaryOk = hasSemanticOverlap(pub?.key_message, pub?.summary, COHERENCE_TOPIC_BODY_OVERLAP);
  const topicToKeyOk =
    hasSemanticOverlap(pub?.topic, pub?.key_message, COHERENCE_TOPIC_KEY_OVERLAP) &&
    topicAnchorsInKeyMessage(pub?.topic, pub?.key_message);
  return topicToSummaryOk && keyToSummaryOk && topicToKeyOk;
}

function repairPublicationSemanticCoherence(publication, fallback, formInput = {}) {
  if (publicationSemanticCoherenceOk(publication)) {
    return { publication, repaired: false };
  }

  let next = { ...publication };
  let repaired = false;
  const fi = formInput && typeof formInput === 'object' ? formInput : {};

  const topicKeyOk =
    hasSemanticOverlap(next.topic, next.key_message, COHERENCE_TOPIC_KEY_OVERLAP) &&
    topicAnchorsInKeyMessage(next.topic, next.key_message);
  if (!topicKeyOk) {
    next = {
      ...next,
      key_message: buildFallbackKeyMessage(fi, {
        topic: next.topic,
        objective: next.objective,
        format: next.format,
        tone: next.tone
      })
    };
    repaired = true;
  }

  const existingSummary = typeof next.summary === 'string' ? next.summary.trim() : '';
  const hasUsableSummary =
    existingSummary.length >= 120 &&
    !AUTHOR_BRIEF_PHRASE_RE.test(existingSummary);

  if (!hasUsableSummary && !publicationSemanticCoherenceOk(next)) {
    next = {
      ...next,
      summary: buildSummaryRepairFromTopic(next.topic, next.format, fi)
    };
    repaired = true;
  }

  if (!hasUsableSummary && !publicationSemanticCoherenceOk(next)) {
    next = {
      ...next,
      summary: fallback.summary,
      key_message: buildFallbackKeyMessage(fi, {
        topic: next.topic || fallback.topic,
        objective: next.objective,
        format: next.format,
        tone: next.tone
      })
    };
    repaired = true;
  }

  return { publication: next, repaired };
}

function normalizeBatchPublication(
  rawItem = {},
  slot,
  formInput,
  compactRagContext,
  skeleton,
  index,
  allowedPrecedentIds = new Set()
) {
  const fallback = buildFallbackPublication(slot, formInput, compactRagContext, skeleton, index);
  const minSummaryLength = getMinSummaryLengthByFormat(slot?.format);
  const generatedSummary = typeof rawItem.summary === 'string' ? rawItem.summary.replace(/\s+/g, ' ').trim() : '';
  const normalizedSummary = generatedSummary.length >= 120
    ? generatedSummary.slice(0, MAX_SUMMARY_LENGTH)
    : ensureTextLength(generatedSummary, minSummaryLength, MAX_SUMMARY_LENGTH);
  const fallbackSummary = ensureTextLength(fallback.summary, minSummaryLength, MAX_SUMMARY_LENGTH);

  const rawUsedPrecedentIds = uniqueStrings(
    toArray(rawItem.used_precedent_ids).filter((value) => typeof value === 'string')
  ).slice(0, 5);
  const normalizedUsedPrecedentIds = rawUsedPrecedentIds.filter((id) => allowedPrecedentIds.has(id));

  const generatedTopic = typeof rawItem.topic === 'string' ? rawItem.topic.trim() : '';
  const generatedKey = typeof rawItem.key_message === 'string' ? rawItem.key_message.trim() : '';
  const substantialGeneration = generatedKey.length >= 40 || normalizedSummary.length >= 180;
  const semanticCore = substantialGeneration
    ? buildDraftSemanticCore({
        topic: generatedTopic || fallback.topic,
        key_message: generatedKey || fallback.key_message,
        summary: normalizedSummary || fallback.summary,
        objective: normalizeObjective(rawItem.objective, slot.objective),
        format: normalizeFormat(rawItem.format, slot.format)
      })
    : fallback.semantic_core || buildDraftSemanticCore(fallback);
  const normalizedPublication = {
    publication_id: `plan_pub_${String(index + 1).padStart(3, '0')}`,
    planned_date: slot.planned_date,
    platform: slot.platform,
    topic: normalizePublicationTopicForUi(
      choosePreferredTopic(
        semanticCore,
        typeof rawItem.topic === 'string' && rawItem.topic.trim() ? rawItem.topic.trim() : fallback.topic,
        normalizeObjective(rawItem.objective, slot.objective),
        index
      )
    ),
    format: normalizeFormat(rawItem.format, slot.format),
    objective: normalizeObjective(rawItem.objective, slot.objective),
    tone: alignToneToObjective(
      typeof rawItem.topic === 'string' && rawItem.topic.trim() ? rawItem.topic.trim() : fallback.topic,
      normalizeTone(rawItem.tone, slot.tone),
      normalizeObjective(rawItem.objective, slot.objective)
    ),
    summary: null,
    key_message: null,
    cta: typeof rawItem.cta === 'string' && rawItem.cta.trim() ? rawItem.cta.trim() : fallback.cta,
    expected_kpi: calibrateExpectedKpi(
      rawItem?.expected_kpi || fallback.expected_kpi,
      {
        objective: normalizeObjective(rawItem.objective, slot.objective),
        format: normalizeFormat(rawItem.format, slot.format),
        tone: normalizeTone(rawItem.tone, slot.tone),
        cta: typeof rawItem.cta === 'string' && rawItem.cta.trim() ? rawItem.cta.trim() : fallback.cta
      }
    ),
    used_precedent_ids: normalizedUsedPrecedentIds,
    semantic_core: semanticCore
  };
  normalizedPublication.key_message = choosePreferredKeyMessage(
    semanticCore,
    typeof rawItem.key_message === 'string' ? rawItem.key_message.trim() : '',
    {
      topic: normalizedPublication.topic,
      objective: normalizedPublication.objective,
      format: normalizedPublication.format,
      tone: normalizedPublication.tone,
      index
    }
  );
  normalizedPublication.summary = sanitizeUserFacingSummary(
    choosePreferredSummary(
      semanticCore,
      normalizedSummary || fallbackSummary,
      {
        topic: normalizedPublication.topic,
        format: slot?.format,
        formInput,
        fallbackSummary
      }
    ),
    normalizedPublication.topic,
    slot?.format,
    formInput,
    normalizedPublication.objective
  );
  normalizedPublication.cta = typeof normalizedPublication.cta === 'string' ? normalizedPublication.cta.trim() : '';

  return repairPublicationSemanticCoherence(
    normalizedPublication,
    {
      ...fallback,
      summary: fallbackSummary
    },
    formInput
  );
}

function validateDraftPlan(plan = {}, formInput = {}) {
  const errors = [];
  const publications = toArray(plan.publications);
  const requestedStart = toIsoDateOnly(formInput.contentPlanStartDate) || toIsoDateOnly(plan?.planning_horizon?.start_date);
  const requestedEnd = toIsoDateOnly(formInput.contentPlanEndDate) || toIsoDateOnly(plan?.planning_horizon?.end_date);
  const requestedPlatforms = uniqueStrings(toArray(formInput.platforms).map((value) => normalizePlatform(value)));
  const normalizedRequestedCount = asNumber(getRequestedPublicationCount(formInput), null);
  const constrainedMinPublications = asNumber(plan?.constraints?.min_publications, null);
  const generatedPublicationsTarget = asNumber(plan?.schedule_preferences?.generated_publications, null);
  const minPublications = [constrainedMinPublications, generatedPublicationsTarget, normalizedRequestedCount]
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value))
    .sort((left, right) => left - right)[0] ?? null;
  const totalPublications = publications.length;
  const ctaCount = publications.reduce((acc, pub) => {
    const cta = typeof pub?.cta === 'string' ? pub.cta.trim() : '';
    return acc + (cta ? 1 : 0);
  }, 0);
  const { minCount: minCtaCount, maxCount: maxCtaCount } = calculateCtaBounds(Math.max(1, totalPublications));

  if (!plan || typeof plan !== 'object') {
    errors.push('draft_content_plan отсутствует');
  }

  if (!plan?.plan_id || typeof plan.plan_id !== 'string') {
    errors.push('plan_id отсутствует');
  }

  if (!requestedStart || !requestedEnd) {
    errors.push('planning_horizon отсутствует или невалиден');
  }

  if (minPublications !== null && publications.length < minPublications) {
    errors.push(`min_publications violated: have=${publications.length}, need>=${minPublications}`);
  }

  const ids = new Set();
  publications.forEach((pub, idx) => {
    const prefix = `publication[${idx}]`;
    if (pub && typeof pub === 'object') {
      pub.tone = normalizePublicationToneValue(pub.tone, 'expert');
      pub.format = normalizePublicationFormatValue(pub.format, 'text');
    }
    if (!pub?.publication_id || typeof pub.publication_id !== 'string') {
      errors.push(`${prefix}: publication_id отсутствует`);
    } else if (ids.has(pub.publication_id)) {
      errors.push(`${prefix}: duplicate publication_id=${pub.publication_id}`);
    } else {
      ids.add(pub.publication_id);
    }

    if (!isIsoDateString(pub?.planned_date)) {
      errors.push(`${prefix}: planned_date невалиден`);
    } else {
      if (requestedStart && pub.planned_date < requestedStart) {
        errors.push(`${prefix}: planned_date раньше горизонта`);
      }
      if (requestedEnd && pub.planned_date > requestedEnd) {
        errors.push(`${prefix}: planned_date позже горизонта`);
      }
    }

    if (!ALLOWED_PLATFORMS.includes(pub?.platform)) {
      errors.push(`${prefix}: platform невалидна`);
    }
    if (requestedPlatforms.length && !requestedPlatforms.includes(pub?.platform)) {
      errors.push(`${prefix}: platform не входит в выбранные платформы`);
    }

    if (!pub?.topic || typeof pub.topic !== 'string') errors.push(`${prefix}: topic отсутствует`);
    if (!pub?.summary || typeof pub.summary !== 'string') errors.push(`${prefix}: summary отсутствует`);
    if (!pub?.key_message || typeof pub.key_message !== 'string') errors.push(`${prefix}: key_message отсутствует`);
    if (pub?.cta !== undefined && typeof pub.cta !== 'string') errors.push(`${prefix}: cta невалиден`);

    if (!ALLOWED_OBJECTIVES.includes(pub?.objective)) {
      errors.push(`${prefix}: objective невалиден`);
    }

    if (!DEFAULT_FORMATS.includes(pub?.format)) {
      errors.push(`${prefix}: format невалиден`);
    }
    if (!ALLOWED_TONES.includes(pub?.tone)) {
      errors.push(`${prefix}: tone невалиден`);
    }

    const engagement = asNumber(pub?.expected_kpi?.engagement_rate, null);
    const conversion = asNumber(pub?.expected_kpi?.conversion_potential, null);
    const reach = asNumber(pub?.expected_kpi?.reach_potential, null);
    if (engagement === null || engagement < 0 || engagement > 1) {
      errors.push(`${prefix}: expected_kpi.engagement_rate невалиден`);
    }
    if (conversion === null || conversion < 0 || conversion > 1) {
      errors.push(`${prefix}: expected_kpi.conversion_potential невалиден`);
    }
    if (reach === null || reach < 0 || reach > 1) {
      errors.push(`${prefix}: expected_kpi.reach_potential невалиден`);
    }
  });

  if (totalPublications > 0 && (ctaCount < minCtaCount || ctaCount > maxCtaCount)) {
    errors.push(`cta coverage violated: have=${ctaCount}, expected=${minCtaCount}-${maxCtaCount}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

async function generateSkeleton(formInput, query, compactRagContext, targetPublicationCount) {
  const systemPrompt = readPromptFile(SKELETON_PROMPT_PATH);
  const verticalContext = buildVerticalContext(formInput);
  const stylePack = buildVerticalStylePack(formInput);
  const userPrompt = `Собери skeleton чернового контент-плана.

Требования проекта:
${JSON.stringify(formInput, null, 2)}

Вертикаль и контекст ниши:
${JSON.stringify(verticalContext, null, 2)}

Style pack:
${stylePack}

RAG query:
${query}

Компактный RAG-контекст:
${JSON.stringify(compactRagContext, null, 2)}

Целевое число публикаций:
${targetPublicationCount}
`;

  // Низкая температура — стабильная структура JSON-скелета плана.
  const llmResponse = await runPipelineStage(
    'draft_skeleton',
    async () =>
      callOpenRouterChat(systemPrompt, userPrompt, {
        temperature: 0.4,
        jsonSchema: PLAN_SKELETON_JSON_SCHEMA,
        schemaName: 'content_plan_skeleton',
        responseFormat: 'json_schema'
      })
  );
  const parsed = extractJsonFromLlmContent(llmResponse.content || '');
  const skeleton = parsed?.draft_content_plan_skeleton || parsed || {};

  return {
    skeleton,
    usage: llmResponse.usage || null
  };
}
export async function generateSkeletonOnly(formInput, query, ragResults, _ragLimit) {
  const compactRagContext = buildCompactRagContext(ragResults);
  const targetPublicationCount = getTargetPublicationCount(formInput);
  const { skeleton, usage } = await generateSkeleton(formInput, query, compactRagContext, targetPublicationCount);
  const repaired = repairSkeleton(
    skeleton,
    formInput,
    targetPublicationCount,
    compactRagContext
  );
  return { skeleton: repaired, usage };
}

function buildGenerationBrief(formInput = {}) {
  return {
    project_name: formInput.projectName || formInput.brandName || '',
    description_excerpt: excerptForSlot(formInput.projectDescription, 220, 0),
    benefits_excerpt: excerptForSlot(formInput.projectBenefits, 180, 1),
    goals_excerpt: excerptForSlot(formInput.projectGoals, 160, 2),
    audience: formInput.consumerCategory || '',
    platforms: formInput.platforms || [],
    formats: formInput.contentFormats || [],
    horizon: {
      start: formInput.contentPlanStartDate || null,
      end: formInput.contentPlanEndDate || null
    },
    frequency: formInput.publicationFrequency || '',
    brand_voice: formInput.brandVoice || formInput.tonePreference || ''
  };
}

async function generateMonthlyPublications({
  formInput,
  query,
  compactRagContext,
  skeleton,
  monthKey,
  slots,
  previousPublications,
  monthIndex,
  totalMonths
}) {
  const systemPrompt = readPromptFile(BATCH_PROMPT_PATH);
  const verticalContext = buildVerticalContext(formInput);
  const stylePack = buildVerticalStylePack(formInput);
  const userPrompt = `Сгенерируй публикации для одного месяца по skeleton.

Краткое досье проекта (не копируй его целиком в каждый пост):
${JSON.stringify(buildGenerationBrief(formInput), null, 2)}

Вертикаль и контекст ниши:
${JSON.stringify(verticalContext, null, 2)}

Style pack:
${stylePack}

RAG query:
${query}

Skeleton метаданные:
${JSON.stringify({
  plan_id: skeleton.plan_id,
  planning_horizon: skeleton.planning_horizon,
  platforms: skeleton.platforms,
  constraints: skeleton.constraints,
  kpi_targets: skeleton.kpi_targets
}, null, 2)}

Компактный RAG-контекст:
${JSON.stringify(compactRagContext, null, 2)}

Ранее сгенерированные публикации предыдущих месяцев:
${JSON.stringify(buildGeneratedPublicationsContext(previousPublications), null, 2)}

summary_openings_to_avoid (не начинать новый summary с тех же 100 символов после нормализации):
${JSON.stringify(buildSummaryOpeningsToAvoidList(previousPublications, 14), null, 2)}

Рекомендуемый тип входа в текст поста по слотам (соблюдай разнообразие):
${JSON.stringify(buildMonthlySlotSummaryHints(slots, monthIndex), null, 2)}

Месяц ${monthIndex + 1} из ${totalMonths}:
${monthKey}

Слоты текущего месяца:
${JSON.stringify(slots, null, 2)}
`;

  const llmResponse = await runPipelineStage(
    `draft_month_batch:${monthKey}`,
    async () =>
      callOpenRouterChat(systemPrompt, userPrompt, {
        temperature: 0.62,
        jsonSchema: PLAN_MONTH_BATCH_JSON_SCHEMA,
        schemaName: 'content_plan_month_batch',
        responseFormat: 'json_schema'
      })
  );
  const parsed = extractJsonFromLlmContent(llmResponse.content || '');
  const rawPubs = toArray(parsed?.publications || parsed?.batch_publications || parsed);
  const publications = applyDraftBatchSummaryDeduplication(rawPubs, slots, formInput, monthIndex);

  return {
    publications,
    usage: llmResponse.usage || null
  };
}

function modelCopyIsUsable(publication) {
  const summary = String(publication?.summary || '').trim();
  const keyMessage = String(publication?.key_message || '').trim();
  if (summary.length < 80 || keyMessage.length < 12) return false;
  return !shouldRewriteMachineKeyMessage(keyMessage);
}

function keepMeasuredEngagement(publication, calibrated) {
  if (publication?.expected_kpi?.engagement_rate_source !== 'ml_post_metrics_calculated') return calibrated;
  return {
    ...calibrated,
    engagement_rate: publication.expected_kpi.engagement_rate,
    engagement_rate_source: 'ml_post_metrics_calculated'
  };
}

export async function generateDraftPlanBatched({
  formInput: rawFormInput,
  form_input,
  query,
  ragResults,
  ragLimit
}) {
  const formInput = rawFormInput || form_input || {};
  const compactRagContext = buildCompactRagContext(ragResults);
  const requestedPublicationCount = getRequestedPublicationCount(formInput);
  const targetPublicationCount = getTargetPublicationCount(formInput);

  const usageItems = [];
  const rawSkeletonResult = await generateSkeleton(
    formInput,
    query,
    compactRagContext,
    targetPublicationCount
  );
  if (rawSkeletonResult.usage) usageItems.push(rawSkeletonResult.usage);

  const skeleton = repairSkeleton(
    rawSkeletonResult.skeleton,
    formInput,
    targetPublicationCount,
    compactRagContext
  );

  const monthlyGroups = groupSlotsByMonth(skeleton.publication_slots);
  const allowedPrecedentIds = new Set(toArray(compactRagContext?.summary?.precedent_ids));
  const publicationMap = new Map();
  const generatedPublications = [];
  let coherenceRepairs = 0;

  for (let monthIndex = 0; monthIndex < monthlyGroups.length; monthIndex += 1) {
    const { monthKey, slots } = monthlyGroups[monthIndex];
    const batchResult = await generateMonthlyPublications({
      formInput,
      query,
      compactRagContext,
      skeleton,
      monthKey,
      slots,
      previousPublications: generatedPublications,
      monthIndex,
      totalMonths: monthlyGroups.length
    });
    if (batchResult.usage) usageItems.push(batchResult.usage);

    const rawItems = toArray(batchResult.publications);
    slots.forEach((slot, localIndex) => {
      const byId = rawItems.find((item) => item?.slot_id === slot.slot_id);
      const byPosition = rawItems[localIndex];
      const resolved = byId || byPosition || null;
      publicationMap.set(slot.slot_id, resolved);
      if (resolved) {
        generatedPublications.push(buildGeneratedPublicationContextItem(slot, resolved));
      }
    });
  }

  const mergedPlan = {
    plan_id: skeleton.plan_id,
    planning_horizon: skeleton.planning_horizon,
    platforms: skeleton.platforms,
    target_audience: skeleton.target_audience,
    constraints: skeleton.constraints,
    schedule_preferences: skeleton.schedule_preferences,
    publications: skeleton.publication_slots.map((slot, index) => {
      const normalizedResult = normalizeBatchPublication(
        publicationMap.get(slot.slot_id) || {},
        slot,
        formInput,
        compactRagContext,
        skeleton,
        index,
        allowedPrecedentIds
      );
      if (normalizedResult.repaired) coherenceRepairs += 1;
      return normalizedResult.publication;
    }),
    kpi_targets: skeleton.kpi_targets,
    notes: skeleton.notes,
    content_profile: skeleton.content_profile || buildVerticalContext(formInput)
  };

  mergedPlan.publications = ensureDistinctTopicTitles(mergedPlan.publications);

  try {
    const mlResult = await predictEngagementRatesForGeneratedPublications(mergedPlan.publications, {
      forceTrain: false
    });
    mergedPlan.publications = mlResult.updatedPublications;
    mergedPlan.kpi_targets = {
      ...(mergedPlan.kpi_targets || {}),
      avg_engagement_rate: mlResult.avgEngagementRate,
      avg_engagement_rate_source: 'ml_relevance_prediction'
    };
  } catch (error) {
    console.warn('[relevancePrediction] Failed to predict engagement_rate:', error?.message || error);
  }

  const projectName = typeof formInput?.projectName === 'string' ? formInput.projectName : '';
  mergedPlan.publications = enforceCtaCoverage(mergedPlan.publications, projectName);
  mergedPlan.publications = mergedPlan.publications.map((publication, index) => {
    const topic = sanitizeTopicTitle(publication?.topic);
    const canonical = normalizePublicationTopicForUi(publication?.title || publication?.topic) || topic;
    const tone = alignToneToObjective(topic, publication?.tone, publication?.objective);
    const usable = modelCopyIsUsable(publication);
    const semanticCore = publication?.semantic_core || buildDraftSemanticCore(publication);
    const keyMessage = usable
      ? stripObjectiveMeta(publication.key_message)
      : reconcilePublicationKeyMessageWithTopic(
        {
          ...publication,
          topic,
          title: publication?.title,
          key_message: choosePreferredKeyMessage(
            semanticCore,
            shouldRewriteMachineKeyMessage(publication?.key_message) ? '' : publication?.key_message,
            {
              topic: canonical,
              objective: publication?.objective,
              format: publication?.format,
              tone,
              index
            }
          )
        },
        index
      );
    const summary = usable
      ? stripObjectiveMeta(publication.summary)
      : sanitizeUserFacingSummary(
        choosePreferredSummary(semanticCore, publication?.summary, {
          topic: canonical,
          format: publication?.format,
          formInput,
          fallbackSummary: publication?.summary
        }),
        canonical,
        publication?.format,
        formInput,
        publication?.objective
      );
    return {
      ...publication,
      topic,
      tone,
      key_message: keyMessage,
      summary,
      text_origin: usable ? 'llm' : 'template_fallback',
      expected_kpi: keepMeasuredEngagement(publication, calibrateExpectedKpi(publication?.expected_kpi, {
        objective: publication?.objective,
        format: publication?.format,
        tone,
        cta: publication?.cta
      })),
      semantic_core: buildDraftSemanticCore({
        ...publication,
        topic: canonical,
        key_message: keyMessage,
        summary
      })
    };
  });

  mergedPlan.publications = dedupeKeyMessagesAcrossPublications(mergedPlan.publications);
  mergedPlan.publications = mergedPlan.publications.map((publication, index) => (
    publication.text_origin === 'llm'
      ? publication
      : {
        ...publication,
        key_message: reconcilePublicationKeyMessageWithTopic(publication, index)
      }
  ));
  mergedPlan.publications = dedupeRepeatedProductBoilerplateInSummaries(mergedPlan.publications);
  mergedPlan.publications = diversifyRepeatedSummaryOpenings(mergedPlan.publications);
  mergedPlan.publications = assignDistinctCtas(mergedPlan.publications, projectName);
  mergedPlan.publications = mergedPlan.publications.map((publication, index) => (
    publication.text_origin === 'llm'
      ? publication
      : {
        ...publication,
        key_message: reconcilePublicationKeyMessageWithTopic(publication, index)
      }
  ));

  const validation = validateDraftPlan(mergedPlan, formInput);
  if (!validation.valid) {
    const error = new Error(`Итоговый draft_content_plan не прошел валидацию: ${validation.errors.join('; ')}`);
    error.validation_errors = validation.errors;
    throw error;
  }

  return {
    draft: {
      draft_content_plan: mergedPlan
    },
    usage: usageItems.length ? mergeUsageStats(usageItems) : null,
    generation_metadata: {
      mode: 'skeleton_monthly_merge',
      rag_limit: ragLimit,
      requested_publications: requestedPublicationCount,
      target_publications: targetPublicationCount,
      total_months: monthlyGroups.length,
      coherence_repairs: coherenceRepairs,
      compact_rag_context: compactRagContext.summary,
      content_profile: buildVerticalContext(formInput),
      style_pack: buildVerticalStylePack(formInput)
    }
  };
}

function buildGeneratedPublicationContextItem(slot = {}, resolved = {}) {
  return {
    publication_id: slot.slot_id,
    planned_date: slot.planned_date,
    platform: slot.platform,
    objective: normalizeObjective(resolved.objective, slot.objective),
    format: normalizeFormat(resolved.format, slot.format),
    topic: typeof resolved.topic === 'string' ? resolved.topic.trim() : '',
    key_message: typeof resolved.key_message === 'string' ? resolved.key_message.trim() : '',
    summary: typeof resolved.summary === 'string' ? resolved.summary.trim() : ''
  };
}

export const DRAFT_PLAN_PIPELINE_TEST_UTILS = {
  tokenizeSemanticText,
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
};
