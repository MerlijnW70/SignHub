import { ConnectionStatus } from './ConnectionStatus'
import { TeamManagement } from './TeamManagement'
import { InviteCodeManager } from './InviteCodeManager'
import { CompanySettings } from './CompanySettings'
import { ConnectionManager } from './ConnectionManager'
import type { UserAccount } from '../module_bindings/types'
import type { Company } from '../module_bindings/types'

interface DashboardProps {
  account: UserAccount
  company: Company
}

export function Dashboard({ account, company }: DashboardProps) {
  const roleTag = account.role.tag
  const canManage = roleTag !== 'Member' && roleTag !== 'Field'

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
            <span className="info-value">{account.fullName}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Nickname</span>
            <span className="info-value">{account.nickname}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Email</span>
            <span className="info-value">{account.email}</span>
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

      {canManage && <ConnectionManager company={company} />}
    </div>
  )
}
