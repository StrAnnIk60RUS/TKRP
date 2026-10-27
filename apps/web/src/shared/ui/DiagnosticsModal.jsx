import React, { useState, useEffect } from 'react';
import { getBreadcrumbs } from '../lib/telemetry/breadcrumbs.js';
import { authHeaders } from '../api/authService.js';
import './DiagnosticsModal.css';

const API_URL =
  import.meta.env.VITE_ENRICHMENT_API_URL !== undefined &&
  import.meta.env.VITE_ENRICHMENT_API_URL !== ''
    ? import.meta.env.VITE_ENRICHMENT_API_URL
    : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export const DiagnosticsModal = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('health');
  const [healthData, setHealthData] = useState(null);
  const [serverErrors, setServerErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setLoading(true);

    // Загрузка /health и /api/telemetry/recent-errors
    Promise.allSettled([
      fetch(`${API_URL}/health`).then((r) => r.json()),
      fetch(`${API_URL}/api/telemetry/recent-errors?limit=25`, {
        headers: authHeaders()
      }).then((r) => r.json())
    ]).then(([healthRes, errorsRes]) => {
      if (!mounted) return;
      if (healthRes.status === 'fulfilled') {
        setHealthData(healthRes.value);
      }
      if (errorsRes.status === 'fulfilled' && errorsRes.value?.errors) {
        setServerErrors(errorsRes.value.errors);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const breadcrumbs = getBreadcrumbs();

  const handleCopyReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      user_agent: navigator.userAgent,
      health: healthData,
      recent_server_errors: serverErrors,
      client_breadcrumbs: breadcrumbs
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const copyString = (str) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(str);
    }
  };

  return (
    <div className="diagnostics-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="diagnostics-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diagnostics-header">
          <div className="diagnostics-title-wrap">
            <span role="img" aria-label="diagnostics">🩺</span>
            <h2 className="diagnostics-title">Диагностика системы и инцидентов</h2>
          </div>
          <button type="button" className="diagnostics-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="diagnostics-nav-tabs">
          <button
            type="button"
            className={`diagnostics-tab ${activeTab === 'health' ? 'active' : ''}`}
            onClick={() => setActiveTab('health')}
          >
            Состояние системы
          </button>
          <button
            type="button"
            className={`diagnostics-tab ${activeTab === 'errors' ? 'active' : ''}`}
            onClick={() => setActiveTab('errors')}
          >
            Журнал инцидентов ({serverErrors.length})
          </button>
          <button
            type="button"
            className={`diagnostics-tab ${activeTab === 'breadcrumbs' ? 'active' : ''}`}
            onClick={() => setActiveTab('breadcrumbs')}
          >
            Действия в UI ({breadcrumbs.length})
          </button>
        </div>

        <div className="diagnostics-body">
          {loading && <p style={{ textAlign: 'center', padding: '20px' }}>Загрузка диагностических данных...</p>}

          {!loading && activeTab === 'health' && (
            <div>
              <div className="diagnostics-grid">
                <div className="diagnostics-metric-card">
                  <div className="label">Сервис API</div>
                  <div className="val">
                    <span className={`status-badge ${healthData?.status === 'ok' ? 'status-ok' : 'status-degraded'}`}>
                      {healthData?.status || 'неизвестно'}
                    </span>
                  </div>
                </div>

                <div className="diagnostics-metric-card">
                  <div className="label">База данных</div>
                  <div className="val">
                    <span className={`status-badge ${healthData?.database === 'connected' ? 'status-ok' : 'status-degraded'}`}>
                      {healthData?.database || 'not_configured'}
                    </span>
                  </div>
                </div>

                <div className="diagnostics-metric-card">
                  <div className="label">Аптайм сервера</div>
                  <div className="val">{healthData?.uptime_seconds ? `${Math.floor(healthData.uptime_seconds / 60)} мин` : 'N/A'}</div>
                </div>

                <div className="diagnostics-metric-card">
                  <div className="label">Очередь задач (JobQueue)</div>
                  <div className="val">
                    {healthData?.job_queue ? `Активно: ${healthData.job_queue.running}, В очереди: ${healthData.job_queue.queued}` : '0'}
                  </div>
                </div>
              </div>

              {healthData?.storage_metrics && (
                <div style={{ marginTop: '16px' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '8px' }}>Метрики хранилища:</div>
                  <pre className="diagnostics-stack-preview">
                    {JSON.stringify(healthData.storage_metrics, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {!loading && activeTab === 'errors' && (
            <div className="diagnostics-list">
              {serverErrors.length === 0 ? (
                <div className="diagnostics-empty-state">
                  🎉 Активных сбоев не зафиксировано. Система работает стабильно.
                </div>
              ) : (
                serverErrors.map((err, idx) => (
                  <div key={idx} className="diagnostics-item">
                    <div className="diagnostics-item-head">
                      <div>
                        {err.module && <span className="diagnostics-tag">[{err.module}]</span>}
                        <span style={{ marginLeft: '8px', fontWeight: 700, color: err.level === 'ERROR' ? '#ff6b6b' : '#f59f00' }}>
                          {err.level}
                        </span>
                      </div>
                      <span className="diagnostics-time">
                        {err.timestamp ? new Date(err.timestamp).toLocaleTimeString() : ''}
                      </span>
                    </div>

                    <div className="diagnostics-msg">{err.message}</div>

                    {err.trace_id && (
                      <div className="diagnostics-trace-row">
                        <span>Trace ID: {err.trace_id}</span>
                        <button type="button" className="diagnostics-copy-btn" onClick={() => copyString(err.trace_id)}>
                          скопировать ID
                        </button>
                      </div>
                    )}

                    {err.error?.stack && (
                      <div className="diagnostics-stack-preview">
                        {err.error.stack.split('\n').slice(0, 4).join('\n')}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {!loading && activeTab === 'breadcrumbs' && (
            <div className="diagnostics-list">
              {breadcrumbs.length === 0 ? (
                <div className="diagnostics-empty-state">
                  Лента действий пуста.
                </div>
              ) : (
                breadcrumbs.slice().reverse().map((crumb, idx) => (
                  <div key={idx} className="diagnostics-item">
                    <div className="diagnostics-item-head">
                      <span className="diagnostics-tag">{crumb.category}</span>
                      <span className="diagnostics-time">
                        {crumb.timestamp ? new Date(crumb.timestamp).toLocaleTimeString() : ''}
                      </span>
                    </div>
                    <div className="diagnostics-msg">{crumb.message}</div>
                    {crumb.data && (
                      <div className="diagnostics-trace-row">
                        {JSON.stringify(crumb.data)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="diagnostics-footer">
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9aa0a6)' }}>
            Кольцевой буфер и сквозной аудит по W3C Trace Context
          </div>
          <button type="button" className="diagnostics-btn-export" onClick={handleCopyReport}>
            {copied ? '✓ Отчет скопирован!' : 'Скопировать технический отчет'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsModal;
