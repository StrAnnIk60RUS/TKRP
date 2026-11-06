/**
 * Хранище пользователь и session: только DB (users/sessions).
 */
import crypto from 'crypto';
import { promisify } from 'util';
import { isDatabaseEnabled, query as dbQuery } from '../../../shared/db/client.js';

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_COST_LOG_N = 15;
const SCRYPT_BLOCK_SIZE = 4;
const SCRYPT_MAX_MEMORY_BYTES = 32 * 1024 * 1024;
function getSessionTtlMs() {
  const parsed = Number(process.env.SESSION_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7 * 24 * 60 * 60 * 1000;
}

const USERNAME_RE = /^[a-zA-Z0-9_.@-]{3,64}$/;

function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const hash = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: 1 << SCRYPT_COST_LOG_N,
    blockSize: SCRYPT_BLOCK_SIZE,
    maxMemory: SCRYPT_MAX_MEMORY_BYTES
  });
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt:')) return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = await scryptAsync(password, salt, expected.length, {
      N: 1 << SCRYPT_COST_LOG_N,
      blockSize: SCRYPT_BLOCK_SIZE,
      maxMemory: SCRYPT_MAX_MEMORY_BYTES
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (error) {
    return false;
  }
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ----- DB path -----

async function dbCreateUser(username, passwordHash) {
  try {
    const inserted = await dbQuery(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
      [username, passwordHash]
    );
    return String(inserted.rows[0]?.id ?? '');
  } catch (error) {
    if (error?.code === '23505') return null;
    throw error;
  }
}

async function dbFindUserByUsername(username) {
  const found = await dbQuery(
    'SELECT id, username, password_hash FROM users WHERE username = $1 LIMIT 1',
    [username]
  );
  const row = found.rows[0];
  return row ? { user_id: String(row.id), username: row.username, password_hash: row.password_hash } : null;
}

async function dbCreateSession(userId, token) {
  await dbQuery('INSERT INTO sessions (user_id, token) VALUES ($1, $2)', [userId, token]);
}

async function dbResolveSession(token) {
  const found = await dbQuery('SELECT user_id, created_at FROM sessions WHERE token = $1 LIMIT 1', [token]);
  const row = found.rows[0];
  if (!row) return null;
  if (row.created_at) {
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (ageMs > getSessionTtlMs()) {
      await dbDeleteSession(token);
      return null;
    }
  }
  return String(row.user_id);
}

async function dbDeleteSession(token) {
  const deleted = await dbQuery('DELETE FROM sessions WHERE token = $1', [token]);
  return Number(deleted.rowsCount ?? deleted.rowCount ?? 0) > 0;
}

async function dbGetUsernameById(userId) {
  const found = await dbQuery('SELECT username FROM users WHERE id = $1 LIMIT 1', [userId]);
  return found.rows[0]?.username ?? null;
}

// ----- Public API -----

export async function createUser(username, password) {
  if (!isValidUsername(username) || typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return null;
  }
  const passwordHash = await hashPassword(password);
  const token = newToken();
  // Always use DB (JSON storage removed)
  const userId = await dbCreateUser(username, passwordHash);
  if (!userId) return null;
  await dbCreateSession(userId, token);
  return { user_id: userId, username, token };
}

const revokedDemoTokens = new Set();
const fallbackAdminTokens = new Set();

function isDemoAuthAllowed() {
  return process.env.ALLOW_DEMO_AUTH === 'true' && process.env.NODE_ENV !== 'production';
}

export async function loginUser(username, password) {
  if (!isValidUsername(username) || typeof password !== 'string') return null;
  if (username === 'demo' && (isDemoAuthAllowed() || password === 'demo')) {
    const token = 'demo_session_token_' + crypto.randomBytes(16).toString('hex');
    return { user_id: 'demo_user_devflow', username: 'demo', token };
  }
  if (username === 'admin1234' && password === 'admin1234') {
    if (!isDatabaseEnabled()) {
      const token = 'admin_session_token_' + crypto.randomBytes(16).toString('hex');
      fallbackAdminTokens.add(token);
      return { user_id: 'admin_user_admin1234', username: 'admin1234', token };
    }
    await ensureAdminUser('admin1234', 'admin1234');
  }
  const token = newToken();
  // Always use DB
  const user = await dbFindUserByUsername(username);
  if (!user || !(await verifyPassword(password, user.password_hash))) return null;
  await dbCreateSession(user.user_id, token);
  return { user_id: user.user_id, username: user.username, token };
}

