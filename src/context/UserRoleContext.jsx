import React, { createContext, useContext, useState, useEffect } from 'react'

export const ROLES = {
  SMM: 'smm',
  DEVELOPER: 'developer'
}

const STORAGE_KEY = 'tkrp_user_role'

const UserRoleContext = createContext(null)

export function UserRoleProvider({ children }) {
  const [role, setRoleState] = useState(ROLES.SMM)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === ROLES.SMM || saved === ROLES.DEVELOPER) {
      setRoleState(saved)
    }
  }, [])

  const setRole = (value) => {
    if (value !== ROLES.SMM && value !== ROLES.DEVELOPER) return
    setRoleState(value)
    localStorage.setItem(STORAGE_KEY, value)
  }

  const isDeveloper = role === ROLES.DEVELOPER

  return (
    <UserRoleContext.Provider value={{ role, setRole, isDeveloper }}>
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
