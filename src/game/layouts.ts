import { turtleLayout, type Position } from './layout'

/**
 * Board layouts. Shapes are the traditional mahjong-solitaire forms, drawn
 * here from scratch (not copied from any program's layout files).
 *
 * Built in TILE units (x right, y down, z = layer), half-tile offsets allowed;
 * converted to the engine's half-tile units. Any even count up to 144 works:
 * a smaller layout simply uses fewer pairs of the tile set.
 */
export interface LayoutDef {
  id: string
  name: string
  positions: Position[]
}

class Builder {
  readonly p: Position[] = []
  tile(x: number, y: number, z: number) {
    this.p.push({ x: Math.round(x * 2), y: Math.round(y * 2), z })
    return this
  }
  /** w × h block of tiles with its top-left tile at (x, y). */
  rect(x: number, y: number, w: number, h: number, z: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.tile(x + i, y + j, z)
    return this
  }
}

/** Square stepped pyramid: 10×8, 8×6, 4×4. Deep stacks keep most tiles covered (hard). */
function pyramid(): Position[] {
  return new Builder().rect(0, 0, 10, 8, 0).rect(1, 1, 8, 6, 1).rect(3, 2, 4, 4, 2).p
}

/** Walled fortress: full floor with a well in the middle, a raised wall ring, and four corner towers. */
function fortress(): Position[] {
  const b = new Builder()
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 12; x++) {
      const well = x >= 4 && x <= 7 && y >= 3 && y <= 4
      if (!well) b.tile(x, y, 0)
      const ring = x === 0 || x === 11 || y === 0 || y === 7
      const innerCorner = (x === 1 || x === 10) && (y === 1 || y === 6)
      if (ring || innerCorner) b.tile(x, y, 1)
    }
  }
  for (const [tx, ty] of [[0, 0], [10, 0], [0, 6], [10, 6]]) b.rect(tx, ty, 2, 2, 2) // towers
  return b.p
}

/** Dragon: a wavy 3-2-1 ridged body, a tall head on the right and a short tail. */
function dragon(): Position[] {
  const b = new Builder()
  const yAt = (c: number) => Math.round((3 + 1.5 * Math.sin(c * 0.55)) * 2) / 2
  b.tile(-1, yAt(-1) - 0.5, 0).tile(-1, yAt(-1) + 0.5, 0) // tail
  for (let c = 0; c < 12; c++) {
    const y = yAt(c)
    b.tile(c, y - 1, 0).tile(c, y, 0).tile(c, y + 1, 0)
    b.tile(c, y - 0.5, 1).tile(c, y + 0.5, 1)
    b.tile(c, y, 2)
  }
  for (const c of [12, 13]) {
    const y = yAt(11)
    for (let z = 0; z < 4; z++) {
      for (let k = 0; k < 4 - z; k++) b.tile(c, y - (3 - z) / 2 + k, z) // 4-3-2-1 stacked column
    }
  }
  return b.p
}

/** Spider: stepped body with a head and eight bent legs, thighs raised. */
function spider(): Position[] {
  const b = new Builder()
  b.rect(5, 0, 5, 4, 0).rect(5.5, 0.5, 4, 3, 1).rect(6, 1, 3, 2, 2).rect(6.5, 1.5, 2, 1, 3) // body
  b.rect(6, -1, 3, 1, 0).tile(7, -1, 1) // head
  // leg rows: y of each successive tile going outward (4 legs per side, mirrored)
  const legs = [
    [0, -0.5, -1, -2, -3],
    [1, 1, 0.5, 0, -0.5],
    [2, 2, 2.5, 3, 3.5],
    [3, 3.5, 4, 5, 6],
  ]
  for (const ys of legs) {
    ys.forEach((y, i) => b.tile(10 + i, y, 0).tile(4 - i, y, 0))
    const thigh = (ys[0] + ys[1]) / 2
    b.tile(10.5, thigh, 1).tile(3.5, thigh, 1) // raised thigh over the first two leg tiles
  }
  return b.p
}

export const LAYOUTS: LayoutDef[] = [
  { id: 'turtle', name: 'Turtle', positions: turtleLayout() },
  { id: 'dragon', name: 'Dragon', positions: dragon() },
  { id: 'pyramid', name: 'Pyramid', positions: pyramid() },
  { id: 'fortress', name: 'Fortress', positions: fortress() },
  { id: 'spider', name: 'Spider', positions: spider() },
]

export const DEFAULT_LAYOUT = 'turtle'

export function getLayout(id: string): LayoutDef {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0]
}
