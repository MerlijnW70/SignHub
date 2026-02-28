import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useTable, useReducer } from 'spacetimedb/react'
import { Identity } from 'spacetimedb'
import { tables, reducers } from './module_bindings'
import { useIdentity, toHex } from './hooks/useIdentity'
import { useFormAction } from './hooks/useFormAction'
import type { UserAccount, Company } from './module_bindings/types'

const TOKEN_KEY = 'stdb_token'

function toSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// ── App Shell ──────────────────────────────────────────────

function App() {
  const { isActive, identity } = useIdentity()

  if (!isActive || !identity) {
    return <div><p>Connecting to SpacetimeDB...</p></div>
  }

  return <AuthenticatedApp />
}

// ── Authenticated App ──────────────────────────────────────

function AuthenticatedApp() {
  const { identityHex, isMe } = useIdentity()
  const [companyMode, setCompanyMode] = useState<'choose' | 'create' | 'join'>('choose')

  const [accounts] = useTable(tables.user_account)
  const myAccount = accounts.find(a => toHex(a.identity) === identityHex)

  const [allCompanies] = useTable(tables.company)
  const myCompany = myAccount?.companyId != null
    ? allCompanies.find(c => c.id === myAccount.companyId)
    : undefined

  const [onlineUsers] = useTable(tables.online_user)
  const onlineCount = onlineUsers.filter(u => u.online).length

  // Demo user setup
  const createAccount = useReducer(reducers.createAccount)
  const createCompany = useReducer(reducers.createCompany)
  const { error: demoError, loading: demoLoading, run: demoRun } = useFormAction()

  const handleDemo = (variant: 'A' | 'B') => {
    const isA = variant === 'A'
    demoRun(async () => {
      await createAccount({
        fullName: isA ? 'Alice van Dijk' : 'Bob Jansen',
        nickname: isA ? 'Alice' : 'Bob',
        email: isA ? 'alice@alphasigns.test' : 'bob@betasigns.test',
      })
      await createCompany({
        name: isA ? 'Alpha Signs' : 'Beta Signs',
        slug: isA ? 'alpha-signs' : 'beta-signs',
        location: isA ? 'Amsterdam, NL' : 'Rotterdam, NL',
      })
    }, 'Demo account created')
  }

  const handleSignOut = () => {
    localStorage.removeItem(TOKEN_KEY)
    window.location.reload()
  }

  // ── Status bar ──

  const statusBar = (
    <div>
      <span>{identityHex ? 'Connected' : 'Connecting...'}</span>
      {' | '}
      <span>{onlineCount} online</span>
      {myAccount && (
        <>
          {' | '}
          <span>Logged in as {myAccount.nickname || myAccount.fullName}</span>
          {' '}
          <button onClick={handleSignOut}>Sign out</button>
        </>
      )}
      <hr />
    </div>
  )

  // ── No account → sign up ──

  if (!myAccount) {
    return (
      <div>
        {statusBar}
        <SignUpSection />
        <hr />
        <h3>Quick Demo Setup</h3>
        <button onClick={() => handleDemo('A')} disabled={demoLoading}>
          {demoLoading ? 'Setting up...' : 'Demo User A — Alpha Signs'}
        </button>
        {' '}
        <button onClick={() => handleDemo('B')} disabled={demoLoading}>
          {demoLoading ? 'Setting up...' : 'Demo User B — Beta Signs'}
        </button>
        {demoError && <p style={{ color: 'red' }}>{demoError}</p>}
      </div>
    )
  }

  // ── No company → create or join ──

  if (myAccount.companyId === undefined || myAccount.companyId === null) {
    return (
      <div>
        {statusBar}
        <h2>Join or Create a Company</h2>
        {companyMode === 'choose' && (
          <div>
            <button onClick={() => setCompanyMode('join')}>I have an invite code</button>
            {' '}
            <button onClick={() => setCompanyMode('create')}>Create a new company</button>
          </div>
        )}
        {companyMode === 'create' && (
          <CreateCompanySection onBack={() => setCompanyMode('choose')} />
        )}
        {companyMode === 'join' && (
          <JoinCompanySection onBack={() => setCompanyMode('choose')} />
        )}
      </div>
    )
  }

  // ── Waiting for company data ──

  if (!myCompany) {
    return (
      <div>
        {statusBar}
        <p>Loading company data...</p>
      </div>
    )
  }

  // ── Full Dashboard ──

  const roleTag = myAccount.role.tag
  const canManage = roleTag !== 'Member' && roleTag !== 'Field'

  return (
    <div>
      {statusBar}

      <h1>{myCompany.name}</h1>
      <p>@{myCompany.slug} — {myCompany.location}</p>

      <ProfileSection account={myAccount} />
      <hr />
      {canManage && <CompanySettingsSection company={myCompany} />}
      {canManage && <><hr /><CapabilitiesSection companyId={myCompany.id} /></>}
      <hr />
      <TeamSection company={myCompany} myRole={roleTag} isMe={isMe} />
      {canManage && <><hr /><InviteCodesSection companyId={myCompany.id} /></>}
      {canManage && <><hr /><ConnectionsSection company={myCompany} /></>}
    </div>
  )
}

