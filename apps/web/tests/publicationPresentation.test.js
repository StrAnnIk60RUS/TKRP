import test from 'node:test'
import assert from 'node:assert/strict'

import { getKpiPresentation } from '../src/features/content-plan/lib/publicationPresentation.js'

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
