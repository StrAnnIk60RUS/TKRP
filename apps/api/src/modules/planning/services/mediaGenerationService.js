import axios from 'axios';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MEDIA_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'data', 'runtime', 'api', 'media');

export const DEFAULT_IMAGE_MODEL = 'black-forest-labs/flux.2-pro';
export const DEFAULT_VIDEO_MODEL = 'google/veo-3.1-lite';

const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';
const OPENROUTER_VIDEOS_URL = 'https://openrouter.ai/api/v1/videos';
const SAFE_MEDIA_FILE = /^[a-f0-9]{32}\.(png|jpe?g|webp|mp4|webm)$/;
const VEO_DURATIONS = new Set([4, 6, 8]);

function asTrimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function httpError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function messageFromResponse(response) {
  const data = response?.data;
  if (data && !Buffer.isBuffer(data) && typeof data !== 'string') {
    const nested = data.error?.message || data.error || data.message;
    if (typeof nested === 'string' && nested.trim()) return nested.trim().slice(0, 400);
  }
  if (typeof data === 'string' && data.trim() && data.length < 400) return data.trim();
  return `OpenRouter ответил статусом ${response?.status || 'ошибки'}`;
}

export function mediaKindForFormat(format) {
  const value = asTrimmed(format).toLowerCase();
  if (value === 'video') return 'video';
  if (value === 'image' || value === 'combined') return 'image';
  return null;
}

export function aspectRatioFor(platform, kind) {
  const value = asTrimmed(platform).toLowerCase();
  if (kind === 'video') return value === 'linkedin' ? '16:9' : '9:16';
  if (value === 'linkedin') return '16:9';
  if (value === 'instagram') return '4:5';
  return '1:1';
}

export function buildFallbackMediaPrompt(kind, topic, summary) {
  if (kind !== 'image' && kind !== 'video') return '';
  const subject = String(topic || summary || 'the subject').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (kind === 'video') {
    return `A 4-second social video about ${subject}. One clear subject, soft natural light, a slow camera move, no on-screen text, no logos.`;
  }
  return `A clean social-media photograph about ${subject}. One clear subject, soft natural light, simple background, no text, no logos.`;
}

function extensionFor(mediaType, kind) {
  const type = String(mediaType || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4')) return 'mp4';
  return kind === 'video' ? 'mp4' : 'png';
}

function contentTypeForExtension(extension) {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'webm') return 'video/webm';
  return 'image/png';
}

export function resolveStoredMediaPath(fileName, mediaDir = DEFAULT_MEDIA_DIR) {
  const name = asTrimmed(fileName);
  if (!SAFE_MEDIA_FILE.test(name)) return null;
  const root = path.resolve(mediaDir);
  const full = path.resolve(root, name);
  if (!full.startsWith(`${root}${path.sep}`)) return null;
  return full;
}

function openRouterHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
    'X-Title': 'IT Project Promotion App'
  };
}

function readVideoDuration() {
  const numeric = Number(process.env.VIDEO_DURATION_SEC);
  if (VEO_DURATIONS.has(numeric)) return numeric;
  return 4;
}

function readVideoResolution() {
  const value = asTrimmed(process.env.VIDEO_RESOLUTION).toLowerCase();
  return value === '1080p' ? '1080p' : '720p';
}

async function callHttp(http, config) {
  const response = await http.request({
    validateStatus: () => true,
    ...config
  });
  if (response.status >= 400) {
    throw httpError(messageFromResponse(response), response.status >= 500 ? 502 : 400);
  }
  return response;
}

async function generateImage(http, apiKey, { model, prompt, aspectRatio }) {
  const response = await callHttp(http, {
    method: 'POST',
    url: OPENROUTER_IMAGES_URL,
    headers: openRouterHeaders(apiKey),
    timeout: 120000,
    data: {
      model,
      prompt,
      resolution: '1K',
      aspect_ratio: aspectRatio,
      n: 1
    }
  });
  const item = response.data?.data?.[0];
  if (!item?.b64_json) throw httpError('OpenRouter не вернул изображение');
  const contentType = item.media_type || 'image/png';
  return {
    buffer: Buffer.from(item.b64_json, 'base64'),
    contentType,
    extension: extensionFor(contentType, 'image')
  };
}

