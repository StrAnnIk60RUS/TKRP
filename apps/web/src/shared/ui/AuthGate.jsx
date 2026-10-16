import React, { useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { getSessionToken, subscribeAuth } from '../api/authService'
import './AuthGate.css'

/**
 * Returns true if the browser holds a session token (user logged in)
 */
export function isUserAuthenticated() {
  return Boolean(getSessionToken())
}

/** Re-renders when login or logout writes the session token. */
export function useIsAuthenticated() {
  const token = useSyncExternalStore(subscribeAuth, getSessionToken, () => null)
  return Boolean(token)
}

/**
 * Gate panel shown to unauthenticated users instead of page content
 */
const AuthGate = () => {
  return (
    <div className="auth-gate">
      <h2>Войдите, чтобы продолжить</h2>
      <p className="auth-gate-subtitle">
        Чтобы создавать, редактировать и сохранять контент-планы, сначала войдите или зарегистрируйтесь.
      </p>
      <div className="auth-gate-actions">
        <Link to="/login" className="auth-gate-btn auth-gate-btn-login">
          Войти
        </Link>
        <Link to="/register" className="auth-gate-btn auth-gate-btn-register">
          Регистрация
        </Link>
      </div>
    </div>
  )
}

export default AuthGate
