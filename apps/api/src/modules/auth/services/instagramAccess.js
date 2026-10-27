/**
 * Instagram parsing and generation are limited to one preview account.
 * The password is never stored here: login still goes through the normal session.
 */
import { getCurrentUser } from './authStore.js';

export const INSTAGRAM_PREVIEW_USERNAME = 'admin123';

const INSTAGRAM_HOSTS = new Set(['instagram.com', 'instagr.am']);

export function canUseInstagram(user) {
  return user?.username === INSTAGRAM_PREVIEW_USERNAME;
}

export function isInstagramUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || /[\r\n]/.test(raw)) return false;
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, '');
    return INSTAGRAM_HOSTS.has(host) || host.endsWith('.instagram.com') || host.endsWith('.instagr.am');
  } catch {
    return false;
  }
}

function hasInstagramPlatformValue(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'instagram';
}

function listHasInstagramPlatform(list) {
  return Array.isArray(list) && list.some((item) => hasInstagramPlatformValue(item));
}

function nodeUsesInstagram(node, depth) {
  if (depth > 8) return true;
  if (node == null) return false;
  if (typeof node === 'string') return hasInstagramPlatformValue(node) || isInstagramUrl(node);
  if (Array.isArray(node)) return node.some((item) => nodeUsesInstagram(item, depth + 1));
  if (typeof node !== 'object') return false;
  if (hasInstagramPlatformValue(node.platform) || listHasInstagramPlatform(node.platforms)) return true;
  if (isInstagramUrl(node.url) || isInstagramUrl(node.source_url)) return true;
  for (const val of Object.values(node)) {
    if (val != null && nodeUsesInstagram(val, depth + 1)) return true;
  }
  return false;
}

export function requestUsesInstagram(body) {
  if (!body || typeof body !== 'object') return false;
  if (isInstagramUrl(body.url)) return true;
  return nodeUsesInstagram(body, 0);
}

function readBearerToken(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function getRequestUser(req) {
  const token = readBearerToken(req);
  if (!token) return null;
  return getCurrentUser(token);
}

export function instagramFeatures(user) {
  return { instagram: canUseInstagram(user) };
}

export async function rejectInstagramIfForbidden(req, res, next) {
  try {
    if (!requestUsesInstagram(req.body)) {
      next();
      return;
    }
    const user = await getRequestUser(req);
    if (canUseInstagram(user)) {
      next();
      return;
    }
    res.status(403).json({
      success: false,
      error: 'Платформа Instagram доступна только для учётной записи admin123',
      request_id: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
