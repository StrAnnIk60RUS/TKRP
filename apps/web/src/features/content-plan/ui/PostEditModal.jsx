import React, { useEffect, useMemo, useRef, useState } from 'react'
import AutoResizeTextarea from '../../../shared/ui/AutoResizeTextarea'
import { generatePublicationMedia } from '../../../shared/api/enrichmentService'
import '../../../shared/ui/PreviewModal.css'
import './editorModals.css'
import {
  getFormatLabel,
  getMediaKind,
  getMediaPromptLabel,
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
import PostMediaBlock from './PostMediaBlock'

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
    cta: coerceString(normalized?.cta || ''),
    media_prompt: coerceString(normalized?.media_prompt || ''),
    media: normalized?.media && typeof normalized.media === 'object' ? normalized.media : null
  }
}

function mediaForDraft(format, media) {
  const kind = getMediaKind(format)
  if (!kind || !media || media.kind !== kind || media.status !== 'ready') return null
  return media
}

const PostEditModal = ({ publication, onSave, onCancel, platforms }) => {
  const platformChoices =
    Array.isArray(platforms) && platforms.length
      ? platforms
      : publicationFieldOptions.platforms.filter((item) => item !== 'instagram')
  const [draft, setDraft] = useState(() => buildInitialDraft(publication))
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const generateAbortRef = useRef(null)

  const title = useMemo(() => {
    const topic = coerceString(publication?.topic || '').trim()
    return topic ? `Редактирование: ${topic}` : 'Редактирование публикации'
  }, [publication])

  useEffect(() => {
    setDraft(buildInitialDraft(publication))
    setError('')
    setGenerating(false)
    generateAbortRef.current?.abort()
  }, [publication])

  useEffect(() => () => generateAbortRef.current?.abort(), [])

  const setField = (name, value) => {
    setDraft((prev) => ({
      ...prev,
      [name]: value,
      ...(name === 'media_prompt' || name === 'format' ? { media: null } : {})
    }))
    setError('')
  }

  const validate = ({ requireMediaPrompt = false } = {}) => {
    const cleaned = {
      planned_date: draft.planned_date || '',
      topic: draft.topic.trim(),
      platform: normalizePlatform(draft.platform),
      format: normalizeFormat(draft.format),
      objective: normalizeObjective(draft.objective),
      tone: normalizeTone(draft.tone.trim(), 'expert'),
      summary: draft.summary.trim(),
      key_message: draft.key_message.trim(),
      cta: draft.cta.trim(),
      media_prompt: draft.media_prompt.trim()
    }

    if (!cleaned.planned_date) return 'Укажите дату публикации'
    if (!cleaned.topic) return 'Укажите тему'
    if (!platformChoices.includes(cleaned.platform)) {
      return 'Укажите платформу из списка'
    }
    if (!publicationFieldOptions.formats.includes(cleaned.format)) return 'Укажите формат публикации'
    if (!publicationFieldOptions.objectives.includes(cleaned.objective)) return 'Укажите цель публикации'
    if (!publicationFieldOptions.tones.includes(cleaned.tone)) return 'Укажите тон'
    if (!cleaned.summary) return 'Укажите текст поста'
    if (!cleaned.key_message) return 'Укажите ключевое сообщение'
    if (requireMediaPrompt && getMediaKind(cleaned.format) && !cleaned.media_prompt) {
      return 'Укажите промпт для изображения или видео'
    }

    return null
  }

  const buildPayload = (mediaOverride) => {
    const format = normalizeFormat(draft.format)
    const kind = getMediaKind(format)
    const media = kind ? mediaForDraft(format, mediaOverride === undefined ? draft.media : mediaOverride) : null
    return {
      planned_date: draft.planned_date,
      topic: draft.topic.trim(),
      platform: normalizePlatform(draft.platform),
      format,
      objective: normalizeObjective(draft.objective),
      tone: normalizeTone(draft.tone.trim(), 'expert'),
      summary: draft.summary.trim(),
      key_message: draft.key_message.trim(),
      cta: draft.cta.trim(),
      media_prompt: kind ? draft.media_prompt.trim() : '',
      media
    }
  }

  const handleSubmit = async () => {
    const maybeError = validate()
    if (maybeError) {
      setError(maybeError)
      return
    }
    const saved = await onSave(buildPayload())
    if (saved === false) setError('Не удалось сохранить пост')
  }

  const handleGenerate = async () => {
    const maybeError = validate({ requireMediaPrompt: true })
    if (maybeError) {
      setError(maybeError)
      return
    }
    const format = normalizeFormat(draft.format)
    const kind = getMediaKind(format)
    if (!kind) return
    generateAbortRef.current?.abort()
    const controller = new AbortController()
    generateAbortRef.current = controller
    setGenerating(true)
    setError('')
    try {
      const media = await generatePublicationMedia(
        {
          prompt: draft.media_prompt.trim(),
          format,
          platform: normalizePlatform(draft.platform)
        },
        { signal: controller.signal }
      )
      setDraft((prev) => ({ ...prev, media }))
      const saved = await onSave(buildPayload(media))
      if (saved === false) setError('Медиа готово, но сохранить пост не удалось')
    } catch (err) {
      if (err?.name === 'AbortError') return
      setError(err?.message || 'Не удалось сгенерировать медиа')
    } finally {
      if (generateAbortRef.current === controller) setGenerating(false)
    }
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
          <fieldset className="editor-form" disabled={generating}>
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
                  {platformChoices.map((p) => (
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
                <AutoResizeTextarea
                  className="editor-textarea"
                  rows="2"
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
                <AutoResizeTextarea
                  className="editor-textarea"
                  rows="6"
                  value={draft.summary}
                  onChange={(e) => setField('summary', e.target.value)}
                  placeholder="Полный текст публикации"
                />
              </label>

              <label className="editor-field editor-field-wide">
                Ключевое сообщение
                <AutoResizeTextarea
                  className="editor-textarea"
                  rows="3"
                  value={draft.key_message}
                  onChange={(e) => setField('key_message', e.target.value)}
                  placeholder="Ключевой тезис"
                />
              </label>

              <label className="editor-field editor-field-wide">
                Призыв к действию
                <AutoResizeTextarea
                  className="editor-textarea"
                  rows="2"
                  value={draft.cta}
                  onChange={(e) => setField('cta', e.target.value)}
                  placeholder="Например: Оставить заявку на демо"
                />
              </label>

              {getMediaKind(draft.format) && (
                <div className="editor-field editor-field-wide">
                  {getMediaPromptLabel(draft.format)}
                  <p className="editor-hint">
                    Это описание кадра от модели. Поправьте его и нажмите генерацию: готовый файл прикрепится к посту.
                  </p>
                  <AutoResizeTextarea
                    className="editor-textarea"
                    rows="4"
                    value={draft.media_prompt}
                    onChange={(e) => setField('media_prompt', e.target.value)}
                    placeholder="Описание сцены на английском: объект, свет, ракурс"
                  />
                  <button
                    type="button"
                    className="btn-secondary editor-generate-btn"
                    onClick={handleGenerate}
                    disabled={generating}
                  >
                    {generating
                      ? 'Генерация…'
                      : getMediaKind(draft.format) === 'video'
                        ? 'Сгенерировать видео'
                        : 'Сгенерировать изображение'}
                  </button>
                  {generating && (
                    <p className="editor-hint">
                      {getMediaKind(draft.format) === 'video'
                        ? 'Видео обычно готово за одну–две минуты.'
                        : 'Изображение обычно готово за несколько секунд.'}
                    </p>
                  )}
                  <PostMediaBlock media={mediaForDraft(draft.format, draft.media)} />
                </div>
              )}
            </div>
          </fieldset>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={generating}>
            <span>Сохранить</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default PostEditModal

