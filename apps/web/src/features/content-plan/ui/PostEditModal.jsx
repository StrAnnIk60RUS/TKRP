import React, { useEffect, useMemo, useState } from 'react'
import '../../../shared/ui/PreviewModal.css'
import './editorModals.css'
import {
  getFormatLabel,
  getObjectiveLabel,
  getPlatformLabel,
  getToneLabel,
  normalizeFormat,
  normalizeObjective,
  normalizePlatform,
  normalizePublicationForUi,
  normalizeTone,
  publicationFieldOptions
} from '../lib/publicationPresentation'

function coerceString(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function buildInitialDraft(publication) {
  const normalized = normalizePublicationForUi(publication)
  return {
    planned_date: coerceString(normalized?.planned_date || ''),
    topic: coerceString(normalized?.topic || ''),
    platform: coerceString(normalized?.platform || ''),
    format: coerceString(normalized?.format || ''),
    objective: coerceString(normalized?.objective || ''),
    tone: normalizeTone(coerceString(normalized?.tone || ''), 'expert'),
    summary: coerceString(normalized?.summary || ''),
    key_message: coerceString(normalized?.key_message || ''),
    cta: coerceString(normalized?.cta || '')
  }
}

const PostEditModal = ({ publication, onSave, onCancel }) => {
  const [draft, setDraft] = useState(() => buildInitialDraft(publication))
  const [error, setError] = useState('')

  const title = useMemo(() => {
    const topic = coerceString(publication?.topic || '').trim()
    return topic ? `Редактирование: ${topic}` : 'Редактирование публикации'
  }, [publication])

  useEffect(() => {
    setDraft(buildInitialDraft(publication))
    setError('')
  }, [publication])

  const setField = (name, value) => {
    setDraft((prev) => ({ ...prev, [name]: value }))
    setError('')
  }

  const validate = () => {
    const cleaned = {
      planned_date: draft.planned_date || '',
      topic: draft.topic.trim(),
      platform: normalizePlatform(draft.platform),
      format: normalizeFormat(draft.format),
      objective: normalizeObjective(draft.objective),
      tone: normalizeTone(draft.tone.trim(), 'expert'),
      summary: draft.summary.trim(),
      key_message: draft.key_message.trim(),
      cta: draft.cta.trim()
    }

    if (!cleaned.planned_date) return 'Укажите дату публикации'
    if (!cleaned.topic) return 'Укажите тему'
    if (!publicationFieldOptions.platforms.includes(cleaned.platform)) {
      return 'Укажите платформу (vk или linkedin)'
    }
    if (!publicationFieldOptions.formats.includes(cleaned.format)) return 'Укажите формат публикации'
    if (!publicationFieldOptions.objectives.includes(cleaned.objective)) return 'Укажите цель публикации'
    if (!publicationFieldOptions.tones.includes(cleaned.tone)) return 'Укажите тон'
    if (!cleaned.summary) return 'Укажите текст поста'
    if (!cleaned.key_message) return 'Укажите ключевое сообщение'

    return null
  }

  const handleSubmit = () => {
    const maybeError = validate()
    if (maybeError) {
      setError(maybeError)
      return
    }

    onSave({
      planned_date: draft.planned_date,
      topic: draft.topic.trim(),
      platform: normalizePlatform(draft.platform),
      format: normalizeFormat(draft.format),
      objective: normalizeObjective(draft.objective),
      tone: normalizeTone(draft.tone.trim(), 'expert'),
      summary: draft.summary.trim(),
      key_message: draft.key_message.trim(),
      cta: draft.cta.trim()
    })
  }

  if (!publication) return null

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
                Дата
                <input
                  className="editor-input"
                  type="date"
                  value={draft.planned_date}
                  onChange={(e) => setField('planned_date', e.target.value)}
                />
              </label>

              <label className="editor-field">
                Платформа
                <select
                  className="editor-input"
                  value={draft.platform}
                  onChange={(e) => setField('platform', e.target.value)}
                >
                  {publicationFieldOptions.platforms.map((p) => (
                    <option key={p} value={p}>
                      {getPlatformLabel(p)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="editor-field">
                Формат
                <select
                  className="editor-input"
                  value={draft.format}
                  onChange={(e) => setField('format', e.target.value)}
                >
                  {publicationFieldOptions.formats.map((f) => (
                    <option key={f} value={f}>
                      {getFormatLabel(f)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="editor-field">
                Цель
                <select
                  className="editor-input"
                  value={draft.objective}
                  onChange={(e) => setField('objective', e.target.value)}
                >
                  {publicationFieldOptions.objectives.map((o) => (
                    <option key={o} value={o}>
                      {getObjectiveLabel(o)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="editor-field editor-field-wide">
                Тема
                <input
                  className="editor-input"
                  type="text"
                  value={draft.topic}
                  onChange={(e) => setField('topic', e.target.value)}
                  placeholder="Например: кейс внедрения датчиков"
                />
              </label>

              <label className="editor-field editor-field-wide">
                Тон
                <select
                  className="editor-input"
                  value={draft.tone}
                  onChange={(e) => setField('tone', e.target.value)}
                >
                  {publicationFieldOptions.tones.map((t) => (
                    <option key={t} value={t}>
                      {getToneLabel(t)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="editor-field editor-field-wide">
                Текст поста
                <textarea
                  className="editor-textarea"
                  rows="6"
                  value={draft.summary}
                  onChange={(e) => setField('summary', e.target.value)}
                  placeholder="Полный текст публикации"
                />
              </label>

              <label className="editor-field editor-field-wide">
                Ключевое сообщение
                <textarea
                  className="editor-textarea"
                  rows="3"
                  value={draft.key_message}
                  onChange={(e) => setField('key_message', e.target.value)}
                  placeholder="Ключевой тезис"
                />
              </label>

              <label className="editor-field editor-field-wide">
                CTA
                <textarea
                  className="editor-textarea"
                  rows="2"
                  value={draft.cta}
                  onChange={(e) => setField('cta', e.target.value)}
                  placeholder="Например: Оставить заявку на демо"
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

export default PostEditModal

