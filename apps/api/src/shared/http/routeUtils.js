export function sendRouteError(res, req, status, fallbackMessage, error) {
  const statusNum = Number(status);
  const hideInternalDetail =
    process.env.NODE_ENV === 'production' && statusNum >= 500;
  const message = hideInternalDetail
    ? fallbackMessage
    : error?.message || fallbackMessage;
  return res.status(status).json({
    success: false,
    error: message,
    request_id: req.requestId,
    error_type: error?.name || 'RouteError',
    timestamp: new Date().toISOString()
  });
}
