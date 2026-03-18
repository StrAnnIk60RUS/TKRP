import React from 'react'

const statusMeta = {
  pending: { label: 'Пусто', className: 'is-pending' },
  in_progress: { label: 'В процессе', className: 'is-in-progress' },
  completed: { label: 'Готово', className: 'is-completed' },
  attention: { label: 'Нужно проверить', className: 'is-attention' }
}

const WizardHeader = ({ currentStep, wizardSteps, onStepClick, stepStatuses = [] }) => {
  const wizardProgress = (currentStep / wizardSteps.length) * 100
  const currentStatus = statusMeta[stepStatuses[currentStep - 1]] || statusMeta.pending

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
              title={`Перейти к этапу: ${stepName}`}
            >
              <span className="wizard-step-number">{stepNumber}.</span> {stepName}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default WizardHeader

