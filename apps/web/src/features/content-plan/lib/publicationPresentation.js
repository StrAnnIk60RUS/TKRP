const ALLOWED_OBJECTIVES = ['inform', 'educate', 'engage', 'convert', 'retain', 'brand_building']
const ALLOWED_FORMATS = ['text', 'image', 'video', 'combined']
const ALLOWED_PLATFORMS = ['vk', 'linkedin']
const ALLOWED_TONES = ['expert', 'friendly', 'official', 'inspiring', 'humorous', 'neutral']

const OBJECTIVE_LABELS = {
  inform: 'Информирование',
  educate: 'Обучение',
  engage: 'Вовлечение',
  convert: 'Конверсия',
  retain: 'Удержание',
  brand_building: 'Узнаваемость бренда'
}

const FORMAT_LABELS = {
  text: 'Текстовый пост',
  image: 'Изображение',
  video: 'Видео',
  combined: 'Комбинированный'
}

const FORMAT_ALIASES = {
  text_post: 'text',
  image_post: 'image',
  video_post: 'video',
  reel: 'video',
  short_video: 'video',
  infographic: 'image',
  carousel: 'image'
}

const PLATFORM_LABELS = {
  vk: 'ВКонтакте',
  linkedin: 'LinkedIn'
}

const TONE_ALIASES = {
  expert: 'expert',
  экспертный: 'expert',
  эксперт: 'expert',
  technical: 'expert',
  tech: 'expert',
  деловой: 'expert',
  деловая: 'expert',
  информативный: 'expert',
  информативная: 'expert',
  информационный: 'expert',
  professional: 'expert',
  businesslike: 'expert',
  friendly: 'friendly',
  friend: 'friendly',
  дружелюбный: 'friendly',
  дружеский: 'friendly',
  warm: 'friendly',
  casual: 'friendly',
  лояльный: 'friendly',
  лояльная: 'friendly',
  supportive: 'friendly',
  поддерживающий: 'friendly',
  поддерживающая: 'friendly',
  official: 'official',
  formal: 'official',
  официальный: 'official',
  корпоративный: 'official',
  уверенный: 'official',
  уверенная: 'official',
  inspiring: 'inspiring',
  inspirational: 'inspiring',
  motivational: 'inspiring',
  вдохновляющий: 'inspiring',
  юмористический: 'humorous',
  humorous: 'humorous',
  humor: 'humorous',
  fun: 'humorous',
  neutral: 'neutral',
  нейтральный: 'neutral'
}

const TONE_LABELS = {
  expert: 'Экспертный',
  friendly: 'Дружелюбный',
  official: 'Официальный',
  inspiring: 'Вдохновляющий',
  humorous: 'Юмористический',
  neutral: 'Нейтральный'
}

function toStringSafe(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

export function normalizeFormat(value, fallback = 'text') {
  const raw = toStringSafe(value).trim().toLowerCase()
  const resolved = FORMAT_ALIASES[raw] || raw
  if (ALLOWED_FORMATS.includes(resolved)) return resolved
  return fallback
}

export function normalizeObjective(value, fallback = 'inform') {
  const raw = toStringSafe(value).trim().toLowerCase()
  if (ALLOWED_OBJECTIVES.includes(raw)) return raw
  return fallback
}

export function normalizePlatform(value, fallback = 'vk') {
  const raw = toStringSafe(value).trim().toLowerCase()
  if (ALLOWED_PLATFORMS.includes(raw)) return raw
  return fallback
}

export function normalizeTone(value, fallback = 'expert') {
  const source = toStringSafe(value).trim().toLowerCase()
  if (!source) return fallback
  const normalized = source
    .replace(/[|/,+;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = normalized.split(' ').filter(Boolean)
  for (const token of tokens) {
    const mapped = TONE_ALIASES[token]
    if (mapped && ALLOWED_TONES.includes(mapped)) return mapped
  }
  if (ALLOWED_TONES.includes(normalized)) return normalized
  return fallback
}

export function getToneLabel(value) {
  const normalized = normalizeTone(value, '')
  return TONE_LABELS[normalized] || toStringSafe(value) || 'не указан'
}

export function getFormatLabel(value) {
  const normalized = normalizeFormat(value, '')
  return FORMAT_LABELS[normalized] || toStringSafe(value) || 'не указан'
}

export function getObjectiveLabel(value) {
  const normalized = normalizeObjective(value, '')
  return OBJECTIVE_LABELS[normalized] || toStringSafe(value) || 'не указана'
}

export function getPlatformLabel(value) {
  const normalized = normalizePlatform(value, '')
  return PLATFORM_LABELS[normalized] || toStringSafe(value) || 'не указана'
}

export function isMeaningfulCta(value) {
  const normalized = toStringSafe(value).trim().toLowerCase()
  if (!normalized) return false
  return normalized !== 'не задано' && normalized !== 'не задан'
}

export function truncateText(value, limit = 280) {
  const text = toStringSafe(value).trim()
  if (!text) return ''
  if (text.length <= limit) return text
  return `${text.slice(0, limit).trimEnd()}...`
}

export function normalizePublicationForUi(publication) {
  if (!publication || typeof publication !== 'object') return publication
  return {
    ...publication,
    planned_date: toStringSafe(publication.planned_date),
    topic: toStringSafe(publication.topic),
    tone: normalizeTone(publication.tone),
    summary: toStringSafe(publication.summary),
    key_message: toStringSafe(publication.key_message),
    cta: toStringSafe(publication.cta),
    format: normalizeFormat(publication.format),
    objective: normalizeObjective(publication.objective),
    platform: normalizePlatform(publication.platform)
  }
}

export const publicationFieldOptions = {
  objectives: ALLOWED_OBJECTIVES,
  formats: ALLOWED_FORMATS,
  platforms: ALLOWED_PLATFORMS,
  tones: ALLOWED_TONES
}
