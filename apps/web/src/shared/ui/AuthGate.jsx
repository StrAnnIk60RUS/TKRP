import React from 'react'
import { Link } from 'react-router-dom'
import { getSessionToken } from '../api/authService'
import './AuthGate.css'

/**
 * Returns true if the browser holds a session token (user logged in)
 */
export function isUserAuthenticated() {
  return Boolean(getSessionToken())
}

/**
 * Gate panel shown to unauthenticated users instead of page content
 */
const AuthGate = () => {
  return (
    <div className="auth-gate">
      <h2>Log in to continue</h2>
      <p className="auth-gate-subtitle">
        To generate, edit and save content-plans, please log in or register first.
      </p>
      <div className="auth-gate-actions">
        <Link to="/login" className="auth-gate-btn auth-gate-btn-login">
          Log in
        </Link>
        <Link to="/register" className="auth-gate-btn auth-gate-btn-register">
          Register
        </Link>
      </div>
    </div>
  )
}

export default AuthGate
