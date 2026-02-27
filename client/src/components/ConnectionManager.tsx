import { useState } from 'react'
import { useTable, useReducer } from 'spacetimedb/react'
import { tables, reducers } from '../module_bindings'
import { useIdentity, toHex } from '../hooks/useIdentity'
import { useFormAction } from '../hooks/useFormAction'
import type { Company } from '../module_bindings/types'

interface ConnectionManagerProps {
  company: Company
}

export function ConnectionManager({ company }: ConnectionManagerProps) {
  const { identityHex } = useIdentity()

  // Subscribe to all connections, filter client-side by company.
  // (SDK bug: .where() uses JS property names in SQL instead of DB column names)
  const [allConnections] = useTable(tables.company_connection)
  const connections = allConnections.filter(
    c => c.companyA === company.id || c.companyB === company.id
  )

  // Subscribe to all companies, filter client-side for directory
  const [allCompanies] = useTable(tables.company)
  const publicCompanies = allCompanies.filter(c => c.isPublic)

  const requestConnection = useReducer(reducers.requestConnection)
  const respondToConnection = useReducer(reducers.respondToConnection)
  const blockCompany = useReducer(reducers.blockCompany)
  const unblockCompany = useReducer(reducers.unblockCompany)
  const disconnectCompany = useReducer(reducers.disconnectCompany)
  const { error, success, loading, run } = useFormAction()

  const [showDirectory, setShowDirectory] = useState(false)

  // Derive connection data
  const getOtherCompanyId = (conn: typeof connections[0]) =>
    conn.companyA === company.id ? conn.companyB : conn.companyA

  const isRequester = (conn: typeof connections[0]) =>
    toHex(conn.requestedBy) === identityHex

  const pendingIncoming = connections.filter(
    c => c.status.tag === 'Pending' && !isRequester(c)
  )
  const pendingOutgoing = connections.filter(
    c => c.status.tag === 'Pending' && isRequester(c)
  )
  const accepted = connections.filter(c => c.status.tag === 'Accepted')
  const blocked = connections.filter(c => c.status.tag === 'Blocked')

  // Companies already connected or pending — exclude from directory
  const connectedIds = new Set(connections.map(getOtherCompanyId))
  const availableCompanies = publicCompanies.filter(
    c => c.id !== company.id && !connectedIds.has(c.id)
  )

  const getCompanyName = (companyId: bigint) => {
    const found = publicCompanies.find(c => c.id === companyId)
    return found?.name ?? `Company #${companyId}`
  }

  const handleRequest = (targetId: bigint) => {
    run(
      () => requestConnection({ targetCompanyId: targetId }),
      'Connection request sent'
    )
  }

  const handleRespond = (connectionId: bigint, accept: boolean) => {
    run(
      () => respondToConnection({ connectionId, accept }),
      accept ? 'Connection accepted' : 'Connection declined'
    )
  }

  const handleBlock = (targetId: bigint) => {
    run(
      () => blockCompany({ targetCompanyId: targetId }),
      'Company blocked'
    )
  }

  const handleDisconnect = (targetId: bigint) => {
    run(
      () => disconnectCompany({ targetCompanyId: targetId }),
      'Disconnected'
    )
  }

  const handleUnblock = (targetId: bigint) => {
    run(
      () => unblockCompany({ targetCompanyId: targetId }),
      'Company unblocked'
    )
  }

  return (
    <section className="dashboard-section">
      <h2>Connections</h2>

      {/* Incoming requests */}
      {pendingIncoming.length > 0 && (
        <div className="connection-group">
          <h3>Incoming Requests</h3>
          <ul className="connection-list">
            {pendingIncoming.map(conn => (
              <li key={String(conn.id)} className="connection-item">
                <span className="connection-name">
                  {getCompanyName(getOtherCompanyId(conn))}
                </span>
                <span className="connection-badge pending">Pending</span>
                <div className="connection-actions">
                  <button
                    className="btn-accept"
                    onClick={() => handleRespond(conn.id, true)}
                    disabled={loading}
                  >
                    Accept
                  </button>
                  <button
                    className="btn-remove"
                    onClick={() => handleRespond(conn.id, false)}
                    disabled={loading}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Active connections */}
      {accepted.length > 0 && (
        <div className="connection-group">
          <h3>Connected</h3>
          <ul className="connection-list">
            {accepted.map(conn => (
              <li key={String(conn.id)} className="connection-item">
                <span className="connection-name">
                  {getCompanyName(getOtherCompanyId(conn))}
                </span>
                <span className="connection-badge accepted">Connected</span>
                <div className="connection-actions">
                  <button
                    className="btn-disconnect"
                    onClick={() => handleDisconnect(getOtherCompanyId(conn))}
                    disabled={loading}
                  >
                    Disconnect
                  </button>
                  <button
                    className="btn-remove"
                    onClick={() => handleBlock(getOtherCompanyId(conn))}
                    disabled={loading}
                  >
                    Block
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Outgoing requests */}
      {pendingOutgoing.length > 0 && (
        <div className="connection-group">
          <h3>Sent Requests</h3>
          <ul className="connection-list">
            {pendingOutgoing.map(conn => (
              <li key={String(conn.id)} className="connection-item">
                <span className="connection-name">
                  {getCompanyName(getOtherCompanyId(conn))}
                </span>
                <span className="connection-badge pending">Pending</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Blocked companies */}
      {blocked.length > 0 && (
        <div className="connection-group">
          <h3>Blocked</h3>
          <ul className="connection-list">
            {blocked.map(conn => (
              <li key={String(conn.id)} className="connection-item">
                <span className="connection-name">
                  {getCompanyName(getOtherCompanyId(conn))}
                </span>
                <span className="connection-badge blocked">Blocked</span>
                <button
                  className="btn-accept"
                  onClick={() => handleUnblock(getOtherCompanyId(conn))}
                  disabled={loading}
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {accepted.length === 0 && pendingIncoming.length === 0 && pendingOutgoing.length === 0 && blocked.length === 0 && (
        <p className="empty-state">No connections yet. Browse the directory to connect with other sign shops.</p>
      )}

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {/* Directory browser */}
      <button
        className="btn-generate"
        onClick={() => setShowDirectory(!showDirectory)}
      >
        {showDirectory ? 'Hide Directory' : 'Browse Directory'}
      </button>

      {showDirectory && (
        <div className="directory">
          {availableCompanies.length === 0 ? (
            <p className="empty-state">No other public companies available.</p>
          ) : (
            <ul className="connection-list">
              {availableCompanies.map(c => (
                <li key={String(c.id)} className="connection-item">
                  <div className="connection-name">
                    <strong>{c.name}</strong>
                    <span className="connection-location">{c.location}</span>
                  </div>
                  <button
                    className="btn-accept"
                    onClick={() => handleRequest(c.id)}
                    disabled={loading}
                  >
                    Connect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