// ── Sign Up ────────────────────────────────────────────────

function SignUpSection() {
  const createAccount = useReducer(reducers.createAccount)
  const { error, loading, run } = useFormAction()
  const [fullName, setFullName] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    run(() => createAccount({
      fullName: fullName.trim(),
      nickname: nickname.trim(),
      email: email.trim(),
    }))
  }

  return (
    <div>
      <h2>Create Account</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Full Name: </label>
          <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Merlijn van der Waal" />
        </div>
        <div>
          <label>Nickname: </label>
          <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Merlijn" />
        </div>
        <div>
          <label>Email: </label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="merlijn@signshop.com" />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading || !fullName.trim() || !nickname.trim() || !email.trim()}>
          {loading ? 'Creating...' : 'Create Account'}
        </button>
      </form>
    </div>
  )
}

// ── Create Company ─────────────────────────────────────────

function CreateCompanySection({ onBack }: { onBack: () => void }) {
  const createCompany = useReducer(reducers.createCompany)
  const { error, loading, run } = useFormAction()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [location, setLocation] = useState('')

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) setSlug(toSlug(value))
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    run(() => createCompany({ name: name.trim(), slug: slug.trim(), location: location.trim() }))
  }

  return (
    <div>
      <h3>Create a Company</h3>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Company Name: </label>
          <input value={name} onChange={e => handleNameChange(e.target.value)} placeholder="Acme Signs" />
        </div>
        <div>
          <label>URL Slug: </label>
          <input value={slug} onChange={e => { setSlugEdited(true); setSlug(toSlug(e.target.value)) }} placeholder="acme-signs" />
          <small> signmakerhub.com/@{slug || '...'}</small>
        </div>
        <div>
          <label>Location: </label>
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Austin, TX" />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading || !name.trim() || !slug.trim() || !location.trim()}>
          {loading ? 'Creating...' : 'Create Company'}
        </button>
      </form>
      <button onClick={onBack}>Back</button>
    </div>
  )
}

// ── Join Company ───────────────────────────────────────────

function JoinCompanySection({ onBack }: { onBack: () => void }) {
  const joinCompany = useReducer(reducers.joinCompany)
  const { error, loading, run } = useFormAction()
  const [code, setCode] = useState('')

  const formatCode = (value: string): string => {
    const clean = value.toUpperCase().replace(/[^A-HJKLMNP-Z2-9]/g, '').slice(0, 16)
    return clean.replace(/(.{4})(?=.)/g, '$1-')
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    run(() => joinCompany({ code: code.trim() }))
  }

  return (
    <div>
      <h3>Join a Company</h3>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Invite Code: </label>
          <input value={code} onChange={e => setCode(formatCode(e.target.value))} placeholder="XXXX-XXXX-XXXX-XXXX" maxLength={19} />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading || code.replace(/-/g, '').length !== 16}>
          {loading ? 'Joining...' : 'Join Company'}
        </button>
      </form>
      <button onClick={onBack}>Back</button>
    </div>
  )
}

