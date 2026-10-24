import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { computePostEngagementMetrics, enrichCompetitorsData } from '../../../../openrouter.js';
import { runPythonProcess } from '../../../shared/runtime/pythonRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.join(__dirname, '..', '..', '..', '..');
const PROJECT_ROOT = path.join(APP_ROOT, '..', '..');
const PARSER_DIR = path.join(PROJECT_ROOT, 'tools', 'parser');
const PYTHON_SCRIPT_PATH = path.join(PARSER_DIR, 'main.py');
const PARSER_RUNTIME_DIR = path.join(PROJECT_ROOT, 'data', 'runtime', 'parser-jobs');
const PARSER_TIMEOUT_MS = Number(process.env.PARSER_TIMEOUT_MS || 120000);

// Each job writes its own PARSER_OUTPUT_PATH, so parses can overlap.
// The cap only limits how many Python processes run at once.
const PARSER_MAX_CONCURRENCY = 2;
let activeParserJobs = 0;
const parserWaiters = [];

function enqueueParserExecution(jobFn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeParserJobs += 1;
      Promise.resolve()
        .then(jobFn)
        .then(resolve, reject)
        .finally(() => {
          activeParserJobs -= 1;
          const next = parserWaiters.shift();
          if (next) next();
        });
    };
    if (activeParserJobs < PARSER_MAX_CONCURRENCY) run();
    else parserWaiters.push(run);
  });
}

function ensureParserRuntimeDir() {
  if (!fs.existsSync(PARSER_RUNTIME_DIR)) {
    fs.mkdirSync(PARSER_RUNTIME_DIR, { recursive: true });
  }
}

function detectPlatform(url) {
  const value = String(url || '').toLowerCase();
  if (value.includes('vk.com')) return 'vk';
  if (value.includes('linkedin.com')) return 'linkedin';
  if (value.includes('instagram.com') || value.includes('instagr.am')) return 'instagram';
  return 'unknown';
}

// Cookie-ы (VK_COOKIE / LINKEDIN_COOKIE) наследуются Python-скриптом через process.env
// (see runPythonProcess env merge). We validate presence before spawning and
// redact values from stdout/stderr so secrets never leak into API responses or logs.
function missingCookieEnvName(url) {
  const platform = detectPlatform(url);
  if (platform === 'vk' && !String(process.env.VK_API_TOKEN || '').trim()) return 'VK_API_TOKEN';
  if (platform === 'linkedin' && !String(process.env.LINKEDIN_COOKIE || '').trim()) return 'LINKEDIN_COOKIE';
  if (platform === 'instagram' && !String(process.env.INSTAGRAM_COOKIE || '').trim() && !String(process.env.APIFY_API_TOKEN || '').trim()) return 'INSTAGRAM_COOKIE or APIFY_API_TOKEN';
  return null;
}

function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const name of [
    'VK_COOKIE',
    'LINKEDIN_COOKIE',
    'INSTAGRAM_COOKIE',
    'VK_API_TOKEN',
    'APIFY_API_TOKEN',
    'OPENROUTER_API_KEY',
    'SERVER_API_KEY',
    'ADMIN_API_KEY'
  ]) {
    const value = String(process.env[name] || '');
    if (value.length > 0) out = out.replaceAll(value, '[REDACTED]');
  }
  out = out.replace(/(access_token|token|api_key|key)=([^&\s"']+)/gi, '$1=[REDACTED]');
  return out;
}

function buildCompetitorId(sourceUrl, platform) {
  const normalized = typeof sourceUrl === 'string' ? sourceUrl.trim() : '';
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 12);
  return `parser_${platform || 'unknown'}_${hash}`;
}

function interactionScore(post) {
  const likes = Number(post?.likes ?? post?.metrics?.likes) || 0;
  const comments = Number(post?.comments ?? post?.metrics?.comments) || 0;
  const shares = Number(post?.reposts ?? post?.shares ?? post?.metrics?.shares) || 0;
  return likes + comments * 1.5 + shares;
}

export function rankParsedPosts(posts = []) {
  if (!Array.isArray(posts) || posts.length <= 1) return Array.isArray(posts) ? posts.slice() : [];
  const stamps = posts.map((post) => {
    const parsed = Date.parse(post?.datetime || '');
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const interactions = posts.map((post) => interactionScore(post));
  const minStamp = Math.min(...stamps);
  const maxStamp = Math.max(...stamps);
  const span = Math.max(1, maxStamp - minStamp);
  const maxInteractions = Math.max(1, ...interactions);
  return posts
    .map((post, index) => ({
      post,
      score:
        ((stamps[index] - minStamp) / span) * 0.45 +
        (Math.log1p(interactions[index]) / Math.log1p(maxInteractions)) * 0.55
    }))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.post);
}

function mapPostsToCompetitorsData(url, posts) {
  const firstPost = posts[0];
  const platform = detectPlatform(url);
  const competitorId = buildCompetitorId(url, platform);
  const accountName = firstPost?.account_name || 'Unknown';
  const followerCount = posts
    .map((post) => Number(post?.follower_count))
    .find((value) => Number.isFinite(value) && value >= 0);

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
        follower_count: followerCount ?? null,
        posts: posts.map((p) => {
          const metrics = {
            likes: p.likes ?? 0,
            comments: p.comments ?? 0,
            shares: p.reposts ?? 0,
            views: p.views ?? 0
          };
          const measured = computePostEngagementMetrics(metrics);
          return {
            // Python-parser отдаёт стабильный `url` поста (для VK это wall-...; для LinkedIn это post url).
            // Используем его дальше, чтобы `publication_id` не сводился к fallback по индексу.
            url: typeof p?.url === 'string' ? p.url : null,
            source_post_id: p?.source_post_id || p?.post_id || null,
            content: p.text || '',
            datetime: p.datetime || null,
            metrics,
            engagement_rate: measured.metrics_quality === 'unknown' ? null : measured.rate,
            metrics_quality: measured.metrics_quality,
            attachments: mapAttachmentsSummary(p.attachments)
          };
        })
      }
    ]
  };
}

let parserJobSeq = 0;

async function runPythonParser(url) {
  return enqueueParserExecution(async () => {
    ensureParserRuntimeDir();
    parserJobSeq += 1;
    const uniqueSuffix = `${Date.now()}-${parserJobSeq}-${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = path.join(PARSER_RUNTIME_DIR, `posts-${uniqueSuffix}.json`);
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
  const ranked = rankParsedPosts(allPosts);
  if (!ranked.length) return [];
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return ranked;
  }
  return ranked.slice(0, limit);
}

export async function parseAndEnrichByUrl(url, limit) {
  const missingCookie = missingCookieEnvName(url);
  if (missingCookie) {
    return {
      success: false,
      pipeline: 'parse_and_enrich',
      error: `${missingCookie} не настроен в .env. Парсер не запуска.`,
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
      error: `${missingCookie} не настроен в .env. Парсер не запуска.`,
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
