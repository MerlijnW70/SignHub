import { useState, type FormEvent } from 'react'
import { useReducer } from 'spacetimedb/react'
import { reducers } from '../module_bindings'
import { useFormAction } from '../hooks/useFormAction'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function CreateCompanyForm({ onBack }: { onBack: () => void }) {
  const createCompany = useReducer(reducers.createCompany)
  const { error, loading, run } = useFormAction()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [location, setLocation] = useState('')

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) {
      setSlug(toSlug(value))
    }
  }

  const handleSlugChange = (value: string) => {
    setSlugEdited(true)
    setSlug(toSlug(value))
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    run(() => createCompany({
      name: name.trim(),
      slug: slug.trim(),
      location: location.trim(),
    }))
  }

  const isValid = name.trim().length > 0 && slug.trim().length > 0 && location.trim().length > 0

  return (
    <div className="form-container">
      <h1>Set Up Your Company</h1>
      <p className="subtitle">Create a company profile for your sign shop</p>

      <form className="form" onSubmit={handleSubmit}>
        <label>
          Company Name
          <input
            type="text"
            placeholder="Acme Signs"
            value={name}
            onChange={e => handleNameChange(e.target.value)}
          />
        </label>

        <label>
          URL Slug
          <input
            type="text"
            placeholder="acme-signs"
            value={slug}
            onChange={e => handleSlugChange(e.target.value)}
          />
          <span className="hint">signmakerhub.com/@{slug || '...'}</span>
        </label>

        <label>
          Location
          <input
            type="text"
            placeholder="Austin, TX"
            value={location}
            onChange={e => setLocation(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={!isValid || loading}>
          {loading ? 'Creating...' : 'Create Company'}
        </button>
      </form>

      <button className="btn-link" onClick={onBack}>
        Or join an existing company with an invite code
      </button>
    </div>
  )
}
