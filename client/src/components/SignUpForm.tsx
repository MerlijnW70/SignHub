import { useState, type FormEvent } from 'react'
import { useReducer } from 'spacetimedb/react'
import { reducers } from '../module_bindings'
import { useFormAction } from '../hooks/useFormAction'

export function SignUpForm() {
  const createAccount = useReducer(reducers.createAccount)
  const { error, loading, run } = useFormAction()

  const [fullName, setFullName] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    run(() => createAccount({
      fullName: fullName.trim(),
      nickname: nickname.trim(),
      email: email.trim(),
    }))
  }

  const isValid = fullName.trim().length > 0 && nickname.trim().length > 0 && email.trim().length > 0

  return (
    <div className="form-container">
      <h1>Welcome to The Signmaker Hub</h1>
      <p className="subtitle">Create your account to get started</p>

      <form className="form" onSubmit={handleSubmit}>
        <label>
          Full Name
          <input
            type="text"
            placeholder="Merlijn van der Waal"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
          />
        </label>

        <label>
          Nickname
          <input
            type="text"
            placeholder="Merlijn"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
          />
        </label>

        <label>
          Email
          <input
            type="email"
            placeholder="merlijn@signshop.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={!isValid || loading}>
          {loading ? 'Creating...' : 'Create Account'}
        </button>
      </form>
    </div>
  )
}
