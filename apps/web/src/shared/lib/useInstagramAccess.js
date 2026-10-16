import { useEffect, useState } from 'react'
import { getCurrentUser } from '../api/authService'

/** True only after /api/auth/me reports the Instagram preview feature for this session. */
export function useInstagramAccess() {
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getCurrentUser()
      .then((user) => {
        if (!cancelled) setAllowed(Boolean(user?.features?.instagram))
      })
      .catch(() => {
        if (!cancelled) setAllowed(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return allowed
}
