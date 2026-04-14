import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUserRole } from '../../../app/providers/UserRoleContext'
import PlanHistoryPanel from '../../../features/content-plan/ui/PlanHistoryPanel'
import PlanSummaryBar from '../../../features/content-plan/ui/PlanSummaryBar'
import PlanFilters from '../../../features/content-plan/ui/PlanFilters'
import PlanViewToggle from '../../../features/content-plan/ui/PlanViewToggle'
import PlanPublicationTable from '../../../features/content-plan/ui/PlanPublicationTable'
import PlanCalendarBoard from '../../../features/content-plan/ui/PlanCalendarBoard'
import PostCard from '../../../features/content-plan/ui/PostCard'
import PostEditModal from '../../../features/content-plan/ui/PostEditModal'
import PlanEditModal from '../../../features/content-plan/ui/PlanEditModal'
import { normalizePublicationForUi } from '../../../features/content-plan/lib/publicationPresentation'
import {
  getCurrentHistoryEntry,
  getCurrentPlanState,
  getPlanHistory,
  getPlanSnapshotToken,
  loadPlanFromHistory,
  removePlanFromHistory,
  savePlanSnapshot
} from '../../../features/content-plan/model/planStorage'
import { exportToExcel, exportToPdf } from '../../../shared/lib/contentPlanExport'
import { platformOptions } from '../../../features/project-form/ui/projectForm/formConfig'
import './ContentPlanPage.css'

const DEFAULT_FILTERS = {
  search: '',
  platform: 'all',
  format: 'all',
  dateFrom: '',
  dateTo: ''
}

const ensureUniquePublicationIds = (plan) => {
  if (!plan || typeof plan !== 'object') return plan
  const pubs = Array.isArray(plan.publications) ? plan.publications : []
  if (!pubs.length) return plan

  const used = new Set()
  const normalized = pubs.map((pub, idx) => {
    const base = typeof pub?.publication_id === 'string' ? pub.publication_id.trim() : ''
    let next = base || `pub_${String(idx + 1).padStart(3, '0')}`
    while (used.has(next)) next = `${next}_${idx + 1}`
    used.add(next)
    return { ...pub, publication_id: next }
  })

  return { ...plan, publications: normalized }
}

const MAX_PLAN_DISPLAY_NAME_LEN = 120

const sanitizeExportBasename = (name) => {
  const t = typeof name === 'string' ? name.trim().slice(0, 80) : ''
  if (!t) return null
  const cleaned = t.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_')
  return cleaned || null
}

const getPlatformsFromPublications = (pubs) => {
  const allowed = new Set(['vk', 'linkedin'])
  const set = new Set()
  pubs.forEach((p) => {
    if (allowed.has(p?.platform)) set.add(p.platform)
  })
  return Array.from(set)
}

const getDateTimestamp = (value) => {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

const sortPublicationsByDate = (pubs) =>
  [...pubs].sort((a, b) => getDateTimestamp(a?.planned_date) - getDateTimestamp(b?.planned_date))

const normalizeText = (value) => (typeof value === 'string' ? value.toLowerCase() : '')
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0))
const PLATFORM_UI_LABELS = { vk: 'VK', linkedin: 'LinkedIn' }
const METRICS_NORMALIZATION_TOLERANCE_RATIO = 0.05

const toFiniteNumberOrNull = (value) => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const getPlanTotalMetric = (metricName, planExpectedKpi, optimizationMeta) => {
  const fromPlan = toFiniteNumberOrNull(planExpectedKpi?.[metricName])
  if (fromPlan != null) return fromPlan
  const stage2Value = toFiniteNumberOrNull(optimizationMeta?.stage2?.[metricName])
  if (stage2Value != null) return stage2Value
  return toFiniteNumberOrNull(optimizationMeta?.[metricName])
}