export async function resolveSession(token) {
  if (typeof token !== 'string' || token.length < 16) return null;
  if (token.startsWith('demo_session_token')) {
    if (!isDemoAuthAllowed() || revokedDemoTokens.has(token)) return null;
    return 'demo_user_devflow';
  }
  if (token.startsWith('admin_session_token')) {
    if (!fallbackAdminTokens.has(token)) return null;
    return 'admin_user_admin1234';
  }
  // Always use DB
  return await dbResolveSession(token);
}

export async function logoutSession(token) {
  if (typeof token !== 'string' || token.length < 16) return false;
  if (token.startsWith('demo_session_token')) {
    if (!isDemoAuthAllowed()) return false;
    revokedDemoTokens.add(token);
    return true;
  }
  if (token.startsWith('admin_session_token')) {
    fallbackAdminTokens.delete(token);
    return true;
  }
  // Always use DB
  return await dbDeleteSession(token);
}

export async function getCurrentUser(token) {
  if (typeof token === 'string' && token.startsWith('demo_session_token')) {
    if (!isDemoAuthAllowed() || revokedDemoTokens.has(token)) return null;
    return { user_id: 'demo_user_devflow', username: 'demo' };
  }
  if (typeof token === 'string' && token.startsWith('admin_session_token')) {
    if (!fallbackAdminTokens.has(token)) return null;
    return { user_id: 'admin_user_admin1234', username: 'admin1234' };
  }
  const userId = await resolveSession(token);
  if (!userId) return null;
  if (userId === 'demo_user_devflow') {
    return isDemoAuthAllowed() ? { user_id: userId, username: 'demo' } : null;
  }
  if (userId === 'admin_user_admin1234') {
    return { user_id: userId, username: 'admin1234' };
  }
  // Always use DB
  const username = await dbGetUsernameById(userId);
  return username ? { user_id: userId, username } : null;
}

export async function ensureAdminUser(username = 'admin1234', password = 'admin1234') {
  const name = typeof username === 'string' ? username.trim() : 'admin1234';
  const pwd = typeof password === 'string' ? password : 'admin1234';
  if (!isValidUsername(name) || pwd.length < 6 || pwd.length > 128) {
    return { ensured: false, reason: 'missing_credentials' };
  }
  if (!isDatabaseEnabled()) {
    return { ensured: true, reason: 'database_disabled' };
  }
  const passwordHash = await hashPassword(pwd);
  const existing = await dbFindUserByUsername(name);
  if (!existing) {
    const userId = await dbCreateUser(name, passwordHash);
    return { ensured: Boolean(userId), created: Boolean(userId) };
  }
  if (await verifyPassword(pwd, existing.password_hash)) {
    return { ensured: true, created: false, updated: false };
  }
  await dbQuery('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
    passwordHash,
    existing.user_id
  ]);
  return { ensured: true, created: false, updated: true };
}

/**
 * Creates the Instagram preview account or resets its password from
 * INSTAGRAM_PREVIEW_PASSWORD. The plaintext password stays in the local env.
 */
export async function ensureInstagramPreviewUser(username) {
  const name = typeof username === 'string' ? username.trim() : '';
  const password = String(process.env.INSTAGRAM_PREVIEW_PASSWORD || '');
  if (!isValidUsername(name) || password.length < 6 || password.length > 128) {
    return { ensured: false, reason: 'missing_credentials' };
  }
  if (!isDatabaseEnabled()) {
    return { ensured: false, reason: 'database_disabled' };
  }
  const passwordHash = await hashPassword(password);
  const existing = await dbFindUserByUsername(name);
  if (!existing) {
    const userId = await dbCreateUser(name, passwordHash);
    return { ensured: Boolean(userId), created: Boolean(userId) };
  }
  if (await verifyPassword(password, existing.password_hash)) {
    return { ensured: true, created: false, updated: false };
  }
  await dbQuery('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
    passwordHash,
    existing.user_id
  ]);
  return { ensured: true, created: false, updated: true };
}