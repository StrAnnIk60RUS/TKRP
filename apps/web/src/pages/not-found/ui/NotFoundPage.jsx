import React from 'react'
import { Link } from 'react-router-dom'
import { isUserAuthenticated } from '../../../shared/ui/AuthGate'
import './NotFoundPage.css'

const NotFoundPage = () => {
  const loggedIn = isUserAuthenticated()

  return (
    <div className="not-found-page">
      <div className="not-found-card">
        <div className="not-found-badge">Ошибка 404</div>
        <div className="not-found-glitch" aria-label="404">
          404
        </div>
        <h1 className="not-found-title">Страница не найдена</h1>
        <p className="not-found-subtitle">
          Запрошенный адрес не существует или был перемещен. Возможно, ссылка устарела или в ней допущена опечатка.
        </p>
        <div className="not-found-actions">
          {loggedIn ? (
            <>
              <Link to="/" className="not-found-btn not-found-btn-primary">
                ← Создать контент-план
              </Link>
              <Link to="/content-plan" className="not-found-btn not-found-btn-secondary">
                Просмотр плана
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className="not-found-btn not-found-btn-primary">
                Войти в аккаунт
              </Link>
              <Link to="/register" className="not-found-btn not-found-btn-secondary">
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
