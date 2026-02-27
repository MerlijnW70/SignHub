import { useState } from 'react'
import { useTable, useReducer } from 'spacetimedb/react'
import { Identity } from 'spacetimedb'
import { tables, reducers } from '../module_bindings'
import { useIdentity } from '../hooks/useIdentity'
import { useFormAction } from '../hooks/useFormAction'
import type { Company } from '../module_bindings/types'

interface TeamManagementProps {
  company: Company
  myRole: string // "Owner" | "Manager" | "Member"
}

interface TransferTarget {
  identity: unknown
  name: string
}

export function TeamManagement({ company, myRole }: TeamManagementProps) {
  const { isMe } = useIdentity()
  const [allProfiles] = useTable(tables.user_profile)
  const [onlineUsers] = useTable(tables.online_user)

  const removeColleague = useReducer(reducers.removeColleague)
  const updateUserRole = useReducer(reducers.updateUserRole)
  const transferOwnership = useReducer(reducers.transferOwnership)
  const { error, success, loading, run } = useFormAction()

  const [transferTarget, setTransferTarget] = useState<TransferTarget | null>(null)

  const isOwner = myRole === 'Owner'
  const canManage = myRole !== 'Member'

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

  const handleRemove = (memberIdentity: unknown) => {
    run(
      () => removeColleague({ colleagueIdentity: memberIdentity as Identity }),
      'Colleague removed'
    )
  }

  const handleRoleChange = (memberIdentity: unknown, newRoleTag: string) => {
    run(
      () => updateUserRole({
        targetIdentity: memberIdentity as Identity,
        newRole: { tag: newRoleTag } as { tag: 'Manager' } | { tag: 'Member' },
      }),
      'Role updated'
    )
  }

  const handleTransferConfirm = () => {
    if (!transferTarget) return
    run(
      () => transferOwnership({ newOwnerIdentity: transferTarget.identity as Identity }),
      'Ownership transferred'
    )
    setTransferTarget(null)
  }

  const canRemoveMember = (memberRoleTag: string): boolean => {
    if (isOwner) return memberRoleTag !== 'Owner'
    if (canManage) return memberRoleTag === 'Member'
    return false
  }

  return (
    <section className="dashboard-section">
      <h2>Team ({teamMembers.length})</h2>

      <ul className="team-list">
        {teamMembers.map(member => {
          const memberRoleTag = member.role.tag
          const isSelf = isMe(member.identity)

          return (
            <li key={String(member.identity)} className="team-member">
              <div className="member-info">
                <span className="member-name">
                  <span className={`dot ${isOnline(member.identity) ? 'online' : 'offline'}`} />
                  {member.fullName}
                  {isSelf && <span className="you-badge">you</span>}
                </span>
                <span className="member-email">{member.email}</span>
              </div>
              <div className="member-actions">
                <span className={`role-badge role-${memberRoleTag.toLowerCase()}`}>
                  {memberRoleTag}
                </span>

                {/* Owner can change roles of non-self, non-Owner members */}
                {isOwner && !isSelf && memberRoleTag !== 'Owner' && (
                  <select
                    className="role-select"
                    value={memberRoleTag}
                    onChange={e => handleRoleChange(member.identity, e.target.value)}
                    disabled={loading}
                  >
                    <option value="Manager">Manager</option>
                    <option value="Member">Member</option>
                  </select>
                )}

                {/* Owner can transfer ownership to any non-self member */}
                {isOwner && !isSelf && (
                  <button
                    className="btn-transfer"
                    onClick={() => setTransferTarget({
                      identity: member.identity,
                      name: member.fullName,
                    })}
                    disabled={loading}
                  >
                    Transfer
                  </button>
                )}

                {/* Remove: shown when caller can remove this member's role level */}
                {canManage && !isSelf && canRemoveMember(memberRoleTag) && (
                  <button
                    className="btn-remove"
                    onClick={() => handleRemove(member.identity)}
                    disabled={loading}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {/* Ownership transfer confirmation modal */}
      {transferTarget && (
        <div className="modal-overlay" onClick={() => setTransferTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Transfer Ownership</h3>
            <p className="modal-warning">
              You are about to transfer ownership of <strong>{company.name}</strong> to{' '}
              <strong>{transferTarget.name}</strong>.
            </p>
            <p className="modal-warning">
              This means you will lose all Owner privileges and become a Manager.
              Only the new owner can reverse this action.
            </p>
            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setTransferTarget(null)}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={handleTransferConfirm}
                disabled={loading}
              >
                {loading ? 'Transferring...' : 'Confirm Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
