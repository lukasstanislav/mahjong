import type { Tile } from './deal'
import { matchKey } from './tiles'

export type Pair = [number, number]

/** Every matching pair (by tile id) among currently free tiles. */
export function findPairs(tiles: Tile[], freeIds: Set<number>): Pair[] {
  const groups = new Map<string, number[]>()
  for (const t of tiles) {
    if (!freeIds.has(t.id)) continue
    const k = matchKey(t.face)
    const g = groups.get(k)
    if (g) g.push(t.id)
    else groups.set(k, [t.id])
  }
  const pairs: Pair[] = []
  for (const ids of groups.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]])
    }
  }
  return pairs
}

const samePair = (a: Pair, b: Pair) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])

/**
 * A random available pair; if there is more than one, never the same as
 * `previous`, so pressing Help again always shows something different.
 */
export function randomHint(pairs: Pair[], previous: Pair | null, rnd: () => number = Math.random): Pair | null {
  const pool = previous && pairs.length > 1 ? pairs.filter((p) => !samePair(p, previous)) : pairs
  if (pool.length === 0) return null
  return pool[Math.floor(rnd() * pool.length)]
}
