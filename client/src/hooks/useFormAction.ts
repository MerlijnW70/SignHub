import { useState, useCallback, useRef, useEffect } from 'react'

interface FormAction {
  error: string
  success: string
  loading: boolean
  run: (fn: () => Promise<void>, successMessage?: string) => Promise<void>
  clearError: () => void
  clearSuccess: () => void
}

export function useFormAction(): FormAction {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  const errorTimer = useRef<ReturnType<typeof setTimeout>>()
  const successTimer = useRef<ReturnType<typeof setTimeout>>()
  const mountedRef = useRef(true)

  // Track mounted state for safe state updates
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(errorTimer.current)
      clearTimeout(successTimer.current)
    }
  }, [])

  const clearError = useCallback(() => {
    setError('')
    clearTimeout(errorTimer.current)
  }, [])

  const clearSuccess = useCallback(() => {
    setSuccess('')
    clearTimeout(successTimer.current)
  }, [])

  const run = useCallback(async (fn: () => Promise<void>, successMessage?: string) => {
    if (loadingRef.current) return

    clearError()
    clearSuccess()
    loadingRef.current = true
    setLoading(true)

    try {
      await fn()
      if (mountedRef.current && successMessage) {
        setSuccess(successMessage)
        clearTimeout(successTimer.current)
        successTimer.current = setTimeout(() => {
          if (mountedRef.current) setSuccess('')
        }, 3000)
      }
    } catch (err) {
      if (!mountedRef.current) return
      let msg: string
      if (err instanceof Error) {
        msg = err.message
      } else if (typeof err === 'object' && err !== null && 'message' in err) {
        msg = String((err as { message: unknown }).message)
      } else {
        msg = String(err)
      }
      // Strip SpacetimeDB wrapper prefixes if present
      msg = msg.replace(/^(ReducerError|Error): /i, '')
      setError(msg || 'An unexpected error occurred')
      console.error('Action failed:', err)
      clearTimeout(errorTimer.current)
      errorTimer.current = setTimeout(() => {
        if (mountedRef.current) setError('')
      }, 5000)
    } finally {
      loadingRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [clearError, clearSuccess])

  return { error, success, loading, run, clearError, clearSuccess }
}
