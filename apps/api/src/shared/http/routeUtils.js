import { logger } from '../logging/logger.js';

export function sendRouteError(res, req, status, fallbackMessage, error) {
  const statusNum = Number(status);
  const hideInternalDetail =
    process.env.NODE_ENV === 'production' && statusNum >= 500;
  const message = hideInternalDetail
    ? fallbackMessage
    : error?.message || fallbackMessage;

  const traceId = req?.traceId || req?.requestId || null;

  const logMeta = {
    trace_id: traceId,
    status: statusNum,
    path: req?.originalUrl || req?.path,
    method: req?.method,
    error: error || new Error(fallbackMessage)
  };

  if (statusNum >= 500) {
    logger.error(`Route error [${statusNum}] on ${req?.method || 'UNKNOWN'} ${req?.path || 'UNKNOWN'}: ${message}`, logMeta);
  } else {
    logger.warn(`Route warning [${statusNum}] on ${req?.method || 'UNKNOWN'} ${req?.path || 'UNKNOWN'}: ${message}`, logMeta);
  }

  return res.status(status).json({
    success: false,
    error: message,
    request_id: req?.requestId,
    trace_id: traceId,
    error_type: error?.name || 'RouteError',
    timestamp: new Date().toISOString()
  });
}
