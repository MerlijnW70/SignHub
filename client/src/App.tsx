import { useState, useEffect } from 'react'
import { useTable } from 'spacetimedb/react'
import { tables } from './module_bindings'
import { useIdentity, toHex } from './hooks/useIdentity'
import { ConnectionStatus } from './components/ConnectionStatus'
import { SignUpForm } from './components/SignUpForm'
import { CreateCompanyForm } from './components/CreateCompanyForm'
import { JoinCompanyForm } from './components/JoinCompanyForm'
import { Dashboard } from './components/Dashboard'
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

  // Subscribe to all companies (single subscription handles both directory
  // and own-company lookup; .where() on renamed columns is broken in SDK)
  const [allCompanies] = useTable(tables.company)

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

  // No account → sign up
  if (!myAccount) {
    return (
      <div className="app center">
        <ConnectionStatus />
        <SignUpForm />
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
