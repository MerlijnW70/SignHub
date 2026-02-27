import { useState, type FormEvent } from 'react'
import { useReducer } from 'spacetimedb/react'
import { reducers } from '../module_bindings'

export function JoinCompanyForm({ onBack }: { onBack: () => void }) {
  const joinCompany = useReducer(reducers.joinCompany)

  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const formatCode = (value: string): string => {
    // Strip everything except alphanumeric
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    // Auto-insert dash after 4 chars
    if (clean.length > 4) {
      return clean.slice(0, 4) + '-' + clean.slice(4, 8)
    }
    return clean
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await joinCompany({ code: code.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const isValid = code.replace(/-/g, '').length === 8

  return (
    <div className="form-container">
      <h1>Join a Company</h1>
      <p className="subtitle">Enter the invite code you received</p>

      <form className="form" onSubmit={handleSubmit}>
        <label>
          Invite Code
          <input
            type="text"
            placeholder="XXXX-XXXX"
            value={code}
            onChange={e => setCode(formatCode(e.target.value))}
            maxLength={9}
            className="invite-code-input"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={!isValid}>
          Join Company
        </button>
      </form>

      <button className="btn-link" onClick={onBack}>
        Or create a new company instead
      </button>
    </div>
  )
}
