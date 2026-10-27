import React, { useState, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerUser } from '../../../shared/api/authService'
import { ToastContainer } from '../../../shared/ui/Toast'
import './AuthPage.css'

const RegisterPage = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [usernameWarning, setUsernameWarning] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState('info')
  const [toasts, setToasts] = useState([])
  const toastCounterRef = useRef(0)

  const handleUsernameChange = (e) => {
    let val = e.target.value

    // Проверяем наличие кириллицы
    if (/[а-яА-ЯёЁ]/.test(val)) {
      setUsernameWarning('Кириллица не поддерживается. Используйте латинские буквы (a-z, A-Z)')
    } else {
      setUsernameWarning('')
    }

    // Автоматическая замена пробелов на подчеркивания (как в лучших сервисах)
    if (val.includes(' ')) {
      val = val.replace(/\s+/g, '_')
    }

    // Удаляем любые символы кириллицы
    val = val.replace(/[а-яА-ЯёЁ]/g, '')

    setUsername(val)
  }

  const addToast = useCallback((msg, type = 'error', options = {}) => {
    toastCounterRef.current += 1
    const id = `${Date.now()}-${toastCounterRef.current}`
    const traceId = typeof options === 'string' ? options : options?.traceId
    setToasts((prev) => [...prev, { id, message: msg, type, traceId }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const submit = async () => {
    const trimmedUsername = username.trim().replace(/\s+/g, '_')
    if (!trimmedUsername || !password) {
      const errMsg = 'Заполните имя пользователя и пароль'
      setMessage(errMsg)
      setMessageKind('error')
      addToast(errMsg, 'error')
      return
    }
    if (trimmedUsername.length < 3) {
      const errMsg = 'Имя пользователя должно содержать минимум 3 символа'
      setMessage(errMsg)
      setMessageKind('error')
      addToast(errMsg, 'error')
      return
    }
    try {
      const result = await registerUser(trimmedUsername, password)
      setMessage(`Регистрация прошла успешно. Добро пожаловать, ${result.user.username}!`)
      setMessageKind('success')
      setUsername('')
      setUsernameWarning('')
      setPassword('')
      navigate('/')
    } catch (error) {
      const errMsg = error.message || 'Не удалось зарегистрироваться'
      setMessage(errMsg)
      setMessageKind('error')
      addToast(errMsg, 'error', { traceId: error?.traceId })
    }
  }

  return (
    <div className="auth-page">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-badge">Создание профиля</div>
          <h1>Регистрация</h1>
          <p className="auth-subtitle">
            Создайте аккаунт, чтобы ваши черновики, конкуренты и снимки планов оставались приватными
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
              onChange={handleUsernameChange}
              placeholder="username (только латиница)"
            />
            {usernameWarning ? (
              <div className="auth-field-warning">
                ⚠️ {usernameWarning}
              </div>
            ) : null}
            <div className="auth-requirements">
              3–64 символа: только латиница (a–z), цифры и знаки _, ., @, -
              <br />
              <span className="auth-requirements-tip">
                Пробелы автоматически заменяются на «_», кириллица не поддерживается.
              </span>
            </div>
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Минимум 6 символов"
            />
            <div className="auth-requirements">
              Минимум 6 символов любой сложности
            </div>
          </div>
          <button type="submit" className="auth-submit-btn">
            Зарегистрироваться
          </button>
        </form>
        {message ? (
          <div className={`auth-message auth-message-${messageKind}`}>{message}</div>
        ) : null}
        <div className="auth-footer">
          <span className="auth-footer-text">Уже зарегистрированы?</span>
          <Link to="/login" className="auth-switch-link">
            Войти в аккаунт →
          </Link>
        </div>
      </div>
    </div>
  )
}

export default RegisterPage
