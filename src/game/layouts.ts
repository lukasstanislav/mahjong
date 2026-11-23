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
  /**
   * 'wide' layouts suit landscape screens. 'tall' ones are drawn for phones in
   * portrait: at most ~7 columns × 10 rows, so tiles stay ~45 px wide (a
   * comfortable tap target) on a 390 px screen. The classic shapes are all wide.
   */
  shape: 'wide' | 'tall'
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
  /**
   * Symmetric profile: `layers[z][row]` = width of a row centred on column `cx`
   * (0 = empty). Rows may sit at half offsets via `y0`. Odd and even widths
   * centre exactly on whole or half columns.
   */
  profile(cx: number, layers: number[][], y0 = 0) {
    layers.forEach((rows, z) => rows.forEach((w, y) => w > 0 && this.rect(cx - (w - 1) / 2, y0 + y, w, 1, z)))
    return this
  }
}

// ---- tall (portrait) layouts ----------------------------------------------------

/** Tower: a tall stepped pyramid, 7×10 → 5×8 → 3×6 → 1×4. Many tiles, few free at start. */
function tower(): Position[] {
  return new Builder().rect(0, 0, 7, 10, 0).rect(1, 1, 5, 8, 1).rect(2, 2, 3, 6, 2).rect(3, 3, 1, 4, 3).p
}

/** Lantern: a rounded paper lantern with a cap and a tassel, domed in four layers. */
function lantern(): Position[] {
  return new Builder().profile(3, [
    [1, 5, 7, 7, 7, 7, 7, 7, 5, 1],
    [0, 3, 5, 5, 5, 5, 5, 5, 3, 0],
    [0, 0, 3, 3, 3, 3, 3, 3, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
  ]).p
}

/** Hourglass: two stepped bulbs joined by a single-tile waist (the waist tiles are free early). */
function hourglass(): Position[] {
  return new Builder().profile(3, [
    [7, 7, 5, 3, 1, 1, 3, 5, 7, 7],
    [5, 5, 3, 1, 0, 0, 1, 3, 5, 5],
    [3, 3, 1, 0, 0, 0, 0, 1, 3, 3],
    [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
  ]).p
}

/** Pagoda: three widening roofs over a base, each roof ridged a layer up on half rows, and a spire. */
function pagoda(): Position[] {
  const b = new Builder()
  b.tile(3, 0, 0).tile(3, 0, 1) // spire
  // [first row, width, rows] per storey; the ridge sits half a row down, one layer up
  const storeys: Array<[number, number, number]> = [[1, 3, 2], [3, 5, 2], [5, 7, 2], [7, 5, 3]]
  for (const [y, w, rows] of storeys) {
    b.rect(3 - (w - 1) / 2, y, w, rows, 0)
    b.rect(3 - (w - 3) / 2, y + 0.5, w - 2, rows - 1, 1)
    if (w >= 5) b.rect(3 - (w - 5) / 2, y + 0.5, w - 4, rows - 1, 2)
  }
  return b.p
}

/** Turtle turned on its side (rows ↔ columns): the classic 144 for a tall screen. Tiles come out small on phones. */
function tallTurtle(): Position[] {
  return turtleLayout().map((p) => ({ x: p.y, y: p.x, z: p.z }))
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
  { id: 'turtle', name: 'Turtle', shape: 'wide', positions: turtleLayout() },
  { id: 'dragon', name: 'Dragon', shape: 'wide', positions: dragon() },
  { id: 'pyramid', name: 'Pyramid', shape: 'wide', positions: pyramid() },
  { id: 'fortress', name: 'Fortress', shape: 'wide', positions: fortress() },
  { id: 'spider', name: 'Spider', shape: 'wide', positions: spider() },
  { id: 'lantern', name: 'Lantern', shape: 'tall', positions: lantern() },
  { id: 'pagoda', name: 'Pagoda', shape: 'tall', positions: pagoda() },
  { id: 'hourglass', name: 'Hourglass', shape: 'tall', positions: hourglass() },
  { id: 'tower', name: 'Tower', shape: 'tall', positions: tower() },
  { id: 'turtle-tall', name: 'Turtle (tall)', shape: 'tall', positions: tallTurtle() },
]

export const DEFAULT_LAYOUT = 'turtle'
/** First-visit default on a portrait screen. */
export const DEFAULT_TALL_LAYOUT = 'lantern'

export function getLayout(id: string): LayoutDef {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0]
}
