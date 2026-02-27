import { useState, useEffect } from 'react'
import { useTable } from 'spacetimedb/react'
import { tables } from './module_bindings'
import { useIdentity } from './hooks/useIdentity'
import { toHex } from './hooks/useIdentity'
import { ConnectionStatus } from './components/ConnectionStatus'
import { SignUpForm } from './components/SignUpForm'
import { CreateCompanyForm } from './components/CreateCompanyForm'
import { JoinCompanyForm } from './components/JoinCompanyForm'
import { Dashboard } from './components/Dashboard'
import './App.css'

function App() {
  const { isActive, identity, identityHex } = useIdentity()
  const [profiles] = useTable(tables.user_profile)
  const [companies] = useTable(tables.company)
  const [companyMode, setCompanyMode] = useState<'choose' | 'create' | 'join'>('choose')
  const [companyTimeout, setCompanyTimeout] = useState(false)

  // 1. Waiting for connection
  if (!isActive || !identity) {
    return (
      <div className="app center">
        <ConnectionStatus />
      </div>
    )
  }

  // 2. Find current user's profile
  const myProfile = profiles.find(p => toHex(p.identity) === identityHex)

  // 3. No profile → sign up
  if (!myProfile) {
    return (
      <div className="app center">
        <ConnectionStatus />
        <SignUpForm />
      </div>
    )
  }

  // 4. No company → choose: create or join
  if (myProfile.companyId === undefined || myProfile.companyId === null) {
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

  // 5. Find the company
  const myCompany = companies.find(c => c.id === myProfile.companyId)

  // Company loading timeout — show error after 10 seconds
  useEffect(() => {
    if (myProfile?.companyId !== undefined && myProfile?.companyId !== null && !myCompany) {
      const timer = setTimeout(() => setCompanyTimeout(true), 10000)
      return () => clearTimeout(timer)
    }
    setCompanyTimeout(false)
  }, [myProfile?.companyId, myCompany])

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

  // 6. Dashboard
  return (
    <div className="app">
      <Dashboard profile={myProfile} company={myCompany} />
    </div>
  )
}

export default App
