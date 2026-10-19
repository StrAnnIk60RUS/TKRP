import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getKpiPresentation,
  getPublicationStatusLabel,
  normalizePublicationForUi
} from '../src/features/content-plan/lib/publicationPresentation.js'

test('getKpiPresentation exposes relative score labels for UI', () => {
  const result = getKpiPresentation({
    engagement_rate: 0.034,
    conversion_potential: 0.052,
    reach_potential: 0.41,
    engagement_band: 'medium',
    conversion_band: 'high',
    reach_band: 'baseline',
    scoring_mode: 'relative_model_score'
  })

  assert.equal(result.engagementPercent, '3.4%')
  assert.equal(result.conversionBand, 'высокий')
  assert.equal(result.reachBand, 'базовый')
  assert.equal(result.isRelativeScore, true)
})

test('getPublicationStatusLabel returns human-readable labels', () => {
  assert.equal(getPublicationStatusLabel('draft'), 'Черновик')
  assert.equal(getPublicationStatusLabel('scheduled'), 'Запланирован к публикации')
  assert.equal(getPublicationStatusLabel('published'), 'Опубликован')
  assert.equal(getPublicationStatusLabel('failed'), 'Ошибка публикации')
  assert.equal(getPublicationStatusLabel('unknown'), 'Черновик')
})

test('normalizePublicationForUi preserves telegram platform, publishing status and metrics', () => {
  const pub = {
    planned_date: '2026-10-20',
    topic: 'Тест Telegram',
    platform: 'telegram',
    status: 'published',
    post_url: 'https://t.me/devflow_ai/123',
    actual_kpi: { likes: 120, views: 2400 }
  }

  const normalized = normalizePublicationForUi(pub)
  assert.equal(normalized.platform, 'telegram')
  assert.equal(normalized.status, 'published')
  assert.equal(normalized.post_url, 'https://t.me/devflow_ai/123')
  assert.equal(normalized.actual_kpi.likes, 120)
})
