import { ConnectionStatus } from './ConnectionStatus'
import { TeamManagement } from './TeamManagement'
import { InviteCodeManager } from './InviteCodeManager'
import { CompanySettings } from './CompanySettings'
import type { UserProfile } from '../module_bindings/types'
import type { Company } from '../module_bindings/types'

interface DashboardProps {
  profile: UserProfile
  company: Company
}

export function Dashboard({ profile, company }: DashboardProps) {
  const roleTag = profile.role.tag
  const canManage = roleTag !== 'Member'

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
            <span className="info-value">
              <span className={`role-badge role-${roleTag.toLowerCase()}`}>{roleTag}</span>
            </span>
          </div>
        </div>
      </section>

      {canManage && <CompanySettings company={company} />}

      <TeamManagement company={company} myRole={roleTag} />

      {canManage && <InviteCodeManager companyId={company.id} />}
    </div>
  )
}
