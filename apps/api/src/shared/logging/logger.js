import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTraceContext } from './requestContext.js';
import { redactSensitiveData } from './redaction.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findProjectRoot(startDir) {
  let curr = startDir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(curr, 'package.json')) && fs.existsSync(path.join(curr, 'apps'))) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve(startDir, '../../../../..');
}

const PROJECT_ROOT = findProjectRoot(__dirname);
const LOGS_DIR = path.resolve(PROJECT_ROOT, 'data', 'runtime', 'logs');

export const LOG_LEVELS = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50
};

const LEVEL_NAMES = {
  10: 'DEBUG',
  20: 'INFO',
  30: 'WARN',
  40: 'ERROR',
  50: 'FATAL'
};

const COLOR_CODES = {
  DEBUG: '\x1b[36m', // Cyan
  INFO: '\x1b[32m',  // Green
  WARN: '\x1b[33m',  // Yellow
  ERROR: '\x1b[31m', // Red
  FATAL: '\x1b[35m', // Magenta
  RESET: '\x1b[0m',
  DIM: '\x1b[2m'
};

function parseLogLevel(val) {
  const normalized = String(val || '').toUpperCase().trim();
  return LOG_LEVELS[normalized] || null;
}

function getDefaultLevel() {
  const envLevel = parseLogLevel(process.env.LOG_LEVEL);
  if (envLevel) return envLevel;
  return process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;
}

// Кольцевой буфер недавних ошибок в памяти (для быстрой диагностики и API)
const MAX_RECENT_ERRORS = 50;
const recentErrors = [];

export function getRecentErrors(limit = 50) {
  const sliceSize = Math.min(Math.max(1, Number(limit) || 50), MAX_RECENT_ERRORS);
  return recentErrors.slice(-sliceSize).reverse();
}

export function clearRecentErrors() {
  recentErrors.length = 0;
}

// Файловый логгер с базовой ротацией по размеру (10 MB)
const MAX_LOG_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
let logsDirInitialized = false;

function ensureLogsDir() {
  if (logsDirInitialized) return;
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    logsDirInitialized = true;
  } catch (err) {
    // Не крашим приложение, если нет доступа к диску
  }
}

function rotateFileIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size >= MAX_LOG_FILE_SIZE_BYTES) {
      const backupPath = `${filePath}.1`;
      try {
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
      } catch {}
      fs.renameSync(filePath, backupPath);
    }
  } catch {}
}

function appendToLogFile(filename, line) {
  if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_TEST_LOG_FILES) {
    return;
  }
  ensureLogsDir();
  try {
    const filePath = path.join(LOGS_DIR, filename);
    rotateFileIfNeeded(filePath);
    fs.appendFileSync(filePath, line + '\n', 'utf8');
  } catch {
    // Игнорируем сбои дисковой записи, чтобы не ронять основной процесс
  }
}

class StructuredLogger {
  constructor(bindings = {}, minLevel = null) {
    this.bindings = bindings;
    this.minLevel = minLevel ?? getDefaultLevel();
  }

  child(additionalBindings = {}) {
    return new StructuredLogger(
      { ...this.bindings, ...additionalBindings },
      this.minLevel
    );
  }

  setLevel(level) {
    const parsed = typeof level === 'number' ? level : parseLogLevel(level);
    if (parsed) {
      this.minLevel = parsed;
    }
  }

  _formatDevMessage(record) {
    const color = COLOR_CODES[record.level] || '';
    const reset = COLOR_CODES.RESET;
    const dim = COLOR_CODES.DIM;

    const time = record.timestamp.split('T')[1].replace('Z', '');
    const lvl = `${color}${record.level.padEnd(5)}${reset}`;
    const mod = record.module ? `${dim}[${record.module}]${reset} ` : '';
    const trace = record.trace_id ? `${dim}(tr:${record.trace_id})${reset} ` : '';
    const msg = record.message;

    const extra = { ...record };
    delete extra.timestamp;
    delete extra.level;
    delete extra.level_num;
    delete extra.module;
    delete extra.trace_id;
    delete extra.message;
    delete extra.error;

    const extraStr = Object.keys(extra).length > 0 ? ` ${dim}${JSON.stringify(extra)}${reset}` : '';
    let out = `${dim}${time}${reset} ${lvl} ${mod}${trace}${msg}${extraStr}`;

    if (record.error) {
      out += `\n${color}${record.error.stack || record.error.message || record.error}${reset}`;
      if (record.error.details) {
        out += `\n${dim}Details: ${JSON.stringify(record.error.details, null, 2)}${reset}`;
      }
    }

    return out;
  }

