import React from 'react'

const WizardHeader = ({ currentStep, wizardSteps, onStepClick }) => {
  const wizardProgress = (currentStep / wizardSteps.length) * 100

  return (
    <div className="main-nav wizard-main-nav">
      <div className="progress-bar-container">
        <div className="progress-bar-fill" style={{ width: `${wizardProgress}%` }}></div>
      </div>
      <span className="progress-text">
        Шаг {currentStep} из {wizardSteps.length}: {wizardSteps[currentStep - 1]}
      </span>
      <div className="wizard-step-tabs">
        {wizardSteps.map((stepName, idx) => {
          const stepNumber = idx + 1
          const isActive = currentStep === stepNumber
          return (
            <button
              key={stepName}
              type="button"
              className={`wizard-step-tab ${isActive ? 'active' : ''}`}
              onClick={() => onStepClick(stepNumber)}
              title={`Перейти к этапу: ${stepName}`}
            >
              {stepNumber}. {stepName}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default WizardHeader

