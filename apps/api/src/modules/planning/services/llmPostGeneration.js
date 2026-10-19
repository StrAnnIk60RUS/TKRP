import { callOpenRouterChat } from '../../../../openrouter.js';
import {
  alignToneToObjective,
  buildObjectiveCta,
  choosePreferredKeyMessage,
  choosePreferredSummary,
  normalizePublicationTopicForUi
} from './contentOutputUtils.js';
import { buildFallbackMediaPrompt, mediaKindForFormat } from './mediaGenerationService.js';

export const POST_CONTENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    key_message: { type: 'string' },
    summary: { type: 'string' },
    cta: { type: 'string' },
    media_prompt: { type: 'string' }
  },
  required: ['key_message', 'summary']
};

function clip(value, maxLen) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`;
}

function compactFormBrief(formInput = {}) {
  if (!formInput || typeof formInput !== 'object') return {};
  return {
    project_name: formInput.projectName || formInput.brandName || '',
    description_excerpt: clip(formInput.projectDescription, 220),
    benefits_excerpt: clip(formInput.projectBenefits, 180),
    audience: formInput.consumerCategory || '',
    brand_voice: formInput.brandVoice || formInput.tonePreference || '',
    platforms: formInput.platforms || []
  };
}

function compactRagBrief(ragResults = {}) {
  const publications = Array.isArray(ragResults?.publications) ? ragResults.publications : [];
  return publications.slice(0, 4).map((item) => {
    const data = item?.data || item || {};
    const model = data.publication_model || data;
    return {
      topic: clip(model.topic || data.topic, 120),
      objective: model.objective || data.objective || '',
      format: model.format || data.format || '',
      summary_excerpt: clip(model.summary || data.summary, 160)
    };
  });
}

function hookInstruction(hook) {
  if (hook === 'question') return 'первое предложение — вопрос к читателю';
  if (hook === 'case') return 'первое предложение — конкретный рабочий случай';
  if (hook === 'contrast') return 'первое предложение — цифра или контраст';
  return 'сразу суть темы, без вопроса и без цифры в первой фразе';
}

function lengthInstruction(length) {
  if (length === 'short') return 'короткий пост, 2–4 предложения';
  if (length === 'long') return 'развёрнутый пост: эпизод, шаг и результат';
  return 'средний пост: один эпизод и вывод';
}

function summaryFloor(format, length) {
  const visual = format === 'image' || format === 'video';
  if (length === 'short') return visual ? 160 : 220;
  if (length === 'long') return visual ? 520 : 700;
  return visual ? 320 : 450;
}

function temperatureFromCreativity(creativity) {
  const numeric = Number(creativity);
  const value = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.5;
  return Number((0.55 + value * 0.35).toFixed(2));
}

function clipMediaPrompt(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= 1200) return text;
  return text.slice(0, 1200).trim();
}

/**
 * Generates post content (key_message, summary, cta, and a media prompt for image/video).
 * @returns {Promise<{ key_message: string, summary: string, cta: string, media_prompt: string }>}
 */
export async function generatePostContent(slot, gaOptimizedParams, formInput, ragResults, usage = {}) {
  const requestedFormat = gaOptimizedParams?.format || slot?.format || 'text';
  const visualKind = mediaKindForFormat(requestedFormat);
  if (process.env.TEST_MODE === 'true') {
    return {
      key_message: 'Test Key Message',
      summary: 'Test Summary.',
      cta: 'Test CTA',
      keyMessage: 'Test Key Message',
      text_origin: 'llm',
      media_prompt: visualKind ? 'Test media prompt' : ''
    };
  }

  const topic = gaOptimizedParams?.topic || slot?.topic || '';
  const format = gaOptimizedParams?.format || slot?.format || 'text';
  const objective = gaOptimizedParams?.objective || slot?.objective || 'inform';
  const tone = gaOptimizedParams?.tone || slot?.tone || 'expert';
  const platform = gaOptimizedParams?.platform || slot?.platform || '';
  const hasCta = Number(gaOptimizedParams?.has_cta) > 0;
  const creativity = gaOptimizedParams?.creativity ?? 0.5;
  const hook = gaOptimizedParams?.hook || 'direct';
  const length = gaOptimizedParams?.length || 'medium';
  const useLists = Number(gaOptimizedParams?.lists) > 0;
  const index = Number.isFinite(Number(gaOptimizedParams?.index)) ? Number(gaOptimizedParams.index) : 0;
  const avoidOpenings = Array.isArray(gaOptimizedParams?.avoid_openings) ? gaOptimizedParams.avoid_openings : [];
  const avoidTopics = Array.isArray(gaOptimizedParams?.avoid_topics) ? gaOptimizedParams.avoid_topics : [];

  const minSummary = summaryFloor(format, length);
  const systemPrompt = [
    'Ты автор постов для соцсетей. Пиши по-русски, как текст для ленты, а не как план редактора.',
    visualKind
      ? 'Верни только JSON с полями key_message, summary, cta, media_prompt.'
      : 'Верни только JSON с полями key_message, summary, cta.',
    'Соблюдай установки крючка, длины и списков из задания.',
    'Этот пост должен отличаться от соседних: другой заход, другие первые 120 символов, другая грамматическая конструкция key_message.',
    'Не копируй описание продукта, RAG и формулировки из списка avoid.',
    'Не пиши «цель публикации», «задача материала», «структура материала».',
    'Не выдумывай цифры, названия и факты, которых нет во входе.'
  ].join(' ');

  const userPrompt = `Слот ${index + 1}.
