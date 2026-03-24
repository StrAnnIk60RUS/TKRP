import React, { createContext, useContext, useState, useEffect } from 'react'

export const ROLES = {
  SMM: 'smm',
  ANALYST: 'analyst',
  DEVELOPER: 'developer'
}

/** Краткое описание режима для отображения в UI */
export const ROLE_MODE_LABELS = {
  [ROLES.SMM]: {
    short: 'Быстрый режим',
    detail: '4 шага, без GA/ML, чеклист обязателен'
  },
  [ROLES.ANALYST]: {
    short: 'Расширенный режим',
    detail: '5 шагов, параметры GA/ML, чеклист обязателен'
  },
  [ROLES.DEVELOPER]: {
    short: 'Полный режим',
    detail: '5 шагов, GA/ML, обход блокировок чеклиста'
  }
}

const STORAGE_KEY = 'tkrp_user_role'

const UserRoleContext = createContext(null)

export function UserRoleProvider({ children }) {
  const [role, setRoleState] = useState(ROLES.SMM)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === ROLES.SMM || saved === ROLES.ANALYST || saved === ROLES.DEVELOPER) {
      setRoleState(saved)
    }
  }, [])

  const setRole = (value) => {
    if (value !== ROLES.SMM && value !== ROLES.ANALYST && value !== ROLES.DEVELOPER) return
    setRoleState(value)
    localStorage.setItem(STORAGE_KEY, value)
  }

  const isDeveloper = role === ROLES.DEVELOPER
  const isAnalyst = role === ROLES.ANALYST
  const isExtendedMode = isDeveloper || isAnalyst

  return (
    <UserRoleContext.Provider value={{ role, setRole, isDeveloper, isAnalyst, isExtendedMode }}>
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
