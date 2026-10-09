import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerUser } from '../../../shared/api/authService'
import './AuthPage.css'

const RegisterPage = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState('info')

  const submit = async () => {
    if (!username || !password) {
      setMessage('Fill in username and password')
      setMessageKind('error')
      return
    }
    try {
      const result = await registerUser(username, password)
      setMessage(`Registration successful. Welcome, ${result.user.username}!`)
      setMessageKind('success')
      setUsername('')
      setPassword('')
      navigate('/')
    } catch (error) {
      setMessage(error.message || 'Registration failed')
      setMessageKind('error')
    }
  }

  return (
    <div className="auth-page">
      <div className="page-header">
        <h1>Registration</h1>
        <p className="page-subtitle">
          Create an account to keep your drafts and plan snapshots private
        </p>
      </div>
      <div className="page-content">
        <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
          <label className="auth-field-label" htmlFor="auth-username">
            Username
          </label>
          <input
            className="auth-username-input"
            type="text"
            name="auth-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Letters, digits, _ . @ - (3-64)"
          />
          <label className="auth-field-label" htmlFor="auth-password">
            Password
          </label>
          <input
            className="auth-password-input"
            type="password"
            name="auth-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
          />
          <button
            type="button"
            className="auth-submit-btn"
            onClick={submit}
          >
            Register
          </button>
        </form>
        {message ? (
          <div className={`auth-message auth-message-${messageKind}`}>{message}</div>
        ) : null}
        <Link to="/login" className="auth-switch-link">
          Already have an account? Login →
        </Link>
      </div>
    </div>
  )
}

export default RegisterPage
