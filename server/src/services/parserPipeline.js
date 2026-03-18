import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { enrichCompetitorsData } from '../../openrouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const PARSER_DIR = path.join(PROJECT_ROOT, 'parser');
const PYTHON_SCRIPT_PATH = path.join(PARSER_DIR, 'main.py');
const PARSER_OUTPUT_PATH = path.join(PARSER_DIR, 'posts.json');

// Parser writes to a single shared file: `parser/posts.json`.
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

function detectPlatform(url) {
  if (url.includes('vk.com')) return 'vk';
  if (url.includes('linkedin.com')) return 'linkedin';
  return 'unknown';
}

function mapPostsToCompetitorsData(url, posts) {
  const firstPost = posts[0];
  const platform = detectPlatform(url);

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
        competitor_id: 'parser_1',
        name: firstPost.account_name || 'Unknown',
        platform,
        follower_count: null,
        posts: posts.map((p, index) => ({
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
    try {
      if (fs.existsSync(PARSER_OUTPUT_PATH)) {
        fs.unlinkSync(PARSER_OUTPUT_PATH);
      }
    } catch (e) {
      console.warn('Не удалось удалить старый posts.json:', e.message);
    }

    const pythonProcess = spawn('python', ['-u', PYTHON_SCRIPT_PATH], {
      cwd: PARSER_DIR,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(`[PYTHON STDOUT] ${text}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(`[PYTHON STDERR] ${text}`);
    });

    pythonProcess.stdin.write(url + '\n');
    pythonProcess.stdin.end();

    const exitCode = await new Promise((resolve) => {
      pythonProcess.on('close', resolve);
    });

    return { exitCode, stdout, stderr };
  });
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
  const runResult = await runPythonParser(url);

  if (runResult.exitCode !== 0) {
    return {
      success: false,
      pipeline: 'parse_and_enrich',
      error: `Python-скрипт завершился с кодом ${runResult.exitCode}`,
      parser_stdout: runResult.stdout,
      parser_stderr: runResult.stderr
    };
  }

  if (!fs.existsSync(PARSER_OUTPUT_PATH)) {
    return {
      success: false,
      pipeline: 'parse_and_enrich',
      error:
        'Python-скрипт завершился без файла posts.json (парсер не сохранил результат). Проверьте настройки парсера и доступ к VK.',
      parser_stdout: runResult.stdout,
      parser_stderr: runResult.stderr
    };
  }

  const rawPostsJson = fs.readFileSync(PARSER_OUTPUT_PATH, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(rawPostsJson);
  } catch (e) {
    return {
      success: false,
      pipeline: 'parse_and_enrich',
      error: `Не удалось распарсить posts.json: ${e.message}`,
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
}

export async function parseOnlyByUrl(url, limit) {
  const runResult = await runPythonParser(url);

  if (runResult.exitCode !== 0) {
    return {
      success: false,
      pipeline: 'parse_only',
      error: `Python-скрипт завершился с кодом ${runResult.exitCode}`,
      parser_stdout: runResult.stdout,
      parser_stderr: runResult.stderr
    };
  }

  if (!fs.existsSync(PARSER_OUTPUT_PATH)) {
    return {
      success: false,
      pipeline: 'parse_only',
      error:
        'Python-скрипт завершился без файла posts.json (парсер не сохранил результат). Проверьте настройки парсера и доступ к VK.',
      parser_stdout: runResult.stdout,
      parser_stderr: runResult.stderr
    };
  }

  const rawPostsJson = fs.readFileSync(PARSER_OUTPUT_PATH, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(rawPostsJson);
  } catch (e) {
    return {
      success: false,
      pipeline: 'parse_only',
      error: `Не удалось распарсить posts.json: ${e.message}`,
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
}
