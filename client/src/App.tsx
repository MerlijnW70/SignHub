import { useState, useEffect } from 'react'
import { useTable, useReducer } from 'spacetimedb/react'
import { tables, reducers } from './module_bindings'
import { useIdentity, toHex } from './hooks/useIdentity'
import { useFormAction } from './hooks/useFormAction'
import { useFilteredTable } from './hooks/useFilteredTable'
import { ConnectionStatus } from './components/ConnectionStatus'
import { SignUpForm } from './components/SignUpForm'
import { CreateCompanyForm } from './components/CreateCompanyForm'
import { JoinCompanyForm } from './components/JoinCompanyForm'
import { Dashboard } from './components/Dashboard'
import type { Company } from './module_bindings/types'
import './App.css'

function App() {
  const { isActive, identity } = useIdentity()

  if (!isActive || !identity) {
    return (
      <div className="app center">
        <ConnectionStatus />
      </div>
    )
  }

  return <AuthenticatedApp />
}

function AuthenticatedApp() {
  const { identity, identityHex } = useIdentity()
  const [companyMode, setCompanyMode] = useState<'choose' | 'create' | 'join'>('choose')
  const [companyTimeout, setCompanyTimeout] = useState(false)

  // Subscribe ONLY to my own account row
  const [accounts] = useTable(
    tables.user_account.where(r => r.identity.eq(identity!))
  )
  const myAccount = accounts.find(a => toHex(a.identity) === identityHex)

  // Server-side filtered: own company + public directory
  const companySql = myAccount?.companyId != null
    ? `SELECT * FROM company WHERE id = ${myAccount.companyId} OR is_public = true`
    : `SELECT * FROM company WHERE is_public = true`
  const [allCompanies] = useFilteredTable<Company>(companySql, 'company')

  const myCompany = myAccount?.companyId != null
    ? allCompanies.find(c => c.id === myAccount.companyId)
    : undefined

  // Company loading timeout
  useEffect(() => {
    if (myAccount?.companyId != null && !myCompany) {
      const timer = setTimeout(() => setCompanyTimeout(true), 10000)
      return () => clearTimeout(timer)
    }
    setCompanyTimeout(false)
  }, [myAccount?.companyId, myCompany])

  // Demo user setup
  const createAccount = useReducer(reducers.createAccount)
  const createCompany = useReducer(reducers.createCompany)
  const { error: demoError, loading: demoLoading, run: demoRun } = useFormAction()

  const handleDemo = (variant: 'A' | 'B') => {
    const isA = variant === 'A'
    demoRun(async () => {
      await createAccount({
        fullName: isA ? 'Alice van Dijk' : 'Bob Jansen',
        nickname: isA ? 'Alice' : 'Bob',
        email: isA ? 'alice@alphasigns.test' : 'bob@betasigns.test',
      })
      await createCompany({
        name: isA ? 'Alpha Signs' : 'Beta Signs',
        slug: isA ? 'alpha-signs' : 'beta-signs',
        location: isA ? 'Amsterdam, NL' : 'Rotterdam, NL',
      })
    }, 'Demo account created')
  }

  // No account → sign up
  if (!myAccount) {
    return (
      <div className="app center">
        <ConnectionStatus />
        <SignUpForm />
        <div className="demo-buttons">
          <p className="demo-label">Quick test setup</p>
          <div className="demo-row">
            <button
              className="btn-choice"
              onClick={() => handleDemo('A')}
              disabled={demoLoading}
            >
              {demoLoading ? 'Setting up...' : 'Demo User A — Alpha Signs'}
            </button>
            <button
              className="btn-choice"
              onClick={() => handleDemo('B')}
              disabled={demoLoading}
            >
              {demoLoading ? 'Setting up...' : 'Demo User B — Beta Signs'}
            </button>
          </div>
          {demoError && <p className="error">{demoError}</p>}
        </div>
      </div>
    )
  }

  // No company → choose: create or join
  if (myAccount.companyId === undefined || myAccount.companyId === null) {
    return (
      <div className="app center">
        <ConnectionStatus />
        {companyMode === 'choose' && (
          <div className="form-container">
            <h1>Join or Create a Company</h1>
            <p className="subtitle">Get started with your sign shop</p>
            <div className="choice-buttons">
              <button className="btn-choice" onClick={() => setCompanyMode('join')}>
                I have an invite code
              </button>
              <button className="btn-choice primary" onClick={() => setCompanyMode('create')}>
                Create a new company
              </button>
            </div>
          </div>
        )}
        {companyMode === 'create' && (
          <CreateCompanyForm onBack={() => setCompanyMode('choose')} />
        )}
        {companyMode === 'join' && (
          <JoinCompanyForm onBack={() => setCompanyMode('choose')} />
        )}
      </div>
    )
  }

  // Company not loaded yet
  if (!myCompany) {
    return (
      <div className="app center">
        <ConnectionStatus />
        {companyTimeout
          ? <p className="error">Could not load company data. Try reloading the page.</p>
          : <p>Loading company...</p>
        }
      </div>
    )
  }

  // Dashboard
  return (
    <div className="app">
      <Dashboard account={myAccount} company={myCompany} />
    </div>
  )
}

export default App