  _log(levelNum, message, meta = {}) {
    if (levelNum < this.minLevel) {
      return;
    }

    const levelName = LEVEL_NAMES[levelNum] || 'INFO';
    const traceContext = getTraceContext();

    let errObj = null;
    let extraMeta = {};

    if (meta instanceof Error) {
      errObj = meta;
    } else if (meta && typeof meta === 'object') {
      if (meta.error instanceof Error) {
        errObj = meta.error;
        extraMeta = { ...meta };
        delete extraMeta.error;
      } else if (meta.err instanceof Error) {
        errObj = meta.err;
        extraMeta = { ...meta };
        delete extraMeta.err;
      } else {
        extraMeta = { ...meta };
      }
    }

    const record = {
      timestamp: new Date().toISOString(),
      level: levelName,
      level_num: levelNum,
      trace_id: traceContext.traceId || traceContext.requestId || this.bindings.trace_id || null,
      module: this.bindings.module || extraMeta.module || null,
      message: typeof message === 'string' ? message : String(message),
      ...this.bindings,
      ...extraMeta
    };

    if (traceContext.clientIp && !record.client_ip) {
      record.client_ip = traceContext.clientIp;
    }
    if (traceContext.userId && !record.user_id) {
      record.user_id = traceContext.userId;
    }
    if (traceContext.path && !record.path) {
      record.path = traceContext.path;
    }

    if (errObj) {
      record.error = {
        name: errObj.name,
        message: errObj.message,
        stack: errObj.stack,
        code: errObj.code,
        details: errObj.details || undefined
      };
    }

    const sanitizedRecord = redactSensitiveData(record);

    // Добавляем в буфер недавних ошибок
    if (levelNum >= LOG_LEVELS.WARN) {
      recentErrors.push(sanitizedRecord);
      if (recentErrors.length > MAX_RECENT_ERRORS) {
        recentErrors.shift();
      }
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const ndjson = JSON.stringify(sanitizedRecord);

    // Вывод в консоль: в dev — форматированный читаемый текст, в prod — NDJSON
    if (isProduction) {
      if (levelNum >= LOG_LEVELS.ERROR) {
        console.error(ndjson);
      } else if (levelNum >= LOG_LEVELS.WARN) {
        console.warn(ndjson);
      } else {
        console.log(ndjson);
      }
    } else {
      const devFormatted = this._formatDevMessage(sanitizedRecord);
      if (levelNum >= LOG_LEVELS.ERROR) {
        console.error(devFormatted);
      } else if (levelNum >= LOG_LEVELS.WARN) {
        console.warn(devFormatted);
      } else {
        console.log(devFormatted);
      }
    }

    // Сохранение в файлы логов
    appendToLogFile('app.log', ndjson);
    if (levelNum >= LOG_LEVELS.WARN) {
      appendToLogFile('error.log', ndjson);
    }
  }

  debug(message, meta) {
    this._log(LOG_LEVELS.DEBUG, message, meta);
  }

  info(message, meta) {
    this._log(LOG_LEVELS.INFO, message, meta);
  }

  warn(message, meta) {
    this._log(LOG_LEVELS.WARN, message, meta);
  }

  error(message, meta) {
    this._log(LOG_LEVELS.ERROR, message, meta);
  }

  fatal(message, meta) {
    this._log(LOG_LEVELS.FATAL, message, meta);
  }
}

export const logger = new StructuredLogger();
export function createLogger(bindings = {}, minLevel = null) {
  return new StructuredLogger(bindings, minLevel);
}
