import React, { useState } from 'react'
import { PROJECT_TYPE_OPTIONS, getFormDataByProjectType } from './projectTypeTemplates'
import { ONBOARDING_MODES } from './formConfig'
import './OnboardingMaster.css'

/**
 * Мастер онбординга: выбор режима (быстрый/расширенный) и шаблона под тип проекта.
 */
const OnboardingMaster = ({
  currentRole,
  onApplyTemplate,
  onModeHint,
  isCompact = false
}) => {
  const [projectType, setProjectType] = useState('')
  const [mode, setMode] = useState('quick')

  const handleApply = () => {
    const formData = getFormDataByProjectType(projectType)
    if (formData) {
      onApplyTemplate(formData)
    }
    if (onModeHint) {
      onModeHint(mode)
    }
  }

  const canApply = projectType && PROJECT_TYPE_OPTIONS.some((o) => o.value === projectType)

  if (isCompact) {
    return (
      <section className="onboarding-master onboarding-master-compact">
        <div className="onboarding-master-row">
          <label className="onboarding-master-label">Тип проекта</label>
          <select
            className="onboarding-master-select"
            value={projectType}
            onChange={(e) => setProjectType(e.target.value)}
          >
            <option value="">Выберите шаблон</option>
            {PROJECT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} — {o.description}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="onboarding-master-btn"
            onClick={handleApply}
            disabled={!canApply}
          >
            Применить шаблон
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="onboarding-master">
      <h3 className="onboarding-master-title">Мастер онбординга</h3>
      <p className="onboarding-master-subtitle">
        Выберите режим и шаблон — форма заполнится автоматически
      </p>

      <div className="onboarding-master-mode-row">
        <span className="onboarding-master-label">Режим</span>
        <div className="onboarding-master-mode-options">
          {Object.entries(ONBOARDING_MODES).map(([value, config]) => (
            <label
              key={value}
              className={`onboarding-master-mode-option ${mode === value ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="onboardingMode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span className="mode-label">{config.label}</span>
              <span className="mode-hint">{config.hint}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="onboarding-master-template-row">
        <label className="onboarding-master-label">Шаблон под тип проекта</label>
        <select
          className="onboarding-master-select"
          value={projectType}
          onChange={(e) => setProjectType(e.target.value)}
        >
          <option value="">Выберите тип</option>
          {PROJECT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} — {o.description}
            </option>
          ))}
        </select>
      </div>

      <div className="onboarding-master-actions">
        <button
          type="button"
          className="onboarding-master-btn primary"
          onClick={handleApply}
          disabled={!canApply}
        >
          Применить и начать
        </button>
      </div>
    </section>
  )
}

export default OnboardingMaster
