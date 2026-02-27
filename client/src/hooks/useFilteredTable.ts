/**
 * Custom hook for server-side filtered table subscriptions.
 *
 * Works around the SpacetimeDB SDK bug where `.where()` generates SQL
 * with JS property names (camelCase) instead of DB column names (snake_case)
 * for renamed columns. This hook accepts raw SQL strings that use the
 * correct DB column names, ensuring server-side filtering.
 *
 * Usage:
 *   const [rows] = useFilteredTable<Connection>(
 *     `SELECT * FROM company_connection WHERE company_a = ${id} OR company_b = ${id}`,
 *     'company_connection'
 *   )
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSpacetimeDB } from 'spacetimedb/react'

type AnyTable = {
  iter(): Iterable<any>
  onInsert(cb: (...args: any[]) => void): void
  removeOnInsert(cb: (...args: any[]) => void): void
  onDelete(cb: (...args: any[]) => void): void
  removeOnDelete(cb: (...args: any[]) => void): void
  onUpdate?(cb: (...args: any[]) => void): void
  removeOnUpdate?(cb: (...args: any[]) => void): void
}

export function useFilteredTable<T>(
  sql: string | undefined,
  accessorName: string
): [T[], boolean] {
  const connectionState = useSpacetimeDB()
  const [version, setVersion] = useState(0)
  const [ready, setReady] = useState(false)

  const bump = useCallback(
    () => setVersion(v => v + 1),
    []
  )

  // Subscribe with raw SQL (server-side filtering)
  useEffect(() => {
    if (!sql || !connectionState.isActive) return
    const conn = connectionState.getConnection()
    if (!conn) return

    const sub = conn.subscriptionBuilder()
      .onApplied(() => {
        setReady(true)
        setVersion(v => v + 1)
      })
      .subscribe(sql)

    return () => {
      sub.unsubscribe()
    }
    // connectionState.isActive is the stable trigger; getConnection is a method ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, connectionState.isActive])

  // Re-render on any table row change
  useEffect(() => {
    if (!connectionState.isActive) return
    const conn = connectionState.getConnection()
    if (!conn) return
    const table: AnyTable = conn.db[accessorName]
    if (!table) return

    table.onInsert(bump)
    table.onDelete(bump)
    table.onUpdate?.(bump)
    return () => {
      table.removeOnInsert(bump)
      table.removeOnDelete(bump)
      table.removeOnUpdate?.(bump)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState.isActive, accessorName, bump])

  // Read from local cache (only contains server-filtered rows)
  const rows = useMemo(() => {
    if (!connectionState.isActive) return []
    const conn = connectionState.getConnection()
    if (!conn) return []
    const table: AnyTable = conn.db[accessorName]
    if (!table) return []
    return Array.from(table.iter()) as T[]
    // version counter drives re-reads; isActive gates access
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, connectionState.isActive, accessorName])

  return [rows, ready]
}
