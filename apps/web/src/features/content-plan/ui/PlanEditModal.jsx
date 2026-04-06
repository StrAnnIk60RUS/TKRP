import React, { useEffect, useMemo, useState } from 'react'
import '../../../shared/ui/PreviewModal.css'
import './editorModals.css'

function coerceToNumberOrNull(value) {
  if (value === null || value === undefined) return null
  if (value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function deriveAutoMinPublications(plan, draft) {
  const nextStart = draft?.start_date || plan?.planning_horizon?.start_date
  const nextEnd = draft?.end_date || plan?.planning_horizon?.end_date
  if (!nextStart || !nextEnd) return 1
  const nextDays = Math.max(1, Math.round((new Date(nextEnd) - new Date(nextStart)) / (24 * 60 * 60 * 1000)) + 1)

  const baseStart = plan?.planning_horizon?.start_date
  const baseEnd = plan?.planning_horizon?.end_date
  const baseDays = baseStart && baseEnd
    ? Math.max(1, Math.round((new Date(baseEnd) - new Date(baseStart)) / (24 * 60 * 60 * 1000)) + 1)
    : nextDays
  const baseMin =
    coerceToNumberOrNull(plan?.schedule_preferences?.requested_publications) ??
    coerceToNumberOrNull(plan?.constraints?.min_publications) ??
    coerceToNumberOrNull(plan?.publications?.length) ??
    1
  const postsPerWeek = Math.max(1 / 7, (baseMin * 7) / Math.max(1, baseDays))
  return Math.max(1, Math.round((postsPerWeek * nextDays) / 7))
}

function buildInitialDraft(plan) {
  return {
    start_date: plan?.planning_horizon?.start_date || '',
    end_date: plan?.planning_horizon?.end_date || '',
    avg_engagement_rate: plan?.kpi_targets?.avg_engagement_rate ?? 0,
    estimated_conversions: plan?.kpi_targets?.estimated_conversions ?? 0,
    notes: plan?.notes || ''
  }
}

const PlanEditModal = ({ plan, onSave, onCancel }) => {
  const [draft, setDraft] = useState(() => buildInitialDraft(plan))
  const [error, setError] = useState('')
  const autoMinPublications = useMemo(() => deriveAutoMinPublications(plan, draft), [plan, draft])

  const title = useMemo(() => {
    const hasOpt = Boolean(plan?.kpi_targets?.avg_engagement_rate)
    return hasOpt ? 'Редактирование параметров плана' : 'Редактирование параметров плана'
  }, [plan])

  useEffect(() => {
    setDraft(buildInitialDraft(plan))
    setError('')
  }, [plan])

  const setField = (name, value) => {
    setDraft((prev) => ({ ...prev, [name]: value }))
    setError('')
  }

  const validate = () => {
    if (!draft.start_date || !draft.end_date) return 'Укажите период планирования'

    return null
  }

  const handleSubmit = () => {
    const maybeError = validate()
    if (maybeError) {
      setError(maybeError)
      return
    }

    onSave({
      planning_horizon: {
        start_date: draft.start_date,
        end_date: draft.end_date
      },
      kpi_targets: {
        avg_engagement_rate: clamp01(draft.avg_engagement_rate),
        estimated_conversions: Number(coerceToNumberOrNull(draft.estimated_conversions) ?? 0)
      },
      constraints: {
        min_publications: autoMinPublications
      },
      notes: draft.notes
    })
  }

  if (!plan) return null

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="editor-form">
            {error && <div className="editor-error">{error}</div>}

            <div className="editor-form-grid">
              <label className="editor-field">
                Дата начала
                <input
                  className="editor-input"
                  type="date"
                  value={draft.start_date}
                  onChange={(e) => setField('start_date', e.target.value)}
                />
              </label>

              <label className="editor-field">
                Дата окончания
                <input
                  className="editor-input"
                  type="date"
                  value={draft.end_date}
                  onChange={(e) => setField('end_date', e.target.value)}
                />
              </label>

              <label className="editor-field">
                avg_engagement_rate (0..1)
                <input
                  className="editor-input"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={draft.avg_engagement_rate}
                  onChange={(e) => setField('avg_engagement_rate', e.target.value)}
                />
              </label>

              <label className="editor-field">
                estimated_conversions
                <input
                  className="editor-input"
                  type="number"
                  step="1"
                  min="0"
                  value={draft.estimated_conversions}
                  onChange={(e) => setField('estimated_conversions', e.target.value)}
                />
              </label>

              <label className="editor-field">
                min_publications (auto)
                <input className="editor-input" type="number" value={autoMinPublications} disabled />
              </label>

              <label className="editor-field editor-field-wide">
                Заметки
                <textarea
                  className="editor-textarea"
                  rows="4"
                  value={draft.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  placeholder="Любые заметки по плану"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="btn-primary" onClick={handleSubmit}>
            <span>Сохранить</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default PlanEditModal

