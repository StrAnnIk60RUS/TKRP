import React from 'react';
import { reportIncident } from '../lib/telemetry/clientReporter.js';
import { addBreadcrumb } from '../lib/telemetry/breadcrumbs.js';
import './ErrorBoundary.css';

function generateTraceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'tr-' + Math.random().toString(36).slice(2, 10);
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      traceId: null,
      copied: false
    };
  }

  static getDerivedStateFromError(error) {
    const traceId = generateTraceId();
    return {
      hasError: true,
      error,
      traceId
    };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });

    addBreadcrumb({
      category: 'error_boundary',
      level: 'error',
      message: error?.message || 'Component render failed',
      data: { stack: errorInfo?.componentStack?.slice(0, 500) }
    });

    reportIncident({
      error,
      componentStack: errorInfo?.componentStack,
      traceId: this.state.traceId
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleCopyReport = () => {
    const { error, errorInfo, traceId } = this.state;
    const report = {
      trace_id: traceId,
      time: new Date().toISOString(),
      url: window.location.href,
      error: {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        componentStack: errorInfo?.componentStack
      }
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 3000);
    }
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo, traceId, copied } = this.state;
      return (
        <div className="error-boundary-overlay" role="alert">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">⚠️</div>
            <h1 className="error-boundary-title">Что-то пошло не так</h1>
            <p className="error-boundary-desc">
              В приложении произошла непредвиденная ошибка. Мы уже зафиксировали детали инцидента в системе аудита.
            </p>

            <div className="error-boundary-meta">
              <span className="trace-label">Идентификатор инцидента:</span>
              <span className="trace-value">{traceId}</span>
            </div>

            <div className="error-boundary-actions">
              <button
                type="button"
                className="error-boundary-btn error-boundary-btn-primary"
                onClick={this.handleReload}
              >
                Перезагрузить страницу
              </button>
              <button
                type="button"
                className="error-boundary-btn error-boundary-btn-secondary"
                onClick={this.handleCopyReport}
              >
                {copied ? '✓ Отчет скопирован!' : 'Скопировать технический отчет'}
              </button>
            </div>

            {process.env.NODE_ENV !== 'production' && error && (
              <details className="error-boundary-details">
                <summary>Технические подробности (для разработчика)</summary>
                <div className="error-boundary-stack">
                  <strong>{error.name}: {error.message}</strong>
                  {error.stack && <div>{error.stack}</div>}
                  {errorInfo?.componentStack && <div>{errorInfo.componentStack}</div>}
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
