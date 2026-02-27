import { useState, useRef, useEffect } from 'react'
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

  // Subscribe to all companies, accounts, and chat messages
  const [allCompanies] = useTable(tables.company)
  const publicCompanies = allCompanies.filter(c => c.isPublic)
  const [allAccounts] = useTable(tables.user_account)
  const [allChats] = useTable(tables.connection_chat)

  const requestConnection = useReducer(reducers.requestConnection)
  const cancelRequest = useReducer(reducers.cancelRequest)
  const acceptConnection = useReducer(reducers.acceptConnection)
  const declineConnection = useReducer(reducers.declineConnection)
  const blockCompany = useReducer(reducers.blockCompany)
  const disconnectCompany = useReducer(reducers.disconnectCompany)
  const sendConnectionChat = useReducer(reducers.sendConnectionChat)
  const { error, success, loading, run } = useFormAction()

  const [showDirectory, setShowDirectory] = useState(false)
  const [expandedConnection, setExpandedConnection] = useState<bigint | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [requestMessage, setRequestMessage] = useState('')
  const [requestTargetId, setRequestTargetId] = useState<bigint | null>(null)
  const [lastSeen, setLastSeen] = useState<Map<string, number>>(() => new Map())
  const [closedChats, setClosedChats] = useState<Set<string>>(() => new Set())
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Derive connection data
  const getOtherCompanyId = (conn: typeof connections[0]) =>
    conn.companyA === company.id ? conn.companyB : conn.companyA

  // Company-level requester detection
  const isRequestingCompany = (conn: typeof connections[0]) => {
    const requester = allAccounts.find(
      a => toHex(a.identity) === toHex(conn.requestedBy)
    )
    return requester?.companyId === company.id
  }

  const pendingIncoming = connections.filter(
    c => c.status.tag === 'Pending' && !isRequestingCompany(c)
  )
  const pendingOutgoing = connections.filter(
    c => c.status.tag === 'Pending' && isRequestingCompany(c)
  )
  const accepted = connections.filter(c => c.status.tag === 'Accepted')

  // Ghosting: blocked companies are completely invisible
  const blockedIds = new Set(
    connections.filter(c => c.status.tag === 'Blocked').map(getOtherCompanyId)
  )

  // Companies already connected or pending — exclude from directory
  const connectedIds = new Set(
    connections
      .filter(c => c.status.tag !== 'Blocked')
      .map(getOtherCompanyId)
  )
  const availableCompanies = publicCompanies.filter(
    c => c.id !== company.id && !connectedIds.has(c.id) && !blockedIds.has(c.id)
  )

  const getCompanyName = (companyId: bigint) => {
    const found = allCompanies.find(c => c.id === companyId)
    return found?.name ?? `Company #${companyId}`
  }

  const getSenderName = (senderIdentity: unknown) => {
    const account = allAccounts.find(
      a => toHex(a.identity) === toHex(senderIdentity)
    )
    return account?.nickname || account?.fullName || 'Unknown'
  }

  const isMine = (senderIdentity: unknown) =>
    toHex(senderIdentity) === identityHex

  // Chat messages for expanded connection
  const getConnectionChats = (connectionId: bigint) =>
    allChats
      .filter(c => c.connectionId === connectionId)
      .sort((a, b) => {
        const ta = Number(a.createdAt?.microsSinceEpoch ?? 0n)
        const tb = Number(b.createdAt?.microsSinceEpoch ?? 0n)
        return ta - tb
      })

  // New message detection
  const hasNewMessages = (conn: typeof connections[0]) => {
    const chats = allChats.filter(c => c.connectionId === conn.id)
    if (chats.length === 0) return false
    const lastChat = chats.reduce((latest, c) => {
      const t = Number(c.createdAt?.microsSinceEpoch ?? 0n)
      return t > latest ? t : latest
    }, 0)
    const seen = lastSeen.get(String(conn.id)) ?? 0
    return lastChat > seen
  }

  // Mark connection as seen when expanded
  useEffect(() => {
    if (expandedConnection !== null) {
      const chats = allChats.filter(c => c.connectionId === expandedConnection)
      if (chats.length > 0) {
        const latest = chats.reduce((max, c) => {
          const t = Number(c.createdAt?.microsSinceEpoch ?? 0n)
          return t > max ? t : max
        }, 0)
        setLastSeen(prev => {
          const next = new Map(prev)
          next.set(String(expandedConnection), latest)
          return next
        })
      }
    }
  }, [expandedConnection, allChats])

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allChats, expandedConnection])

  // Handlers
  const handleRequest = (targetId: bigint) => {
    setRequestTargetId(targetId)
    setRequestMessage('')
  }

  const handleSendRequest = () => {
    if (requestTargetId === null) return
    run(
      () => requestConnection({ targetCompanyId: requestTargetId, message: requestMessage }),
      'Connection request sent'
    )
    setRequestTargetId(null)
    setRequestMessage('')
  }

  const handleCancelRequestForm = () => {
    setRequestTargetId(null)
    setRequestMessage('')
  }

  const handleCancel = (targetId: bigint) => {
    run(
      () => cancelRequest({ targetCompanyId: targetId }),
      'Request cancelled'
    )
  }

  const handleAccept = (targetId: bigint) => {
    run(
      () => acceptConnection({ targetCompanyId: targetId }),
      'Connection accepted'
    )
  }

  const handleDecline = (targetId: bigint) => {
    run(
      () => declineConnection({ targetCompanyId: targetId }),
      'Connection declined'
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

  const handleSendChat = (connectionId: bigint) => {
    if (!chatInput.trim()) return
    run(
      () => sendConnectionChat({ connectionId, text: chatInput.trim() }),
      ''
    )
    setChatInput('')
  }

  const toggleChat = (connId: bigint) => {
    setExpandedConnection(prev => prev === connId ? null : connId)
    setChatInput('')
  }

  const closeChat = (connId: bigint) => {
    setClosedChats(prev => {
      const next = new Set(prev)
      next.add(String(connId))
      return next
    })
    if (expandedConnection === connId) setExpandedConnection(null)
  }

  // Chat panel component
  const renderChat = (conn: typeof connections[0], alwaysShow = false) => {
    const isOpen = expandedConnection === conn.id
    const autoOpen = alwaysShow && !closedChats.has(String(conn.id))
    if (!isOpen && !autoOpen) return null
    const chats = getConnectionChats(conn.id)

    return (
      <div className="chat-panel">
        <div className="chat-panel-header">
          <button className="btn-subtle" onClick={() => closeChat(conn.id)}>Close</button>
        </div>
        <div className="chat-messages">
          {conn.initialMessage && (
            <div className="chat-initial">
              <span className="chat-sender">{getSenderName(conn.requestedBy)}</span>
              <p>{conn.initialMessage}</p>
            </div>
          )}
          {chats.map(msg => (
            <div
              key={String(msg.id)}
              className={`chat-message ${isMine(msg.sender) ? 'mine' : ''}`}
            >
              <span className="chat-sender">{getSenderName(msg.sender)}</span>
              <p>{msg.text}</p>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="chat-input-row">
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendChat(conn.id)}
            placeholder="Type a message..."
          />
          <button
            className="btn-accept"
            onClick={() => handleSendChat(conn.id)}
            disabled={loading || !chatInput.trim()}
          >
            Send
          </button>
        </div>
      </div>
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
              <li key={String(conn.id)} className="connection-item-wrap">
                <div
                  className="connection-item clickable"
                  onClick={() => toggleChat(conn.id)}
                >
                  <span className="connection-name">
                    {getCompanyName(getOtherCompanyId(conn))}
                    {hasNewMessages(conn) && <span className="new-message-dot" />}
                    <span className="connection-wants">wants to connect</span>
                  </span>
                  <div className="connection-actions">
                    <button
                      className="btn-accept"
                      onClick={e => { e.stopPropagation(); handleAccept(getOtherCompanyId(conn)) }}
                      disabled={loading}
                    >
                      Accept
                    </button>
                    <button
                      className="btn-subtle"
                      onClick={e => { e.stopPropagation(); handleDecline(getOtherCompanyId(conn)) }}
                      disabled={loading}
                    >
                      Decline
                    </button>
                    <button
                      className="btn-subtle"
                      onClick={e => { e.stopPropagation(); handleBlock(getOtherCompanyId(conn)) }}
                      disabled={loading}
                    >
                      Block
                    </button>
                  </div>
                </div>
                {renderChat(conn, true)}
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
              <li key={String(conn.id)} className="connection-item-wrap">
                <div
                  className="connection-item clickable"
                  onClick={() => toggleChat(conn.id)}
                >
                  <span className="connection-name">
                    {getCompanyName(getOtherCompanyId(conn))}
                    {hasNewMessages(conn) && <span className="new-message-dot" />}
                  </span>
                  <span className="connection-badge accepted">Connected</span>
                  <div className="connection-actions">
                    <button
                      className="btn-subtle"
                      onClick={e => { e.stopPropagation(); handleDisconnect(getOtherCompanyId(conn)) }}
                      disabled={loading}
                    >
                      Disconnect
                    </button>
                    <button
                      className="btn-subtle"
                      onClick={e => { e.stopPropagation(); handleBlock(getOtherCompanyId(conn)) }}
                      disabled={loading}
                    >
                      Block
                    </button>
                  </div>
                </div>
                {renderChat(conn)}
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
              <li key={String(conn.id)} className="connection-item-wrap">
                <div
                  className="connection-item clickable"
                  onClick={() => toggleChat(conn.id)}
                >
                  <span className="connection-name">
                    {getCompanyName(getOtherCompanyId(conn))}
                    {hasNewMessages(conn) && <span className="new-message-dot" />}
                  </span>
                  <span className="connection-badge pending">Request Sent</span>
                  <div className="connection-actions">
                    <button
                      className="btn-subtle"
                      onClick={e => { e.stopPropagation(); handleCancel(getOtherCompanyId(conn)) }}
                      disabled={loading}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
                {renderChat(conn)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {accepted.length === 0 && pendingIncoming.length === 0 && pendingOutgoing.length === 0 && (
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
                  {requestTargetId === c.id ? (
                    <div className="request-form">
                      <input
                        type="text"
                        value={requestMessage}
                        onChange={e => setRequestMessage(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSendRequest()}
                        placeholder="Why do you want to connect? (optional)"
                        autoFocus
                      />
                      <div className="request-form-actions">
                        <button
                          className="btn-accept"
                          onClick={handleSendRequest}
                          disabled={loading}
                        >
                          Send
                        </button>
                        <button
                          className="btn-subtle"
                          onClick={handleCancelRequestForm}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn-accept"
                      onClick={() => handleRequest(c.id)}
                      disabled={loading}
                    >
                      Connect
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
