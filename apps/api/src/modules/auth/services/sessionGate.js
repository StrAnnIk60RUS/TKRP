/**
 * Middleware: authenticated session or admin API key; anonymous access is rejected.
 */
import { resolveSession } from './authStore.js';

function readBearerToken(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function matchesAdminApiKey(req) {
  const adminApiKey = process.env.ADMIN_API_KEY || process.env.SERVER_API_KEY;
  if (!adminApiKey) return false;
  const bearer = readBearerToken(req);
  const provided = bearer || String(req.headers['x-server-api-key'] || '').trim();
  return provided.length > 0 && provided === adminApiKey;
}

export async function requireSessionOrAdminApiKey(req, res, next) {
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
}
