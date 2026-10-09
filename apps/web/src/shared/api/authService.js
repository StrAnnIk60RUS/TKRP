/**
 * Сервис для регистрация, логin и logout пользователей
 */

const API_URL = import.meta.env.VITE_ENRICHMENT_API_URL || 'http://localhost:3001';

const SESSION_KEY = 'tkrp_session';
const USER_ID_KEY = 'tkrp_user_id';

export function getSessionToken() {
  return localStorage.getItem(SESSION_KEY) || null;
}

export function setSessionToken(token) {
  if (token) {
    localStorage.setItem(SESSION_KEY, token);
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
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
      throw new Error(`Cannot connect to server at ${API_URL}: check that the backend is running and that the page address is allowed by CORS.`);
    }
    throw error;
  }
};

const postAuthJson = async (endpoint, payload) => {
  const response = await safeFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await buildFetchErrorMessage(response));
  }
  return await response.json();
};

/**
 * Registers a new user and stores session token in localStorage
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Object>} - { success, user, token }
 */
export async function registerUser(username, password) {
  const result = await postAuthJson(`${API_URL}/api/auth/register`, { username, password });
  if (!result.success) {
    throw new Error(result.error || 'Registration failed');
  }
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
  if (!result.success) {
    throw new Error(result.error || 'Login failed');
  }
  setSessionToken(result.token);
  setCurrentUserId(result.user?.user_id);
  return result;
}

/**
 * Logs out current user: invalidates session on server and clears localStorage
 */
export async function logoutUser() {
  const token = getSessionToken();
  if (token) {
    try {
      await postAuthJson(`${API_URL}/api/auth/logout`, { token });
    } catch (error) {
      console.error('Ошибка в logoutUser:', error);
    }
  }
  setSessionToken(null);
  setCurrentUserId(null);
}

/**
 * Returns current authenticated user or null if not logged in
 * @returns {Promise<Object|null>} - { user_id, username }
 */
export async function getCurrentUser() {
  const token = getSessionToken();
  if (!token) return null;
  try {
    const response = await fetch(`${API_URL}/api/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result.success ? result.user : null;
  } catch (error) {
    console.error('Ошибка в getCurrentUser:', error);
    return null;
  }
}
