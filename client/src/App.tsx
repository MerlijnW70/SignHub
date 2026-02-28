import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { useTable, useReducer } from 'spacetimedb/react'
import { Identity } from 'spacetimedb'
import { tables, reducers } from './module_bindings'
import { useIdentity, toHex } from './hooks/useIdentity'
import { useFormAction } from './hooks/useFormAction'
import type { UserAccount, Company, CompanyMember, Notification, Project, ProjectMember, ProjectChat } from './module_bindings/types'

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
  const [allMembers] = useTable(tables.company_member)

  // Derive my memberships and companies
  const myMemberships = allMembers.filter(m => toHex(m.identity) === identityHex)
  const myCompanies = myMemberships
    .map(m => allCompanies.find(c => c.id === m.companyId))
    .filter((c): c is Company => c != null)

  const activeCompanyId = myAccount?.activeCompanyId
  const myCompany = activeCompanyId != null
    ? allCompanies.find(c => c.id === activeCompanyId)
    : undefined
  const myMembership = activeCompanyId != null
    ? myMemberships.find(m => m.companyId === activeCompanyId)
    : undefined

  const [onlineUsers] = useTable(tables.online_user)
  const onlineCount = onlineUsers.filter(u => u.online).length

  // Auto-switch: if active company is null but user has memberships, switch to first
  const switchActiveCompany = useReducer(reducers.switchActiveCompany)
  useEffect(() => {
    if (myAccount && myAccount.activeCompanyId == null && myMemberships.length > 0) {
      switchActiveCompany({ companyId: myMemberships[0].companyId }).catch(() => {
        // Silently ignore — subscription update will retry
      })
    }
  }, [myAccount?.activeCompanyId, myMemberships.length])

  // ── Notifications & toasts ──
  const [allNotifications] = useTable(tables.notification)
  const myNotifications = allNotifications.filter(n => toHex(n.recipientIdentity) === identityHex)
  const activeNotifications = activeCompanyId != null
    ? myNotifications.filter(n => n.companyId === activeCompanyId)
    : []
  const unreadCount = activeNotifications.filter(n => !n.isRead).length

  const [toasts, setToasts] = useState<Array<{ id: string; title: string; body: string }>>([])
  const prevNotifIdsRef = useRef<Set<string>>(new Set())
  const initialLoadRef = useRef(true)

  useEffect(() => {
    const currentIds = new Set(myNotifications.map(n => String(n.id)))

    // On first render, capture existing IDs without toasting
    if (initialLoadRef.current) {
      prevNotifIdsRef.current = currentIds
      initialLoadRef.current = false
      return
    }

    // Find newly arrived unread notifications
    const newNotifs = myNotifications.filter(
      n => !prevNotifIdsRef.current.has(String(n.id)) && !n.isRead
    )

    if (newNotifs.length > 0) {
      setToasts(prev => [
        ...prev,
        ...newNotifs.map(n => ({
          id: `toast-${String(n.id)}-${Date.now()}`,
          title: n.title,
          body: n.body,
        })),
      ])
    }

    prevNotifIdsRef.current = currentIds
  }, [myNotifications])

  // Auto-dismiss toasts after 5 seconds
  useEffect(() => {
    if (toasts.length === 0) return
    const timer = setTimeout(() => setToasts(prev => prev.slice(1)), 5000)
    return () => clearTimeout(timer)
  }, [toasts])

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
      {myAccount && activeCompanyId != null && (
        <>
          {' | '}
          <NotificationBell notifications={activeNotifications} companyId={activeCompanyId} />
        </>
      )}
      {myAccount && (
        <>
          {' | '}
          <span>Logged in as {myAccount.nickname || myAccount.fullName}</span>
          {' '}
          <button onClick={handleSignOut}>Sign out</button>
        </>
      )}
      {myCompanies.length > 1 && myCompany && activeCompanyId != null && (
        <>
          {' | '}
          <CompanySwitcher
            myCompanies={myCompanies}
            myMemberships={myMemberships}
            activeCompanyId={activeCompanyId}
          />
        </>
      )}
      <hr />
    </div>
  )

  // ── Toast overlay ──
  const toastOverlay = toasts.length > 0 && (
    <div style={{
      position: 'fixed', top: 16, right: 16, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 350,
    }}>
      {toasts.map(toast => (
        <div key={toast.id} style={{
          background: '#333', color: 'white', padding: '12px 16px',
          borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          position: 'relative',
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{toast.title}</div>
          <div style={{ fontSize: 13, opacity: 0.9 }}>{toast.body}</div>
          <button
            onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
            style={{ position: 'absolute', top: 4, right: 8, background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 16 }}
          >x</button>
        </div>
      ))}
    </div>
  )

  // ── No account → sign up ──

  if (!myAccount) {
    return (
      <div>
        {toastOverlay}
        {statusBar}
        <SignUpSection />
      </div>
    )
  }

  // ── No memberships → create or join ──

  if (myMemberships.length === 0) {
    return (
      <div>
        {toastOverlay}
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

  if (!myCompany || !myMembership) {
    return (
      <div>
        {toastOverlay}
        {statusBar}
        <p>Loading company data...</p>
      </div>
    )
  }

  // ── Full Dashboard ──

  const roleTag = myMembership.role.tag
  const canManage = roleTag === 'Admin' || roleTag === 'Owner'
  const isPending = roleTag === 'Pending'

  // Pending users see a limited view until activated
  if (isPending) {
    return (
      <div>
        {toastOverlay}
        {statusBar}
        <h1>{myCompany.name}</h1>
        <p>@{myCompany.slug} — {myCompany.location}</p>
        <ProfileSection account={myAccount} membership={myMembership} />
        <hr />
        <div style={{ border: '2px solid orange', padding: 12, marginTop: 8 }}>
          <h2>Awaiting Activation</h2>
          <p>Your account is pending approval. An admin or owner of <strong>{myCompany.name}</strong> must activate your account before you can access company features.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {toastOverlay}
      {statusBar}

      <h1>{myCompany.name}</h1>
      <p>@{myCompany.slug} — {myCompany.location}</p>

      <ProfileSection account={myAccount} membership={myMembership} />
      {myCompanies.length > 0 && activeCompanyId != null && (
        <>
          <hr />
          <MyCompaniesSection
            myCompanies={myCompanies}
            myMemberships={myMemberships}
            activeCompanyId={activeCompanyId}
          />
        </>
      )}
      <hr />
      <TeamSection company={myCompany} myRole={roleTag} isMe={isMe} allMembers={allMembers} />
      <hr />
      {canManage && <CompanySettingsSection company={myCompany} />}
      {canManage && <><hr /><CapabilitiesSection companyId={myCompany.id} /></>}
      {canManage && <><hr /><InviteCodesSection companyId={myCompany.id} /></>}
      {canManage && <><hr /><ConnectionsSection company={myCompany} /></>}

      <hr />
      <ProjectsSection company={myCompany} canManage={canManage} />

      <hr />
      <details>
        <summary>Join Another Company</summary>
        <div style={{ marginTop: 8 }}>
          <JoinCompanySection onBack={() => {}} />
        </div>
      </details>
    </div>
  )
}

// ── Notification Bell ──────────────────────────────────────

function NotificationBell({ notifications, companyId }: {
  notifications: Notification[]
  companyId: bigint
}) {
  const markRead = useReducer(reducers.markNotificationRead)
  const markAllRead = useReducer(reducers.markAllNotificationsRead)
  const clearAll = useReducer(reducers.clearNotifications)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const sorted = [...notifications].sort(
    (a, b) => Number(b.createdAt?.microsSinceUnixEpoch ?? 0n) - Number(a.createdAt?.microsSinceUnixEpoch ?? 0n)
  )
  const unread = sorted.filter(n => !n.isRead)
  const hasRead = sorted.some(n => n.isRead)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ position: 'relative', cursor: 'pointer', background: 'none', border: '1px solid #ccc', padding: '2px 8px' }}
      >
        Bell{unread.length > 0 && (
          <span style={{
            position: 'absolute', top: -8, right: -8,
            background: 'red', color: 'white', borderRadius: '50%',
            fontSize: 11, fontWeight: 'bold', minWidth: 18, height: 18,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px',
          }}>
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 1000,
          background: 'white', border: '1px solid #ccc', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          width: 320, maxHeight: 400, overflowY: 'auto',
        }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Notifications</strong>
            <span>
              {unread.length > 0 && (
                <button onClick={() => markAllRead({ companyId }).catch(() => {})} style={{ fontSize: 12, marginRight: 4 }}>Mark all read</button>
              )}
              {hasRead && (
                <button onClick={() => { clearAll({ companyId }).catch(() => {}); setOpen(false) }} style={{ fontSize: 12 }}>Clear read</button>
              )}
            </span>
          </div>

          {sorted.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#888' }}>No notifications</div>
          ) : (
            sorted.map(n => (
              <div
                key={String(n.id)}
                onClick={() => { if (!n.isRead) markRead({ notificationId: n.id }).catch(() => {}) }}
                style={{
                  padding: '8px 12px', borderBottom: '1px solid #f0f0f0',
                  cursor: n.isRead ? 'default' : 'pointer',
                  background: n.isRead ? 'white' : '#f0f7ff',
                }}
              >
                <div style={{ fontWeight: n.isRead ? 'normal' : 'bold', fontSize: 13 }}>{n.title}</div>
                <div style={{ fontSize: 12, color: '#555' }}>{n.body}</div>
              </div>
            ))
          )}
        </div>
      )}
    </span>
  )
}

