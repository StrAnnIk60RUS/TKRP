import { sendRouteError } from './routeUtils.js';
import { logger } from '../logging/logger.js';

export function apiNotFoundHandler(req, res) {
  const traceId = req?.traceId || req?.requestId || null;
  res.status(404).json({
    success: false,
    error: 'Not found',
    request_id: req?.requestId,
    trace_id: traceId,
    timestamp: new Date().toISOString()
  });
}

export function globalErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const traceId = req?.traceId || req?.requestId || null;
  const msg = String(err?.message || '');
  if (msg.includes('not allowed by CORS')) {
    logger.warn(`CORS rejected origin for ${req?.method} ${req?.path}`, {
      trace_id: traceId,
      origin: req?.headers?.origin,
      client_ip: req?.clientIp
    });
    res.status(403).json({
      success: false,
      error: 'Origin not allowed',
      request_id: req?.requestId,
      trace_id: traceId,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const status = Number(err.statusCode || err.status) || 500;
  sendRouteError(res, req, status, 'Internal server error', err);
}
