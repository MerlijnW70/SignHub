import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SpacetimeDBProvider } from 'spacetimedb/react'
import { DbConnection } from './module_bindings'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={builder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>,
)
