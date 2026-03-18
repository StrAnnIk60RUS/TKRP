export function sendRouteError(res, req, status, fallbackMessage, error) {
  const message = error?.message || fallbackMessage;
  return res.status(status).json({
    success: false,
    error: message,
    request_id: req.requestId,
    error_type: error?.name || 'RouteError',
    timestamp: new Date().toISOString()
  });
}
