import { useState } from 'react'
import { useTable, useReducer } from 'spacetimedb/react'
import { tables, reducers } from '../module_bindings'
import { useFormAction } from '../hooks/useFormAction'

interface InviteCodeManagerProps {
  companyId: bigint
}

export function InviteCodeManager({ companyId }: InviteCodeManagerProps) {
  const [allCodes] = useTable(tables.invite_code)
  const generateCode = useReducer(reducers.generateInviteCode)
  const deleteCode = useReducer(reducers.deleteInviteCode)

  const { error, success, loading, run } = useFormAction()
  const [copiedCode, setCopiedCode] = useState('')

  const companyCodes = allCodes.filter(c => c.companyId === companyId)

  const handleGenerate = () => {
    run(() => generateCode({ maxUses: 10 }), 'Invite code generated')
  }

  const handleDelete = (code: string) => {
    run(() => deleteCode({ code }), 'Invite code deleted')
  }

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(''), 2000)
  }

  return (
    <section className="dashboard-section">
      <h2>Invite Codes</h2>

      {companyCodes.length === 0 ? (
        <p className="empty-state">No active invite codes. Generate one to invite team members.</p>
      ) : (
        <ul className="invite-list">
          {companyCodes.map(invite => (
            <li key={invite.code} className="invite-item">
              <div className="invite-code-display">
                <code className="invite-code">{invite.code}</code>
                <button
                  className="btn-copy"
                  onClick={() => handleCopy(invite.code)}
                >
                  {copiedCode === invite.code ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="invite-meta">
                <span className="invite-uses">{invite.usesRemaining} uses left</span>
                <button
                  className="btn-remove"
                  onClick={() => handleDelete(invite.code)}
                  disabled={loading}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        className="btn-generate"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? 'Generating...' : 'Generate Invite Code'}
      </button>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
    </section>
  )
}
