import { describe, expect, it } from 'vitest'
import { dealSolvable } from './deal'
import { isFree, turtleLayout, type Position } from './layout'
import { canMatch, tilePairs } from './tiles'

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

describe('layout', () => {
  const layout = turtleLayout()

  it('has 144 unique positions', () => {
    expect(layout).toHaveLength(144)
    expect(new Set(layout.map((p) => `${p.x},${p.y},${p.z}`)).size).toBe(144)
  })

  it('blocks a tile with neighbours on both long sides', () => {
    const a: Position = { x: 2, y: 0, z: 0 }
    const l: Position = { x: 0, y: 0, z: 0 }
    const r: Position = { x: 4, y: 0, z: 0 }
    expect(isFree(a, [a, l])).toBe(true)
    expect(isFree(a, [a, l, r])).toBe(false)
  })

  it('blocks a tile covered from above, including half-offset cover', () => {
    const a: Position = { x: 12, y: 6, z: 3 }
    expect(isFree(a, [a, { x: 13, y: 7, z: 4 }])).toBe(false)
  })

  it('has the expected number of free tiles at start', () => {
    const free = layout.filter((p) => isFree(p, layout))
    // layer 0: ends of rows 0,1,2,5,6,7 (12) + left cap + outer right cap
    // layer 1: row ends (12), layer 2: row ends (8), layer 3: all under apex, apex: 1
    expect(free).toHaveLength(35)
  })
})

describe('tiles', () => {
  it('produces 72 matching pairs', () => {
    const pairs = tilePairs()
    expect(pairs).toHaveLength(72)
    for (const [a, b] of pairs) expect(canMatch(a, b)).toBe(true)
  })
})

describe('dealSolvable', () => {
  it('returns a deal whose recorded solution clears the board', () => {
    for (let s = 1; s <= 20; s++) {
      const { tiles, solution } = dealSolvable(turtleLayout(), seeded(s))
      const remaining = new Map(tiles.map((t) => [t.id, t]))
      for (const [a, b] of solution) {
        const positions = [...remaining.values()].map((t) => t.pos)
        const ta = remaining.get(a)!
        const tb = remaining.get(b)!
        expect(isFree(ta.pos, positions)).toBe(true)
        expect(isFree(tb.pos, positions)).toBe(true)
        expect(canMatch(ta.face, tb.face)).toBe(true)
        remaining.delete(a)
        remaining.delete(b)
      }
      expect(remaining.size).toBe(0)
    }
  })
})
