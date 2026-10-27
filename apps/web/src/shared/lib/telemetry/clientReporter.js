import { getBreadcrumbs } from './breadcrumbs.js';

const API_URL =
  import.meta.env.VITE_ENRICHMENT_API_URL !== undefined &&
  import.meta.env.VITE_ENRICHMENT_API_URL !== ''
    ? import.meta.env.VITE_ENRICHMENT_API_URL
    : (import.meta.env.DEV ? 'http://localhost:3001' : '');

function generateTraceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'tr-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}

/**
 * Отправляет диагностический пакет ошибки на сервер
 */
export async function reportIncident({ error, componentStack, traceId }) {
  const effectiveTraceId = traceId || error?.traceId || generateTraceId();

  const incidentPayload = {
    trace_id: effectiveTraceId,
    timestamp: new Date().toISOString(),
    error: {
      name: error?.name || 'Error',
      message: error?.message || String(error || 'Unknown error'),
      stack: error?.stack || null,
      componentStack: componentStack || null
    },
    breadcrumbs: getBreadcrumbs(),
    url: typeof window !== 'undefined' ? window.location.href : '',
    app_version: '1.0.0',
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'browser'
  };

  try {
    const endpoint = `${API_URL}/api/telemetry/incident`;
    const bodyStr = JSON.stringify(incidentPayload);

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([bodyStr], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
    } else if (typeof fetch === 'function') {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        keepalive: true
      });
    }
  } catch (err) {
    // Не крашим интерфейс, если репортер не может достучаться до сервера
    console.warn('Не удалось отправить отчет об инциденте на сервер:', err);
  }

  return incidentPayload;
}
