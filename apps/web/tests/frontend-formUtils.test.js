import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildGaConfigFromForm,
  buildPostGaConfigFromForm,
  buildSafeFormInputForGeneration,
  buildSuggestedPrecedentQuery,
  validateFormData
} from '../src/features/project-form/ui/projectForm/formUtils.js'
import { initialFormData } from '../src/features/project-form/ui/projectForm/formConfig.js'

test('validateFormData reports required field errors', () => {
  const result = validateFormData(initialFormData)

  assert.equal(result.isValid, false)
  assert.equal(result.errors.producerName, 'Наименование производителя обязательно')
  assert.equal(result.errors.projectDescription, 'Описание проекта обязательно')
})

test('buildSafeFormInputForGeneration fills sensible defaults', () => {
  const result = buildSafeFormInputForGeneration({
    ...initialFormData,
    projectName: 'Demo'
  })

  assert.equal(result.projectName, 'Demo')
  assert.equal(result.consumerCategory, 'B2B')
  assert.deepEqual(result.contentFormats, ['text'])
  assert.deepEqual(result.platforms, ['linkedin'])
})

test('buildSuggestedPrecedentQuery includes key business signals', () => {
  const query = buildSuggestedPrecedentQuery({
    ...initialFormData,
    projectName: 'CloudAnalytics',
    projectDescription: 'AI analytics platform',
    consumerCategory: 'B2B',
    platforms: ['linkedin'],
    contentFormats: ['text'],
    projectBenefits: 'Fast ROI'
  })

  assert.match(query, /CloudAnalytics/)
  assert.match(query, /B2B/)
  assert.match(query, /linkedin/)
  assert.match(query, /Fast ROI/)
})

test('buildGaConfigFromForm parses numeric fields', () => {
  const config = buildGaConfigFromForm({
    ...initialFormData,
    evoPopulationSize: '150',
    evoGenerations: '40',
    evoTournamentSize: '4',
    evoMutationProbability: '0.2'
  })

  assert.equal(config.populationSize, 150)
  assert.equal(config.maxGenerations, 40)
  assert.equal(config.tournamentSize, 4)
  assert.equal(config.mutationProbability, 0.2)
})

test('buildPostGaConfigFromForm uses post fields and shared seed', () => {
  const config = buildPostGaConfigFromForm({
    ...initialFormData,
    evoRandomSeed: '42',
    evoPostPopulationSize: '64',
    evoPostGenerations: '30',
    evoPostMutationProbability: '0.09'
  })

  assert.equal(config.seed, '42')
  assert.equal(config.populationSize, 64)
  assert.equal(config.maxGenerations, 30)
  assert.equal(config.mutationProbability, 0.09)
})
