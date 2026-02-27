import { useTable } from 'spacetimedb/react'
import { tables } from '../module_bindings'
import { useIdentity } from '../hooks/useIdentity'
import { ConnectionStatus } from './ConnectionStatus'
import type { UserProfile } from '../module_bindings/types'
import type { Company } from '../module_bindings/types'

interface DashboardProps {
  profile: UserProfile
  company: Company
}

export function Dashboard({ profile, company }: DashboardProps) {
  const { isMe } = useIdentity()
  const [allProfiles] = useTable(tables.user_profile)

  const teamMembers = allProfiles.filter(
    p => p.companyId !== undefined && p.companyId !== null && p.companyId === company.id
  )

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
        </div>
      </section>

      <section className="dashboard-section">
        <h2>Team ({teamMembers.length})</h2>
        <ul className="team-list">
          {teamMembers.map(member => (
            <li key={String(member.identity)} className="team-member">
              <span className="member-name">
                {member.fullName}
                {isMe(member.identity) && <span className="you-badge">you</span>}
              </span>
              <span className="member-role">{member.isAdmin ? 'Admin' : 'Member'}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
