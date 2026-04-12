import React, { useEffect, useMemo, useState } from 'react'
import { getCompactTopicHeading } from '../lib/publicationPresentation'

const MOBILE_LAYOUT_BREAKPOINT = 768

const HOLIDAYS = [
  ['01-01', 'Новый год'],
  ['01-07', 'Рождество'],
  ['02-23', '23 февраля'],
  ['03-08', '8 марта'],
  ['05-01', 'Праздник труда'],
  ['05-09', 'День Победы'],
  ['06-12', 'День России'],
  ['11-04', 'День народного единства']
]

const parseIsoDate = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

const toIso = (date) => date.toISOString().slice(0, 10)
const toMonthKey = (date) => date.slice(0, 7)
const toMonthLabel = (monthKey) => {
  const date = parseIsoDate(`${monthKey}-01`)
  if (!date) return monthKey
  return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const buildDateRange = (start, end) => {
  const from = parseIsoDate(start)
  const to = parseIsoDate(end)
  if (!from || !to || from > to) return []

  const result = []
  const cursor = new Date(from)
  while (cursor <= to) {
    result.push(toIso(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return result
}

const getPublicationLabel = (publication) => {
  const raw = publication.title || publication.topic || ''
  const fromTopic = raw ? getCompactTopicHeading(raw) || raw : ''
  return fromTopic || publication.key_message || publication.objective || publication.publication_id
}

const getHolidayLabel = (isoDate) => HOLIDAYS.find(([key]) => key === isoDate.slice(5))?.[1] || null

const isNarrowViewport = () => {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT
}

const PlanCalendarBoard = ({
  plan,
  publications,
  keyDates = '',
  platformOptions = [],
  onMovePublication
}) => {
  const [isMobileLayout, setIsMobileLayout] = useState(isNarrowViewport)
  const [selectedPublicationId, setSelectedPublicationId] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [targetPlatform, setTargetPlatform] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleResize = () => setIsMobileLayout(isNarrowViewport())
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const dates = useMemo(
    () => buildDateRange(plan?.planning_horizon?.start_date, plan?.planning_horizon?.end_date),
    [plan]
  )

  const platforms = useMemo(() => {
    const fromPlan = Array.isArray(plan?.platforms) ? plan.platforms : []
    const fromPublications = publications.map((item) => item?.platform).filter(Boolean)
    const unique = Array.from(new Set([...fromPlan, ...fromPublications]))
    if (unique.length) return unique
    return platformOptions
  }, [plan, publications, platformOptions])

  const publicationsByCell = useMemo(() => {
    return publications.reduce((acc, publication) => {
      const key = `${publication?.planned_date || 'no-date'}__${publication?.platform || 'no-platform'}`
      if (!acc[key]) acc[key] = []
      acc[key].push(publication)
      return acc
    }, {})
  }, [publications])

  const keyDateHints = useMemo(() => {
    if (!keyDates.trim()) return {}
    return keyDates
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((acc, line) => {
        const match = line.match(/\d{4}-\d{2}-\d{2}/)
        if (!match) return acc
        const date = match[0]
        const text = line.replace(date, '').replace(/^[-:.\s]+/, '').trim() || 'Ключевая дата'
        acc[date] = text
        return acc
      }, {})
  }, [keyDates])

  const months = useMemo(() => {
    return dates.reduce((acc, date) => {
      const key = toMonthKey(date)
      if (!acc[key]) acc[key] = []
      acc[key].push(date)
      return acc
    }, {})
  }, [dates])

  const selectedPublication = useMemo(
    () => publications.find((item) => item?.publication_id === selectedPublicationId) || null,
    [publications, selectedPublicationId]
  )

  useEffect(() => {
    if (!selectedPublication) {
      setTargetDate('')
      setTargetPlatform('')
      return
    }
    setTargetDate(selectedPublication.planned_date || dates[0] || '')
    setTargetPlatform(selectedPublication.platform || platforms[0] || '')
  }, [dates, platforms, selectedPublication])

  const handleMobileSelectPublication = (publication) => {
    if (!publication?.publication_id) return
    setSelectedPublicationId(publication.publication_id)
  }

  const handleMobileMove = () => {
    if (!selectedPublicationId || !targetDate || !targetPlatform) return
    onMovePublication(selectedPublicationId, targetDate, targetPlatform)
    setSelectedPublicationId('')
  }

  if (!plan || publications.length === 0) {
    return <p className="no-posts">Календарь станет доступен после генерации публикаций.</p>
  }

  return (
    <div className="plan-calendar">
      <div className="plan-calendar-intro">
        <div className="plan-calendar-intro-title">Зачем этот календарь</div>
        <p>
          {isMobileLayout
            ? 'Выбирайте публикацию касанием, переносите ее через форму ниже и выравнивайте контент вокруг ключевых дат.'
            : 'Используйте drag-and-drop, чтобы быстро перераспределить публикации по датам и платформам, увидеть перегрузки и выровнять контент вокруг ключевых дат.'}
        </p>
        <div className="plan-calendar-legend">
          <span className="plan-calendar-dot is-holiday">Праздник</span>
          <span className="plan-calendar-dot is-key-date">Ключевая дата</span>
        </div>
      </div>

      {isMobileLayout && (
        <div className="plan-calendar-mobile-move">
          <div className="plan-calendar-mobile-title">Перенос публикаций на мобильном</div>
          <p className="plan-calendar-mobile-copy">
            Выберите карточку публикации ниже, затем задайте новую дату и платформу и подтвердите перенос.
          </p>

          {!selectedPublication && (
            <div className="plan-calendar-mobile-empty">Сначала выберите публикацию в календаре.</div>
          )}

          {selectedPublication && (
            <div className="plan-calendar-mobile-controls">
              <div className="plan-calendar-mobile-selection">
                <span className="plan-calendar-mobile-selection-label">Выбрано</span>
                <strong>{getPublicationLabel(selectedPublication)}</strong>
                <span>
                  Сейчас: {selectedPublication.planned_date || 'без даты'} /{' '}
                  {(selectedPublication.platform || 'без платформы').toUpperCase()}
                </span>
              </div>

              <label className="plan-calendar-mobile-field">
                <span>Новая дата</span>
                <select value={targetDate} onChange={(event) => setTargetDate(event.target.value)}>
                  {dates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </label>

              <label className="plan-calendar-mobile-field">
                <span>Платформа</span>
                <select value={targetPlatform} onChange={(event) => setTargetPlatform(event.target.value)}>
                  {platforms.map((platform) => (
                    <option key={platform} value={platform}>
                      {platform.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="secondary-btn plan-calendar-mobile-action"
                onClick={handleMobileMove}
                disabled={!targetDate || !targetPlatform}
              >
                Перенести публикацию
              </button>
            </div>
          )}
        </div>
      )}

      {Object.entries(months).map(([month, monthDates]) => (
        <section key={month} className="plan-calendar-month">
          <h3>{toMonthLabel(month)}</h3>
          <div className="plan-calendar-grid">
            {monthDates.map((date) => {
              const holiday = getHolidayLabel(date)
              const keyHint = keyDateHints[date]
              return (
                <article key={date} className="plan-calendar-day">
                  <header className="plan-calendar-day-header">
                    <strong>{date}</strong>
                    {(holiday || keyHint) && (
                      <div className="plan-calendar-day-markers">
                        {holiday ? <span className="marker-holiday">{holiday}</span> : null}
                        {keyHint ? <span className="marker-key-date">{keyHint}</span> : null}
                      </div>
                    )}
                  </header>
                  <div className="plan-calendar-lanes">
                    {platforms.map((platform) => {
                      const cellKey = `${date}__${platform}`
                      const items = publicationsByCell[cellKey] || []
                      return (
                        <div
                          key={cellKey}
                          className="plan-calendar-lane"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            const publicationId = event.dataTransfer.getData('text/publication-id')
                            if (!publicationId) return
                            onMovePublication(publicationId, date, platform)
                          }}
                        >
                          <div className="plan-calendar-lane-title">{platform.toUpperCase()}</div>
                          {items.map((publication) => (
                            isMobileLayout ? (
                              <button
                                key={publication.publication_id}
                                type="button"
                                className={`plan-calendar-card plan-calendar-card-button ${
                                  selectedPublicationId === publication.publication_id ? 'is-selected' : ''
                                }`}
                                onClick={() => handleMobileSelectPublication(publication)}
                                aria-pressed={selectedPublicationId === publication.publication_id}
                              >
                                <div className="plan-calendar-card-title">{getPublicationLabel(publication)}</div>
                                <div className="plan-calendar-card-meta">{publication.format || 'format n/a'}</div>
                              </button>
                            ) : (
                              <div
                                key={publication.publication_id}
                                className="plan-calendar-card"
                                draggable
                                onDragStart={(event) =>
                                  event.dataTransfer.setData('text/publication-id', publication.publication_id)
                                }
                              >
                                <div className="plan-calendar-card-title">{getPublicationLabel(publication)}</div>
                                <div className="plan-calendar-card-meta">{publication.format || 'format n/a'}</div>
                              </div>
                            )
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export default PlanCalendarBoard
