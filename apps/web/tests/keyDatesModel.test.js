import test from 'node:test'
import assert from 'node:assert/strict'

import {
  holidaysInRange,
  parseKeyDates,
  serializeKeyDates
} from '../src/features/project-form/ui/projectForm/keyDatesModel.js'

const range = { startDate: '2026-03-01', endDate: '2026-05-31' }

test('parseKeyDates reads Russian dates inside the plan horizon', () => {
  const parsed = parseKeyDates(
    '15 марта - запуск бета-версии, 1 апреля - вебинар по внедрению, 15 апреля - кейс-стади с первым клиентом, 1 мая - обновление функционала, 20 мая - итоговая презентация результатов.',
    range
  )

  assert.deepEqual(
    parsed.items.map((item) => item.date),
    ['2026-03-15', '2026-04-01', '2026-04-15', '2026-05-01', '2026-05-20']
  )
  assert.equal(parsed.items[0].description, 'запуск бета-версии')
  assert.equal(parsed.items[4].description, 'итоговая презентация результатов')
  assert.equal(parsed.notes, '')
})

test('parseKeyDates reads day.month entries and keeps month-only text as notes', () => {
  const dated = parseKeyDates('02.04 — старт контент-цикла; 09.04 — серия про интеграции', range)
  assert.deepEqual(dated.items, [
    { date: '2026-04-02', description: 'старт контент-цикла' },
    { date: '2026-04-09', description: 'серия про интеграции' }
  ])

  const notesOnly = parseKeyDates('Апрель — запуск обновления; Июнь — вебинар по внедрению.', range)
  assert.deepEqual(notesOnly.items, [])
  assert.match(notesOnly.notes, /Апрель — запуск обновления/)
})

test('structured key dates round-trip without splitting descriptions', () => {
  const source = '2026-04-02 — старт 09.04 внутри текста\nАпрель — запуск без дня'
  const parsed = parseKeyDates(source, range)

  assert.deepEqual(parsed.items, [{ date: '2026-04-02', description: 'старт 09.04 внутри текста' }])
  assert.equal(parsed.notes, 'Апрель — запуск без дня')
  assert.equal(serializeKeyDates(parsed.items, parsed.notes), source)
})

test('holidaysInRange returns only holidays inside the horizon', () => {
  const holidays = holidaysInRange('2026-03-01', '2026-05-31').map((item) => item.date)
  assert.deepEqual(holidays, ['2026-03-08', '2026-05-01', '2026-05-09'])
})
