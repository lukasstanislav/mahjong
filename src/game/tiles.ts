export type Suit = 'dots' | 'bamboo' | 'characters' | 'wind' | 'dragon' | 'flower' | 'season'

export interface Face {
  suit: Suit
  /** 1–9 for numbered suits; 1–4 winds (E S W N), dragons (red green white), flowers, seasons. */
  rank: number
}

/**
 * Matching key. Identical faces match, except flowers match any flower and
 * seasons match any season (each of those faces exists only once).
 */
export function matchKey(f: Face): string {
  return f.suit === 'flower' || f.suit === 'season' ? f.suit : `${f.suit}-${f.rank}`
}

export function canMatch(a: Face, b: Face): boolean {
  return matchKey(a) === matchKey(b)
}

/** The standard 144-tile set, grouped into 72 matching pairs. */
export function tilePairs(): Array<[Face, Face]> {
  const pairs: Array<[Face, Face]> = []
  const four = (suit: Suit, rank: number) => {
    const f = { suit, rank }
    pairs.push([f, f], [f, f])
  }
  for (const suit of ['dots', 'bamboo', 'characters'] as const) {
    for (let r = 1; r <= 9; r++) four(suit, r)
  }
  for (let r = 1; r <= 4; r++) four('wind', r)
  for (let r = 1; r <= 3; r++) four('dragon', r)
  for (const suit of ['flower', 'season'] as const) {
    pairs.push([{ suit, rank: 1 }, { suit, rank: 2 }], [{ suit, rank: 3 }, { suit, rank: 4 }])
  }
  return pairs
}
