/**
 * Board geometry.
 *
 * Coordinates are in HALF-tile units: a tile occupies a 2×2 cell area, so
 * `x: 3` means "1.5 tiles from the left". This lets the classic layout place
 * tiles on half offsets (the end caps and the apex) without fractions.
 * `z` is the layer, 0 = table.
 */
export interface Position {
  x: number
  y: number
  z: number
}

/** Classic 144-tile "turtle" pyramid. Positions are fixed; only faces are shuffled. */
export function turtleLayout(): Position[] {
  const p: Position[] = []
  const row = (y: number, from: number, to: number, z: number) => {
    for (let x = from; x <= to; x++) p.push({ x: x * 2, y: y * 2, z })
  }

  // Layer 0 — 87 tiles
  const base: Array<[number, number]> = [
    [1, 12], [3, 10], [2, 11], [1, 12], [1, 12], [2, 11], [3, 10], [1, 12],
  ]
  base.forEach(([from, to], y) => row(y, from, to, 0))
  p.push({ x: 0, y: 7, z: 0 }) // left cap, between rows 3 and 4
  p.push({ x: 26, y: 7, z: 0 }) // right caps
  p.push({ x: 28, y: 7, z: 0 })

  // Layers 1–3 — 6×6, 4×4, 2×2 centred squares
  for (let y = 1; y <= 6; y++) row(y, 4, 9, 1)
  for (let y = 2; y <= 5; y++) row(y, 5, 8, 2)
  for (let y = 3; y <= 4; y++) row(y, 6, 7, 3)

  // Apex
  p.push({ x: 13, y: 7, z: 4 })

  return p
}

/** True if `b` sits directly above `a` and overlaps it. */
export function covers(b: Position, a: Position): boolean {
  return b.z === a.z + 1 && Math.abs(b.x - a.x) < 2 && Math.abs(b.y - a.y) < 2
}

/** True if `b` touches `a`'s long side on the given side, same layer. */
export function touchesSide(b: Position, a: Position, side: -1 | 1): boolean {
  return b.z === a.z && b.x - a.x === 2 * side && Math.abs(b.y - a.y) < 2
}

/**
 * A tile is pickable when nothing lies on top of it and at least one of its
 * long (left/right) sides is open.
 */
export function isFree(a: Position, others: Iterable<Position>): boolean {
  let left = false
  let right = false
  for (const b of others) {
    if (b === a) continue
    if (covers(b, a)) return false
    if (touchesSide(b, a, -1)) left = true
    else if (touchesSide(b, a, 1)) right = true
  }
  return !(left && right)
}
