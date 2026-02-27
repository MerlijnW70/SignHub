import { useSpacetimeDB } from 'spacetimedb/react'

export function useIdentity() {
  const { identity, isActive } = useSpacetimeDB()

  const identityHex = identity?.toHexString?.() ?? identity?.toString?.() ?? ''

  const isMe = (other: unknown): boolean => {
    if (!identityHex || !other) return false
    const otherStr =
      typeof other === 'object' && other !== null && 'toHexString' in other
        ? (other as { toHexString: () => string }).toHexString()
        : String(other)
    return identityHex === otherStr
  }

  return { identity, identityHex, isActive, isMe }
}
