import React, { useEffect, useMemo, useState } from 'react'
import '../PreviewModal.css'
import './editorModals.css'

const ALLOWED_OBJECTIVES = ['inform', 'educate', 'engage', 'convert', 'retain']
const ALLOWED_PLATFORMS = ['vk', 'linkedin']
const ALLOWED_FORMATS = ['text', 'image', 'video', 'combined']

function coerceString(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function buildInitialDraft(publication) {
  return {
    planned_date: coerceString(publication?.planned_date || ''),
    topic: coerceString(publication?.topic || ''),
    platform: coerceString(publication?.platform || ''),
    format: coerceString(publication?.format || ''),
    objective: coerceString(publication?.objective || ''),
    tone: coerceString(publication?.tone || ''),
    key_message: coerceString(publication?.key_message || ''),
    cta: coerceString(publication?.cta || '')
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
      platform: draft.platform,
      format: draft.format,
      objective: draft.objective,
      tone: draft.tone.trim(),
      key_message: draft.key_message.trim(),
      cta: draft.cta.trim()
    }

    if (!cleaned.planned_date) return 'Укажите дату публикации'
    if (!cleaned.topic) return 'Укажите тему'
    if (!ALLOWED_PLATFORMS.includes(cleaned.platform)) return 'Укажите платформу (vk или linkedin)'
    if (!ALLOWED_FORMATS.includes(cleaned.format)) return 'Укажите формат публикации'
    if (!ALLOWED_OBJECTIVES.includes(cleaned.objective)) return 'Укажите цель публикации'
    if (!cleaned.tone) return 'Укажите тон'
    if (!cleaned.key_message) return 'Укажите ключевое сообщение'
    if (!cleaned.cta) return 'Укажите CTA'

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
      platform: draft.platform,
      format: draft.format,
      objective: draft.objective,
      tone: draft.tone.trim(),
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
                  {ALLOWED_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
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
                  {ALLOWED_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f}
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
                  {ALLOWED_OBJECTIVES.map((o) => (
                    <option key={o} value={o}>
                      {o}
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
                <input
                  className="editor-input"
                  type="text"
                  value={draft.tone}
                  onChange={(e) => setField('tone', e.target.value)}
                  placeholder="Например: экспертный"
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

