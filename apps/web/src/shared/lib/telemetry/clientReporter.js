import { getBreadcrumbs } from './breadcrumbs.js';

const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
const API_URL =
  metaEnv.VITE_ENRICHMENT_API_URL !== undefined &&
  metaEnv.VITE_ENRICHMENT_API_URL !== ''
    ? metaEnv.VITE_ENRICHMENT_API_URL
    : (metaEnv.DEV ? 'http://localhost:3001' : (typeof process !== 'undefined' && process.env?.API_URL ? process.env.API_URL : ''));

export function generateTraceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'tr-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}

/**
 * Отправляет диагностический пакет ошибки на сервер
 */
export async function reportIncident({ error, componentStack, traceId } = {}) {
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
    url: typeof window !== 'undefined' ? window.location?.href || '' : '',
    app_version: '1.0.0',
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent || 'browser' : 'browser'
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

let crashReporterInitialized = false;

/**
 * Автоматически перехватывает фатальные сбои в браузере и неотловленные Promise.rejection,
 * отправляя диагностические дампы на бэкенд с защитой от лавины (throttling).
 */
export function initGlobalCrashReporting() {
  if (typeof window === 'undefined' || crashReporterInitialized) return;
  crashReporterInitialized = true;

  let lastReportTime = 0;
  const shouldReport = () => {
    const now = Date.now();
    if (now - lastReportTime > 3000) {
      lastReportTime = now;
      return true;
    }
    return false;
  };

  window.addEventListener('error', (event) => {
    try {
      if (shouldReport() && event.error) {
        reportIncident({ error: event.error }).catch(() => {});
      }
    } catch {}
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      if (shouldReport()) {
        const err =
          event.reason instanceof Error
            ? event.reason
            : new Error(String(event.reason || 'Unhandled Promise Rejection'));
        reportIncident({ error: err }).catch(() => {});
      }
    } catch {}
  });
}
