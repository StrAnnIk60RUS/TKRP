import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildMonthCells,
  formatKeyDate,
  formatMonthLabel,
  holidaysInRange,
  isDateInRange,
  listMonthKeys,
  parseIsoDate,
  parseKeyDates,
  serializeKeyDates
} from './keyDatesModel.js'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const KeyDatesEditor = ({
  id = 'keyDates',
  value = '',
  startDate = '',
  endDate = '',
  disabled = false,
  onChange
}) => {
  const descriptionRefs = useRef(new Map())
  const pendingFocusDate = useRef('')
  const [activeDate, setActiveDate] = useState('')
  const [draftDate, setDraftDate] = useState('')
  const [visibleMonth, setVisibleMonth] = useState('')

  const parsed = useMemo(
    () => parseKeyDates(value, { startDate, endDate }),
    [value, startDate, endDate]
  )
  const monthKeys = useMemo(() => listMonthKeys(startDate, endDate), [startDate, endDate])
  const holidayOptions = useMemo(
    () => holidaysInRange(startDate, endDate).filter((item) => !parsed.items.some((entry) => entry.date === item.date)),
    [startDate, endDate, parsed.items]
  )
  const selectedDates = useMemo(() => new Set(parsed.items.map((item) => item.date)), [parsed.items])
  const activeMonth = monthKeys.includes(visibleMonth) ? visibleMonth : monthKeys[0] || ''
  const monthCells = useMemo(() => (activeMonth ? buildMonthCells(activeMonth) : []), [activeMonth])
  const holidayByDate = useMemo(() => {
    const map = new Map()
    holidaysInRange(startDate, endDate).forEach((item) => map.set(item.date, item.label))
    return map
  }, [startDate, endDate])

  useEffect(() => {
    if (!pendingFocusDate.current) return
    const node = descriptionRefs.current.get(pendingFocusDate.current)
    if (!node) return
    node.focus()
    pendingFocusDate.current = ''
  }, [parsed.items])

  const emit = (items, notes = parsed.notes) => {
    onChange?.(serializeKeyDates(items, notes))
  }

  const focusDate = (date) => {
    setActiveDate(date)
    pendingFocusDate.current = date
    if (date.slice(0, 7) && monthKeys.includes(date.slice(0, 7))) setVisibleMonth(date.slice(0, 7))
  }

  const addDate = (date, description = '') => {
    if (!parseIsoDate(date) || disabled) return
    const existing = parsed.items.find((item) => item.date === date)
    if (existing) {
      focusDate(date)
      return
    }
    emit([...parsed.items, { date, description }])
    focusDate(date)
  }

  const updateDescription = (date, description) => {
    emit(parsed.items.map((item) => (item.date === date ? { ...item, description } : item)))
  }

  const removeDate = (date) => {
    emit(parsed.items.filter((item) => item.date !== date))
    if (activeDate === date) setActiveDate('')
  }

  const addDraftDate = () => {
    if (!draftDate) return
    addDate(draftDate)
    setDraftDate('')
  }

  const shiftMonth = (step) => {
    const index = monthKeys.indexOf(activeMonth)
    const next = monthKeys[index + step]
    if (next) setVisibleMonth(next)
  }

  return (
    <div className="key-dates-editor">
      <p className="key-dates-lead">
        {monthKeys.length
          ? 'Сначала отметьте день в календаре периода, затем коротко опишите событие.'
          : 'Укажите даты начала и окончания плана — после этого дни можно будет выбирать в календаре.'}
      </p>

      <div className={`key-dates-layout ${monthKeys.length ? '' : 'is-single'}`}>
        <div className="key-dates-picker">
          {activeMonth && (
            <div className="key-dates-calendar">
              <div className="key-dates-calendar-nav">
                <button
                  type="button"
                  className="key-dates-nav-btn"
                  onClick={() => shiftMonth(-1)}
                  disabled={disabled || monthKeys.indexOf(activeMonth) <= 0}
                  aria-label="Предыдущий месяц"
                >
                  ‹
                </button>
                <div className="key-dates-month">{formatMonthLabel(activeMonth)}</div>
                <button
                  type="button"
                  className="key-dates-nav-btn"
                  onClick={() => shiftMonth(1)}
                  disabled={disabled || monthKeys.indexOf(activeMonth) >= monthKeys.length - 1}
                  aria-label="Следующий месяц"
                >
                  ›
                </button>
              </div>
              <div className="key-dates-weekdays" aria-hidden="true">
                {WEEKDAYS.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="key-dates-grid" role="group" aria-label="Дни месяца">
                {monthCells.map((iso, index) => {
                  if (!iso) return <span key={`empty-${index}`} className="key-dates-day is-empty" />
                  const inRange = isDateInRange(iso, startDate, endDate)
                  const selected = selectedDates.has(iso)
                  const holiday = holidayByDate.get(iso)
                  return (
                    <button
                      key={iso}
                      type="button"
                      className={`key-dates-day ${selected ? 'is-selected' : ''} ${holiday ? 'is-holiday' : ''} ${inRange ? '' : 'is-outside'}`}
                      disabled={disabled || !inRange}
                      aria-pressed={selected}
                      aria-label={`${formatKeyDate(iso)}${holiday ? `, ${holiday}` : ''}${selected ? ', выбрана' : ''}`}
                      onClick={() => addDate(iso, '')}
                    >
                      <span>{Number(iso.slice(8))}</span>
                      {holiday && <i className="key-dates-holiday-mark" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {holidayOptions.length > 0 && (
            <div className="key-dates-suggestions">
              <span className="key-dates-suggestions-label">Праздники периода</span>
              <div className="key-dates-chips">
                {holidayOptions.map((item) => (
                  <button
                    key={item.date}
                    type="button"
                    className="key-dates-chip"
                    disabled={disabled}
                    onClick={() => addDate(item.date, item.label)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="key-dates-manual">
            <label htmlFor={`${id}-draft`} className="key-dates-manual-label">
              Или укажите дату вручную
            </label>
            <div className="key-dates-manual-row">
              <input
                id={`${id}-draft`}
                type="date"
                className="form-input key-dates-date-input"
                value={draftDate}
                min={parseIsoDate(startDate) ? startDate : undefined}
                max={parseIsoDate(endDate) ? endDate : undefined}
                onChange={(event) => setDraftDate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addDraftDate()
                  }
                }}
                disabled={disabled}
              />
              <button type="button" className="key-dates-add-btn" onClick={addDraftDate} disabled={disabled || !draftDate}>
                Добавить
              </button>
            </div>
          </div>
        </div>

        <div className="key-dates-descriptions">
          <div className="key-dates-descriptions-head">
            <span>Описание выбранных дат</span>
            <span className="key-dates-count">{parsed.items.length}</span>
          </div>
          {parsed.items.length === 0 ? (
            <p className="key-dates-empty">
              {monthKeys.length
                ? 'Даты пока не выбраны. Отметьте день в календаре — поле описания появится здесь.'
                : 'Даты пока не выбраны. Добавьте дату — поле описания появится здесь.'}
            </p>
          ) : (
            <ul className="key-dates-list">
              {parsed.items.map((item) => {
                const outside = monthKeys.length > 0 && !isDateInRange(item.date, startDate, endDate)
                return (
                  <li key={item.date} className={`key-dates-item ${activeDate === item.date ? 'is-active' : ''}`}>
                    <div className="key-dates-item-date">
                      <span>{formatKeyDate(item.date)}</span>
                      {outside && <small>вне периода</small>}
                    </div>
                    <input
                      ref={(node) => {
                        if (node) descriptionRefs.current.set(item.date, node)
                        else descriptionRefs.current.delete(item.date)
                      }}
                      type="text"
                      className="form-input key-dates-description-input"
                      value={item.description}
                      placeholder="Что происходит в этот день"
                      aria-label={`Описание для ${formatKeyDate(item.date)}`}
                      disabled={disabled}
                      onFocus={() => setActiveDate(item.date)}
                      onChange={(event) => updateDescription(item.date, event.target.value)}
                    />
                    <button
                      type="button"
                      className="key-dates-remove-btn"
                      onClick={() => removeDate(item.date)}
                      disabled={disabled}
                    >
                      Убрать
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {parsed.notes.trim() && (
            <label className="key-dates-notes" htmlFor={`${id}-notes`}>
              <span>Текст без конкретного дня</span>
              <textarea
                id={`${id}-notes`}
                className="form-textarea key-dates-notes-input"
                rows="3"
                value={parsed.notes}
                disabled={disabled}
                onChange={(event) => emit(parsed.items, event.target.value)}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  )
}

export default KeyDatesEditor
