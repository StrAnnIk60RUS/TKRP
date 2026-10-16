import React from 'react'
import { Link } from 'react-router-dom'
import { isUserAuthenticated } from '../../../shared/ui/AuthGate'
import './NotFoundPage.css'

const NotFoundPage = () => {
  const loggedIn = isUserAuthenticated()

  return (
    <div className="not-found-page">
      <div className="page-header">
        <h1>404</h1>
        <p className="page-subtitle">
          Страница, которую вы ищете, не существует или была перемещена. Проверьте адрес или перейдите на одну из страниц ниже.
        </p>
      </div>
      <div className="page-content">
        <div className="not-found-links">
          {loggedIn ? (
            <Link to="/" className="not-found-link">
              ← На главную
            </Link>
          ) : (
            <>
              <Link to="/login" className="not-found-link">
                Вход
              </Link>
              <Link to="/register" className="not-found-link">
                Регистрация
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default NotFoundPage
