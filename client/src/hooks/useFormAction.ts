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
  const errorTimer = useRef<ReturnType<typeof setTimeout>>()
  const successTimer = useRef<ReturnType<typeof setTimeout>>()

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
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
    if (loading) return

    clearError()
    clearSuccess()
    setLoading(true)

    try {
      await fn()
      if (successMessage) {
        setSuccess(successMessage)
        successTimer.current = setTimeout(() => setSuccess(''), 3000)
      }
    } catch (err) {
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
      errorTimer.current = setTimeout(() => setError(''), 5000)
    } finally {
      setLoading(false)
    }
  }, [loading, clearError, clearSuccess])

  return { error, success, loading, run, clearError, clearSuccess }
}
