import { DbConnection } from '../src/module_bindings'
import type { Identity } from 'spacetimedb'

const WS_URI = 'ws://localhost:3000'
const DB_NAME = 'new-app-ulf9q'

export interface TestClient {
  conn: DbConnection
  identity: Identity
  disconnect: () => void
}

/**
 * Creates a new SpacetimeDB client with a fresh identity.
 * Connects, subscribes to all tables, and resolves when the subscription is applied.
 */
export function createClient(): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('createClient timed out after 10s')),
      10_000
    )

    const conn = DbConnection.builder()
      .withUri(WS_URI)
      .withDatabaseName(DB_NAME)
      .onConnect((connection, identity, _token) => {
        connection
          .subscriptionBuilder()
          .onApplied(() => {
            clearTimeout(timeout)
            resolve({
              conn: connection,
              identity,
              disconnect: () => connection.disconnect(),
            })
          })
          .subscribeToAllTables()
      })
      .onConnectError((_ctx, err) => {
        clearTimeout(timeout)
        reject(err)
      })
      .build()
  })
}

/**
 * Polls a predicate until it returns true, or throws after timeout.
 */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000
): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`)
    }
    await sleep(50)
  }
}

/**
 * Calls an async function and asserts that it rejects with an error
 * message containing the expected substring.
 */
export async function expectError(
  fn: () => Promise<void>,
  expectedSubstring: string
): Promise<void> {
  try {
    await fn()
    throw new Error(
      `Expected error containing "${expectedSubstring}" but reducer succeeded`
    )
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : String(err)
    if (!msg.includes(expectedSubstring)) {
      throw new Error(
        `Expected error containing "${expectedSubstring}" but got: "${msg}"`
      )
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Converts an Identity to a hex string for comparison.
 */
export function identityToHex(identity: unknown): string {
  if (identity && typeof identity === 'object' && 'toHexString' in identity) {
    return (identity as { toHexString(): string }).toHexString()
  }
  if (identity instanceof Uint8Array) {
    return Array.from(identity)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return String(identity)
}
