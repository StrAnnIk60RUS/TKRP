import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loginUser } from '../../../shared/api/authService'
import './AuthPage.css'

const LoginPage = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState('info')

  const submit = async () => {
    if (!username || !password) {
      setMessage('Введите имя пользователя и пароль')
      setMessageKind('error')
      return
    }
    try {
      const result = await loginUser(username, password)
      setMessage(`С возвращением, ${result.user.username}!`)
      setMessageKind('success')
      setUsername('')
      setPassword('')
      navigate('/')
    } catch (error) {
      setMessage(error.message || 'Не удалось войти')
      setMessageKind('error')
    }
  }

  return (
    <div className="auth-page">
      <div className="page-header">
        <h1>Вход</h1>
        <p className="page-subtitle">
          Войдите, чтобы открыть ваши черновики и снимки планов
        </p>
      </div>
      <div className="page-content">
        <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
          <label className="auth-field-label" htmlFor="auth-username">
            Имя пользователя
          </label>
          <input
            className="auth-username-input"
            type="text"
            name="auth-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Ваше имя пользователя"
          />
          <label className="auth-field-label" htmlFor="auth-password">
            Пароль
          </label>
          <input
            className="auth-password-input"
            type="password"
            name="auth-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Ваш пароль"
          />
          <button
            type="button"
            className="auth-submit-btn"
            onClick={submit}
          >
            Войти
          </button>
        </form>
        {message ? (
          <div className={`auth-message auth-message-${messageKind}`}>{message}</div>
        ) : null}
        <Link to="/register" className="auth-switch-link">
          Нет аккаунта? Регистрация →
        </Link>
      </div>
    </div>
  )
}

export default LoginPage
