import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useUserRole } from '../../app/providers/UserRoleContext'
import { ROLES, ROLE_MODE_LABELS } from '../../app/providers/UserRoleContext'
import './Layout.css'

const Layout = ({ children }) => {
  const location = useLocation()
  const { role, setRole } = useUserRole()
  const [theme, setTheme] = useState('dark')

  useEffect(() => {
    const saved = localStorage.getItem('theme')
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved)
    }
  }, [])

  useEffect(() => {
    document.body.classList.remove('theme-light', 'theme-dark')
    document.body.classList.add(`theme-${theme}`)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  return (
    <div className="app">
      <div className="app-container">
        <header className="app-header">
          <div className="header-top-row">
            <div className="header-content">
              <h1>Автоматизация продвижения IT-проектов</h1>
              <p className="subtitle">
                Создайте контент-план для вашего IT-проекта с помощью ИИ
              </p>
            </div>
            <div className="header-controls">
              <div className="role-selector-block">
                <select
                  className="role-select"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  title="Роль: разный уровень детализации и число шагов"
                  aria-describedby="role-mode-hint"
                >
                  <option value={ROLES.SMM}>Маркетолог (SMM) — быстрый, 4 шага</option>
                  <option value={ROLES.ANALYST}>Аналитик — расширенный, 5 шагов + GA/ML</option>
                  <option value={ROLES.DEVELOPER}>Разработчик — полный, обход чеклиста</option>
                </select>
                <div id="role-mode-hint" className="role-mode-hint">
                  {ROLE_MODE_LABELS[role]?.short}: {ROLE_MODE_LABELS[role]?.detail}
                </div>
              </div>
              <button
                type="button"
                className="theme-toggle-btn"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              </button>
            </div>
          </div>
          <nav className="main-nav">
            <Link 
              to="/" 
              className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
            >
              Создать контент-план
            </Link>
            <Link 
              to="/content-plan" 
              className={`nav-link ${location.pathname === '/content-plan' ? 'active' : ''}`}
            >
              Просмотр контент-плана
            </Link>
          </nav>
        </header>
        <main className="app-main">
          {children}
        </main>
      </div>
    </div>
  )
}

export default Layout
