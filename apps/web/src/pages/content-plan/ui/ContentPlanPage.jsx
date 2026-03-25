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
import {
  getCurrentHistoryEntry,
  getCurrentPlanState,
  getPlanHistory,
  loadPlanFromHistory,
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

const matchesFilters = (publication, filters) => {
  if (filters.platform !== 'all' && publication.platform !== filters.platform) return false
  if (filters.format !== 'all' && publication.format !== filters.format) return false

  const plannedDate = publication.planned_date || ''
  if (filters.dateFrom && plannedDate && plannedDate < filters.dateFrom) return false
  if (filters.dateTo && plannedDate && plannedDate > filters.dateTo) return false

  if (filters.search.trim()) {
    const haystack = [
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

  const safePlan = useMemo(() => ensureUniquePublicationIds(contentPlan), [contentPlan])
  const publications = useMemo(
    () => (Array.isArray(safePlan?.publications) ? sortPublicationsByDate(safePlan.publications) : []),
    [safePlan]
  )
  const platforms = Array.isArray(safePlan?.platforms) ? safePlan.platforms : []
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
    const allSaturated =
      engagementValues.length >= 3 && engagementValues.every((value) => value >= 0.999)
    const avgEngagementRate = engagementValues.length
      ? engagementValues.reduce((sum, value) => sum + value, 0) / engagementValues.length
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
      engagementLikelySaturated: allSaturated,
      platformsLabel:
        Array.from(new Set(filteredPublications.map((item) => item.platform).filter(Boolean)))
          .map((item) => item.toUpperCase())
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
      optimization_valid: optimizationMeta?.stage2?.constraints_check?.valid ?? null
    }),
    [optimizationMeta, platforms, publications.length, safePlan]
  )

  const handleFilterChange = (name, value) => {
    setFilters((prev) => ({ ...prev, [name]: value }))
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
    if (!snapshot?.plan) return
    setContentPlan(ensureUniquePublicationIds(snapshot.plan))
    setOptimizationMeta(snapshot.optimization || null)
    setPlanHistory(getPlanHistory())
  }

  const baseFilename = `content_plan_${new Date().toISOString().split('T')[0]}`

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
        <p className="page-subtitle">
          ID плана: <strong>{contentPlan.plan_id || 'Неизвестно'}</strong>
        </p>
        {optimizationMeta && isDeveloper && (
          <p className="page-subtitle">
            Оптимизация: F_kp = <strong>{optimizationMeta.stage2?.f_kp ?? optimizationMeta?.f_kp ?? 'недоступен'}</strong>; ограничения:{' '}
            <strong>{optimizationMeta.stage2?.constraints_check?.valid ? 'OK' : 'есть нарушения'}</strong>
          </p>
        )}
        {optimizationMeta && !isDeveloper && (
          <p className="page-subtitle">
            План улучшен: <strong>{optimizationMeta.stage2?.constraints_check?.valid ? 'ограничения соблюдены' : 'есть ограничения для проверки'}</strong>
          </p>
        )}
      </div>

      <PlanSummaryBar summary={summary} optimizationMeta={optimizationMeta} />

      <div className="content-plan-content">
        <PlanHistoryPanel
          history={planHistory}
          onLoad={handleLoadHistoryEntry}
          currentPlanId={contentPlan.plan_id}
          currentPlanType={currentPlanType}
          currentSavedAt={currentSavedAt}
          currentSummary={currentSummary}
        />

        <section className="plan-section">
          <h2 className="section-title">Параметры плана</h2>
          <div className="plan-summary-grid">
            <div className="plan-summary-item">
              <span className="plan-summary-label">Период</span>
              <span className="plan-summary-value">
                {contentPlan.planning_horizon?.start_date || '—'} — {contentPlan.planning_horizon?.end_date || '—'}
              </span>
            </div>
            <div className="plan-summary-item">
              <span className="plan-summary-label">Платформы</span>
              <span className="plan-summary-value">
                {platforms.length ? platforms.join(', ').toUpperCase() : 'не заданы'}
              </span>
            </div>
            <div className="plan-summary-item">
              <span className="plan-summary-label">Публикаций</span>
              <span className="plan-summary-value">{publications.length}</span>
            </div>
            <div className="plan-summary-item">
              <span className="plan-summary-label">Цели KPI</span>
              <span className="plan-summary-value">
                {contentPlan.kpi_targets
                  ? `ср. вовлечённость ≥ ${((contentPlan.kpi_targets.avg_engagement_rate || 0) * 100).toFixed(
                      1
                    )}%${contentPlan.kpi_targets.avg_engagement_rate_source === 'ml_relevance_prediction' ? ' (ML)' : ''}, конверсии ≈ ${
                      contentPlan.kpi_targets.estimated_conversions || 0
                    }`
                  : 'не заданы'}
              </span>
            </div>
            {contentPlan.constraints && (
              <div className="plan-summary-item plan-summary-item-full">
                <span className="plan-summary-label">Ограничения</span>
                <span className="plan-summary-value">
                  мин. публикаций: {contentPlan.constraints.min_publications ?? '—'}
                </span>
              </div>
            )}
            {contentPlan.notes && (
              <div className="plan-summary-item plan-summary-item-full">
                <span className="plan-summary-label">Заметки</span>
                <span className="plan-summary-value">{contentPlan.notes}</span>
              </div>
            )}
          </div>
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
