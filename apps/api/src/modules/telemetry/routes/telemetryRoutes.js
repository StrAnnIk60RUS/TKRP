import { Router } from 'express';
import { logger, getRecentErrors } from '../../../shared/logging/logger.js';
import { requireLocalOrApiKey } from '../../../shared/http/security.js';
import { getMetricsAsPrometheusText } from '../../../shared/logging/metrics.js';

const router = Router();

/**
 * Прием отчетов об инцидентах и сбоях с фронтенда (React ErrorBoundary / Unhandled Errors)
 */
router.post('/incident', (req, res) => {
  const { trace_id, error, breadcrumbs, url, app_version, user_agent } = req.body || {};

  const effectiveTraceId = trace_id || req.traceId || req.requestId;
  const errorMessage = error?.message || 'Unknown client incident';

  logger.error(`Frontend incident reported: ${errorMessage}`, {
    module: 'frontend',
    trace_id: effectiveTraceId,
    client_error: error || null,
    breadcrumbs: Array.isArray(breadcrumbs) ? breadcrumbs.slice(-25) : [],
    url: url || null,
    app_version: app_version || 'unknown',
    user_agent: user_agent || req.headers['user-agent'] || null
  });

  res.status(200).json({
    success: true,
    message: 'Incident recorded',
    trace_id: effectiveTraceId,
    timestamp: new Date().toISOString()
  });
});

/**
 * Получение последних ошибок для панели диагностики / разработчика
 */
router.get('/recent-errors', requireLocalOrApiKey, (req, res) => {
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 100);
  const errors = getRecentErrors(limit);

  res.status(200).json({
    success: true,
    count: errors.length,
    errors,
    timestamp: new Date().toISOString()
  });
});

/**
 * Выгрузка метрик в формате Prometheus text exposition format (v0.0.4)
 */
router.get('/metrics', requireLocalOrApiKey, (req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(getMetricsAsPrometheusText());
});

export default router;
