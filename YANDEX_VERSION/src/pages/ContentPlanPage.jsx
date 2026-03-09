import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './ContentPlanPage.css'

const ContentPlanPage = () => {
  const navigate = useNavigate()
  const [contentPlan, setContentPlan] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Загрузка контент-плана из localStorage или API
    const savedPlan = localStorage.getItem('currentContentPlan')
    if (savedPlan) {
      try {
        setContentPlan(JSON.parse(savedPlan))
      } catch (e) {
        console.error('Ошибка загрузки контент-плана:', e)
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

  return (
    <div className="content-plan-page">
      <div className="page-header">
        <div className="header-actions">
          <h1>Контент-план</h1>
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
          Сгенерированный контент-план для проекта: <strong>{contentPlan.project_input?.it_project_info?.name || 'Неизвестно'}</strong>
        </p>
      </div>

      <div className="content-plan-content">
        {/* Онтология */}
        {contentPlan.content_plan?.ontology && (
          <section className="plan-section">
            <h2 className="section-title">Онтология</h2>
            <div className="ontology-view">
              <div className="ontology-item">
                <h3>Классы</h3>
                <ul>
                  {contentPlan.content_plan.ontology.classes?.map((cls, idx) => (
                    <li key={idx}>{cls}</li>
                  ))}
                </ul>
              </div>
              <div className="ontology-item">
                <h3>Подклассы</h3>
                <ul>
                  {contentPlan.content_plan.ontology.subclasses?.map((sub, idx) => (
                    <li key={idx}>{sub}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        {/* Платформы и посты */}
        {contentPlan.content_plan?.platforms && (
          <section className="plan-section">
            <h2 className="section-title">Публикации по платформам</h2>
            {Object.entries(contentPlan.content_plan.platforms).map(([platform, data]) => (
              <div key={platform} className="platform-block">
                <h3 className="platform-name">{platform.toUpperCase()}</h3>
                {data.posts && data.posts.length > 0 ? (
                  <div className="posts-list">
                    {data.posts.map((post, idx) => (
                      <div key={idx} className="post-card">
                        <div className="post-header">
                          <span className="post-date">
                            {new Date(post.publication_date).toLocaleDateString('ru-RU')}
                          </span>
                          <span className="post-category">{post.category}</span>
                        </div>
                        <div className="post-content">{post.content}</div>
                        {post.estimated_metrics && (
                          <div className="post-metrics">
                            <span>Лайки: {post.estimated_metrics.likes}</span>
                            <span>Просмотры: {post.estimated_metrics.views}</span>
                            <span>Вовлеченность: {(post.estimated_metrics.engagement_rate * 100).toFixed(2)}%</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="no-posts">Посты не сгенерированы</p>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Анализ */}
        {contentPlan.content_plan?.analysis && (
          <section className="plan-section">
            <h2 className="section-title">Анализ конкурентов</h2>
            <div className="analysis-view">
              <pre>{JSON.stringify(contentPlan.content_plan.analysis, null, 2)}</pre>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export default ContentPlanPage