const normalizeMetricByTotal = (items, rawKey, totalValue) => {
  const targetTotal = Math.max(0, Math.round(totalValue))
  if (!Array.isArray(items) || items.length === 0) return new Array(0)
  if (targetTotal === 0) return items.map(() => 0)

  const weights = items.map((item) => Math.max(0, Number(item?.[rawKey]) || 0))
  const weightSum = weights.reduce((sum, value) => sum + value, 0)
  if (weightSum <= 0) {
    const base = Math.floor(targetTotal / items.length)
    let remainder = targetTotal - base * items.length
    return items.map(() => {
      if (remainder > 0) {
        remainder -= 1
        return base + 1
      }
      return base
    })
  }

  const exact = weights.map((value) => (value / weightSum) * targetTotal)
  const floored = exact.map((value) => Math.floor(value))
  let remainder = targetTotal - floored.reduce((sum, value) => sum + value, 0)

  const rankedRemainders = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)

  for (let idx = 0; idx < rankedRemainders.length && remainder > 0; idx += 1) {
    floored[rankedRemainders[idx].index] += 1
    remainder -= 1
  }

  return floored
}

const matchesFilters = (publication, filters) => {
  if (filters.platform !== 'all' && publication.platform !== filters.platform) return false
  if (filters.format !== 'all' && publication.format !== filters.format) return false

  const plannedDate = publication.planned_date || ''
  if (filters.dateFrom && plannedDate && plannedDate < filters.dateFrom) return false
  if (filters.dateTo && plannedDate && plannedDate > filters.dateTo) return false

  if (filters.search.trim()) {
    const haystack = [
      publication.title,
      publication.topic,
      publication.key_message,
      publication.cta,
      publication.objective,
      publication.tone
    ]
      .map(normalizeText)
      .join(' ')

    if (!haystack.includes(filters.search.trim().toLowerCase())) return false
  }

  return true
}

