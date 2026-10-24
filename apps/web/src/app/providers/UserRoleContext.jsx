import React, { createContext, useContext, useState, useEffect } from 'react'

export const ROLES = {
  SMM: 'smm',
  ANALYST: 'analyst'
}

/** Краткое описание режима для отображения в UI */
export const ROLE_MODE_LABELS = {
  [ROLES.SMM]: {
    name: 'Маркетолог (SMM)',
    short: 'Быстрый прикладной режим',
    detail: '3 шага: конкуренты, проект, аудитория — и генерация готового плана в 1 клик'
  },
  [ROLES.ANALYST]: {
    name: 'Маркетолог-аналитик',
    short: 'Глубокий аналитический режим',
    detail: '6 шагов: ручной RAG-поиск по прецедентам, метрики моделей ML, трассировка GA и выгрузка JSON'
  }
}

const STORAGE_KEY = 'tkrp_user_role'

const UserRoleContext = createContext(null)

export function UserRoleProvider({ children }) {
  const [role, setRoleState] = useState(ROLES.SMM)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === ROLES.SMM || saved === ROLES.ANALYST) {
      setRoleState(saved)
    } else if (saved === 'developer') {
      // Автоматическая миграция устаревшей роли разработчика на роль аналитика
      setRoleState(ROLES.ANALYST)
      localStorage.setItem(STORAGE_KEY, ROLES.ANALYST)
    }
  }, [])

  const setRole = (value) => {
    if (value !== ROLES.SMM && value !== ROLES.ANALYST) return
    setRoleState(value)
    localStorage.setItem(STORAGE_KEY, value)
  }

  const isAnalyst = role === ROLES.ANALYST
  const isSmm = role === ROLES.SMM
  const isExtendedMode = isAnalyst
  // Роль программиста удалена; флаг оставлен со значением false для обратной совместимости
  const isDeveloper = false

  return (
    <UserRoleContext.Provider
      value={{
        role,
        setRole,
        isAnalyst,
        isSmm,
        isExtendedMode,
        isDeveloper
      }}
    >
      {children}
    </UserRoleContext.Provider>
  )
}

export function useUserRole() {
  const ctx = useContext(UserRoleContext)
  if (!ctx) {
    throw new Error('useUserRole must be used within UserRoleProvider')
  }
  return ctx
}
