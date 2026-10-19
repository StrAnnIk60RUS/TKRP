import React, { useState, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loginUser } from '../../../shared/api/authService'
import { setupDemoSession } from '../../../features/demo/demoData'
import { ToastContainer } from '../../../shared/ui/Toast'
import './AuthPage.css'

const LoginPage = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState('info')
  const [toasts, setToasts] = useState([])
  const toastCounterRef = useRef(0)

  const addToast = useCallback((msg, type = 'error') => {
    toastCounterRef.current += 1
    const id = `${Date.now()}-${toastCounterRef.current}`
    setToasts((prev) => [...prev, { id, message: msg, type }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleLoginAsDemo = () => {
    try {
      const user = setupDemoSession()
      setMessage(`Вход в демонстрационный аккаунт (${user.project_name}) выполнен!`)
      setMessageKind('success')
      navigate('/content-plan')
    } catch (error) {
      console.error('Ошибка входа в демо:', error)
      setMessage('Не удалось инициализировать демо-данные')
      setMessageKind('error')
      addToast('Не удалось инициализировать демо-данные', 'error')
    }
  }

  const submit = async () => {
    if (username.trim().toLowerCase() === 'demo') {
      handleLoginAsDemo()
      return
    }

    if (!username || !password) {
      const errMsg = 'Введите имя пользователя и пароль'
      setMessage(errMsg)
      setMessageKind('error')
      addToast(errMsg, 'error')
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
      const errMsg = error.message || 'Не удалось войти'
      setMessage(errMsg)
      setMessageKind('error')
      addToast(errMsg, 'error')
    }
  }

  return (
    <div className="auth-page">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-badge">Вход в систему</div>
          <h1>Добро пожаловать</h1>
          <p className="auth-subtitle">
            Войдите в аккаунт, чтобы управлять проектами, черновиками и снимками контент-планов
          </p>
        </div>
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="auth-field-group">
            <label className="auth-field-label" htmlFor="auth-username">
              Имя пользователя
            </label>
            <input
              id="auth-username"
              className="auth-username-input"
              type="text"
              name="auth-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Введите логин"
            />
          </div>
          <div className="auth-field-group">
            <label className="auth-field-label" htmlFor="auth-password">
              Пароль
            </label>
            <input
              id="auth-password"
              className="auth-password-input"
              type="password"
              name="auth-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите пароль"
            />
          </div>
          <button type="submit" className="auth-submit-btn">
            Войти в аккаунт
          </button>
        </form>
        {message ? (
          <div className={`auth-message auth-message-${messageKind}`}>{message}</div>
        ) : null}

        <div className="demo-login-box">
          <div className="demo-login-badge">Быстрый старт для демонстрации</div>
          <p className="demo-login-desc">
            Демонстрация работы автопостинга, статистики каналов VK/Telegram и сопоставления ML-прогнозов с фактом для проекта <strong>DevFlow AI</strong>:
          </p>
          <button
            type="button"
            className="demo-login-btn"
            onClick={handleLoginAsDemo}
          >
            ✨ Войти в Демо-аккаунт (с предзаполненными данными)
          </button>
        </div>

        <div className="auth-footer">
          <span className="auth-footer-text">Впервые у нас?</span>
          <Link to="/register" className="auth-switch-link">
            Создать аккаунт →
          </Link>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