async function generateVideo(http, apiKey, { model, prompt, aspectRatio, sleep, pollIntervalMs, maxPolls }) {
  const submitted = await callHttp(http, {
    method: 'POST',
    url: OPENROUTER_VIDEOS_URL,
    headers: openRouterHeaders(apiKey),
    timeout: 60000,
    data: {
      model,
      prompt,
      duration: readVideoDuration(),
      resolution: readVideoResolution(),
      aspect_ratio: aspectRatio,
      generate_audio: String(process.env.VIDEO_GENERATE_AUDIO || '').toLowerCase() === 'true'
    }
  });
  const jobId = submitted.data?.id;
  if (!jobId) throw httpError('OpenRouter не вернул идентификатор видео');
  const pollingUrl = submitted.data?.polling_url || `${OPENROUTER_VIDEOS_URL}/${jobId}`;
  const pause = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const interval = pollIntervalMs ?? 5000;
  const attempts = maxPolls ?? 96;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await pause(interval);
    const polled = await callHttp(http, {
      method: 'GET',
      url: pollingUrl,
      headers: openRouterHeaders(apiKey),
      timeout: 30000
    });
    const status = polled.data?.status;
    if (status === 'completed') {
      const contentUrl = polled.data?.unsigned_urls?.[0];
      if (!contentUrl) throw httpError('OpenRouter не вернул ссылку на видео');
      const isSameOrigin = (() => {
        try {
          return new URL(contentUrl).origin === new URL(OPENROUTER_VIDEOS_URL).origin;
        } catch {
          return false;
        }
      })();
      const file = await callHttp(http, {
        method: 'GET',
        url: contentUrl,
        headers: isSameOrigin ? openRouterHeaders(apiKey) : {},
        responseType: 'arraybuffer',
        timeout: 120000
      });
      const headerType = file.headers?.['content-type'] || file.headers?.['Content-Type'] || 'video/mp4';
      const contentType = String(headerType).split(';')[0].trim() || 'video/mp4';
      return {
        buffer: Buffer.from(file.data),
        contentType,
        extension: extensionFor(contentType, 'video')
      };
    }
    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      const reason = polled.data?.error;
      const text = typeof reason === 'string' ? reason : reason?.message;
      throw httpError(text || `Генерация видео завершилась со статусом ${status}`);
    }
  }
  throw httpError('Генерация видео превысила время ожидания');
}

async function writeMediaFile(buffer, extension, mediaDir) {
  if (!buffer || buffer.length === 0) throw httpError('Пустой файл медиа');
  await mkdir(mediaDir, { recursive: true });
  const fileName = `${randomBytes(16).toString('hex')}.${extension}`;
  const filePath = resolveStoredMediaPath(fileName, mediaDir);
  if (!filePath) throw httpError('Не удалось сохранить файл медиа');
  await writeFile(filePath, buffer);
  return fileName;
}

/**
 * Generates an image or a short video for a publication prompt and stores the file locally.
 * @returns {Promise<{ kind: string, status: string, model: string, prompt: string, file_name: string, url: string, content_type: string, aspect_ratio: string, generated_at: string }>}
 */
export async function generatePublicationMedia(input = {}, deps = {}) {
  const kind = mediaKindForFormat(input.format);
  if (!kind) throw httpError('Медиа генерируется для форматов image, video и combined', 400);
  const prompt = asTrimmed(input.prompt);
  if (!prompt) throw httpError('Промпт для генерации пуст', 400);
  if (prompt.length > 4000) throw httpError('Промпт длиннее 4000 символов', 400);

  const apiKey = deps.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw httpError('OPENROUTER_API_KEY не задан', 503);

  const http = deps.http || axios;
  const mediaDir = deps.mediaDir || DEFAULT_MEDIA_DIR;
  const aspectRatio = aspectRatioFor(input.platform, kind);
  const model = kind === 'video'
    ? (deps.videoModel || asTrimmed(process.env.VIDEO_MODEL) || DEFAULT_VIDEO_MODEL)
    : (deps.imageModel || asTrimmed(process.env.IMAGE_MODEL) || DEFAULT_IMAGE_MODEL);

  const rendered = kind === 'video'
    ? await generateVideo(http, apiKey, {
      model,
      prompt,
      aspectRatio,
      sleep: deps.sleep,
      pollIntervalMs: deps.pollIntervalMs,
      maxPolls: deps.maxPolls
    })
    : await generateImage(http, apiKey, { model, prompt, aspectRatio });

  const fileName = await writeMediaFile(rendered.buffer, rendered.extension, mediaDir);
  return {
    kind,
    status: 'ready',
    model,
    prompt,
    file_name: fileName,
    url: `/api/plan/media/files/${fileName}`,
    content_type: rendered.contentType || contentTypeForExtension(rendered.extension),
    aspect_ratio: aspectRatio,
    generated_at: new Date().toISOString()
  };
}
