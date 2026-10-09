import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { enrichCompetitorsData } from '../../../../openrouter.js';
import { runPythonProcess } from '../../../shared/runtime/pythonRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.join(__dirname, '..', '..', '..', '..');
const PROJECT_ROOT = path.join(APP_ROOT, '..', '..');
const PARSER_DIR = path.join(PROJECT_ROOT, 'tools', 'parser');
const PYTHON_SCRIPT_PATH = path.join(PARSER_DIR, 'main.py');
const PARSER_RUNTIME_DIR = path.join(PROJECT_ROOT, 'data', 'runtime', 'parser-jobs');
const PARSER_TIMEOUT_MS = Number(process.env.PARSER_TIMEOUT_MS || 120000);

// Parser writes to a single shared file in `tools/parser/posts.json`.
// To avoid race conditions between concurrent requests, serialize executions in-process.
let parserExecutionQueue = Promise.resolve();

function enqueueParserExecution(jobFn) {
  const jobPromise = parserExecutionQueue.then(jobFn, jobFn);
  // Ensure the queue keeps moving even if the job rejects.
  parserExecutionQueue = jobPromise.then(
    () => undefined,
    () => undefined
  );
  return jobPromise;
}

function ensureParserRuntimeDir() {
  if (!fs.existsSync(PARSER_RUNTIME_DIR)) {
    fs.mkdirSync(PARSER_RUNTIME_DIR, { recursive: true });
  }
}

function detectPlatform(url) {
  if (url.includes('vk.com')) return 'vk';
  if (url.includes('linkedin.com')) return 'linkedin';
  return 'unknown';
}

// Cookie-ы (VK_COOKIE / LINKEDIN_COOKIE) наследуются Python-скриптом через process.env
// (see runPythonProcess env merge). We validate presence before spawning and
// redact values from stdout/stderr so secrets never leak into API responses or logs.
function missingCookieEnvName(url) {
  const platform = detectPlatform(url);
  if (platform === 'vk' && !String(process.env.VK_COOKIE || '').trim()) return 'VK_COOKIE';
  if (platform === 'linkedin' && !String(process.env.LINKEDIN_COOKIE || '').trim()) return 'LINKEDIN_COOKIE';
  return null;
}

function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const name of ['VK_COOKIE', 'LINKEDIN_COOKIE']) {
    const value = String(process.env[name] || '');
    if (value.length > 0) out = out.replaceAll(value, '[REDACTED]');
  }
  return out;
}

function buildCompetitorId(sourceUrl, platform) {
  const normalized = typeof sourceUrl === 'string' ? sourceUrl.trim() : '';
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 12);
  return `parser_${platform || 'unknown'}_${hash}`;
}

function mapPostsToCompetitorsData(url, posts) {
  const firstPost = posts[0];
  const platform = detectPlatform(url);
  const competitorId = buildCompetitorId(url, platform);
  const accountName = firstPost?.account_name || 'Unknown';

  const mapAttachmentsSummary = (attachments) => {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return {
        has_photo: false,
        has_video: false,
        has_link: false,
        has_document: false
      };
    }

    const typesSet = new Set();

    attachments.forEach((att) => {
      const t = att?.type;
      if (typeof t === 'string') {
        typesSet.add(t);
      }
    });

    const types = Array.from(typesSet);

    return {
      has_photo: types.includes('photo'),
      has_video: types.includes('video'),
      has_link: types.includes('link'),
      has_document: types.includes('doc') || types.includes('document')
    };
  };

  return {
    parsing_metadata: {
      source_url: url,
      platform,
      parsed_at: new Date().toISOString(),
      total_posts: posts.length
    },
    competitors: [
      {
        competitor_id: competitorId,
        name: accountName,
        platform,
        follower_count: null,
        posts: posts.map((p) => ({
          // Python-parser отдаёт стабильный `url` поста (для VK это wall-...; для LinkedIn это post url).
          // Используем его дальше, чтобы `publication_id` не сводился к fallback по индексу.
          url: typeof p?.url === 'string' ? p.url : null,
          source_post_id: p?.source_post_id || p?.post_id || null,
          content: p.text || '',
          datetime: p.datetime || null,
          metrics: {
            likes: p.likes ?? 0,
            comments: p.comments ?? 0,
            shares: p.reposts ?? 0,
            views: p.views ?? 0
          },
          attachments: mapAttachmentsSummary(p.attachments)
        }))
      }
    ]
  };
}

async function runPythonParser(url) {
  return enqueueParserExecution(async () => {
    ensureParserRuntimeDir();
    const outputPath = path.join(PARSER_RUNTIME_DIR, `posts-${Date.now()}.json`);
    const result = await runPythonProcess({
      scriptPath: PYTHON_SCRIPT_PATH,
      cwd: PARSER_DIR,
      input: `${url}\n`,
      timeoutMs: PARSER_TIMEOUT_MS,
      description: 'tools/parser/main.py',
      env: {
        PARSER_OUTPUT_PATH: outputPath
      }
    });

    return {
      ...result,
      outputPath
    };
  });
}

function cleanupParserOutput(outputPath) {
  if (!outputPath) return;
  try {
    fs.rmSync(outputPath, { force: true });
  } catch (error) {
    console.warn('Не удалось удалить временный output парсера:', error.message);
  }
}

