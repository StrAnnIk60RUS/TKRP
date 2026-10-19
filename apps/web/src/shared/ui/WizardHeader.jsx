import React from 'react'

const statusMeta = {
  pending: { label: 'Ожидает', className: 'is-pending' },
  in_progress: { label: 'В работе', className: 'is-in-progress' },
  completed: { label: 'Готово', className: 'is-completed' },
  attention: { label: 'Требует внимания', className: 'is-attention' }
}

const WizardHeader = ({
  currentStep,
  wizardSteps,
  onStepClick,
  stepStatuses = [],
  stepMeta = null
}) => {
  const wizardProgress = (currentStep / wizardSteps.length) * 100
  const currentStatus = statusMeta[stepStatuses[currentStep - 1]] || statusMeta.pending
  const handleStepKeyDown = (event, stepNumber) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      onStepClick(Math.min(wizardSteps.length, stepNumber + 1))
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onStepClick(Math.max(1, stepNumber - 1))
    }
  }

  return (
    <div className="main-nav wizard-main-nav">
      <div className="progress-bar-container">
        <div className="progress-bar-fill" style={{ width: `${wizardProgress}%` }}></div>
      </div>
      <div className="wizard-progress-meta">
        <span className="progress-text">
          Шаг {currentStep} из {wizardSteps.length}: {wizardSteps[currentStep - 1]}
        </span>
        <span className={`wizard-status-pill ${currentStatus.className}`}>{currentStatus.label}</span>
      </div>
      <div className="wizard-step-tabs">
        {wizardSteps.map((stepName, idx) => {
          const stepNumber = idx + 1
          const isActive = currentStep === stepNumber
          const status = statusMeta[stepStatuses[idx]] || statusMeta.pending
          return (
            <button
              key={stepName}
              type="button"
              className={`wizard-step-tab ${isActive ? 'active' : ''} ${status.className}`}
              onClick={() => onStepClick(stepNumber)}
              onKeyDown={(event) => handleStepKeyDown(event, stepNumber)}
              title={`Шаг ${stepNumber}: ${stepName} (${status.label})`}
              aria-label={`Шаг ${stepNumber}: ${stepName}`}
              aria-current={isActive ? 'step' : undefined}
            >
              {stepNumber}. {stepName}
            </button>
          )
        })}
      </div>

      {stepMeta && (
        <div className="ux-step-guide-banner" role="region" aria-label="Подсказка по текущему шагу">
          <div className="ux-step-guide-main">
            <div className="ux-step-guide-kicker">ЧТО ДЕЛАТЬ СЕЙЧАС</div>
            <h2 className="ux-step-guide-title">{stepMeta.title}</h2>
            <p className="ux-step-guide-goal">
              {stepMeta.goal}
              {stepMeta.nextHint ? ` ${stepMeta.nextHint}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default WizardHeader
