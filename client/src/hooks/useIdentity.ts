import { useSpacetimeDB } from 'spacetimedb/react'

/** Convert any SpacetimeDB identity value to a stable hex string for comparison. */
export function toHex(identity: unknown): string {
  if (!identity) return ''
  if (typeof identity === 'object' && identity !== null && 'toHexString' in identity) {
    return (identity as { toHexString: () => string }).toHexString()
  }
  return String(identity)
}

export function useIdentity() {
  const { identity, isActive } = useSpacetimeDB()

  const identityHex = toHex(identity)

  const isMe = (other: unknown): boolean => {
    if (!identityHex || !other) return false
    return identityHex === toHex(other)
  }

  return { identity, identityHex, isActive, isMe }
}