Платформа: ${platform || 'не указана'}
Тема: ${topic}
Формат: ${format}
Цель: ${objective}
Тон: ${tone}
Крючок: ${hookInstruction(hook)}
Длина: ${lengthInstruction(length)}
Списки: ${useLists ? 'внутри текста маркированный список из трёх коротких пунктов' : 'сплошной текст без списков и нумерации'}
CTA: ${hasCta ? 'нужен, свой для этой темы' : 'не нужен, верни пустую строку'}

Досье проекта (не вставляй его целиком):
${JSON.stringify(compactFormBrief(formInput))}

Ориентиры из прецедентов (перескажи угол слота, не копируй):
${JSON.stringify(compactRagBrief(ragResults))}

Темы, которые уже заняты:
${JSON.stringify(avoidTopics)}

Начала summary, которые нельзя повторять:
${JSON.stringify(avoidOpenings)}

key_message — один тезис до 200 символов, с терминами этой темы.
summary — текст поста от ${minSummary} символов. ${lengthInstruction(length)} Для instagram короче и визуальнее, для linkedin экспертнее, для vk понятнее.
cta — короткая фраза под эту тему или пустая строка.
${visualKind ? `media_prompt — промпт на английском для генерации ${visualKind === 'video' ? 'короткого видео' : 'изображения'} к этому посту. Конкретная сцена: объект, свет, ракурс${visualKind === 'video' ? ', одно движение камеры и одно действие' : ''}. Без текста в кадре, без логотипов и водяных знаков. 2–4 предложения.` : ''}
`;

  try {
    const llmResponse = await callOpenRouterChat(systemPrompt, userPrompt, {
      temperature: temperatureFromCreativity(creativity),
      maxTokens: visualKind ? 1100 : 900,
      jsonSchema: POST_CONTENT_JSON_SCHEMA,
      schemaName: 'post_content_generation',
      responseFormat: 'json_schema'
    });

    if (usage) {
      usage.prompt_tokens = (usage.prompt_tokens || 0) + (llmResponse.usage?.prompt_tokens || 0);
      usage.completion_tokens = (usage.completion_tokens || 0) + (llmResponse.usage?.completion_tokens || 0);
      usage.total_tokens = (usage.total_tokens || 0) + (llmResponse.usage?.total_tokens || 0);
    }

    const content = String(llmResponse.content || '').trim();
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('LLM post JSON not found');
      result = JSON.parse(jsonMatch[0]);
    }

    const keyMessage = result.key_message ?? result.keyMessage;
    const summary = result.summary;
    if (keyMessage !== undefined && summary !== undefined) {
      const ctaText = hasCta ? String(result.cta || '').trim() : '';
      const writtenSummary = String(summary).trim();
      const mediaPrompt = visualKind
        ? clipMediaPrompt(result.media_prompt || result.mediaPrompt) ||
          buildFallbackMediaPrompt(visualKind, topic, writtenSummary)
        : '';
      return {
        key_message: String(keyMessage).trim(),
        summary: writtenSummary,
        cta: ctaText,
        text_origin: 'llm',
        media_prompt: mediaPrompt
      };
    }
  } catch (err) {
    console.error('Error generating post content via LLM:', err);
  }

  const resolvedTopic = normalizePublicationTopicForUi(topic || '');
  const resolvedTone = alignToneToObjective(resolvedTopic, tone || '', objective || '');
  const semanticCore = {
    topic: resolvedTopic,
    key_message: '',
    summary: '',
    objective: objective || '',
    format: format || '',
    tone: resolvedTone
  };
  const keyMessage = choosePreferredKeyMessage(semanticCore, '', {
    topic: resolvedTopic,
    objective,
    format,
    tone: resolvedTone,
    index
  });
  const summary = choosePreferredSummary(semanticCore, '', {
    topic: resolvedTopic,
    format,
    fallbackSummary: ''
  });
  const cta = hasCta ? buildObjectiveCta(objective || '', '', resolvedTopic, index) : '';
  return {
    key_message: keyMessage,
    summary,
    cta,
    text_origin: 'template_fallback',
    media_prompt: visualKind ? buildFallbackMediaPrompt(visualKind, resolvedTopic, summary) : ''
  };
}
