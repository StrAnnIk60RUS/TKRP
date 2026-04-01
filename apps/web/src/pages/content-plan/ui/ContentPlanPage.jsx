import React, { useState, useEffect, useMemo, useCallback } from 'react'
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
  getPlanSnapshotToken,
  loadPlanFromHistory,
  openSnapshotByToken,
  removePlanFromHistory,
  savePlanSnapshot
} from '../../../features/content-plan/model/planStorage'
import { listPlanSnapshotsFromServer } from '../../../shared/api/enrichmentService'
import { exportToExcel, exportToPdf } from '../../../shared/lib/contentPlanExport'
import { platformOptions } from '../../../features/project-form/ui/projectForm/formConfig'
import './ContentPlanPage.css'

import ContentPlanEmptyState from '../../../features/content-plan/ui/ContentPlanEmptyState'
import {
  DEFAULT_FILTERS,
  MAX_PLAN_DISPLAY_NAME_LEN,
  ensureUniquePublicationIds,
  sanitizeExportBasename,
  getPlatformsFromPublications,
  sortPublicationsByDate,
  clamp01,
  formatSavedAt,
  formatSavedPlatforms,
  extractSnapshotTokenFromInput,
  matchesFilters
} from '../../../features/content-plan/lib/contentPlanPageUtils'

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
  const [savedSnapshots, setSavedSnapshots] = useState([])
  const [savedListLoading, setSavedListLoading] = useState(false)
  const [savedListError, setSavedListError] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [openingToken, setOpeningToken] = useState(false)
  const [savedPlansLibraryOpen, setSavedPlansLibraryOpen] = useState(false)
  const [savedPlansFilter, setSavedPlansFilter] = useState('')

  const safePlan = useMemo(() => ensureUniquePublicationIds(contentPlan), [contentPlan])
  const publications = useMemo(
    () => (Array.isArray(safePlan?.publications) ? sortPublicationsByDate(safePlan.publications) : []),
    [safePlan]
  )
  const platforms = useMemo(
    () => (Array.isArray(safePlan?.platforms) ? safePlan.platforms : []),
    [safePlan?.platforms]
  )
  const formatOptions = useMemo(
    () => Array.from(new Set(publications.map((item) => item?.format).filter(Boolean))),
    [publications]
  )

  const relatedPlanHistory = useMemo(() => {
    if (!Array.isArray(planHistory) || planHistory.length === 0) return []
    const pid = safePlan?.plan_id
    if (pid) {
      return planHistory.filter((h) => h?.id === pid)
    }
    const token = getPlanSnapshotToken()
    if (token) {
      return planHistory.filter((h) => h?.snapshot_token === token)
    }
    return []
  }, [planHistory, safePlan?.plan_id])

  const filteredSavedSnapshots = useMemo(() => {
    const q = savedPlansFilter.trim().toLowerCase()
    if (!q) return savedSnapshots
    return savedSnapshots.filter((item) => {
      const hay = [
        item.summary?.display_name,
        item.summary?.plan_id,
        item.token,
        item.summary?.start_date,
        item.summary?.end_date,
        formatSavedAt(item.saved_at),
        formatSavedPlatforms(item.summary?.platforms)
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }, [savedSnapshots, savedPlansFilter])

  const refreshSavedSnapshots = useCallback(async () => {
    setSavedListLoading(true)
    setSavedListError(false)
    try {
      const res = await listPlanSnapshotsFromServer()
      setSavedSnapshots(Array.isArray(res?.snapshots) ? res.snapshots : [])
    } catch (e) {
      console.error('Не удалось загрузить список сохранённых планов:', e)
      setSavedListError(true)
      setSavedSnapshots([])
    } finally {
      setSavedListLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadCurrentPlan = async () => {
      const tokenFromUrl = new URLSearchParams(window.location.search).get('token')?.trim()
      if (tokenFromUrl) {
        const opened = await openSnapshotByToken(tokenFromUrl)
        if (cancelled) return
        if (opened?.plan) {
          setContentPlan(ensureUniquePublicationIds(opened.plan))
          setOptimizationMeta(opened.optimization || null)
          setPlanHistory(getPlanHistory())
          navigate('/content-plan', { replace: true })
          setLoading(false)
          return
        }
        if (opened?.missingSnapshot) {
          window.alert('Снимок по ссылке не найден на сервере.')
          navigate('/content-plan', { replace: true })
        }
      }
      const state = await getCurrentPlanState()
      if (cancelled) return
      if (state?.plan) setContentPlan(ensureUniquePublicationIds(state.plan))
      setOptimizationMeta(state?.optimization || null)
      setPlanHistory(getPlanHistory())
      setLoading(false)
    }
    loadCurrentPlan()
    return () => {
      cancelled = true
    }
  }, [navigate])

  useEffect(() => {
    if (loading || contentPlan != null) return
    refreshSavedSnapshots()
  }, [loading, contentPlan, refreshSavedSnapshots])

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
      const saved = await savePlanSnapshot(nextPlan, { type, optimization, token })
      if (!saved.ok) {
        window.alert(saved.message)
        return
      }
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

    const token = getPlanSnapshotToken()
    try {
      const saved = await savePlanSnapshot(nextPlan, {
        type: 'draft',
        optimization: null,
        ...(token ? { token } : {})
      })
      if (!saved.ok) {
        window.alert(saved.message)
        return
      }
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
    const token = getPlanSnapshotToken()
    try {
      const saved = await savePlanSnapshot(nextPlan, {
        type,
        optimization,
        ...(token ? { token } : {})
      })
      if (!saved.ok) {
        window.alert(saved.message)
        return
      }
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

    const token = getPlanSnapshotToken()
    try {
      const saved = await savePlanSnapshot(nextPlan, {
        type: 'draft',
        optimization: null,
        ...(token ? { token } : {})
      })
      if (!saved.ok) {
        window.alert(saved.message)
        return
      }
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
    if (snapshot?.networkError) {
      window.alert(snapshot.message)
      return
    }
    if (!snapshot?.plan) {
      window.alert('Не удалось загрузить версию плана.')
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
      if (result.loadNetworkError) {
        window.alert(
          'Текущая версия убрана из истории, но следующий план не загрузился: ' + result.loadNetworkError
        )
      }
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

  const handleOpenSnapshotByToken = async (rawToken) => {
    const token = extractSnapshotTokenFromInput(typeof rawToken === 'string' ? rawToken : '')
    if (!token) {
      window.alert('Вставьте рабочую ссылку на план или скопированный из неё идентификатор (32 символа).')
      return
    }
    setOpeningToken(true)
    try {
      const result = await openSnapshotByToken(token)
      if (result?.missingSnapshot) {
        window.alert('Снимок не найден на сервере.')
        await refreshSavedSnapshots()
        return
      }
      if (result?.networkError) {
        window.alert(result.message)
        return
      }
      if (!result?.plan) {
        window.alert('Не удалось открыть план.')
        return
      }
      setContentPlan(ensureUniquePublicationIds(result.plan))
      setOptimizationMeta(result.optimization || null)
      setPlanHistory(getPlanHistory())
      setTokenInput('')
      setSavedPlansLibraryOpen(false)
    } finally {
      setOpeningToken(false)
    }
  }

  const handleToggleSavedLibrary = () => {
    setSavedPlansLibraryOpen((prev) => {
      const next = !prev
      if (next) refreshSavedSnapshots()
      return next
    })
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

  const currentSnapshotToken = getPlanSnapshotToken()

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
      <ContentPlanEmptyState
        navigate={navigate}
        savedSnapshots={savedSnapshots}
        savedListLoading={savedListLoading}
        savedListError={savedListError}
        refreshSavedSnapshots={refreshSavedSnapshots}
        savedPlansFilter={savedPlansFilter}
        onSavedPlansFilterChange={setSavedPlansFilter}
        filteredSavedSnapshots={filteredSavedSnapshots}
        tokenInput={tokenInput}
        onTokenInputChange={setTokenInput}
        openingToken={openingToken}
        onOpenByToken={handleOpenSnapshotByToken}
        formatSavedAt={formatSavedAt}
        formatSavedPlatforms={formatSavedPlatforms}
      />
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

      <div className="saved-plans-library-bar">
        <button type="button" className="secondary-btn" onClick={handleToggleSavedLibrary}>
          {savedPlansLibraryOpen ? 'Скрыть список планов' : 'Все сохранённые планы'}
        </button>
      </div>

      {savedPlansLibraryOpen && (
        <section className="plan-section saved-plans-library-panel" aria-label="Сохранённые планы на сервере">
          <p className="saved-plans-intro saved-plans-intro-compact">
            Поиск по названию, дате, платформам или ID плана. По ссылке — в блоке ниже списка.
          </p>
          {savedListLoading && <p className="saved-plans-hint">Загрузка списка…</p>}
          {savedListError && (
            <div className="saved-plans-error-row">
              <p className="saved-plans-error">Не удалось загрузить список. Проверьте API (порт 3001).</p>
              <button type="button" className="secondary-btn" onClick={() => refreshSavedSnapshots()}>
                Повторить
              </button>
            </div>
          )}
          {!savedListLoading && !savedListError && savedSnapshots.length > 0 && (
            <div className="saved-plans-search-row saved-plans-search-row-inline">
              <input
                type="search"
                className="saved-plans-search-input"
                value={savedPlansFilter}
                onChange={(e) => setSavedPlansFilter(e.target.value)}
                placeholder="Поиск по названию, дате, платформам или ID плана"
                aria-label="Поиск среди сохранённых планов"
              />
            </div>
          )}
          {!savedListLoading && !savedListError && savedSnapshots.length === 0 && (
            <p className="saved-plans-hint">Нет сохранённых снимков.</p>
          )}
          {!savedListLoading &&
            !savedListError &&
            savedSnapshots.length > 0 &&
            filteredSavedSnapshots.length === 0 && (
              <p className="saved-plans-hint">Ничего не найдено по запросу.</p>
            )}
          {!savedListLoading && !savedListError && filteredSavedSnapshots.length > 0 && (
            <div className="precedent-cards saved-plans-cards">
              {filteredSavedSnapshots.map((item) => {
                const isCurrent = item.token === currentSnapshotToken
                return (
                  <div
                    key={item.token}
                    className={`precedent-card plan-history-card ${isCurrent ? 'is-current' : ''}`}
                  >
                    <div className="precedent-card-header">
                      <span
                        className="precedent-card-title"
                        title={String(item.summary?.display_name || item.summary?.plan_id || item.token)}
                      >
                        {item.summary?.display_name?.trim() || item.summary?.plan_id || 'Сохранённый план'}
                      </span>
                    </div>
                    <div className="precedent-card-body">
                      <div>Сохранён: {formatSavedAt(item.saved_at)}</div>
                      <div>Публикаций: {item.summary?.publications_count ?? 0}</div>
                      <div>Платформы: {formatSavedPlatforms(item.summary?.platforms) || 'не указаны'}</div>
                    </div>
                    {isCurrent && <div className="plan-history-current-badge">Открыт сейчас</div>}
                    <div className="plan-history-card-actions">
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={openingToken || isCurrent}
                        onClick={() => handleOpenSnapshotByToken(item.token)}
                      >
                        {isCurrent ? 'Открыт' : 'Открыть'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <details className="saved-plans-link-details saved-plans-link-details-inline">
            <summary>Открыть по ссылке из браузера</summary>
            <div className="saved-plans-token-row saved-plans-token-row-inline saved-plans-token-row-details">
              <input
                type="text"
                className="saved-plans-token-input"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Ссылка или идентификатор из адресной строки"
                disabled={openingToken}
                aria-label="Ссылка на сохранённый план"
              />
              <button
                type="button"
                className="secondary-btn"
                disabled={openingToken || !tokenInput.trim()}
                onClick={() => handleOpenSnapshotByToken(tokenInput)}
              >
                {openingToken ? 'Открытие…' : 'Открыть план'}
              </button>
            </div>
          </details>
        </section>
      )}

      <PlanSummaryBar
        summary={summary}
        optimizationMeta={optimizationMeta}
        planExpectedKpi={safePlan?.expected_kpi}
      />

      <div className="content-plan-content">
        <PlanHistoryPanel
          history={relatedPlanHistory}
          onLoad={handleLoadHistoryEntry}
          onDelete={handleDeleteHistoryEntry}
          currentPlanId={contentPlan.plan_id}
          currentPlanType={currentPlanType}
          currentSavedAt={currentSavedAt}
          currentSummary={currentSummary}
          subtitle="Здесь только версии текущего плана (один и тот же идентификатор плана в данных). Чтобы открыть другой сохранённый план, используйте «Все сохранённые планы» выше."
          emptyMessage="Для этого плана в локальной истории нет других версий. Другие снимки на диске откройте через «Все сохранённые планы»."
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