// ── Profile ────────────────────────────────────────────────

function ProfileSection({ account }: { account: UserAccount }) {
  const updateProfile = useReducer(reducers.updateProfile)
  const leaveCompany = useReducer(reducers.leaveCompany)
  const { error, success, loading, run } = useFormAction()
  const [editing, setEditing] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [fullName, setFullName] = useState(account.fullName)
  const [nickname, setNickname] = useState(account.nickname)
  const [email, setEmail] = useState(account.email)

  useEffect(() => {
    setFullName(account.fullName)
    setNickname(account.nickname)
    setEmail(account.email)
  }, [account.fullName, account.nickname, account.email])

  const handleSave = () => {
    run(async () => {
      await updateProfile({ nickname: nickname.trim(), email: email.trim() })
      setEditing(false)
    }, 'Profile updated')
  }

  return (
    <div>
      <h2>Your Profile</h2>
      <p>Role: <strong>{account.role.tag}</strong></p>
      {!editing ? (
        <div>
          <p>Name: {account.fullName}</p>
          <p>Nickname: {account.nickname}</p>
          <p>Email: {account.email}</p>
          <button onClick={() => setEditing(true)}>Edit Profile</button>
        </div>
      ) : (
        <div>
          <div><label>Full Name: </label><input value={fullName} onChange={e => setFullName(e.target.value)} /></div>
          <div><label>Nickname: </label><input value={nickname} onChange={e => setNickname(e.target.value)} /></div>
          <div><label>Email: </label><input value={email} onChange={e => setEmail(e.target.value)} /></div>
          <button onClick={handleSave} disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
          {' '}
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
      {account.role.tag !== 'Owner' && account.companyId != null && (
        !confirmLeave ? (
          <button onClick={() => setConfirmLeave(true)}>Leave Company</button>
        ) : (
          <div style={{ border: '2px solid red', padding: 8, marginTop: 8 }}>
            <p><strong>Leave company?</strong> You will lose access and need a new invite to rejoin.</p>
            <button onClick={() => { run(() => leaveCompany(), 'Left company'); setConfirmLeave(false) }} disabled={loading}>
              {loading ? 'Leaving...' : 'Confirm Leave'}
            </button>
            {' '}
            <button onClick={() => setConfirmLeave(false)}>Cancel</button>
          </div>
        )
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}
    </div>
  )
}

// ── Company Settings ───────────────────────────────────────

function CompanySettingsSection({ company }: { company: Company }) {
  const updateProfile = useReducer(reducers.updateCompanyProfile)
  const { error, success, loading, run } = useFormAction()

  const [name, setName] = useState(company.name)
  const [slug, setSlug] = useState(company.slug)
  const [location, setLocation] = useState(company.location)
  const [bio, setBio] = useState(company.bio)
  const [isPublic, setIsPublic] = useState(company.isPublic)
  const [kvkNumber, setKvkNumber] = useState(company.kvkNumber)

  useEffect(() => {
    setName(company.name)
    setSlug(company.slug)
    setLocation(company.location)
    setBio(company.bio)
    setIsPublic(company.isPublic)
    setKvkNumber(company.kvkNumber)
  }, [company.name, company.slug, company.location, company.bio, company.isPublic, company.kvkNumber])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    run(() => updateProfile({
      name: name.trim(), slug: slug.trim(), location: location.trim(),
      bio: bio.trim(), isPublic, kvkNumber: kvkNumber.trim(),
    }), 'Company profile updated')
  }

  return (
    <div>
      <h2>Company Settings</h2>
      <form onSubmit={handleSubmit}>
        <div><label>Name: </label><input value={name} onChange={e => setName(e.target.value)} /></div>
        <div><label>Slug: </label><input value={slug} onChange={e => setSlug(e.target.value)} /></div>
        <div><label>Location: </label><input value={location} onChange={e => setLocation(e.target.value)} /></div>
        <div><label>KvK Number: </label><input value={kvkNumber} onChange={e => setKvkNumber(e.target.value)} placeholder="12345678" /></div>
        <div><label>Bio: </label><textarea value={bio} onChange={e => setBio(e.target.value)} placeholder="About your company..." /></div>
        <div><label><input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} /> Visible in public directory</label></div>
        <button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Company Profile'}</button>
        {error && <span style={{ color: 'red' }}> {error}</span>}
        {success && <span style={{ color: 'green' }}> {success}</span>}
      </form>
    </div>
  )
}

// ── Capabilities ───────────────────────────────────────────

function CapabilitiesSection({ companyId }: { companyId: bigint }) {
  const [allCapabilities] = useTable(tables.capability)
  const cap = allCapabilities.find(c => c.companyId === companyId)
  const updateCapabilities = useReducer(reducers.updateCapabilities)
  const { error, success, loading, run } = useFormAction()

  const [canInstall, setCanInstall] = useState(false)
  const [hasCnc, setHasCnc] = useState(false)
  const [hasLargeFormat, setHasLargeFormat] = useState(false)
  const [hasBucketTruck, setHasBucketTruck] = useState(false)

  useEffect(() => {
    if (cap) {
      setCanInstall(cap.canInstall)
      setHasCnc(cap.hasCnc)
      setHasLargeFormat(cap.hasLargeFormat)
      setHasBucketTruck(cap.hasBucketTruck)
    }
  }, [cap?.companyId, cap?.canInstall, cap?.hasCnc, cap?.hasLargeFormat, cap?.hasBucketTruck])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    run(() => updateCapabilities({ canInstall, hasCnc, hasLargeFormat, hasBucketTruck }), 'Capabilities updated')
  }

  if (!cap) return <div><h2>Capabilities</h2><p>Loading...</p></div>

  return (
    <div>
      <h2>Capabilities</h2>
      <form onSubmit={handleSubmit}>
        <div><label><input type="checkbox" checked={canInstall} onChange={e => setCanInstall(e.target.checked)} /> Installation Services</label></div>
        <div><label><input type="checkbox" checked={hasCnc} onChange={e => setHasCnc(e.target.checked)} /> CNC Router</label></div>
        <div><label><input type="checkbox" checked={hasLargeFormat} onChange={e => setHasLargeFormat(e.target.checked)} /> Large Format Printing</label></div>
        <div><label><input type="checkbox" checked={hasBucketTruck} onChange={e => setHasBucketTruck(e.target.checked)} /> Bucket Truck</label></div>
        <button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Capabilities'}</button>
        {error && <span style={{ color: 'red' }}> {error}</span>}
        {success && <span style={{ color: 'green' }}> {success}</span>}
      </form>
    </div>
  )
}

