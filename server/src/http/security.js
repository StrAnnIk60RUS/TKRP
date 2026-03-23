import crypto from 'crypto';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3001',
  'http://127.0.0.1:3001'
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
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('192.168.') ||
    normalized.startsWith('10.') ||
    normalized.startsWith('172.16.') ||
    normalized.startsWith('172.17.') ||
    normalized.startsWith('172.18.') ||
    normalized.startsWith('172.19.') ||
    normalized.startsWith('172.2')
  );
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return normalizeIp(forwarded.split(',')[0]);
  }
  return normalizeIp(req.ip || req.socket?.remoteAddress || '');
}

function getRequestKey(req) {
  const clientIp = getClientIp(req) || 'unknown-ip';
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
  return provided.length > 0 && provided === expectedKey;
}

export function attachRequestContext(req, res, next) {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  req.clientIp = getClientIp(req);
  res.setHeader('x-request-id', requestId);
  next();
}

export function createCorsOptions() {
  const configuredOrigins = parseCsv(process.env.CORS_ALLOWED_ORIGINS);
  const allowlist = new Set(configuredOrigins.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS);

  return {
    origin(origin, callback) {
      if (!origin || allowlist.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Server-API-Key'],
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
  if (isLocalIp(req.clientIp) || hasMatchingApiKey(req, adminApiKey)) {
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error: 'Admin API key required for this endpoint.',
    request_id: req.requestId
  });
}
