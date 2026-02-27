import { useState, useEffect, type FormEvent } from 'react'
import { useTable, useReducer } from 'spacetimedb/react'
import { tables, reducers } from '../module_bindings'
import { useFormAction } from '../hooks/useFormAction'
import type { Company } from '../module_bindings/types'

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

  const handleProfileSubmit = (e: FormEvent) => {
    e.preventDefault()
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

  // Subscribe to all capabilities, filter client-side by company.
  // (SDK bug: .where() uses JS property names in SQL instead of DB column names)
  const [allCapabilities] = useTable(tables.capability)
  const capabilities = allCapabilities.filter(c => c.companyId === company.id)
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
            <button className="btn-save" type="submit" disabled={profileAction.loading}>
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
    </>
  )
}
