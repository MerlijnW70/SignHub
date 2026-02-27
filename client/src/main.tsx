import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SpacetimeDBProvider } from 'spacetimedb/react'
import { DbConnection } from './module_bindings'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'
import App from './App.tsx'

const TOKEN_KEY = 'stdb_token'

const builder = DbConnection.builder()
  .withUri('ws://localhost:3000')
  .withDatabaseName('new-app-ulf9q')
  .withToken(localStorage.getItem(TOKEN_KEY) || '')
  .onConnect((_conn, _identity, token) => {
    localStorage.setItem(TOKEN_KEY, token)
  })
  .onDisconnect(() => {
    console.warn('SpacetimeDB disconnected — will auto-reconnect')
  })
  .onConnectError((_conn, err) => {
    console.error('SpacetimeDB connection error:', err)
  })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <SpacetimeDBProvider connectionBuilder={builder}>
        <App />
      </SpacetimeDBProvider>
    </ErrorBoundary>
  </StrictMode>,
)
