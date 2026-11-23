import { describe, expect, it } from 'vitest'
import { dealSolvable } from './deal'
import { isFree } from './layout'
import { LAYOUTS } from './layouts'
import { canMatch } from './tiles'

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

describe.each(LAYOUTS)('layout $name', ({ positions }) => {
  it('has an even number of tiles, at most 144', () => {
    expect(positions.length % 2).toBe(0)
    expect(positions.length).toBeLessThanOrEqual(144)
    expect(positions.length).toBeGreaterThan(40)
  })

  it('has no two tiles occupying the same space', () => {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]
        const b = positions[j]
        const overlap = a.z === b.z && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2
        expect(overlap, `tiles ${i} and ${j} overlap at layer ${a.z}`).toBe(false)
      }
    }
  })

  it('has every raised tile resting on a tile below', () => {
    for (const a of positions) {
      if (a.z === 0) continue
      const supported = positions.some((b) => b.z === a.z - 1 && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2)
      expect(supported, `floating tile at ${JSON.stringify(a)}`).toBe(true)
    }
  })

  it('deals solvably (recorded solution clears the board)', () => {
    for (let s = 1; s <= 20; s++) {
      const { tiles, solution } = dealSolvable(positions, seeded(s))
      const remaining = new Map(tiles.map((t) => [t.id, t]))
      for (const [a, b] of solution) {
        const pos = [...remaining.values()].map((t) => t.pos)
        expect(isFree(remaining.get(a)!.pos, pos) && isFree(remaining.get(b)!.pos, pos)).toBe(true)
        expect(canMatch(remaining.get(a)!.face, remaining.get(b)!.face)).toBe(true)
        remaining.delete(a)
        remaining.delete(b)
      }
      expect(remaining.size).toBe(0)
    }
  })
})

it('prints layout stats', () => {
  for (const { name, positions } of LAYOUTS) {
    const free = positions.filter((p) => isFree(p, positions)).length
    const layers = Math.max(...positions.map((p) => p.z)) + 1
    const w = (Math.max(...positions.map((p) => p.x)) - Math.min(...positions.map((p) => p.x))) / 2 + 1
    const h = (Math.max(...positions.map((p) => p.y)) - Math.min(...positions.map((p) => p.y))) / 2 + 1
    console.log(`${name.padEnd(9)} tiles ${String(positions.length).padStart(3)}  free at start ${String(free).padStart(2)}  layers ${layers}  size ${w}×${h}`)
  }
})
