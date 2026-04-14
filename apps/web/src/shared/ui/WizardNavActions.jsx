import React from 'react'

const statusLabels = {
  pending: 'Этап ещё не заполнен',
  in_progress: 'Этап в работе',
  completed: 'Этап заполнен',
  attention: 'Есть поля, которые стоит проверить'
}

const WizardNavActions = ({
  goToPrevStep,
  goToNextStep,
  isFirstStep,
  isLastStep,
  currentStep,
  wizardSteps,
  stepStatuses = [],
  onLastStepNext = null,
  canProceedFromLastStep = false,
  lastStepNextLabel = 'ПЕРЕЙТИ К ПЛАНУ',
  lastStepNextTitle = ''
}) => {
  const currentStatus = stepStatuses[currentStep - 1] || 'pending'
  const isLastStepRedirectEnabled = isLastStep && typeof onLastStepNext === 'function'
  const isNextDisabled = isLastStepRedirectEnabled ? !canProceedFromLastStep : isLastStep
  const nextButtonLabel = isLastStepRedirectEnabled ? lastStepNextLabel : 'ДАЛЕЕ'
  const nextButtonTitle = isLastStepRedirectEnabled ? lastStepNextTitle : ''

  const handleNextClick = () => {
    if (isLastStepRedirectEnabled) {
      if (canProceedFromLastStep) onLastStepNext()
      return
    }
    goToNextStep()
  }

  return (
    <>
      <div className="wizard-nav-summary">
        <span className="wizard-nav-summary-step">
          Текущий этап: {wizardSteps[currentStep - 1]}
        </span>
        <span className={`wizard-nav-summary-status ${currentStatus}`}>
          {statusLabels[currentStatus]}
        </span>
      </div>

      <div className="form-actions wizard-nav-actions">
        <button
          type="button"
          className="submit-button secondary"
          onClick={goToPrevStep}
          disabled={isFirstStep}
        >
          <span>НАЗАД</span>
        </button>
        <button
          type="button"
          className="submit-button primary"
          onClick={handleNextClick}
          disabled={isNextDisabled}
          title={nextButtonTitle}
        >
          <span>{nextButtonLabel}</span>
        </button>
      </div>
    </>
  )
}

export default WizardNavActions

