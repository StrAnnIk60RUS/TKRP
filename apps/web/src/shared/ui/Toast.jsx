import React, { useEffect, useState } from 'react'
import './Toast.css'

const Toast = ({ message, type = 'success', onClose, duration = 3000, traceId }) => {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose()
      }, duration)
      return () => clearTimeout(timer)
    }
  }, [duration, onClose])

  const handleCopyTrace = (e) => {
    e.stopPropagation()
    if (navigator?.clipboard?.writeText && traceId) {
      navigator.clipboard.writeText(traceId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className={`toast toast-${type}`} role="status" aria-live="polite">
      <div className="toast-icon">
        {type === 'success' && '✅'}
        {type === 'error' && '❌'}
        {type === 'info' && 'ℹ️'}
        {type === 'warning' && '⚠️'}
      </div>
      <div className="toast-body">
        <div className="toast-message">{message}</div>
        {traceId && (
          <div className="toast-trace-badge">
            <span className="toast-trace-label">ID:</span>
            <span className="toast-trace-val" title={traceId}>
              {traceId.length > 16 ? `${traceId.slice(0, 8)}…${traceId.slice(-4)}` : traceId}
            </span>
            <button
              type="button"
              className="toast-trace-copy"
              onClick={handleCopyTrace}
              title="Скопировать Trace ID инцидента"
            >
              {copied ? '✓ скопировано' : 'копировать'}
            </button>
          </div>
        )}
      </div>
      <button className="toast-close" onClick={onClose} aria-label="Закрыть уведомление">×</button>
    </div>
  )
}

export const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div className="toast-container" aria-live="polite" aria-relevant="additions text">
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          traceId={toast.traceId}
          onClose={() => removeToast(toast.id)}
          duration={toast.duration}
        />
      ))}
    </div>
  )
}

export default Toast
