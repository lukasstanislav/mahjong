import { isFree, type Position } from './layout'
import { tilePairs, type Face } from './tiles'

export interface Tile {
  id: number
  pos: Position
  face: Face
}

export type Random = () => number

function shuffle<T>(arr: T[], rnd: Random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Randomly distribute faces over the fixed layout so that the board is
 * guaranteed to be solvable.
 *
 * A naive shuffle often produces dead boards. Instead we simulate a game in
 * reverse: repeatedly pick two positions that are free in the remaining
 * layout, give them a matching pair, and remove them. Playing those removals
 * in the same order is a valid solution. Rarely the simulation strands itself
 * (fewer than two free positions left); we then retry.
 */
export function dealSolvable(
  layout: Position[],
  rnd: Random = Math.random,
  maxAttempts = 200,
): { tiles: Tile[]; solution: Array<[number, number]> } {
  if (layout.length % 2 !== 0) throw new Error('Layout needs an even number of positions')

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pairs = shuffle(tilePairs(), rnd).slice(0, layout.length / 2)
    if (pairs.length * 2 !== layout.length) throw new Error('Not enough tiles for layout')

    const remaining = new Set(layout.map((_, i) => i))
    const faces = new Array<Face>(layout.length)
    const solution: Array<[number, number]> = []
    let stuck = false

    for (const [fa, fb] of pairs) {
      const remPos = [...remaining].map((i) => layout[i])
      const free = [...remaining].filter((i) => isFree(layout[i], remPos))
      if (free.length < 2) {
        stuck = true
        break
      }
      shuffle(free, rnd)
      const [a, b] = free
      faces[a] = fa
      faces[b] = fb
      remaining.delete(a)
      remaining.delete(b)
      solution.push([a, b])
    }

    if (!stuck) {
      return {
        tiles: layout.map((pos, id) => ({ id, pos, face: faces[id] })),
        solution,
      }
    }
  }
  throw new Error('Could not produce a solvable deal')
}
