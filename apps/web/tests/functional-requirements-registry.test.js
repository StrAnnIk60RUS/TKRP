/**
 * Матрица функциональных требований (табл. 2.1, п. 5.1, UI-сценарии).
 * Каждый тест соответствует одной строке реестра FR_REQUIREMENTS.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { FR_REQUIREMENTS } from '../../../tools/testing/fr-requirements.mjs'
import { runFrCheck } from '../../../tools/testing/fr-checks.mjs'

for (const req of FR_REQUIREMENTS) {
  const label = `[${req.id}] ${req.role} — ${req.title}`

  test(label, () => {
    const result = runFrCheck(req.check)
    assert.equal(result.ok, true, `${req.id} passed`)
  })
}

test('[FR-MATRIX] реестр содержит все блоки табл. 2.1 и п. 5.1', () => {
  const ids = FR_REQUIREMENTS.map((r) => r.id)
  assert.ok(ids.includes('FR-2.1-01'))
  assert.ok(ids.includes('FR-2.1-19'))
  assert.ok(ids.includes('FR-5.1-10'))
  assert.ok(ids.includes('FR-UI-SC-06'))
  assert.equal(FR_REQUIREMENTS.length, 35)
})
