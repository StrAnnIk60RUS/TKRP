import React from 'react'

const WizardNavActions = ({ goToPrevStep, goToNextStep, isFirstStep, isLastStep }) => {
  return (
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
  )
}

export default WizardNavActions