// ── Company Switcher ──────────────────────────────────────

function CompanySwitcher({ myCompanies, myMemberships, activeCompanyId }: {
  myCompanies: Company[]
  myMemberships: CompanyMember[]
  activeCompanyId: bigint
}) {
  const switchCompany = useReducer(reducers.switchActiveCompany)
  const { error, run } = useFormAction()

  return (
    <span>
      <select
        value={String(activeCompanyId)}
        onChange={e => run(() => switchCompany({ companyId: BigInt(e.target.value) }))}
      >
        {myCompanies.map(c => {
          const membership = myMemberships.find(m => m.companyId === c.id)
          return (
            <option key={String(c.id)} value={String(c.id)}>
              {c.name} ({membership?.role?.tag ?? 'Member'})
            </option>
          )
        })}
      </select>
      {error && <span style={{ color: 'red' }}> {error}</span>}
    </span>
  )
}

// ── My Companies ──────────────────────────────────────────

function MyCompaniesSection({ myCompanies, myMemberships, activeCompanyId }: {
  myCompanies: Company[]
  myMemberships: CompanyMember[]
  activeCompanyId: bigint
}) {
  const switchCompany = useReducer(reducers.switchActiveCompany)
  const leaveCompany = useReducer(reducers.leaveCompany)
  const { error, loading, run } = useFormAction()
  const [confirmLeaveId, setConfirmLeaveId] = useState<bigint | null>(null)

  return (
    <div>
      <h2>My Companies ({myCompanies.length})</h2>
      <table border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>Company</th>
            <th>Location</th>
            <th>Your Role</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {myCompanies.map(c => {
            const mem = myMemberships.find(m => m.companyId === c.id)
            const roleTag = mem?.role?.tag ?? 'Member'
            const isActive = c.id === activeCompanyId
            return (
              <tr key={String(c.id)} style={isActive ? { fontWeight: 'bold' } : undefined}>
                <td>{c.name}{isActive ? ' (active)' : ''}</td>
                <td>{c.location}</td>
                <td>{roleTag}</td>
                <td>
                  {!isActive && (
                    <button onClick={() => switchCompany({ companyId: c.id })} disabled={loading}>
                      Switch to
                    </button>
                  )}
                  {roleTag !== 'Owner' && (
                    <>
                      {' '}
                      {confirmLeaveId === c.id ? (
                        <span>
                          <strong>Leave {c.name}?</strong>{' '}
                          <button onClick={() => {
                            setConfirmLeaveId(null)
                            // Switch to this company first if not active, then leave
                            run(async () => {
                              if (!isActive) await switchCompany({ companyId: c.id })
                              await leaveCompany()
                            }, `Left ${c.name}`)
                          }} disabled={loading}>Confirm</button>
                          {' '}
                          <button onClick={() => setConfirmLeaveId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmLeaveId(c.id)} disabled={loading}>Leave</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {error && <p style={{ color: 'red' }}>{error}</p>}
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

function ProfileSection({ account, membership }: { account: UserAccount; membership: CompanyMember }) {
  const updateProfile = useReducer(reducers.updateProfile)
  const { error, success, loading, run } = useFormAction()
  const [editing, setEditing] = useState(false)
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
      <p>Role: <strong>{membership.role.tag}</strong></p>
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

function TeamSection({ company, myRole, isMe, allMembers }: { company: Company; myRole: string; isMe: (id: unknown) => boolean; allMembers: CompanyMember[] }) {
  const [allAccounts] = useTable(tables.user_account)
  const companyMembers = allMembers.filter(m => m.companyId === company.id)
  const [onlineUsers] = useTable(tables.online_user)

  const removeColleague = useReducer(reducers.removeColleague)
  const updateUserRole = useReducer(reducers.updateUserRole)
  const transferOwnership = useReducer(reducers.transferOwnership)
  const { error, success, loading, run } = useFormAction()

  const [confirmAction, setConfirmAction] = useState<{ type: 'transfer' | 'remove'; identity: unknown; name: string } | null>(null)

  const isOwner = myRole === 'Owner'
  const isAdmin = myRole === 'Admin'
  const canManage = isOwner || isAdmin

  const isOnline = (memberIdentity: unknown): boolean => {
    const hex = toHex(memberIdentity)
    return onlineUsers.some(u => toHex(u.identity) === hex && u.online)
  }

  const handleRoleChange = (memberIdentity: unknown, newRoleTag: string) => {
    run(() => updateUserRole({
      targetIdentity: memberIdentity as Identity,
      newRole: { tag: newRoleTag } as { tag: 'Admin' } | { tag: 'Member' } | { tag: 'Installer' } | { tag: 'Field' } | { tag: 'Pending' },
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

  // Join membership with account data
  const teamData = companyMembers.map(m => ({
    membership: m,
    account: allAccounts.find(a => toHex(a.identity) === toHex(m.identity)),
  })).filter(t => t.account != null) as { membership: CompanyMember; account: UserAccount }[]

  const internalTeam = teamData.filter(t => t.membership.role?.tag !== 'Installer' && t.membership.role?.tag !== 'Pending')
  const hires = teamData.filter(t => t.membership.role?.tag === 'Installer')
  const pending = teamData.filter(t => t.membership.role?.tag === 'Pending')

  const renderMemberRow = ({ membership: mem, account: acct }: { membership: CompanyMember; account: UserAccount }) => {
    const memberRoleTag = mem.role?.tag ?? 'Member'
    const isSelf = isMe(mem.identity)
    const displayName = acct.nickname || acct.fullName
    return (
      <tr key={toHex(mem.identity)}>
        <td>{isOnline(mem.identity) ? '🟢' : '⚪'}</td>
        <td>{displayName}{isSelf ? ' (you)' : ''}</td>
        <td>{acct.email}</td>
        <td>
          {canManage && !isSelf && memberRoleTag !== 'Owner' && (
            memberRoleTag === 'Pending'
              ? <button onClick={() => handleRoleChange(mem.identity, 'Member')} disabled={loading}>Activate</button>
              : (memberRoleTag === 'Installer' || memberRoleTag === 'Field')
                ? <select value={memberRoleTag} onChange={e => handleRoleChange(mem.identity, e.target.value)} disabled={loading}>
                    <option value="Installer">Installer</option>
                    <option value="Field">Field</option>
                  </select>
                : isOwner
                  ? <select value={memberRoleTag} onChange={e => handleRoleChange(mem.identity, e.target.value)} disabled={loading}>
                      <option value="Admin">Admin</option>
                      <option value="Member">Member</option>
                    </select>
                  : null
          )}
          {' '}{memberRoleTag}
        </td>
        {canManage && (
          <td>
            {isOwner && !isSelf && memberRoleTag !== 'Pending' && memberRoleTag !== 'Installer' && memberRoleTag !== 'Field' && (
              <button onClick={() => setConfirmAction({ type: 'transfer', identity: mem.identity, name: displayName })} disabled={loading}>
                Transfer Ownership
              </button>
            )}
            {' '}
            {canManage && !isSelf && (memberRoleTag === 'Pending' || memberRoleTag === 'Member' || memberRoleTag === 'Field' || memberRoleTag === 'Installer' || isOwner) && memberRoleTag !== 'Owner' && (
              <button onClick={() => setConfirmAction({ type: 'remove', identity: mem.identity, name: displayName })} disabled={loading}>
                Remove
              </button>
            )}
          </td>
        )}
      </tr>
    )
  }

  const renderTable = (rows: typeof teamData) => (
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
      <tbody>{rows.map(renderMemberRow)}</tbody>
    </table>
  )

  return (
    <div>
      <h2>Team ({internalTeam.length})</h2>
      {internalTeam.length > 0 ? renderTable(internalTeam) : <p>No team members yet.</p>}

      <h2 style={{ marginTop: 16 }}>Hires ({hires.length})</h2>
      {hires.length > 0 ? renderTable(hires) : <p>No external hires yet.</p>}

      <h2 style={{ marginTop: 16 }}>Pending ({pending.length})</h2>
      {pending.length > 0 ? renderTable(pending) : <p>No pending members.</p>}

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
  const [allMembers] = useTable(tables.company_member)

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
    // Check if the requester has a membership in our company
    return allMembers.some(m => toHex(m.identity) === toHex(conn.requestedBy) && m.companyId === company.id)
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
        <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && chatInput.trim()) handleSendChat(conn.id) }} placeholder="Type a message..." />
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
                {' | '}
                <button onClick={() => setExpandedChat(expandedChat === conn.id ? null : conn.id)} style={{ fontWeight: 'bold' }}>
                  {expandedChat === conn.id ? 'Close Chat' : 'Open Chat'}
                </button>
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
                {' | '}
                <button onClick={() => setExpandedChat(expandedChat === conn.id ? null : conn.id)} style={{ fontWeight: 'bold' }}>
                  {expandedChat === conn.id ? 'Close Chat' : 'Open Chat'}
                </button>
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
                {' | '}
                <button onClick={() => setExpandedChat(expandedChat === conn.id ? null : conn.id)} style={{ fontWeight: 'bold' }}>
                  {expandedChat === conn.id ? 'Close Chat' : 'Open Chat'}
                </button>
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
                    <div style={{ display: 'inline-block', marginTop: 4 }}>
                      <p style={{ margin: '4px 0' }}>Send a message with your request, or just connect directly.</p>
                      <input value={requestMessage} onChange={e => setRequestMessage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSendRequest(c.id) }} placeholder="Write a message..." autoFocus />
                      {' '}
                      <button onClick={() => handleSendRequest(c.id)} disabled={loading}>
                        {requestMessage.trim() ? 'Send with Message' : 'Just Connect'}
                      </button>
                      {' '}
                      <button onClick={() => { setRequestTargetId(null); setRequestMessage('') }}>Cancel</button>
                    </div>
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

// ── Projects Section ──────────────────────────────────────

function ProjectsSection({ company, canManage }: { company: Company; canManage: boolean }) {
  const { identityHex } = useIdentity()

  const [allProjects] = useTable(tables.project)
  const [allProjectMembers] = useTable(tables.project_member)
  const [allProjectChats] = useTable(tables.project_chat)
  const [allCompanies] = useTable(tables.company)
  const [allMembers] = useTable(tables.company_member)
  const [allAccounts] = useTable(tables.user_account)
  const [allConnections] = useTable(tables.company_connection)

  const createProject = useReducer(reducers.createProject)
  const inviteToProject = useReducer(reducers.inviteToProject)
  const acceptProjectInvite = useReducer(reducers.acceptProjectInvite)
  const declineProjectInvite = useReducer(reducers.declineProjectInvite)
  const sendProjectChat = useReducer(reducers.sendProjectChat)
  const leaveProject = useReducer(reducers.leaveProject)
  const kickFromProject = useReducer(reducers.kickFromProject)
  const deleteProject = useReducer(reducers.deleteProject)
  const { error, success, loading, run } = useFormAction()

  const [view, setView] = useState<'list' | 'create' | 'detail'>('list')
  const [selectedProjectId, setSelectedProjectId] = useState<bigint | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [inviteTargetId, setInviteTargetId] = useState<bigint | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // My company's project memberships
  const myProjectMemberships = allProjectMembers.filter(m => m.companyId === company.id)
  const pendingInvites = myProjectMemberships.filter(m => m.status.tag === 'Invited')
  const acceptedMemberships = myProjectMemberships.filter(m => m.status.tag === 'Accepted')

  // Projects I'm a member of (Accepted)
  const myProjects = acceptedMemberships
    .map(m => allProjects.find(p => p.id === m.projectId))
    .filter((p): p is Project => p != null)

  // Projects I'm invited to
  const invitedProjects = pendingInvites
    .map(m => allProjects.find(p => p.id === m.projectId))
    .filter((p): p is Project => p != null)

  // Selected project detail
  const selectedProject = selectedProjectId != null
    ? allProjects.find(p => p.id === selectedProjectId)
    : undefined
  const selectedMembers = selectedProjectId != null
    ? allProjectMembers.filter(m => m.projectId === selectedProjectId)
    : []
  const selectedChats = selectedProjectId != null
    ? [...allProjectChats.filter(c => c.projectId === selectedProjectId)]
        .sort((a, b) => Number(a.createdAt?.microsSinceUnixEpoch ?? 0n) - Number(b.createdAt?.microsSinceUnixEpoch ?? 0n))
    : []
  const acceptedMembers = selectedMembers.filter(m => m.status.tag === 'Accepted')
  const isOwner = selectedProject?.ownerCompanyId === company.id

  // Build sender lookup map: identityHex -> { companyName, nickname }
  const senderMap = useMemo(() => {
    const map = new Map<string, { companyName: string; nickname: string }>()
    for (const pm of acceptedMembers) {
      const comp = allCompanies.find(c => c.id === pm.companyId)
      const companyName = comp?.name ?? 'Unknown'
      // Find all members of this company
      const compMembers = allMembers.filter(m => m.companyId === pm.companyId)
      for (const cm of compMembers) {
        const hex = toHex(cm.identity)
        if (!map.has(hex)) {
          const acc = allAccounts.find(a => toHex(a.identity) === hex)
          map.set(hex, { companyName, nickname: acc?.nickname ?? 'Unknown' })
        }
      }
    }
    return map
  }, [acceptedMembers.length, allMembers.length, allCompanies.length, allAccounts.length])

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedChats.length])

  const getCompanyName = (id: bigint) =>
    allCompanies.find(c => c.id === id)?.name ?? 'Unknown'

  const handleCreate = () => {
    run(async () => {
      await createProject({ name: createName, description: createDesc })
      setCreateName('')
      setCreateDesc('')
      setView('list')
    }, 'Project created')
  }

  const handleSendChat = () => {
    if (!chatInput.trim() || selectedProjectId == null) return
    const text = chatInput
    setChatInput('')
    run(async () => {
      try {
        await sendProjectChat({ projectId: selectedProjectId, text })
      } catch (err) {
        // Restore message on failure so the user doesn't lose it
        setChatInput(text)
        throw err
      }
    })
  }

  // Companies available for invitation: accepted connections not already in the project
  const invitableCompanies = selectedProjectId != null
    ? allConnections
        .filter(c => c.status.tag === 'Accepted' && (c.companyA === company.id || c.companyB === company.id))
        .map(c => c.companyA === company.id ? c.companyB : c.companyA)
        .filter(cid => !selectedMembers.some(m => m.companyId === cid && (m.status.tag === 'Accepted' || m.status.tag === 'Invited')))
        .map(cid => allCompanies.find(c => c.id === cid))
        .filter((c): c is Company => c != null)
    : []

  // ── Pending invitations banner ──
  const inviteBanner = invitedProjects.length > 0 && (
    <div style={{ border: '2px solid #4a90d9', padding: 12, marginBottom: 12 }}>
      <h3>Pending Project Invitations</h3>
      {invitedProjects.map(p => (
        <div key={String(p.id)} style={{ marginBottom: 8 }}>
          <strong>{p.name}</strong> — from {getCompanyName(p.ownerCompanyId)}
          {p.description && <div style={{ fontSize: 13, color: '#555' }}>{p.description}</div>}
          {canManage ? (
            <div style={{ marginTop: 4 }}>
              <button
                onClick={() => run(() => acceptProjectInvite({ projectId: p.id }), 'Invitation accepted')}
                disabled={loading}
              >{loading ? 'Processing...' : 'Accept'}</button>
              {' '}
              <button
                onClick={() => run(() => declineProjectInvite({ projectId: p.id }), 'Invitation declined')}
                disabled={loading}
              >{loading ? 'Processing...' : 'Decline'}</button>
            </div>
          ) : (
            <div style={{ marginTop: 4, fontSize: 13, color: '#888' }}>
              An admin must accept or decline this invitation.
            </div>
          )}
        </div>
      ))}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}
    </div>
  )

  // ── Create form ──
  if (view === 'create') {
    return (
      <div>
        <h2>Projects</h2>
        <h3>Create New Project</h3>
        <div>
          <input
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            placeholder="Project name"
            maxLength={80}
          />
        </div>
        <div style={{ marginTop: 4 }}>
          <textarea
            value={createDesc}
            onChange={e => setCreateDesc(e.target.value)}
            placeholder="Description (optional)"
            maxLength={500}
            rows={3}
            style={{ width: '100%', maxWidth: 400 }}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={handleCreate} disabled={loading || !createName.trim()}>
            {loading ? 'Creating...' : 'Create Project'}
          </button>
          {' '}
          <button onClick={() => setView('list')}>Cancel</button>
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </div>
    )
  }

  // ── Project detail view — stale check ──
  if (view === 'detail' && !selectedProject && selectedProjectId != null) {
    return (
      <div>
        <h2>Projects</h2>
        <p>This project is no longer available. It may have been deleted.</p>
        <button onClick={() => { setView('list'); setSelectedProjectId(null) }}>&larr; Back to projects</button>
      </div>
    )
  }

  // ── Project detail view ──
  if (view === 'detail' && selectedProject) {
    return (
      <div>
        <h2>Projects</h2>
        <button onClick={() => { setView('list'); setSelectedProjectId(null) }}>&larr; Back to projects</button>

        <h3>{selectedProject.name}</h3>
        {selectedProject.description && <p style={{ color: '#555' }}>{selectedProject.description}</p>}
        <p style={{ fontSize: 13, color: '#888' }}>
          Owner: {getCompanyName(selectedProject.ownerCompanyId)}
          {isOwner && ' (you)'}
        </p>

        {/* Members */}
        <h4>Members ({acceptedMembers.length})</h4>
        <ul>
          {acceptedMembers.map(m => (
            <li key={String(m.id)}>
              {getCompanyName(m.companyId)}
              {m.companyId === selectedProject.ownerCompanyId && ' (owner)'}
              {m.companyId === company.id && ' (you)'}
              {isOwner && canManage && m.companyId !== company.id && (
                <>
                  {' '}
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${getCompanyName(m.companyId)} from this project?`)) {
                        run(() => kickFromProject({ projectId: selectedProject.id, targetCompanyId: m.companyId }), 'Company removed')
                      }
                    }}
                    disabled={loading}
                    style={{ fontSize: 12 }}
                  >Kick</button>
                </>
              )}
            </li>
          ))}
        </ul>

        {/* Invited (pending) members */}
        {selectedMembers.filter(m => m.status.tag === 'Invited').length > 0 && (
          <>
            <h4>Invited</h4>
            <ul>
              {selectedMembers.filter(m => m.status.tag === 'Invited').map(m => (
                <li key={String(m.id)}>{getCompanyName(m.companyId)} — pending</li>
              ))}
            </ul>
          </>
        )}

        {/* Invite new company (owner only) */}
        {isOwner && canManage && (
          <div style={{ marginTop: 8 }}>
            <h4>Invite Company</h4>
            {invitableCompanies.length === 0 ? (
              <p style={{ fontSize: 13, color: '#888' }}>No connected companies available to invite.</p>
            ) : (
              <div>
                <select
                  value={inviteTargetId != null ? String(inviteTargetId) : ''}
                  onChange={e => setInviteTargetId(e.target.value ? BigInt(e.target.value) : null)}
                >
                  <option value="">Select a company...</option>
                  {invitableCompanies.map(c => (
                    <option key={String(c.id)} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
                {' '}
                <button
                  onClick={() => {
                    if (inviteTargetId != null) {
                      const targetId = inviteTargetId
                      run(async () => {
                        await inviteToProject({ projectId: selectedProject.id, targetCompanyId: targetId })
                        setInviteTargetId(null)
                      }, 'Invitation sent')
                    }
                  }}
                  disabled={loading || inviteTargetId == null}
                >Invite</button>
              </div>
            )}
          </div>
        )}

        {/* Chat */}
        <h4>Chat</h4>
        <div style={{ border: '1px solid #ddd', maxHeight: 300, overflowY: 'auto', padding: 8, marginBottom: 8 }}>
          {selectedChats.length === 0 ? (
            <p style={{ color: '#888', textAlign: 'center' }}>No messages yet.</p>
          ) : (
            selectedChats.map(msg => {
              const sender = senderMap.get(toHex(msg.sender))
              const isMyMsg = toHex(msg.sender) === identityHex
              return (
                <div key={String(msg.id)} style={{ marginBottom: 6 }}>
                  <span style={{ fontWeight: 'bold', color: isMyMsg ? '#2a7ae2' : '#333' }}>
                    [{sender?.companyName ?? '?'}] {sender?.nickname ?? '?'}:
                  </span>{' '}
                  <span>{msg.text}</span>
                </div>
              )
            })
          )}
          <div ref={chatEndRef} />
        </div>
        <div>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && chatInput.trim()) handleSendChat() }}
            placeholder="Type a message..."
            style={{ width: '60%' }}
          />
          {' '}
          <button onClick={handleSendChat} disabled={loading || !chatInput.trim()}>Send</button>
        </div>
        {error && <p style={{ color: 'red', fontSize: 13, marginTop: 4 }}>{error}</p>}

        {/* Actions — admin+ only */}
        {canManage && (
          <div style={{ marginTop: 16 }}>
            {isOwner ? (
              <button
                onClick={() => {
                  if (confirm(`Delete project "${selectedProject.name}"? This cannot be undone.`)) {
                    run(async () => {
                      await deleteProject({ projectId: selectedProject.id })
                      setView('list')
                      setSelectedProjectId(null)
                    }, 'Project deleted')
                  }
                }}
                disabled={loading}
                style={{ color: 'red' }}
              >Delete Project</button>
            ) : (
              <button
                onClick={() => {
                  if (confirm(`Leave project "${selectedProject.name}"?`)) {
                    run(async () => {
                      await leaveProject({ projectId: selectedProject.id })
                      setView('list')
                      setSelectedProjectId(null)
                    }, 'Left project')
                  }
                }}
                disabled={loading}
              >Leave Project</button>
            )}
          </div>
        )}

        {error && <p style={{ color: 'red' }}>{error}</p>}
        {success && <p style={{ color: 'green' }}>{success}</p>}
      </div>
    )
  }

  // ── Project list view (default) ──
  return (
    <div>
      <h2>Projects</h2>

      {inviteBanner}

      {canManage && (
        <button onClick={() => setView('create')} style={{ marginBottom: 12 }}>
          + Create Project
        </button>
      )}

      {myProjects.length === 0 ? (
        <p>No active projects. {canManage ? 'Create one or wait for invitations.' : 'Wait for project invitations from your admin.'}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 4 }}>Project</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 4 }}>Owner</th>
              <th style={{ textAlign: 'center', borderBottom: '1px solid #ccc', padding: 4 }}>Members</th>
              <th style={{ borderBottom: '1px solid #ccc', padding: 4 }}></th>
            </tr>
          </thead>
          <tbody>
            {myProjects.map(p => {
              const memberCount = allProjectMembers.filter(
                m => m.projectId === p.id && m.status.tag === 'Accepted'
              ).length
              return (
                <tr key={String(p.id)}>
                  <td style={{ padding: 4 }}>{p.name}</td>
                  <td style={{ padding: 4 }}>{getCompanyName(p.ownerCompanyId)}</td>
                  <td style={{ padding: 4, textAlign: 'center' }}>{memberCount}</td>
                  <td style={{ padding: 4 }}>
                    <button onClick={() => { setSelectedProjectId(p.id); setView('detail') }}>
                      View
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}
    </div>
  )
}

export default App
