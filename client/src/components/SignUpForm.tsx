import { useState, type FormEvent } from 'react'
import { useReducer } from 'spacetimedb/react'
import { reducers } from '../module_bindings'

export function SignUpForm() {
  const createUserProfile = useReducer(reducers.createUserProfile)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await createUserProfile({ fullName: fullName.trim(), email: email.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const isValid = fullName.trim().length > 0 && email.trim().length > 0

  return (
    <div className="form-container">
      <h1>Welcome to The Signmaker Hub</h1>
      <p className="subtitle">Create your account to get started</p>

      <form className="form" onSubmit={handleSubmit}>
        <label>
          Full Name
          <input
            type="text"
            placeholder="John Smith"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
          />
        </label>

        <label>
          Email
          <input
            type="email"
            placeholder="john@signshop.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={!isValid}>
          Create Account
        </button>
      </form>
    </div>
  )
}
