import { useLayoutEffect, useRef } from 'react'

const fitTextarea = (el) => {
  if (!el) return
  el.style.height = 'auto'
  const max = Number.parseFloat(window.getComputedStyle(el).maxHeight)
  const border = el.offsetHeight - el.clientHeight
  const full = el.scrollHeight + border
  const capped = Number.isFinite(max) ? Math.min(full, max) : full
  el.style.height = `${capped}px`
  el.style.overflowY = Number.isFinite(max) && full > max + 1 ? 'auto' : 'hidden'
}

const AutoResizeTextarea = ({ onInput, value, ...props }) => {
  const ref = useRef(null)

  useLayoutEffect(() => {
    fitTextarea(ref.current)
  }, [value])

  return (
    <textarea
      {...props}
      ref={ref}
      value={value}
      onInput={(event) => {
        fitTextarea(event.currentTarget)
        onInput?.(event)
      }}
    />
  )
}

export default AutoResizeTextarea
