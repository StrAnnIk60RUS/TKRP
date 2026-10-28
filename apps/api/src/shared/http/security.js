import crypto from 'crypto';
import { runWithContext } from '../logging/requestContext.js';
import { logger } from '../logging/logger.js';
import { recordHttpRequest } from '../logging/metrics.js';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3001',
  'http://127.0.0.1:3001'
];

const DEFAULT_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Server-API-Key',
  'X-Trace-Id',
  'x-trace-id',
  'X-Request-Id',
  'x-request-id'
];

const DEFAULT_EXPOSED_HEADERS = [
  'X-Trace-Id',
  'x-trace-id',
  'X-Request-Id',
  'x-request-id'
];

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIp(rawIp) {
  if (!rawIp) return '';
  const ip = String(rawIp).trim();
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

function isLocalIp(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('192.168.') ||
    normalized.startsWith('10.')
  ) {
    return true;
  }
  if (normalized.startsWith('172.')) {
    const parts = normalized.split('.');
    if (parts.length === 4) {
      const secondOctet = parseInt(parts[1], 10);
      return Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
    }
  }
  return false;
}

function getClientIp(req) {
  const trustProxy = String(process.env.TRUST_PROXY || '').toLowerCase() === 'true';
  if (trustProxy) {
    const realIp = req.headers?.['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) {
      return normalizeIp(realIp.trim());
    }
    const forwarded = req.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return normalizeIp(forwarded.split(',')[0]);
    }
  }
  return normalizeIp(req.socket?.remoteAddress || req.ip || '');
}

function getRequestKey(req) {
  const clientIp = req.clientIp || getClientIp(req) || 'unknown-ip';
  return `${clientIp}:${req.path}`;
}

function readApiKey(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return String(req.headers['x-server-api-key'] || '').trim();
}

function hasMatchingApiKey(req, expectedKey) {
  if (!expectedKey) return false;
  const provided = readApiKey(req);
  if (!provided || typeof provided !== 'string') return false;
  const expectedBuf = Buffer.from(String(expectedKey));
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function attachRequestContext(req, res, next) {
  const incomingTrace = req?.headers?.['x-trace-id'] || req?.headers?.['x-request-id'];
  const requestId =
    typeof incomingTrace === 'string' && /^[a-zA-Z0-9_\-]{8,64}$/.test(incomingTrace.trim())
      ? incomingTrace.trim()
      : crypto.randomUUID();

  req.requestId = requestId;
  req.traceId = requestId;
  req.clientIp = getClientIp(req);

  if (typeof res?.setHeader === 'function') {
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-trace-id', requestId);
  }

  const startTime = Date.now();
  if (typeof res?.on === 'function') {
    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const statusCode = res.statusCode || 200;
      const pathStr = req?.originalUrl || req?.path || '';
      const isHealthCheck = pathStr === '/health';

      const logMeta = {
        method: req?.method,
        path: pathStr,
        status: statusCode,
        duration_ms: durationMs,
        client_ip: req?.clientIp
      };

      try {
        recordHttpRequest(req?.method, pathStr, statusCode, durationMs / 1000);
      } catch {}

      if (statusCode >= 500) {
        logger.error(`HTTP ${req?.method} ${pathStr} -> ${statusCode} (${durationMs}ms)`, logMeta);
      } else if (statusCode >= 400) {
        logger.warn(`HTTP ${req?.method} ${pathStr} -> ${statusCode} (${durationMs}ms)`, logMeta);
      } else if (isHealthCheck) {
        logger.debug(`HTTP ${req?.method} ${pathStr} -> ${statusCode} (${durationMs}ms)`, logMeta);
      } else {
        logger.info(`HTTP ${req?.method} ${pathStr} -> ${statusCode} (${durationMs}ms)`, logMeta);
      }
    });
  }

  const context = {
    traceId: requestId,
    requestId,
    clientIp: req.clientIp,
    path: req?.path,
    method: req?.method
  };

  runWithContext(context, () => {
    next();
  });
}

const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function createCorsOptions() {
  const configuredOrigins = parseCsv(process.env.CORS_ALLOWED_ORIGINS);
  const allowlist = new Set(configuredOrigins.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS);
  const configuredHeaders = parseCsv(process.env.CORS_ALLOWED_HEADERS);
  const allowedHeaders = Array.from(new Set([...DEFAULT_ALLOWED_HEADERS, ...configuredHeaders]));

  return {
    origin(origin, callback) {
      if (!origin || allowlist.has(origin) || LOCALHOST_ORIGIN_PATTERN.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders,
    exposedHeaders: DEFAULT_EXPOSED_HEADERS,
    maxAge: 600
  };
}

export function createRateLimitMiddleware(options = {}) {
  const windowMs = Number(options.windowMs || process.env.RATE_LIMIT_WINDOW_MS || 60000);
  const maxRequests = Number(options.maxRequests || process.env.RATE_LIMIT_MAX_REQUESTS || 60);
  const buckets = new Map();

  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    if (isLocalIp(req.clientIp)) {
      next();
      return;
    }

    const now = Date.now();
    const key = getRequestKey(req);
    if (buckets.size > 500) {
      for (const [k, b] of buckets.entries()) {
        if (now - b.startedAt >= windowMs) buckets.delete(k);
      }
    }
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > maxRequests) {
      res.status(429).json({
        success: false,
        error: 'Too many requests. Retry later.',
        request_id: req.requestId
      });
      return;
    }

    next();
  };
}

export function requireLocalOrApiKey(req, res, next) {
  const apiKey = process.env.SERVER_API_KEY;
  if (isLocalIp(req.clientIp) || hasMatchingApiKey(req, apiKey)) {
    next();
    return;
  }

  res.status(401).json({
    success: false,
    error: 'API key required for this endpoint.',
    request_id: req.requestId
  });
}

export function requireLocalOrAdminApiKey(req, res, next) {
  const adminApiKey = process.env.ADMIN_API_KEY || process.env.SERVER_API_KEY;
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    if (adminApiKey && hasMatchingApiKey(req, adminApiKey)) {
      next();
      return;
    }
  } else if (isLocalIp(req.clientIp) || hasMatchingApiKey(req, adminApiKey)) {
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error: 'Admin API key required for this endpoint.',
    request_id: req.requestId
  });
}

export function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production' || req.secure || req.headers?.['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export function createAuthRateLimitMiddleware(options = {}) {
  const windowMs = Number(options.windowMs || process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60000);
  const maxRequests = Number(options.maxRequests || process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || 30);
  const buckets = new Map();

  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    const now = Date.now();
    const key = `${req.clientIp || getClientIp(req) || 'unknown-ip'}:auth`;
    if (buckets.size > 500) {
      for (const [k, b] of buckets.entries()) {
        if (now - b.startedAt >= windowMs) buckets.delete(k);
      }
    }
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > maxRequests) {
      res.status(429).json({
        success: false,
        error: 'Too many authentication attempts. Retry later.',
        request_id: req.requestId
      });
      return;
    }

    next();
  };
}
