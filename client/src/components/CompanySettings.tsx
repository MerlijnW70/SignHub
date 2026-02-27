import { useState, useEffect, type FormEvent } from 'react'
import { useReducer } from 'spacetimedb/react'
import { reducers } from '../module_bindings'
import { useFormAction } from '../hooks/useFormAction'
import { toHex } from '../hooks/useIdentity'
import { useFilteredTable } from '../hooks/useFilteredTable'
import type { Company, Capability, Connection, UserAccount } from '../module_bindings/types'

interface CompanySettingsProps {
  company: Company
}

export function CompanySettings({ company }: CompanySettingsProps) {
  // Profile form
  const updateProfile = useReducer(reducers.updateCompanyProfile)
  const profileAction = useFormAction()

  const [name, setName] = useState(company.name)
  const [slug, setSlug] = useState(company.slug)
  const [location, setLocation] = useState(company.location)
  const [bio, setBio] = useState(company.bio)
  const [isPublic, setIsPublic] = useState(company.isPublic)
  const [kvkNumber, setKvkNumber] = useState(company.kvkNumber)

  // Sync form when company data changes from server
  useEffect(() => {
    setName(company.name)
    setSlug(company.slug)
    setLocation(company.location)
    setBio(company.bio)
    setIsPublic(company.isPublic)
    setKvkNumber(company.kvkNumber)
  }, [company.name, company.slug, company.location, company.bio, company.isPublic, company.kvkNumber])

  const profileValid = name.trim().length > 0 && slug.trim().length > 0 && location.trim().length > 0

  const handleProfileSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!profileValid) return
    profileAction.run(
      () => updateProfile({
        name: name.trim(),
        slug: slug.trim(),
        location: location.trim(),
        bio: bio.trim(),
        isPublic,
        kvkNumber: kvkNumber.trim(),
      }),
      'Company profile updated'
    )
  }

  // Server-side filtered: only our company's capabilities
  const [capabilities] = useFilteredTable<Capability>(
    `SELECT * FROM capability WHERE company_id = ${company.id}`,
    'capability'
  )
  const updateCapabilities = useReducer(reducers.updateCapabilities)
  const capAction = useFormAction()

  const cap = capabilities[0]

  const [canInstall, setCanInstall] = useState(false)
  const [hasCnc, setHasCnc] = useState(false)
  const [hasLargeFormat, setHasLargeFormat] = useState(false)
  const [hasBucketTruck, setHasBucketTruck] = useState(false)

  // Sync capabilities when data arrives
  useEffect(() => {
    if (cap) {
      setCanInstall(cap.canInstall)
      setHasCnc(cap.hasCnc)
      setHasLargeFormat(cap.hasLargeFormat)
      setHasBucketTruck(cap.hasBucketTruck)
    }
  }, [cap?.companyId, cap?.canInstall, cap?.hasCnc, cap?.hasLargeFormat, cap?.hasBucketTruck])

  const handleCapSubmit = (e: FormEvent) => {
    e.preventDefault()
    capAction.run(
      () => updateCapabilities({ canInstall, hasCnc, hasLargeFormat, hasBucketTruck }),
      'Capabilities updated'
    )
  }

  // Server-side filtered: connections, companies, and accounts for our company
  const [allConnections] = useFilteredTable<Connection>(
    `SELECT * FROM company_connection WHERE company_a = ${company.id} OR company_b = ${company.id}`,
    'company_connection'
  )
  const [allCompanies] = useFilteredTable<Company>(
    `SELECT * FROM company WHERE id = ${company.id} OR is_public = true`,
    'company'
  )
  const [allAccounts] = useFilteredTable<UserAccount>(
    `SELECT * FROM user_account WHERE company_id = ${company.id}`,
    'user_account'
  )
  const unblockCompany = useReducer(reducers.unblockCompany)
  const blockAction = useFormAction()

  const blockedByUs = allConnections.filter(c => {
    if (c.status.tag !== 'Blocked') return false
    if (c.companyA !== company.id && c.companyB !== company.id) return false
    // Only show if the blocker belongs to our company
    if (!c.blockedBy) return false
    const blockerAccount = allAccounts.find(
      a => toHex(a.identity) === toHex(c.blockedBy!)
    )
    return blockerAccount?.companyId === company.id
  })

  const getOtherCompanyId = (conn: typeof blockedByUs[0]) =>
    conn.companyA === company.id ? conn.companyB : conn.companyA

  const getBlockedCompanyName = (companyId: bigint) => {
    const found = allCompanies.find(c => c.id === companyId)
    return found?.name ?? `Company #${companyId}`
  }

  return (
    <>
      <section className="dashboard-section">
        <h2>Company Settings</h2>
        <form className="settings-form" onSubmit={handleProfileSubmit}>
          <label>
            Company Name
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </label>
          <label>
            URL Slug
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value)}
            />
          </label>
          <label>
            Location
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
            />
          </label>
          <label>
            KvK Number
            <input
              type="text"
              value={kvkNumber}
              onChange={e => setKvkNumber(e.target.value)}
              placeholder="12345678"
            />
          </label>
          <label>
            Bio
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Tell other sign shops about your company..."
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={e => setIsPublic(e.target.checked)}
            />
            Visible in public directory
          </label>
          <div className="settings-actions">
            <button className="btn-save" type="submit" disabled={profileAction.loading || !profileValid}>
              {profileAction.loading ? 'Saving...' : 'Save Profile'}
            </button>
            {profileAction.error && <span className="error">{profileAction.error}</span>}
            {profileAction.success && <span className="success">{profileAction.success}</span>}
          </div>
        </form>
      </section>

      <section className="dashboard-section">
        <h2>Capabilities</h2>
        {!cap ? (
          <p className="empty-state">Loading capabilities...</p>
        ) : (
        <form className="settings-form" onSubmit={handleCapSubmit}>
          <div className="capabilities-grid">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={canInstall}
                onChange={e => setCanInstall(e.target.checked)}
              />
              Installation Services
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={hasCnc}
                onChange={e => setHasCnc(e.target.checked)}
              />
              CNC Router
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={hasLargeFormat}
                onChange={e => setHasLargeFormat(e.target.checked)}
              />
              Large Format Printing
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={hasBucketTruck}
                onChange={e => setHasBucketTruck(e.target.checked)}
              />
              Bucket Truck
            </label>
          </div>
          <div className="settings-actions">
            <button className="btn-save" type="submit" disabled={capAction.loading}>
              {capAction.loading ? 'Saving...' : 'Save Capabilities'}
            </button>
            {capAction.error && <span className="error">{capAction.error}</span>}
            {capAction.success && <span className="success">{capAction.success}</span>}
          </div>
        </form>
        )}
      </section>

      {blockedByUs.length > 0 && (
        <section className="dashboard-section">
          <h2>Blocked Companies</h2>
          <ul className="connection-list">
            {blockedByUs.map(conn => (
              <li key={String(conn.id)} className="connection-item">
                <span className="connection-name">
                  {getBlockedCompanyName(getOtherCompanyId(conn))}
                </span>
                <span className="connection-badge blocked">Blocked</span>
                <button
                  className="btn-accept"
                  onClick={() => blockAction.run(
                    () => unblockCompany({ targetCompanyId: getOtherCompanyId(conn) }),
                    'Company unblocked'
                  )}
                  disabled={blockAction.loading}
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
          {blockAction.error && <p className="error">{blockAction.error}</p>}
          {blockAction.success && <p className="success">{blockAction.success}</p>}
        </section>
      )}
    </>
  )
}
