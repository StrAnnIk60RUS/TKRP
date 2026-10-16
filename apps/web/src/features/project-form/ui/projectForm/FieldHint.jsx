import React, { useState } from 'react'
import { getFieldHint } from './fieldHints'
import './FieldHint.css'

/**
 * Иконка подсказки к полю GA/ML с тултипом.
 */
const FieldHint = ({ fieldName }) => {
  const [showFull, setShowFull] = useState(false)
  const short = getFieldHint(fieldName, false)
  const full = getFieldHint(fieldName, true)

  if (!short && !full) return null

  return (
    <span className="field-hint-wrapper">
      <button
        type="button"
        className="field-hint-trigger"
        onClick={() => setShowFull((v) => !v)}
        onBlur={() => setTimeout(() => setShowFull(false), 150)}
        aria-label="Подсказка"
        title={short}
      >
        ?
      </button>
      {showFull && full && (
        <span className="field-hint-popover" role="tooltip">
          {full}
        </span>
      )}
    </span>
  )
}

export default FieldHint
