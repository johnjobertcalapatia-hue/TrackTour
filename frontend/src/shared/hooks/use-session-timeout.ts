import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '@/features/auth/services/auth-store'

const INACTIVITY_TIMEOUT = 13 * 60 * 1000 // 13 minutes before warning
const WARNING_DURATION = 120 // 2 minutes countdown in seconds
const ACTIVITY_KEY = 'last_activity'
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const

function getLastActivity(): number {
  const stored = sessionStorage.getItem(ACTIVITY_KEY)
  return stored ? parseInt(stored, 10) : Date.now()
}

function setLastActivity() {
  sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()))
}

export function useSessionTimeout() {
  const [showWarning, setShowWarning] = useState(false)
  const [countdown, setCountdown] = useState(WARNING_DURATION)
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAllTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    if (warningRef.current) clearTimeout(warningRef.current)
    timerRef.current = null
    countdownRef.current = null
    warningRef.current = null
  }, [])

  const handleLogout = useCallback(async () => {
    clearAllTimers()
    setShowWarning(false)
    await logout()
    window.location.href = '/login'
  }, [logout, clearAllTimers])

  const startInactivityTimer = useCallback(() => {
    clearAllTimers()
    setLastActivity()

    timerRef.current = setTimeout(() => {
      setShowWarning(true)
      setCountdown(WARNING_DURATION)
    }, INACTIVITY_TIMEOUT)
  }, [clearAllTimers])

  const resetTimer = useCallback(() => {
    setShowWarning(false)
    setCountdown(WARNING_DURATION)
    startInactivityTimer()
  }, [startInactivityTimer])

  const handleActivity = useCallback(() => {
    if (showWarning) return // don't reset during warning — user must click "Stay Logged In"
    setLastActivity()
    startInactivityTimer()
  }, [showWarning, startInactivityTimer])

  // Main inactivity timer
  useEffect(() => {
    if (!user) return

    startInactivityTimer()

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true })
    }

    return () => {
      clearAllTimers()
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity)
      }
    }
  }, [user, startInactivityTimer, handleActivity, clearAllTimers])

  // Countdown timer when warning is shown
  useEffect(() => {
    if (!showWarning) return

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          handleLogout()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [showWarning, handleLogout])

  return {
    showWarning,
    countdown,
    resetTimer,
    handleLogout,
  }
}
