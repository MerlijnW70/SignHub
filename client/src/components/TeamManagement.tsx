import { useState, useEffect, useCallback } from 'react'
import { useTable, useReducer } from 'spacetimedb/react'
import { Identity } from 'spacetimedb'
import { tables, reducers } from '../module_bindings'
import { useIdentity, toHex } from '../hooks/useIdentity'
import { useFormAction } from '../hooks/useFormAction'
import { useFilteredTable } from '../hooks/useFilteredTable'
import type { Company, UserAccount } from '../module_bindings/types'

interface TeamManagementProps {
  company: Company
  myRole: string // "Owner" | "Admin" | "Member" | "Field"
}

interface ActionTarget {
  identity: unknown
  name: string
}

export function TeamManagement({ company, myRole }: TeamManagementProps) {
  const { isMe } = useIdentity()
  // Server-side filtered: only team members in our company
  const [allAccounts] = useFilteredTable<UserAccount>(
    `SELECT * FROM user_account WHERE company_id = ${company.id}`,
    'user_account'
  )
  const teamMembers = allAccounts.filter(a => a.companyId === company.id)
  const [onlineUsers] = useTable(tables.online_user)

  const removeColleague = useReducer(reducers.removeColleague)
  const updateUserRole = useReducer(reducers.updateUserRole)
  const transferOwnership = useReducer(reducers.transferOwnership)
  const { error, success, loading, run } = useFormAction()

  const [transferTarget, setTransferTarget] = useState<ActionTarget | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ActionTarget | null>(null)

  // Close modals on Escape key
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setTransferTarget(null)
      setRemoveTarget(null)
    }
  }, [])

  useEffect(() => {
    if (transferTarget || removeTarget) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [transferTarget, removeTarget, handleEscape])

  const isOwner = myRole === 'Owner'
  const canManage = myRole !== 'Member' && myRole !== 'Field'

  const isOnline = (memberIdentity: unknown): boolean => {
    const hex = toHex(memberIdentity)
    return onlineUsers.some(u => toHex(u.identity) === hex && u.online)
  }

  const handleRoleChange = (memberIdentity: unknown, newRoleTag: string) => {
    run(
      () => updateUserRole({
        targetIdentity: memberIdentity as Identity,
        newRole: { tag: newRoleTag } as { tag: 'Admin' } | { tag: 'Member' } | { tag: 'Field' },
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

  const handleRemoveConfirm = () => {
    if (!removeTarget) return
    run(
      () => removeColleague({ colleagueIdentity: removeTarget.identity as Identity }),
      'Colleague removed'
    )
    setRemoveTarget(null)
  }

  const canRemoveMember = (memberRoleTag: string): boolean => {
    if (isOwner) return memberRoleTag !== 'Owner'
    if (canManage) return memberRoleTag === 'Member' || memberRoleTag === 'Field'
    return false
  }

  return (
    <section className="dashboard-section">
      <h2>Team ({teamMembers.length})</h2>

      <ul className="team-list">
        {teamMembers.map(member => {
          const memberRoleTag = member.role?.tag ?? 'Member'
          const isSelf = isMe(member.identity)

          return (
            <li key={String(member.identity)} className="team-member">
              <div className="member-info">
                <span className="member-name">
                  <span className={`dot ${isOnline(member.identity) ? 'online' : 'offline'}`} />
                  {member.nickname || member.fullName}
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
                    <option value="Admin">Admin</option>
                    <option value="Member">Member</option>
                    <option value="Field">Field</option>
                  </select>
                )}

                {/* Owner can transfer ownership to any non-self member */}
                {isOwner && !isSelf && (
                  <button
                    className="btn-transfer"
                    onClick={() => setTransferTarget({
                      identity: member.identity,
                      name: member.nickname || member.fullName,
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
                    onClick={() => setRemoveTarget({
                      identity: member.identity,
                      name: member.nickname || member.fullName,
                    })}
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
              This means you will lose all Owner privileges and become an Admin.
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

      {/* Remove colleague confirmation modal */}
      {removeTarget && (
        <div className="modal-overlay" onClick={() => setRemoveTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Remove Team Member</h3>
            <p className="modal-warning">
              Are you sure you want to remove <strong>{removeTarget.name}</strong> from{' '}
              <strong>{company.name}</strong>?
            </p>
            <p className="modal-warning">
              They will lose access to the company and will need a new invite code to rejoin.
            </p>
            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setRemoveTarget(null)}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={handleRemoveConfirm}
                disabled={loading}
              >
                {loading ? 'Removing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
