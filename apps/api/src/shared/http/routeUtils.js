export function sendRouteError(res, req, status, fallbackMessage, error) {
  const isProd = process.env.NODE_ENV === 'production';
  const hideServerDetails = isProd && status >= 500;
  const message = hideServerDetails ? fallbackMessage : error?.message || fallbackMessage;
  return res.status(status).json({
    success: false,
    error: message,
    request_id: req.requestId,
    error_type: error?.name || 'RouteError',
    timestamp: new Date().toISOString()
  });
}
