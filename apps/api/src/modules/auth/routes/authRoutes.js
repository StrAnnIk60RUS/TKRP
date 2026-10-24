import { Router } from 'express';
import { createUser, getCurrentUser, loginUser, logoutSession } from '../services/authStore.js';
import { instagramFeatures } from '../services/instagramAccess.js';
import { sendRouteError } from '../../../shared/http/routeUtils.js';
import { createAuthRateLimitMiddleware } from '../../../shared/http/security.js';

const router = Router();
const authRateLimiter = createAuthRateLimitMiddleware();

function readBearerToken(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

router.post('/register', authRateLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const username = body.username;
    const password = body.password;
    if (typeof username !== 'string' || typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'Некорректное имя пользователя или пароль (пароль: 6–128 символов)',
        request_id: req.requestId
      });
    }
    const created = await createUser(username, password);
    if (!created) {
      return res.status(409).json({
        success: false,
        error: 'Имя пользователя уже занято',
        request_id: req.requestId
      });
    }
    return res.json({
      success: true,
      user: { user_id: created.user_id, username: created.username },
      token: created.token,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/auth/register', error);
  }
});

router.post('/login', authRateLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const username = body.username;
    const password = body.password;
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Укажите имя пользователя и пароль',
        request_id: req.requestId
      });
    }
    const result = await loginUser(username, password);
    if (!result) {
      return res.status(400).json({
        success: false,
        error: 'Неверное имя пользователя или пароль',
        request_id: req.requestId
      });
    }
    return res.json({
      success: true,
      user: { user_id: result.user_id, username: result.username },
      token: result.token,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/auth/login', error);
  }
});

router.post('/logout', async (req, res) => {
  try {
    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token : readBearerToken(req);
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Не указан токен сессии',
        request_id: req.requestId
      });
    }
    const removed = await logoutSession(token);
    return res.json({
      success: true,
      removed: removed,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/auth/logout', error);
  }
});

router.get('/me', async (req, res) => {
  try {
    const token = readBearerToken(req);
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Нужен токен авторизации',
        request_id: req.requestId
      });
    }
    const user = await getCurrentUser(token);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Сессия не найдена или истекла',
        request_id: req.requestId
      });
    }
    return res.json({
      success: true,
      user: {
        ...user,
        features: instagramFeatures(user)
      },
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/auth/me', error);
  }
});

export default router;
