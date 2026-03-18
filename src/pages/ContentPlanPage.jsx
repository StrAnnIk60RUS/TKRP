import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import './ContentPlanPage.css'

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

const PostCard = ({ post, showPlatformField }) => {
  const plannedDateLabel = post.planned_date
    ? new Date(post.planned_date).toLocaleDateString('ru-RU')
    : 'Дата не указана'

  return (
    <div className="post-card">
      <div className="post-header">
        <span className="post-date">{plannedDateLabel}</span>
        <span className="post-category">{post.topic || 'Без темы'}</span>
      </div>
      <div className="post-content">
        {showPlatformField && <div><strong>Платформа:</strong> {post.platform || 'не указана'}</div>}
        <div><strong>Формат:</strong> {post.format || 'не указан'}</div>
        <div><strong>Цель:</strong> {post.objective || 'не указана'}</div>
        <div><strong>Тон:</strong> {post.tone || 'не указан'}</div>
        <div><strong>Ключевое сообщение:</strong> {post.key_message || 'не задано'}</div>
        <div><strong>CTA:</strong> {post.cta || 'не задано'}</div>
      </div>
      {post.expected_kpi && (
        <div className="post-metrics">
          <span>
            Вовлечённость:{' '}
            {((post.expected_kpi.engagement_rate || 0) * 100).toFixed(1)}%
            {post.expected_kpi.engagement_rate_source === 'ml_relevance_prediction' ? ' (ML)' : ''}
          </span>
          <span>
            Потенциал конверсии:{' '}
            {((post.expected_kpi.conversion_potential || 0) * 100).toFixed(1)}%
          </span>
          <span>
            Потенциал охвата:{' '}
            {((post.expected_kpi.reach_potential || 0) * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}

const ContentPlanPage = () => {
  const navigate = useNavigate()
  const [contentPlan, setContentPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [optimizationMeta, setOptimizationMeta] = useState(null)
  const safePlan = useMemo(() => ensureUniquePublicationIds(contentPlan), [contentPlan])
  const publications = Array.isArray(safePlan?.publications) ? safePlan.publications : []
  const platforms = Array.isArray(safePlan?.platforms) ? safePlan.platforms : []

  useEffect(() => {
    // Загрузка чернового контент-плана из localStorage
    const savedPlan = localStorage.getItem('currentContentPlan')
    if (savedPlan) {
      try {
        const parsed = JSON.parse(savedPlan)
        setContentPlan(ensureUniquePublicationIds(parsed))
      } catch (e) {
        console.error('Ошибка загрузки контент-плана:', e)
      }
    }

    const savedOptimization = localStorage.getItem('currentContentPlanOptimization')
    if (savedOptimization) {
      try {
        setOptimizationMeta(JSON.parse(savedOptimization))
      } catch (e) {
        console.error('Ошибка загрузки метаданных оптимизации:', e)
      }
    }
    setLoading(false)
  }, [])

  const handleDownload = () => {
    if (!contentPlan) return

    const jsonString = JSON.stringify(contentPlan, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `content_plan_${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
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

  const groupedByPlatform = platforms.reduce((acc, platform) => {
    acc[platform] = publications
      .filter((p) => p.platform === platform)
      .sort((a, b) => {
        const da = a.planned_date ? new Date(a.planned_date).getTime() : 0
        const db = b.planned_date ? new Date(b.planned_date).getTime() : 0
        return da - db
      })
    return acc
  }, {})

  return (
    <div className="content-plan-page">
      <div className="page-header">
        <div className="header-actions">
          <h1>{optimizationMeta ? 'Оптимизированный контент-план' : 'Черновой контент-план'}</h1>
          <div className="action-buttons">
            <button className="secondary-btn" onClick={() => navigate('/')}>
              Назад
            </button>
            <button className="primary-btn" onClick={handleDownload}>
              Скачать JSON
            </button>
          </div>
        </div>
        <p className="page-subtitle">
          ID плана: <strong>{contentPlan.plan_id || 'Неизвестно'}</strong>
        </p>
        {optimizationMeta && (
          <p className="page-subtitle">
            Оптимизация: F_kp = <strong>{optimizationMeta.stage2?.f_kp ?? '—'}</strong>; ограничения:{' '}
            <strong>{optimizationMeta.stage2?.constraints_check?.valid ? 'OK' : 'есть нарушения'}</strong>
          </p>
        )}
      </div>

      <div className="content-plan-content">
        {/* Общая информация по плану (человекочитаемая сводка) */}
        <section className="plan-section">
          <h2 className="section-title">Параметры плана</h2>
          <div className="plan-summary-grid">
            <div className="plan-summary-item">
              <span className="plan-summary-label">Период:</span>
              <span className="plan-summary-value">
                {contentPlan.planning_horizon?.start_date || '—'} —{' '}
                {contentPlan.planning_horizon?.end_date || '—'}
              </span>
            </div>
            <div className="plan-summary-item">
              <span className="plan-summary-label">Платформы:</span>
              <span className="plan-summary-value">
                {platforms.length ? platforms.join(', ').toUpperCase() : 'не заданы'}
              </span>
            </div>
            <div className="plan-summary-item">
              <span className="plan-summary-label">Публикаций:</span>
              <span className="plan-summary-value">
                {publications.length}
              </span>
            </div>
            <div className="plan-summary-item">
              <span className="plan-summary-label">Цели KPI:</span>
              <span className="plan-summary-value">
                {contentPlan.kpi_targets
                  ? `ср. вовлечённость ≥ ${
                      ((contentPlan.kpi_targets.avg_engagement_rate || 0) * 100).toFixed(1)
                    }%${contentPlan.kpi_targets.avg_engagement_rate_source === 'ml_relevance_prediction' ? ' (ML)' : ''}, конверсии ≈ ${
                      contentPlan.kpi_targets.estimated_conversions || 0
                    }`
                  : 'не заданы'}
              </span>
            </div>
            {contentPlan.constraints && (
              <div className="plan-summary-item plan-summary-item-full">
                <span className="plan-summary-label">Ограничения:</span>
                <span className="plan-summary-value">
                  мин. публикаций: {contentPlan.constraints.min_publications ?? '—'};
                  {' '}общий бюджет: {contentPlan.constraints.total_budget ?? '—'};
                  {' '}макс. стоимость поста: {contentPlan.constraints.max_cost_per_publication ?? '—'}
                </span>
              </div>
            )}
            {contentPlan.notes && (
              <div className="plan-summary-item plan-summary-item-full">
                <span className="plan-summary-label">Заметки:</span>
                <span className="plan-summary-value">
                  {contentPlan.notes}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Список публикаций как контент-календарь по платформам */}
        <section className="plan-section">
          <h2 className="section-title">Публикации в плане</h2>
          {publications.length === 0 && (
            <p className="no-posts">В черновом плане пока нет публикаций.</p>
          )}
          {publications.length > 0 && platforms.length === 0 && (
            <div className="posts-list">
              {publications.map((post, idx) => (
                <PostCard
                  key={`${post.publication_id || 'pub'}_${post.platform || 'na'}_${post.planned_date || 'na'}_${idx}`}
                  post={post}
                  showPlatformField
                />
              ))}
            </div>
          )}

          {platforms.length > 0 && (
            <>
              {platforms.map((platform) => {
                const posts = groupedByPlatform[platform] || []
                if (!posts.length) return null
                return (
                  <div key={platform} className="platform-block">
                    <h3 className="platform-name">{platform.toUpperCase()}</h3>
                    <div className="posts-list">
                      {posts.map((post, idx) => (
                        <PostCard
                          key={`${post.publication_id || 'pub'}_${platform}_${post.planned_date || 'na'}_${idx}`}
                          post={post}
                          showPlatformField={false}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default ContentPlanPage
