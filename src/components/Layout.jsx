import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import './Layout.css'

const Layout = ({ children }) => {
  const location = useLocation()

  return (
    <div className="app">
      <div className="app-container">
        <header className="app-header">
          <div className="header-content">
            <h1>Автоматизация продвижения IT-проектов</h1>
            <p className="subtitle">
              Создайте контент-план для вашего IT-проекта с помощью ИИ
            </p>
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
