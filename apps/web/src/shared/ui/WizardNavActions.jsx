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
  stepStatuses = []
}) => {
  const currentStatus = stepStatuses[currentStep - 1] || 'pending'

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
          onClick={goToNextStep}
          disabled={isLastStep}
        >
          <span>ДАЛЕЕ</span>
        </button>
      </div>
    </>
  )
}

export default WizardNavActions