function applyPostsLimit(allPosts, limit) {
  if (!Array.isArray(allPosts)) return [];
  if (!allPosts.length) return [];
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return allPosts;
  }
  return allPosts.slice(0, limit);
}

export async function parseAndEnrichByUrl(url, limit) {
  const missingCookie = missingCookieEnvName(url);
  if (missingCookie) {
    return {
      success: false,
      pipeline: 'parse_and_enrich',
      error: `Cookie ${missingCookie} не настроен в .env. Парсер не запуска.`,
      missing_cookie_env: missingCookie
    };
  }
  const runResult = await runPythonParser(url);
  runResult.stdout = redactSecrets(runResult.stdout);
  runResult.stderr = redactSecrets(runResult.stderr);

  if (runResult.exitCode !== 0) {
    return {
      success: false,
      pipeline: 'parse_and_enrich',
      error: `Python-скрипт завершился с кодом ${runResult.exitCode}`,
      parser_stdout: runResult.stdout,
      parser_stderr: runResult.stderr
    };
  }

  if (!fs.existsSync(runResult.outputPath)) {
    return {
      success: false,
      pipeline: 'parse_and_enrich',
      error:
        'Python-скрипт завершился без выходного JSON-файла. Проверьте настройки парсера и доступ к VK.',
      parser_stdout: runResult.stdout,
      parser_stderr: runResult.stderr
    };
  }

  try {
    const rawPostsJson = fs.readFileSync(runResult.outputPath, 'utf-8');
    let parsed;
    try {
      parsed = JSON.parse(rawPostsJson);
    } catch (e) {
      return {
        success: false,
        pipeline: 'parse_and_enrich',
        error: `Не удалось распарсить JSON output парсера: ${e.message}`,
        parser_stdout: runResult.stdout,
        parser_stderr: runResult.stderr,
        raw_sample: rawPostsJson.slice(0, 1000)
      };
    }

    const allPosts = Array.isArray(parsed.posts) ? parsed.posts : [];
    if (!allPosts.length) {
      return {
        success: false,
        pipeline: 'parse_and_enrich',
        error:
          'Парсер не вернул ни одного поста (posts пуст). Возможно, требуется авторизация или обновление cookies.',
        parser_stdout: runResult.stdout,
        parser_stderr: runResult.stderr,
        raw_parser_output: parsed
      };
    }

    const posts = applyPostsLimit(allPosts, limit);
    const competitorsData = mapPostsToCompetitorsData(url, posts);
    const enrichmentResult = await enrichCompetitorsData(competitorsData);

    return {
      success: enrichmentResult.enriched_data !== null,
      pipeline: 'parse_and_enrich',
      parser_stdout: runResult.stdout,
      parser_stderr: runResult.stderr,
      raw_parsed_posts: posts,
      ...enrichmentResult
    };
  } finally {
    cleanupParserOutput(runResult.outputPath);
  }
}

export async function parseOnlyByUrl(url, limit) {
  const missingCookie = missingCookieEnvName(url);
  if (missingCookie) {
    return {
      success: false,
      pipeline: 'parse_only',
      error: `Cookie ${missingCookie} не настроен в .env. Парсер не запуска.`,
      missing_cookie_env: missingCookie
    };
  }
  const runResult = await runPythonParser(url);
  runResult.stdout = redactSecrets(runResult.stdout);
  runResult.stderr = redactSecrets(runResult.stderr);

  if (runResult.exitCode !== 0) {
    return {
      success: false,
      pipeline: 'parse_only',
      error: `Python-скрипт завершился с кодом ${runResult.exitCode}`,
      parser_stdout: runResult.stdout,
      parser_stderr: runResult.stderr
    };
  }

  if (!fs.existsSync(runResult.outputPath)) {
    return {
      success: false,
      pipeline: 'parse_only',
      error:
        'Python-скрипт завершился без выходного JSON-файла. Проверьте настройки парсера и доступ к VK.',
      parser_stdout: runResult.stdout,
      parser_stderr: runResult.stderr
    };
  }

  try {
    const rawPostsJson = fs.readFileSync(runResult.outputPath, 'utf-8');
    let parsed;
    try {
      parsed = JSON.parse(rawPostsJson);
    } catch (e) {
      return {
        success: false,
        pipeline: 'parse_only',
        error: `Не удалось распарсить JSON output парсера: ${e.message}`,
        parser_stdout: runResult.stdout,
        parser_stderr: runResult.stderr,
        raw_sample: rawPostsJson.slice(0, 1000)
      };
    }

    const allPosts = Array.isArray(parsed.posts) ? parsed.posts : [];
    if (!allPosts.length) {
      return {
        success: false,
        pipeline: 'parse_only',
        error:
          'Парсер не вернул ни одного поста (posts пуст). Возможно, требуется авторизация или обновление cookies.',
        parser_stdout: runResult.stdout,
        parser_stderr: runResult.stderr,
        raw_parser_output: parsed
      };
    }

    const posts = applyPostsLimit(allPosts, limit);
    const competitorsData = mapPostsToCompetitorsData(url, posts);

    return {
      success: true,
      pipeline: 'parse_only',
      competitors_data: competitorsData,
      parser_stdout: runResult.stdout,
      parser_stderr: runResult.stderr,
      raw_parsed_posts: posts
    };
  } finally {
    cleanupParserOutput(runResult.outputPath);
  }
}