const ContentPlanPage = () => {
  const navigate = useNavigate()
  const { isDeveloper } = useUserRole()
  const [contentPlan, setContentPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [optimizationMeta, setOptimizationMeta] = useState(null)
  const [planHistory, setPlanHistory] = useState([])
  const [publicationToEdit, setPublicationToEdit] = useState(null)
  const [isPlanEditOpen, setIsPlanEditOpen] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [viewMode, setViewMode] = useState('cards')
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const [isEditingPlanName, setIsEditingPlanName] = useState(false)
  const [planNameDraft, setPlanNameDraft] = useState('')

  const safePlan = useMemo(() => ensureUniquePublicationIds(contentPlan), [contentPlan])
  const publications = useMemo(() => {
    if (!Array.isArray(safePlan?.publications)) return []
    const stage2Publications = Array.isArray(optimizationMeta?.stage2?.publications)
      ? optimizationMeta.stage2.publications
      : []
    const stage2TotalLikes = getPlanTotalMetric(
      'predicted_total_likes',
      safePlan?.expected_kpi,
      optimizationMeta
    )
    const stage2TotalShares = getPlanTotalMetric(
      'predicted_total_shares',
      safePlan?.expected_kpi,
      optimizationMeta
    )
    const stage2TotalViews = getPlanTotalMetric(
      'predicted_total_views',
      safePlan?.expected_kpi,
      optimizationMeta
    )
    const stage2RawSums = stage2Publications.reduce(
      (acc, item) => ({
        likes: acc.likes + Math.max(0, Number(item?.predicted_likes) || 0),
        shares: acc.shares + Math.max(0, Number(item?.predicted_shares) || 0),
        views: acc.views + Math.max(0, Number(item?.predicted_views) || 0)
      }),
      { likes: 0, shares: 0, views: 0 }
    )
    const needsNormalization =
      stage2Publications.length > 0 &&
      ((stage2TotalLikes != null &&
        stage2RawSums.likes > 0 &&
        Math.abs(stage2RawSums.likes - stage2TotalLikes) >
          Math.max(1, stage2TotalLikes * METRICS_NORMALIZATION_TOLERANCE_RATIO)) ||
        (stage2TotalShares != null &&
          stage2RawSums.shares > 0 &&
          Math.abs(stage2RawSums.shares - stage2TotalShares) >
            Math.max(1, stage2TotalShares * METRICS_NORMALIZATION_TOLERANCE_RATIO)) ||
        (stage2TotalViews != null &&
          stage2RawSums.views > 0 &&
          Math.abs(stage2RawSums.views - stage2TotalViews) >
            Math.max(1, stage2TotalViews * METRICS_NORMALIZATION_TOLERANCE_RATIO)))
    const normalizedLikes = needsNormalization
      ? normalizeMetricByTotal(stage2Publications, 'predicted_likes', stage2TotalLikes ?? 0)
      : null
    const normalizedShares = needsNormalization
      ? normalizeMetricByTotal(stage2Publications, 'predicted_shares', stage2TotalShares ?? 0)
      : null
    const normalizedViews = needsNormalization
      ? normalizeMetricByTotal(stage2Publications, 'predicted_views', stage2TotalViews ?? 0)
      : null
    const stage2ById = new Map(
      stage2Publications
        .filter((item) => typeof item?.publication_id === 'string' && item.publication_id.trim())
        .map((item) => [item.publication_id.trim(), item])
    )

    const enriched = safePlan.publications.map((item, index) => {
      const publicationId =
        typeof item?.publication_id === 'string' ? item.publication_id.trim() : ''
      const stage2Match = stage2ById.get(publicationId) || stage2Publications[index] || null
      if (!stage2Match) return item

      const predictedLikes =
        normalizedLikes?.[index] ?? toFiniteNumberOrNull(stage2Match?.predicted_likes)
      const predictedShares =
        normalizedShares?.[index] ?? toFiniteNumberOrNull(stage2Match?.predicted_shares)
      const predictedViews =
        normalizedViews?.[index] ?? toFiniteNumberOrNull(stage2Match?.predicted_views)
      const hasStage2Metrics =
        predictedLikes != null || predictedShares != null || predictedViews != null
      if (!hasStage2Metrics) return item

      return {
        ...item,
        expected_kpi: {
          ...(item?.expected_kpi || {}),
          ml_predicted_likes: predictedLikes ?? item?.expected_kpi?.ml_predicted_likes ?? null,
          ml_predicted_shares: predictedShares ?? item?.expected_kpi?.ml_predicted_shares ?? null,
          ml_predicted_views: predictedViews ?? item?.expected_kpi?.ml_predicted_views ?? null,
          predicted_likes: predictedLikes ?? item?.expected_kpi?.predicted_likes ?? null,
          predicted_shares: predictedShares ?? item?.expected_kpi?.predicted_shares ?? null,
          predicted_views: predictedViews ?? item?.expected_kpi?.predicted_views ?? null,
          predicted_likes_source:
            item?.expected_kpi?.predicted_likes_source ||
            (needsNormalization ? 'stage2_post_evolution_normalized' : 'stage2_post_evolution')
        }
      }
    })

    return sortPublicationsByDate(enriched).map((item) => normalizePublicationForUi(item))
  }, [optimizationMeta, safePlan])
  const platforms = useMemo(
    () => (Array.isArray(safePlan?.platforms) ? safePlan.platforms : []),
    [safePlan]
  )
  const formatOptions = useMemo(
    () => Array.from(new Set(publications.map((item) => item?.format).filter(Boolean))),
    [publications]
  )

  useEffect(() => {
    const loadCurrentPlan = async () => {
      const state = await getCurrentPlanState()
      if (state?.plan) setContentPlan(ensureUniquePublicationIds(state.plan))
      setOptimizationMeta(state?.optimization || null)
      setPlanHistory(getPlanHistory())
      setLoading(false)
    }
    loadCurrentPlan()
  }, [])

  useEffect(() => {
    if (!downloadMenuOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setDownloadMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [downloadMenuOpen])

  const filteredPublications = useMemo(
    () => publications.filter((publication) => matchesFilters(publication, filters)),
    [filters, publications]
  )

  const groupedFilteredByPlatform = useMemo(() => {
    const platformKeys = Array.from(
      new Set(filteredPublications.map((item) => item?.platform).filter(Boolean))
    )

    return platformKeys.reduce((acc, platform) => {
      acc[platform] = filteredPublications.filter((item) => item.platform === platform)
      return acc
    }, {})
  }, [filteredPublications])

  const summary = useMemo(() => {
    const engagementValues = filteredPublications
      .map((item) => clamp01(item?.expected_kpi?.engagement_rate))
      .filter((value) => Number.isFinite(value))
    const conversionValues = filteredPublications
      .map((item) => clamp01(item?.expected_kpi?.conversion_potential))
      .filter((value) => Number.isFinite(value))
    const reachValues = filteredPublications
      .map((item) => clamp01(item?.expected_kpi?.reach_potential))
      .filter((value) => Number.isFinite(value))
    const totalPredictedLikes = filteredPublications.reduce(
      (sum, item) => sum + (toFiniteNumberOrNull(item?.expected_kpi?.ml_predicted_likes) ?? 0),
      0
    )
    const totalPredictedShares = filteredPublications.reduce(
      (sum, item) => sum + (toFiniteNumberOrNull(item?.expected_kpi?.ml_predicted_shares) ?? 0),
      0
    )
    const totalPredictedViews = filteredPublications.reduce(
      (sum, item) => sum + (toFiniteNumberOrNull(item?.expected_kpi?.ml_predicted_views) ?? 0),
      0
    )
    const postsWithMlMetricsCount = filteredPublications.filter(
      (item) =>
        toFiniteNumberOrNull(item?.expected_kpi?.ml_predicted_likes) != null ||
        toFiniteNumberOrNull(item?.expected_kpi?.ml_predicted_shares) != null ||
        toFiniteNumberOrNull(item?.expected_kpi?.ml_predicted_views) != null
    ).length
    const allSaturated =
      engagementValues.length >= 3 && engagementValues.every((value) => value >= 0.999)
    const avgEngagementRate = engagementValues.length
      ? engagementValues.reduce((sum, value) => sum + value, 0) / engagementValues.length
      : 0
    const avgConversionPotential = conversionValues.length
      ? conversionValues.reduce((sum, value) => sum + value, 0) / conversionValues.length
      : 0
    const avgReachPotential = reachValues.length
      ? reachValues.reduce((sum, value) => sum + value, 0) / reachValues.length
      : 0
    const horizonStart = safePlan?.planning_horizon?.start_date || ''
    const horizonEnd = safePlan?.planning_horizon?.end_date || ''
    const publicationsDateRange =
      filteredPublications.length > 0
        ? `${filteredPublications[0]?.planned_date || '—'} - ${
            filteredPublications[filteredPublications.length - 1]?.planned_date || '—'
          }`
        : ''

    return {
      totalCount: publications.length,
      filteredCount: filteredPublications.length,
      avgEngagementRate,
      avgConversionPotential,
      avgReachPotential,
      totalPredictedLikes,
      totalPredictedShares,
      totalPredictedViews,
      postsWithMlMetricsCount,
      engagementLikelySaturated: allSaturated,
      platformsLabel:
        Array.from(new Set(filteredPublications.map((item) => item.platform).filter(Boolean)))
          .map((item) => PLATFORM_UI_LABELS[item] || String(item).toUpperCase())
          .join(', ') || 'не указаны',
      dateRangeLabel: `${horizonStart || '—'} - ${horizonEnd || '—'}`,
      dateRangeMeta: publicationsDateRange
    }
  }, [filteredPublications, publications.length, safePlan])

  const currentPlanType = optimizationMeta ? 'optimized' : 'draft'
  const currentHistoryEntry = getCurrentHistoryEntry()
  const currentSavedAt =
    currentHistoryEntry?.id === contentPlan?.plan_id && currentHistoryEntry?.type === currentPlanType
      ? currentHistoryEntry.saved_at
      : null
  const currentSummary = useMemo(
    () => ({
      publications_count: publications.length,
      platforms,
      start_date: safePlan?.planning_horizon?.start_date || null,
      end_date: safePlan?.planning_horizon?.end_date || null,
      display_name:
        typeof safePlan?.display_name === 'string' && safePlan.display_name.trim()
          ? safePlan.display_name.trim().slice(0, MAX_PLAN_DISPLAY_NAME_LEN)
          : null,
      optimization_valid: optimizationMeta?.stage2?.constraints_check?.valid ?? null,
      optimization_messages: optimizationMeta?.stage2?.constraints_check?.messages ?? null
    }),
    [optimizationMeta, platforms, publications.length, safePlan]
  )

  const handleFilterChange = (name, value) => {
    setFilters((prev) => ({ ...prev, [name]: value }))
  }

  const beginEditPlanName = () => {
    setPlanNameDraft(
      typeof safePlan?.display_name === 'string' ? safePlan.display_name : ''
    )
    setIsEditingPlanName(true)
  }

  const cancelEditPlanName = () => {
    setIsEditingPlanName(false)
    setPlanNameDraft('')
  }

  const handleSavePlanDisplayName = async () => {
    if (!safePlan) return
    const token = getPlanSnapshotToken()
    if (!token) {
      console.error('Нет токена snapshot — нельзя сохранить название')
      return
    }
    const trimmed = planNameDraft.trim().slice(0, MAX_PLAN_DISPLAY_NAME_LEN)
    const nextPlan = { ...safePlan }
    if (trimmed) nextPlan.display_name = trimmed
    else delete nextPlan.display_name

    const type = optimizationMeta ? 'optimized' : 'draft'
    const optimization = optimizationMeta || null
    try {
      const ok = await savePlanSnapshot(nextPlan, { type, optimization, token })
      if (!ok) return
      setContentPlan(nextPlan)
      setPlanHistory(getPlanHistory())
      setIsEditingPlanName(false)
    } catch (e) {
      console.error('Не удалось сохранить название плана:', e)
    }
  }

  const handleSavePostEdit = async (nextPartialPublication) => {
    if (!publicationToEdit?.publication_id || !safePlan) return

    const nextPublications = Array.isArray(safePlan.publications)
      ? safePlan.publications.map((p) =>
          p?.publication_id === publicationToEdit.publication_id ? { ...p, ...nextPartialPublication } : p
        )
      : []

    const nextPlan = ensureUniquePublicationIds({
      ...safePlan,
      publications: nextPublications,
      platforms: getPlatformsFromPublications(nextPublications)
    })

    try {
      await savePlanSnapshot(nextPlan, { type: 'draft', optimization: null })
      setContentPlan(nextPlan)
      setOptimizationMeta(null)
      setPlanHistory(getPlanHistory())
      setPublicationToEdit(null)
    } catch (e) {
      console.error('Не удалось сохранить редактирование поста:', e)
    }
  }

  const handleMovePublication = async (publicationId, nextDate, nextPlatform) => {
    if (!safePlan || !publicationId || !nextDate || !nextPlatform) return
    const nextPublications = Array.isArray(safePlan.publications)
      ? safePlan.publications.map((item) =>
          item?.publication_id === publicationId
            ? { ...item, planned_date: nextDate, platform: nextPlatform }
            : item
        )
      : []

    const nextPlan = ensureUniquePublicationIds({
      ...safePlan,
      publications: nextPublications,
      platforms: getPlatformsFromPublications(nextPublications)
    })

    const type = optimizationMeta ? 'optimized' : 'draft'
    const optimization = optimizationMeta || null
    try {
      await savePlanSnapshot(nextPlan, { type, optimization })
      setContentPlan(nextPlan)
      setPlanHistory(getPlanHistory())
    } catch (e) {
      console.error('Не удалось сохранить изменение календаря:', e)
    }
  }

  const handleSavePlanEdit = async (nextPlanFields) => {
    if (!safePlan) return

    const nextPlan = ensureUniquePublicationIds({
      ...safePlan,
      planning_horizon: nextPlanFields.planning_horizon,
      kpi_targets: nextPlanFields.kpi_targets,
      constraints: nextPlanFields.constraints,
      notes: nextPlanFields.notes
    })

    try {
      await savePlanSnapshot(nextPlan, { type: 'draft', optimization: null })
      setContentPlan(nextPlan)
      setOptimizationMeta(null)
      setPlanHistory(getPlanHistory())
      setIsPlanEditOpen(false)
    } catch (e) {
      console.error('Не удалось сохранить редактирование параметров плана:', e)
    }
  }

  const handleLoadHistoryEntry = async (entryId, entryType, savedAt) => {
    const snapshot = await loadPlanFromHistory(entryId, entryType, savedAt)
    setPlanHistory(getPlanHistory())
    if (snapshot?.missingSnapshot) {
      window.alert(
        'Эта версия плана больше не найдена на сервере (файл удалён или среда сброшена). Запись убрана из истории.'
      )
      return
    }
    if (!snapshot?.plan) {
      window.alert('Не удалось загрузить версию плана. Проверьте соединение с API и попробуйте снова.')
      return
    }
    setContentPlan(ensureUniquePublicationIds(snapshot.plan))
    setOptimizationMeta(snapshot.optimization || null)
  }

  const handleDeleteHistoryEntry = async (entryId, entryType, savedAt) => {
    if (
      !window.confirm(
        'Удалить эту версию контент-плана из истории? Файл на сервере будет удалён, восстановить её будет нельзя.'
      )
    ) {
      return
    }
    try {
      const result = await removePlanFromHistory(entryId, entryType, savedAt)
      if (!result.ok) return
      setPlanHistory(getPlanHistory())
      if (result.hadCurrentRemoved) {
        if (result.loaded?.plan) {
          setContentPlan(ensureUniquePublicationIds(result.loaded.plan))
          setOptimizationMeta(result.loaded.optimization || null)
        } else {
          setContentPlan(null)
          setOptimizationMeta(null)
        }
      }
    } catch (e) {
      console.error('Не удалось удалить план из истории:', e)
    }
  }

  const baseFilename =
    sanitizeExportBasename(safePlan?.display_name) ||
    `content_plan_${new Date().toISOString().split('T')[0]}`

  const handleDownloadJson = () => {
    if (!contentPlan) return
    const jsonString = JSON.stringify(contentPlan, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${baseFilename}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setDownloadMenuOpen(false)
  }

  const handleDownloadExcel = () => {
    if (!contentPlan) return
    exportToExcel(contentPlan, baseFilename)
    setDownloadMenuOpen(false)
  }

  const handleDownloadPdf = async () => {
    if (!contentPlan) return
    try {
      await exportToPdf(contentPlan, { filename: baseFilename, isOptimized: !!optimizationMeta })
    } catch (e) {
      console.error('Ошибка экспорта PDF:', e)
    }
    setDownloadMenuOpen(false)
  }

  if (loading) {
    return (
      <div className="content-plan-page">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Загрузка контент-плана...</p>
        </div>
      </div>
    )
  }

  if (!contentPlan) {
    return (
      <div className="content-plan-page">
        <div className="empty-state">
          <h2>Контент-план не найден</h2>
          <p>Создайте новый контент-план на главной странице</p>
          <button className="primary-btn" onClick={() => navigate('/')}>
            Создать контент-план
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="content-plan-page">
      <div className="page-header">
        <div className="header-actions">
          <h1>{optimizationMeta ? 'Оптимизированный контент-план' : 'Черновой контент-план'}</h1>
          <div className="action-buttons">
            <button className="secondary-btn" onClick={() => navigate('/')}>
              Назад
            </button>
            <button
              className="secondary-btn"
              onClick={() => setIsPlanEditOpen(true)}
              title="Редактировать параметры плана"
            >
              Редактировать параметры
            </button>
            <div className="download-dropdown">
              <button
                type="button"
                className="primary-btn"
                onClick={() => setDownloadMenuOpen((v) => !v)}
                aria-expanded={downloadMenuOpen}
                aria-haspopup="true"
              >
                Скачать ▼
              </button>
              {downloadMenuOpen && (
                <>
                  <div
                    className="download-dropdown-backdrop"
                    onClick={() => setDownloadMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <ul className="download-dropdown-menu">
                    <li>
                      <button type="button" onClick={handleDownloadExcel}>
                        Excel (.xlsx)
                      </button>
                    </li>
                    <li>
                      <button type="button" onClick={handleDownloadPdf}>
                        PDF
                      </button>
                    </li>
                    {isDeveloper && (
                      <li>
                        <button type="button" onClick={handleDownloadJson}>
                          JSON
                        </button>
                      </li>
                    )}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="plan-page-meta">
          <div className="plan-display-name-row">
            <span className="plan-display-name-label">Название</span>
            {isEditingPlanName ? (
              <div className="plan-display-name-edit">
                <input
                  type="text"
                  className="plan-display-name-input"
                  value={planNameDraft}
                  onChange={(e) => setPlanNameDraft(e.target.value.slice(0, MAX_PLAN_DISPLAY_NAME_LEN))}
                  placeholder="Например, VK — весна 2026"
                  maxLength={MAX_PLAN_DISPLAY_NAME_LEN}
                  autoFocus
                  aria-label="Название контент-плана"
                />
                <button type="button" className="secondary-btn plan-display-name-btn" onClick={handleSavePlanDisplayName}>
                  Сохранить
                </button>
                <button type="button" className="secondary-btn plan-display-name-btn" onClick={cancelEditPlanName}>
                  Отмена
                </button>
              </div>
            ) : (
              <div className="plan-display-name-view">
                <span className="plan-display-name-value">
                  {contentPlan.display_name?.trim() ? contentPlan.display_name.trim() : 'Без названия'}
                </span>
                <button
                  type="button"
                  className="secondary-btn plan-display-name-btn"
                  onClick={beginEditPlanName}
                  title="Изменить название плана"
                >
                  Изменить
                </button>
              </div>
            )}
          </div>
          <p className="page-subtitle">
            ID плана: <strong>{contentPlan.plan_id || 'Неизвестно'}</strong>
          </p>
        </div>
      </div>

      <div className="content-plan-content">
        <PlanHistoryPanel
          history={planHistory}
          onLoad={handleLoadHistoryEntry}
          onDelete={handleDeleteHistoryEntry}
          currentPlanId={contentPlan.plan_id}
          currentPlanType={currentPlanType}
          currentSavedAt={currentSavedAt}
          currentSummary={currentSummary}
        />

        <section className="plan-section">
          <h2 className="section-title">Сводка контент-плана</h2>
          <PlanSummaryBar
            summary={summary}
            optimizationMeta={optimizationMeta}
            planExpectedKpi={safePlan?.expected_kpi}
          />
        </section>

        <PlanFilters
          filters={filters}
          platformOptions={platforms}
          formatOptions={formatOptions}
          onChange={handleFilterChange}
          onReset={() => setFilters(DEFAULT_FILTERS)}
        />

        <section className="plan-section">
          <div className="plan-publications-header">
            <div>
              <h2 className="section-title">Публикации в плане</h2>
              <p className="plan-publications-subtitle">
                Переключайтесь между карточками и таблицей, чтобы быстро найти нужную публикацию или
                отредактировать её.
              </p>
            </div>
            <PlanViewToggle
              viewMode={viewMode}
              onChange={setViewMode}
              filteredCount={filteredPublications.length}
            />
          </div>

          {filteredPublications.length === 0 && (
            <p className="no-posts">По текущим фильтрам публикаций не найдено.</p>
          )}

          {filteredPublications.length > 0 && viewMode === 'table' && (
            <PlanPublicationTable publications={filteredPublications} onEdit={setPublicationToEdit} />
          )}

          {filteredPublications.length > 0 && viewMode === 'calendar' && (
            <PlanCalendarBoard
              plan={safePlan}
              publications={filteredPublications}
              keyDates={safePlan?.notes || ''}
              platformOptions={platformOptions.map((item) => item.value)}
              onMovePublication={handleMovePublication}
            />
          )}

          {filteredPublications.length > 0 && viewMode === 'cards' && Object.keys(groupedFilteredByPlatform).length === 0 && (
            <div className="posts-list">
              {filteredPublications.map((post, idx) => (
                <PostCard
                  key={`${post.publication_id || 'pub'}_${post.platform || 'na'}_${post.planned_date || 'na'}_${idx}`}
                  post={post}
                  showPlatformField
                  onEdit={() => setPublicationToEdit(post)}
                />
              ))}
            </div>
          )}

          {filteredPublications.length > 0 && viewMode === 'cards' && Object.keys(groupedFilteredByPlatform).length > 0 && (
            <>
              {Object.entries(groupedFilteredByPlatform).map(([platform, posts]) => (
                <div key={platform} className="platform-block">
                  <h3 className="platform-name">{platform.toUpperCase()}</h3>
                  <div className="posts-list">
                    {posts.map((post, idx) => (
                      <PostCard
                        key={`${post.publication_id || 'pub'}_${platform}_${post.planned_date || 'na'}_${idx}`}
                        post={post}
                        showPlatformField={false}
                        onEdit={() => setPublicationToEdit(post)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </section>
      </div>

      {!!publicationToEdit && (
        <PostEditModal
          publication={publicationToEdit}
          onSave={handleSavePostEdit}
          onCancel={() => setPublicationToEdit(null)}
        />
      )}

      {!!isPlanEditOpen && (
        <PlanEditModal
          plan={safePlan}
          onSave={handleSavePlanEdit}
          onCancel={() => setIsPlanEditOpen(false)}
        />
      )}
    </div>
  )
}

export default ContentPlanPage
