/**
 * Middleware: authenticated session or admin API key; anonymous access is rejected.
 */
import crypto from 'crypto';
import { resolveSession } from './authStore.js';

function readBearerToken(req) {
  const header = req.headers?.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  if (typeof req.query?.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return null;
}

function matchesAdminApiKey(req) {
  const adminApiKey = process.env.ADMIN_API_KEY || process.env.SERVER_API_KEY;
  if (!adminApiKey) return false;
  const bearer = readBearerToken(req);
  const provided = bearer || String(req.headers['x-server-api-key'] || req.query?.apiKey || '').trim();
  if (!adminApiKey || typeof adminApiKey !== 'string') return false;
  if (!provided || typeof provided !== 'string') return false;
  const expectedBuf = Buffer.from(adminApiKey);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export async function requireSessionOrAdminApiKey(req, res, next) {
  try {
    if (matchesAdminApiKey(req)) {
      next();
      return;
    }

    const token = readBearerToken(req);
    if (token && await resolveSession(token)) {
      next();
      return;
    }

    res.status(401).json({
      success: false,
      error: 'Authentication required. Please log in or register.',
      request_id: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
