import { sendRouteError } from './routeUtils.js';

export function apiNotFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: 'Not found',
    request_id: req.requestId,
    timestamp: new Date().toISOString()
  });
}

export function globalErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const msg = String(err?.message || '');
  if (msg.includes('not allowed by CORS')) {
    res.status(403).json({
      success: false,
      error: 'Origin not allowed',
      request_id: req.requestId,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const status = Number(err.statusCode || err.status) || 500;
  sendRouteError(res, req, status, 'Internal server error', err);
}
