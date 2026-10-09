/**
 * Хранище пользователь и session: scrypt-хэши + DB (users/sessions) или JSON fallback.
 */
import crypto from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isDatabaseEnabled, query as dbQuery } from '../../../shared/db/client.js';

const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_COST_LOG_N = 15;
const SCRYPT_BLOCK_SIZE = 4;
const SCRYPT_MAX_MEMORY_BYTES = 32 * 1024 * 1024;

const USERNAME_RE = /^[a-zA-Z0-9_.@-]{3,64}$/;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'data',
  'runtime',
  'api'
);
const USERS_FILE = join(DATA_DIR, 'users.json');
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');

function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: 1 << SCRYPT_COST_LOG_N, blockSize: SCRYPT_BLOCK_SIZE, maxMemory: SCRYPT_MAX_MEMORY_BYTES });
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt:')) return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: 1 << SCRYPT_COST_LOG_N, blockSize: SCRYPT_BLOCK_SIZE, maxMemory: SCRYPT_MAX_MEMORY_BYTES });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (error) {
    return false;
  }
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ----- JSON fallback (sequential mutation queue to avoid races) -----

let jsonQueue = Promise.resolve();

async function readJsonArray(file) {
  try {
    const raw = await readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error(`[auth] Ошибка读取 ${file}:`, error?.message || error);
    return [];
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), 'utf-8');
}

async function withJsonStore(fn) {
  const step = jsonQueue.then(fn);
  jsonQueue = step.then(() => null).catch(() => null);
  await step;
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
  const found = await dbQuery('SELECT user_id FROM sessions WHERE token = $1 LIMIT 1', [token]);
  const row = found.rows[0];
  return row ? String(row.user_id) : null;
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
  const passwordHash = hashPassword(password);
  const token = newToken();
  if (isDatabaseEnabled()) {
    const userId = await dbCreateUser(username, passwordHash);
    if (!userId) return null;
    await dbCreateSession(userId, token);
    return { user_id: userId, username, token };
  }
  let created = null;
  await withJsonStore(async () => {
    const users = await readJsonArray(USERS_FILE);
    if (users.some((item) => item?.username === username)) return;
    const user = {
      id: crypto.randomUUID(),
      username,
      password_hash: passwordHash,
      created_at: new Date().toISOString()
    };
    users.push(user);
    await writeJsonAtomic(USERS_FILE, users);
    const sessions = await readJsonArray(SESSIONS_FILE);
    sessions.push({ user_id: user.id, token, created_at: user.created_at });
    await writeJsonAtomic(SESSIONS_FILE, sessions);
    created = { user_id: user.id, username, token };
  });
  return created;
}

export async function loginUser(username, password) {
  if (!isValidUsername(username) || typeof password !== 'string') return null;
  const token = newToken();
  if (isDatabaseEnabled()) {
    const user = await dbFindUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    await dbCreateSession(user.user_id, token);
    return { user_id: user.user_id, username: user.username, token };
  }
  let result = null;
  await withJsonStore(async () => {
    const users = await readJsonArray(USERS_FILE);
    const user = users.find((item) => item?.username === username);
    if (!user || !verifyPassword(password, user.password_hash)) return;
    const sessions = await readJsonArray(SESSIONS_FILE);
    sessions.push({ user_id: user.id, token, created_at: new Date().toISOString() });
    await writeJsonAtomic(SESSIONS_FILE, sessions);
    result = { user_id: user.id, username: user.username, token };
  });
  return result;
}

export async function resolveSession(token) {
  if (typeof token !== 'string' || token.length < 16) return null;
  if (isDatabaseEnabled()) return await dbResolveSession(token);
  const sessions = await readJsonArray(SESSIONS_FILE);
  const found = sessions.find((item) => item?.token === token);
  return found ? String(found.user_id) : null;
}

export async function logoutSession(token) {
  if (typeof token !== 'string' || token.length < 16) return false;
  if (isDatabaseEnabled()) return await dbDeleteSession(token);
  let removed = false;
  await withJsonStore(async () => {
    const sessions = await readJsonArray(SESSIONS_FILE);
    const kept = sessions.filter((item) => item?.token !== token);
    removed = kept.length < sessions.length;
    if (removed) await writeJsonAtomic(SESSIONS_FILE, kept);
  });
  return removed;
}

export async function getCurrentUser(token) {
  const userId = await resolveSession(token);
  if (!userId) return null;
  if (isDatabaseEnabled()) {
    const username = await dbGetUsernameById(userId);
    return username ? { user_id: userId, username } : null;
  }
  const users = await readJsonArray(USERS_FILE);
  const user = users.find((item) => String(item?.id) === userId);
  return user ? { user_id: userId, username: user.username } : null;
}
