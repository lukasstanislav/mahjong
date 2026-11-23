import type { Face } from '../game/tiles'
import * as I from './icons'

/**
 * Tile face sets. 'classic' is the riichi sprite (public/tiles.svg); the
 * others are generated here as standalone SVG strings in the sprite's
 * 320×446 face box, so both boards can use them: the WebGL atlas rasterises
 * them like sprite symbols, and the DOM board shows them as <image>s.
 *
 * The generated sets avoid Chinese characters and mahjong conventions, for
 * players who don't read them (kids, many older players):
 * - 'numbers': a big numeral plus a card suit. Suits differ in colour AND
 *   shape (♥ red, ♠ black, ♦ blue, like a four-colour deck).
 * - 'pictures': count the apples / stars / fish (1–9), with a small numeral
 *   as a crutch; honours are single pictures.
 * In both, all flowers sit on a pink disc and all seasons on a blue disc:
 * the disc is what tells a player that any flower matches any flower.
 */
export type FaceSetId = 'classic' | 'numbers' | 'pictures'

export interface FaceSet {
  id: FaceSetId
  name: string
}

export const FACE_SETS: FaceSet[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'numbers', name: 'Big numbers' },
  { id: 'pictures', name: 'Pictures' },
]
export const DEFAULT_FACE_SET: FaceSetId = 'classic'

export const FACE_W = 320
export const FACE_H = 446
const FONT = `font-family="Arial, Helvetica, sans-serif" font-weight="bold" text-anchor="middle"`

const SUITS = {
  numbers: { dots: I.heart, bamboo: I.spade, characters: I.diamond },
  pictures: { dots: I.apple, bamboo: I.star, characters: I.fish },
} as const
const SUIT_INK = {
  numbers: { dots: I.INK.red, bamboo: I.INK.black, characters: I.INK.blue },
  pictures: { dots: I.INK.red, bamboo: '#b3770a', characters: I.INK.blue },
} as const

const HONOURS = { wind: [I.sun, I.moon, I.rainbow, I.house], dragon: [I.tree, I.boat, I.bell] }
const FLOWERS = [
  () => I.flower('#e8457a', '#ffd23f', 5, 18), // pink
  () => I.flower('#ffffff', '#f2b705', 12, 14), // daisy
  () => I.flower('#ffcc00', '#7a4a1e', 10, 16), // sunflower
  () => I.flower('#8e5bd8', '#fff1a8', 6, 17), // violet
]
const SEASONS = [I.sprout, I.iceCream, I.leaf, I.snowflake]

/** Dice-like arrangement of n (1–9) items in a 3×3 grid: [col, row] in 0..2 (halves allowed). */
const PIPS: Record<number, Array<[number, number]>> = {
  1: [[1, 1]],
  2: [[1, 0.4], [1, 1.6]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0.3, 0.4], [1.7, 0.4], [0.3, 1.6], [1.7, 1.6]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0.4, 0], [1.6, 0], [0.4, 1], [1.6, 1], [0.4, 2], [1.6, 2]],
  7: [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]],
  8: [[0, 0], [1, 0], [2, 0], [0.5, 1], [1.5, 1], [0, 2], [1, 2], [2, 2]],
  9: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
}

const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FACE_W} ${FACE_H}">${body}</svg>`
const disc = (fill: string) => `<circle cx="160" cy="223" r="138" fill="${fill}"/>`

/** Standalone SVG for one face of a generated set. */
export function faceSvg(set: Exclude<FaceSetId, 'classic'>, f: Face): string {
  switch (f.suit) {
    case 'wind':
    case 'dragon':
      return wrap(I.place(HONOURS[f.suit][f.rank - 1](), 160, 223, 250))
    case 'flower':
      return wrap(disc(I.INK.pink) + I.place(FLOWERS[f.rank - 1](), 160, 223, 230))
    case 'season':
      return wrap(disc(I.INK.sky) + I.place(SEASONS[f.rank - 1](), 160, 223, 210))
  }
  const icon = SUITS[set][f.suit]()
  const ink = SUIT_INK[set][f.suit]
  if (set === 'numbers') {
    return wrap(`<text x="160" y="222" font-size="230" fill="${ink}" ${FONT}>${f.rank}</text>` + I.place(icon, 160, 330, 130))
  }
  // pictures: count the objects; a small numeral in the corner helps
  const n = f.rank
  // as large as the 320×446 box allows: tiles are ~44 px wide on a phone
  const size = n === 1 ? 200 : n <= 4 ? 124 : n <= 6 ? 106 : 94
  const [x0, y0, dx, dy] = n === 1 ? [160, 250, 0, 0] : [62, 148, 98, 106] // top row clears the corner numeral
  const items = PIPS[n].map(([c, r]) => I.place(icon, x0 + c * dx, y0 + r * dy, size)).join('')
  return wrap(items + `<text x="44" y="78" font-size="80" fill="${ink}" ${FONT}>${n}</text>`)
}

/** `data:` URL of a face, for <image href> (memoised: the DOM board renders each face many times). */
const urlCache = new Map<string, string>()
export function faceDataUrl(set: Exclude<FaceSetId, 'classic'>, f: Face): string {
  const key = `${set}/${f.suit}/${f.rank}`
  let url = urlCache.get(key)
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(faceSvg(set, f))}`
    urlCache.set(key, url)
  }
  return url
}
