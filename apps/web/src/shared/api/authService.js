/**
 * Сервис для регистрации, входа и выхода пользователей с W3C-трассировкой и телеметрией
 */

import { addBreadcrumb } from '../lib/telemetry/breadcrumbs.js';

const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
const API_URL =
  metaEnv.VITE_ENRICHMENT_API_URL !== undefined &&
  metaEnv.VITE_ENRICHMENT_API_URL !== ''
    ? metaEnv.VITE_ENRICHMENT_API_URL
    : (metaEnv.DEV ? 'http://localhost:3001' : (typeof process !== 'undefined' && process.env?.API_URL ? process.env.API_URL : ''));

function createTraceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'tr-' + Math.random().toString(36).slice(2, 10);
}

const SESSION_KEY = 'tkrp_session';
const USER_ID_KEY = 'tkrp_user_id';
const authListeners = new Set();

export function subscribeAuth(listener) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function notifyAuth() {
  authListeners.forEach((listener) => listener());
}

export function getSessionToken() {
  return localStorage.getItem(SESSION_KEY) || null;
}

export function setSessionToken(token) {
  if (token) {
    localStorage.setItem(SESSION_KEY, token);
  } else {
    localStorage.removeItem(SESSION_KEY);
    setCurrentUserId(null);
  }
  notifyAuth();
}

export function getCurrentUserId() {
  return localStorage.getItem(USER_ID_KEY) || null;
}

function setCurrentUserId(userId) {
  if (userId) {
    localStorage.setItem(USER_ID_KEY, String(userId));
  } else {
    localStorage.removeItem(USER_ID_KEY);
  }
}

export function authHeaders() {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const buildFetchErrorMessage = async (response) => {
  let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
  try {
    const errorData = await response.json();
    errorMessage = errorData.error || errorData.message || errorMessage;
  } catch (e) {
    const text = await response.text().catch(() => 'Неизвестная ошибка');
    errorMessage = text || errorMessage;
  }
  return errorMessage;
};

// Network/CORS-level fetch failures (TypeError: "Failed to fetch") are opaque for users.
const safeFetch = async (endpoint, options = {}) => {
  try {
    return await fetch(endpoint, options);
  } catch (error) {
    if (error?.name === 'TypeError') {
      const serverDesc = API_URL || 'сервер';
      throw new Error(`Не удалось подключиться к серверу (${serverDesc}). Проверьте, что сервер запущен и адрес страницы разрешён.`);
    }
    throw error;
  }
};

const postAuthJson = async (endpoint, payload) => {
  const traceId = createTraceId();
  const startTime = Date.now();

  addBreadcrumb({
    category: 'auth.request',
    message: `POST ${endpoint}`,
    data: { trace_id: traceId }
  });

  let response;
  try {
    response = await safeFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-trace-id': traceId
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    addBreadcrumb({
      category: 'auth.error',
      level: 'error',
      message: `POST ${endpoint} failed: ${error?.message || error}`,
      data: { trace_id: traceId, duration_ms: Date.now() - startTime }
    });
    error.traceId = traceId;
    throw error;
  }

  const durationMs = Date.now() - startTime;
  const responseTraceId =
    response.headers?.get?.('x-trace-id') ||
    response.headers?.get?.('x-request-id') ||
    traceId;

  if (!response.ok) {
    addBreadcrumb({
      category: 'auth.error',
      level: 'warn',
      message: `POST ${endpoint} -> ${response.status} (${durationMs}ms)`,
      data: { trace_id: responseTraceId, status: response.status }
    });
    const error = new Error(await buildFetchErrorMessage(response));
    error.status = response.status;
    error.traceId = responseTraceId;
    throw error;
  }

  addBreadcrumb({
    category: 'auth.success',
    level: 'info',
    message: `POST ${endpoint} -> 200 (${durationMs}ms)`,
    data: { trace_id: responseTraceId }
  });

  const data = await response.json();
  if (data && !data.success && data.error) {
    const error = new Error(data.error);
    error.traceId = responseTraceId;
    throw error;
  }
  return data;
};

/**
 * Registers a new user and stores session token in localStorage
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Object>} - { success, user, token }
 */
export async function registerUser(username, password) {
  const result = await postAuthJson(`${API_URL}/api/auth/register`, { username, password });
  setSessionToken(result.token);
  setCurrentUserId(result.user?.user_id);
  return result;
}

/**
 * Logs in an existing user and stores session token in localStorage
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Object>} - { success, user, token }
 */
export async function loginUser(username, password) {
  const result = await postAuthJson(`${API_URL}/api/auth/login`, { username, password });
  setSessionToken(result.token);
  setCurrentUserId(result.user?.user_id);
  return result;
}

/**
 * Logs out current user: invalidates session on server and clears localStorage
 */
export async function logoutUser() {
  const token = getSessionToken();
  const userId = getCurrentUserId();
  if (token) {
    try {
      await postAuthJson(`${API_URL}/api/auth/logout`, { token });
    } catch (error) {
      console.error('Ошибка в logoutUser:', error);
    }
  }
  setSessionToken(null);
  setCurrentUserId(null);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('projectFormDraft');
      if (userId) {
        localStorage.removeItem(`projectFormDraft:${userId}`);
      }
    }
  } catch (e) {
    // ignore
  }
}

/**
 * Returns current authenticated user or null if not logged in
 * @returns {Promise<Object|null>} - { user_id, username }
 */
export async function getCurrentUser() {
  const token = getSessionToken();
  if (!token) return null;
  const traceId = createTraceId();
  try {
    const response = await fetch(`${API_URL}/api/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-trace-id': traceId
      }
    });
    if (!response.ok) {
      if (response.status === 401) {
        setSessionToken(null);
      }
      return null;
    }
    const result = await response.json();
    return result.success ? result.user : null;
  } catch (error) {
    console.error('Ошибка в getCurrentUser:', error);
    return null;
  }
}
