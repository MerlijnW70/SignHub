import { useState } from 'react'
import { useTable, useReducer } from 'spacetimedb/react'
import { Identity } from 'spacetimedb'
import { tables, reducers } from '../module_bindings'
import { useIdentity } from '../hooks/useIdentity'
import type { Company } from '../module_bindings/types'

interface TeamManagementProps {
  company: Company
  isAdmin: boolean
}

export function TeamManagement({ company, isAdmin }: TeamManagementProps) {
  const { isMe } = useIdentity()
  const [allProfiles] = useTable(tables.user_profile)
  const [onlineUsers] = useTable(tables.online_user)

  const removeColleague = useReducer(reducers.removeColleague)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const teamMembers = allProfiles.filter(
    p => p.companyId !== undefined && p.companyId !== null && p.companyId === company.id
  )

  const isOnline = (memberIdentity: unknown): boolean => {
    const hex =
      typeof memberIdentity === 'object' && memberIdentity !== null && 'toHexString' in memberIdentity
        ? (memberIdentity as { toHexString: () => string }).toHexString()
        : String(memberIdentity)
    return onlineUsers.some(u => {
      const uHex =
        typeof u.identity === 'object' && u.identity !== null && 'toHexString' in u.identity
          ? (u.identity as { toHexString: () => string }).toHexString()
          : String(u.identity)
      return uHex === hex && u.online
    })
  }

  const handleRemove = async (memberIdentity: unknown) => {
    setError('')
    setSuccess('')
    try {
      await removeColleague({ colleagueIdentity: memberIdentity as Identity })
      setSuccess('Colleague removed')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="dashboard-section">
      <h2>Team ({teamMembers.length})</h2>

      <ul className="team-list">
        {teamMembers.map(member => (
          <li key={String(member.identity)} className="team-member">
            <div className="member-info">
              <span className="member-name">
                <span className={`dot ${isOnline(member.identity) ? 'online' : 'offline'}`} />
                {member.fullName}
                {isMe(member.identity) && <span className="you-badge">you</span>}
              </span>
              <span className="member-email">{member.email}</span>
            </div>
            <div className="member-actions">
              <span className="member-role">{member.isAdmin ? 'Admin' : 'Member'}</span>
              {isAdmin && !isMe(member.identity) && (
                <button
                  className="btn-remove"
                  onClick={() => handleRemove(member.identity)}
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
    </section>
  )
}
