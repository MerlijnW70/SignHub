import { useTable } from 'spacetimedb/react'
import { tables } from '../module_bindings'
import { useIdentity } from '../hooks/useIdentity'

export function ConnectionStatus() {
  const { isActive } = useIdentity()
  const [onlineUsers] = useTable(tables.online_user)

  const onlineCount = onlineUsers.filter(u => u.online).length

  return (
    <>
      {!isActive && (
        <div className="banner-disconnected">
          Disconnected — reconnecting...
        </div>
      )}
      <div className="connection-status">
        <span className={`dot ${isActive ? 'online' : 'offline'}`} />
        <span>{isActive ? 'Connected' : 'Connecting...'}</span>
        {isActive && <span className="online-count">{onlineCount} online</span>}
      </div>
    </>
  )
}
