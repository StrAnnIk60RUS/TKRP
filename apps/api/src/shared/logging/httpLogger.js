import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { requestContext } from './requestContext.js';
import { logger } from './logger.js';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_\-]{8,64}$/;

function resolveTraceId(req) {
  const incoming = req.headers['x-trace-id'] || req.headers['x-request-id'];
  if (typeof incoming === 'string' && SAFE_ID_PATTERN.test(incoming.trim())) {
    return incoming.trim();
  }
  return crypto.randomUUID();
}

/**
 * Middleware сквозной трассировки и логирования входящих HTTP-запросов.
 * Интегрирует AsyncLocalStorage для автоматического контекста во всех асинхронных вызовах.
 */
export function httpContextAndAccessLogger(req, res, next) {
  const traceId = resolveTraceId(req);
  req.traceId = traceId;
  req.requestId = traceId;

  res.setHeader('x-trace-id', traceId);
  res.setHeader('x-request-id', traceId);

  const startTime = performance.now();
  const context = {
    traceId,
    requestId: traceId,
    clientIp: req.clientIp || req.ip || '',
    path: req.path,
    method: req.method
  };

  res.on('finish', () => {
    const durationMs = Math.round(performance.now() - startTime);
    const statusCode = res.statusCode;
    const isHealthCheck = req.path === '/health';

    const logMeta = {
      method: req.method,
      path: req.originalUrl || req.path,
      status: statusCode,
      duration_ms: durationMs,
      content_length: res.getHeader('content-length') || null,
      user_agent: req.headers['user-agent'] || null
    };

    if (statusCode >= 500) {
      logger.error(`HTTP ${req.method} ${req.path} -> ${statusCode} (${durationMs}ms)`, logMeta);
    } else if (statusCode >= 400) {
      logger.warn(`HTTP ${req.method} ${req.path} -> ${statusCode} (${durationMs}ms)`, logMeta);
    } else if (isHealthCheck) {
      logger.debug(`HTTP ${req.method} ${req.path} -> ${statusCode} (${durationMs}ms)`, logMeta);
    } else {
      logger.info(`HTTP ${req.method} ${req.path} -> ${statusCode} (${durationMs}ms)`, logMeta);
    }
  });

  requestContext.run(context, () => {
    next();
  });
}
