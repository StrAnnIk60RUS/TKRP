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
      setMessage('Заполните имя пользователя и пароль')
      setMessageKind('error')
      return
    }
    try {
      const result = await registerUser(username, password)
      setMessage(`Регистрация прошла успешно. Добро пожаловать, ${result.user.username}!`)
      setMessageKind('success')
      setUsername('')
      setPassword('')
      navigate('/')
    } catch (error) {
      setMessage(error.message || 'Не удалось зарегистрироваться')
      setMessageKind('error')
    }
  }

  return (
    <div className="auth-page">
      <div className="page-header">
        <h1>Регистрация</h1>
        <p className="page-subtitle">
          Создайте аккаунт, чтобы ваши черновики и снимки планов оставались приватными
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
            placeholder="Буквы, цифры, _ . @ - (3–64)"
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
            placeholder="Минимум 6 символов"
          />
          <button
            type="button"
            className="auth-submit-btn"
            onClick={submit}
          >
            Зарегистрироваться
          </button>
        </form>
        {message ? (
          <div className={`auth-message auth-message-${messageKind}`}>{message}</div>
        ) : null}
        <Link to="/login" className="auth-switch-link">
          Уже есть аккаунт? Вход →
        </Link>
      </div>
    </div>
  )
}

export default RegisterPage
