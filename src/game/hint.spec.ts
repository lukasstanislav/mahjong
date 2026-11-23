import { describe, expect, it } from 'vitest'
import type { Tile } from './deal'
import { findPairs, randomHint, type Pair } from './hint'

const tile = (id: number, suit: Tile['face']['suit'], rank: number): Tile => ({
  id,
  pos: { x: id * 2, y: 0, z: 0 },
  face: { suit, rank },
})

describe('findPairs', () => {
  const tiles = [
    tile(0, 'dots', 1),
    tile(1, 'dots', 1),
    tile(2, 'dots', 1),
    tile(3, 'bamboo', 2),
    tile(4, 'flower', 1),
    tile(5, 'flower', 3),
    tile(6, 'bamboo', 2),
  ]

  it('lists all matching pairs among free tiles only', () => {
    const pairs = findPairs(tiles, new Set([0, 1, 2, 3, 4, 5])) // 6 is blocked
    const key = (p: Pair) => [...p].sort().join('-')
    expect(pairs.map(key).sort()).toEqual(['0-1', '0-2', '1-2', '4-5'])
  })

  it('returns nothing when no free tiles match', () => {
    expect(findPairs(tiles, new Set([0, 3, 4]))).toEqual([])
  })
})

describe('randomHint', () => {
  it('never repeats the previous pair when another exists', () => {
    const pairs: Pair[] = [[0, 1], [2, 3]]
    for (let i = 0; i < 20; i++) expect(randomHint(pairs, [1, 0])).toEqual([2, 3])
  })

  it('repeats when it is the only pair, and returns null when there is none', () => {
    expect(randomHint([[0, 1]], [0, 1])).toEqual([0, 1])
    expect(randomHint([], null)).toBeNull()
  })
})
