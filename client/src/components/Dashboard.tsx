import { useState } from 'react'
import { ConnectionStatus } from './ConnectionStatus'
import { TeamManagement } from './TeamManagement'
import { useIdentity } from '../hooks/useIdentity'
import type { UserProfile } from '../module_bindings/types'
import type { Company } from '../module_bindings/types'

interface DashboardProps {
  profile: UserProfile
  company: Company
}

export function Dashboard({ profile, company }: DashboardProps) {
  const { identityHex } = useIdentity()
  const [copied, setCopied] = useState(false)

  const copyIdentity = async () => {
    await navigator.clipboard.writeText(identityHex)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>{company.name}</h1>
          <span className="slug">@{company.slug}</span>
          <span className="location">{company.location}</span>
        </div>
        <ConnectionStatus />
      </header>

      <section className="dashboard-section">
        <h2>Your Profile</h2>
        <div className="info-grid">
          <div className="info-item">
            <span className="info-label">Name</span>
            <span className="info-value">{profile.fullName}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Email</span>
            <span className="info-value">{profile.email}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Role</span>
            <span className="info-value">{profile.isAdmin ? 'Admin' : 'Member'}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Your Identity</span>
            <span className="info-value identity-value">
              <code className="identity-hex">{identityHex.slice(0, 12)}...{identityHex.slice(-8)}</code>
              <button className="btn-copy" onClick={copyIdentity}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </span>
          </div>
        </div>
      </section>

      <TeamManagement company={company} isAdmin={profile.isAdmin} />
    </div>
  )
}