// ── Team Management ────────────────────────────────────────

function TeamSection({ company, myRole, isMe }: { company: Company; myRole: string; isMe: (id: unknown) => boolean }) {
  const [allAccounts] = useTable(tables.user_account)
  const teamMembers = allAccounts.filter(a => a.companyId === company.id)
  const [onlineUsers] = useTable(tables.online_user)

  const removeColleague = useReducer(reducers.removeColleague)
  const updateUserRole = useReducer(reducers.updateUserRole)
  const transferOwnership = useReducer(reducers.transferOwnership)
  const { error, success, loading, run } = useFormAction()

  const [confirmAction, setConfirmAction] = useState<{ type: 'transfer' | 'remove'; identity: unknown; name: string } | null>(null)

  const isOwner = myRole === 'Owner'
  const canManage = myRole !== 'Member' && myRole !== 'Field'

  const isOnline = (memberIdentity: unknown): boolean => {
    const hex = toHex(memberIdentity)
    return onlineUsers.some(u => toHex(u.identity) === hex && u.online)
  }

  const handleRoleChange = (memberIdentity: unknown, newRoleTag: string) => {
    run(() => updateUserRole({
      targetIdentity: memberIdentity as Identity,
      newRole: { tag: newRoleTag } as { tag: 'Admin' } | { tag: 'Member' } | { tag: 'Field' },
    }), 'Role updated')
  }

  const handleConfirm = () => {
    if (!confirmAction) return
    if (confirmAction.type === 'transfer') {
      run(() => transferOwnership({ newOwnerIdentity: confirmAction.identity as Identity }), 'Ownership transferred')
    } else {
      run(() => removeColleague({ colleagueIdentity: confirmAction.identity as Identity }), 'Colleague removed')
    }
    setConfirmAction(null)
  }

  return (
    <div>
      <h2>Team ({teamMembers.length})</h2>
      <table border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>Status</th>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            {canManage && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {teamMembers.map(member => {
            const memberRoleTag = member.role?.tag ?? 'Member'
            const isSelf = isMe(member.identity)
            return (
              <tr key={toHex(member.identity)}>
                <td>{isOnline(member.identity) ? '🟢' : '⚪'}</td>
                <td>{member.nickname || member.fullName}{isSelf ? ' (you)' : ''}</td>
                <td>{member.email}</td>
                <td>
                  {isOwner && !isSelf && memberRoleTag !== 'Owner' ? (
                    <select value={memberRoleTag} onChange={e => handleRoleChange(member.identity, e.target.value)} disabled={loading}>
                      <option value="Admin">Admin</option>
                      <option value="Member">Member</option>
                      <option value="Field">Field</option>
                    </select>
                  ) : (
                    memberRoleTag
                  )}
                </td>
                {canManage && (
                  <td>
                    {isOwner && !isSelf && (
                      <button onClick={() => setConfirmAction({ type: 'transfer', identity: member.identity, name: member.nickname || member.fullName })} disabled={loading}>
                        Transfer Ownership
                      </button>
                    )}
                    {' '}
                    {canManage && !isSelf && (memberRoleTag === 'Member' || memberRoleTag === 'Field' || isOwner) && memberRoleTag !== 'Owner' && (
                      <button onClick={() => setConfirmAction({ type: 'remove', identity: member.identity, name: member.nickname || member.fullName })} disabled={loading}>
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}

      {confirmAction && (
        <div style={{ border: '2px solid red', padding: 8, marginTop: 8 }}>
          <p><strong>{confirmAction.type === 'transfer' ? 'Transfer Ownership' : 'Remove Team Member'}</strong></p>
          <p>
            {confirmAction.type === 'transfer'
              ? `Transfer ownership of ${company.name} to ${confirmAction.name}? You will become Admin.`
              : `Remove ${confirmAction.name} from ${company.name}? They will need a new invite to rejoin.`
            }
          </p>
          <button onClick={handleConfirm} disabled={loading}>{loading ? 'Processing...' : 'Confirm'}</button>
          {' '}
          <button onClick={() => setConfirmAction(null)}>Cancel</button>
        </div>
      )}
    </div>
  )
}

// ── Invite Codes ───────────────────────────────────────────

function InviteCodesSection({ companyId }: { companyId: bigint }) {
  const [allCodes] = useTable(tables.invite_code)
  const companyCodes = allCodes.filter(c => c.companyId === companyId)
  const generateCode = useReducer(reducers.generateInviteCode)
  const deleteCode = useReducer(reducers.deleteInviteCode)
  const { error, success, loading, run } = useFormAction()
  const [copiedCode, setCopiedCode] = useState('')

  const handleCopy = async (code: string) => {
    try { await navigator.clipboard.writeText(code) } catch { /* fallback */ }
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(''), 2000)
  }

  return (
    <div>
      <h2>Invite Codes</h2>
      {companyCodes.length === 0 ? (
        <p>No active invite codes.</p>
      ) : (
        <ul>
          {companyCodes.map(invite => (
            <li key={invite.code}>
              <code>{invite.code}</code>
              {' — '}{invite.usesRemaining} uses left{' '}
              <button onClick={() => handleCopy(invite.code)}>{copiedCode === invite.code ? 'Copied!' : 'Copy'}</button>
              {' '}
              <button onClick={() => run(() => deleteCode({ code: invite.code }), 'Deleted')} disabled={loading}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => run(() => generateCode({ maxUses: 10 }), 'Invite code generated')} disabled={loading}>
        {loading ? 'Generating...' : 'Generate Invite Code'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}
    </div>
  )
}

// ── Connections ────────────────────────────────────────────

function ConnectionsSection({ company }: { company: Company }) {
  const { identityHex } = useIdentity()

  const [allConnections] = useTable(tables.company_connection)
  const connections = allConnections.filter(c => c.companyA === company.id || c.companyB === company.id)

  const [allCompanies] = useTable(tables.company)
  const [allAccounts] = useTable(tables.user_account)
  const [allChats] = useTable(tables.connection_chat)

  const requestConnection = useReducer(reducers.requestConnection)
  const cancelRequest = useReducer(reducers.cancelRequest)
  const acceptConnection = useReducer(reducers.acceptConnection)
  const declineConnection = useReducer(reducers.declineConnection)
  const blockCompany = useReducer(reducers.blockCompany)
  const unblockCompany = useReducer(reducers.unblockCompany)
  const disconnectCompany = useReducer(reducers.disconnectCompany)
  const sendConnectionChat = useReducer(reducers.sendConnectionChat)
  const { error, success, loading, run } = useFormAction()

  const [showDirectory, setShowDirectory] = useState(false)
  const [expandedChat, setExpandedChat] = useState<bigint | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [requestTargetId, setRequestTargetId] = useState<bigint | null>(null)
  const [requestMessage, setRequestMessage] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Ghosting support: track company IDs where we sent a request but no
  // Pending row appeared (because the target silently blocked us).
  // We show these as phantom "Pending" entries so the blocked party
  // can't tell they've been ghosted. Persisted to localStorage so a
  // page refresh doesn't reveal the ghost.
  const [ghostedIds, setGhostedIds] = useState<Set<bigint>>(() => {
    try {
      const stored = localStorage.getItem(`ghosted_${String(company.id)}`)
      if (stored) {
        return new Set(JSON.parse(stored).map((v: string) => BigInt(v)))
      }
    } catch { /* ignore */ }
    return new Set()
  })

  // Persist ghosted IDs whenever they change
  useEffect(() => {
    const key = `ghosted_${String(company.id)}`
    if (ghostedIds.size === 0) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify([...ghostedIds].map(String)))
    }
  }, [ghostedIds, company.id])

  const getOtherCompanyId = (conn: typeof connections[0]) =>
    conn.companyA === company.id ? conn.companyB : conn.companyA

  const isRequestingCompany = (conn: typeof connections[0]) => {
    const requester = allAccounts.find(a => toHex(a.identity) === toHex(conn.requestedBy))
    return requester?.companyId === company.id
  }

  const getCompanyName = (id: bigint) => allCompanies.find(c => c.id === id)?.name ?? `Company #${id}`
  const getSenderName = (identity: unknown) => {
    const a = allAccounts.find(acc => toHex(acc.identity) === toHex(identity))
    return a?.nickname || a?.fullName || 'Unknown'
  }

  const pendingIncoming = connections.filter(c => c.status.tag === 'Pending' && !isRequestingCompany(c))
  const pendingOutgoing = connections.filter(c => c.status.tag === 'Pending' && isRequestingCompany(c))
  const accepted = connections.filter(c => c.status.tag === 'Accepted')
  const blockedIds = new Set(connections.filter(c => c.status.tag === 'Blocked').map(getOtherCompanyId))
  const connectedIds = new Set(connections.filter(c => c.status.tag !== 'Blocked').map(getOtherCompanyId))

  // Prune ghosted IDs if a real connection row now exists for that company
  useEffect(() => {
    if (ghostedIds.size === 0) return
    const toRemove = [...ghostedIds].filter(id => connectedIds.has(id))
    if (toRemove.length > 0) {
      setGhostedIds(prev => {
        const next = new Set(prev)
        for (const id of toRemove) next.delete(id)
        return next
      })
    }
  }, [connectedIds, ghostedIds])

  const publicCompanies = allCompanies.filter(c => c.isPublic)
  const availableCompanies = publicCompanies.filter(
    c => c.id !== company.id && !connectedIds.has(c.id) && !blockedIds.has(c.id) && !ghostedIds.has(c.id)
  )

  // Blocked companies we blocked (blockingCompanyId is now a company ID, not identity)
  const blockedByUs = connections.filter(c =>
    c.status.tag === 'Blocked'
    && (c.companyA === company.id || c.companyB === company.id)
    && c.blockingCompanyId === company.id
  )

  const getChats = (connectionId: bigint) =>
    allChats.filter(c => c.connectionId === connectionId)
      .sort((a, b) => Number(a.createdAt?.microsSinceUnixEpoch ?? 0n) - Number(b.createdAt?.microsSinceUnixEpoch ?? 0n))

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allChats, expandedChat])

  const handleSendRequest = (targetId: bigint) => {
    const msg = requestMessage
    setRequestTargetId(null)
    setRequestMessage('')
    run(async () => {
      await requestConnection({ targetCompanyId: targetId, message: msg })
      // After success, add to ghosted set. If a real Pending row appears
      // from the subscription, the useEffect above will prune it.
      // If the target blocked us, no row appears and the phantom stays.
      setGhostedIds(prev => new Set(prev).add(targetId))
    }, 'Request sent')
  }

  const handleSendChat = (connectionId: bigint) => {
    if (!chatInput.trim()) return
    run(() => sendConnectionChat({ connectionId, text: chatInput.trim() }))
    setChatInput('')
  }

  const renderChat = (conn: typeof connections[0]) => {
    if (expandedChat !== conn.id) return null
    const chats = getChats(conn.id)
    return (
      <div style={{ marginLeft: 20, border: '1px solid #ccc', padding: 8 }}>
        {conn.initialMessage && <p><em>{getSenderName(conn.requestedBy)}: {conn.initialMessage}</em></p>}
        {chats.map(msg => (
          <p key={String(msg.id)} style={{ color: toHex(msg.sender) === identityHex ? 'blue' : 'inherit' }}>
            <strong>{getSenderName(msg.sender)}:</strong> {msg.text}
          </p>
        ))}
        <div ref={chatEndRef} />
        <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendChat(conn.id)} placeholder="Type a message..." />
        {' '}
        <button onClick={() => handleSendChat(conn.id)} disabled={loading || !chatInput.trim()}>Send</button>
      </div>
    )
  }

  return (
    <div>
      <h2>Connections</h2>

      {/* Incoming requests */}
      {pendingIncoming.length > 0 && (
        <div>
          <h3>Incoming Requests</h3>
          <ul>
            {pendingIncoming.map(conn => (
              <li key={String(conn.id)}>
                <strong>{getCompanyName(getOtherCompanyId(conn))}</strong> wants to connect
                {' '}
                <button onClick={() => run(() => acceptConnection({ targetCompanyId: getOtherCompanyId(conn) }), 'Accepted')} disabled={loading}>Accept</button>
                {' '}
                <button onClick={() => run(() => declineConnection({ targetCompanyId: getOtherCompanyId(conn) }), 'Declined')} disabled={loading}>Decline</button>
                {' '}
                <button onClick={() => run(() => blockCompany({ targetCompanyId: getOtherCompanyId(conn) }), 'Blocked')} disabled={loading}>Block</button>
                {' '}
                <button onClick={() => setExpandedChat(expandedChat === conn.id ? null : conn.id)}>Chat</button>
                {renderChat(conn)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Active connections */}
      {accepted.length > 0 && (
        <div>
          <h3>Connected</h3>
          <ul>
            {accepted.map(conn => (
              <li key={String(conn.id)}>
                <strong>{getCompanyName(getOtherCompanyId(conn))}</strong> — Connected
                {' '}
                <button onClick={() => run(() => disconnectCompany({ targetCompanyId: getOtherCompanyId(conn) }), 'Disconnected')} disabled={loading}>Disconnect</button>
                {' '}
                <button onClick={() => run(() => blockCompany({ targetCompanyId: getOtherCompanyId(conn) }), 'Blocked')} disabled={loading}>Block</button>
                {' '}
                <button onClick={() => setExpandedChat(expandedChat === conn.id ? null : conn.id)}>Chat</button>
                {renderChat(conn)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Outgoing requests (real + ghosted phantoms) */}
      {(pendingOutgoing.length > 0 || ghostedIds.size > 0) && (
        <div>
          <h3>Sent Requests</h3>
          <ul>
            {pendingOutgoing.map(conn => (
              <li key={String(conn.id)}>
                <strong>{getCompanyName(getOtherCompanyId(conn))}</strong> — Pending
                {' '}
                <button onClick={() => run(() => cancelRequest({ targetCompanyId: getOtherCompanyId(conn) }), 'Cancelled')} disabled={loading}>Cancel</button>
                {' '}
                <button onClick={() => setExpandedChat(expandedChat === conn.id ? null : conn.id)}>Chat</button>
                {renderChat(conn)}
              </li>
            ))}
            {[...ghostedIds].map(id => (
              <li key={`ghost-${id}`}>
                <strong>{getCompanyName(id)}</strong> — Pending
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Blocked companies */}
      {blockedByUs.length > 0 && (
        <div>
          <h3>Blocked</h3>
          <ul>
            {blockedByUs.map(conn => (
              <li key={String(conn.id)}>
                {getCompanyName(getOtherCompanyId(conn))}
                {' '}
                <button onClick={() => run(() => unblockCompany({ targetCompanyId: getOtherCompanyId(conn) }), 'Unblocked')} disabled={loading}>Unblock</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {accepted.length === 0 && pendingIncoming.length === 0 && pendingOutgoing.length === 0 && ghostedIds.size === 0 && (
        <p>No connections yet. Browse the directory to connect with other sign shops.</p>
      )}

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}

      {/* Directory */}
      <button onClick={() => setShowDirectory(!showDirectory)}>
        {showDirectory ? 'Hide Directory' : 'Browse Directory'}
      </button>

      {showDirectory && (
        <div>
          {availableCompanies.length === 0 ? (
            <p>No other public companies available.</p>
          ) : (
            <ul>
              {availableCompanies.map(c => (
                <li key={String(c.id)}>
                  <strong>{c.name}</strong> — {c.location}
                  {' '}
                  {requestTargetId === c.id ? (
                    <span>
                      <input value={requestMessage} onChange={e => setRequestMessage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSendRequest(c.id) }} placeholder="Message (optional)" autoFocus />
                      {' '}
                      <button onClick={() => handleSendRequest(c.id)} disabled={loading}>Send</button>
                      {' '}
                      <button onClick={() => { setRequestTargetId(null); setRequestMessage('') }}>Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => setRequestTargetId(c.id)} disabled={loading}>Connect</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default App
