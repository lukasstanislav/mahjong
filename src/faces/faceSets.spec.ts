import { describe, expect, it } from 'vitest'
import { cellIndex, CELL_COUNT, faceAt } from '../three/atlas'
import { matchKey } from '../game/tiles'
import { faceSvg } from './faceSets'

const allFaces = Array.from({ length: CELL_COUNT }, (_, i) => faceAt(i))

it('faceAt inverts cellIndex for all 42 cells', () => {
  allFaces.forEach((f, i) => expect(cellIndex(f)).toBe(i))
})

describe.each(['numbers', 'pictures'] as const)('generated face set %s', (set) => {
  it('draws every face as a standalone SVG', () => {
    for (const f of allFaces) {
      const svg = faceSvg(set, f)
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
      expect(svg).not.toMatch(/NaN|undefined/)
    }
  })

  it('gives faces that do not match different pictures', () => {
    const byKey = new Map<string, string>()
    for (const f of allFaces) {
      const k = matchKey(f)
      if (k === 'flower' || k === 'season') continue
      byKey.set(k, faceSvg(set, f))
    }
    expect(new Set(byKey.values()).size).toBe(byKey.size)
  })

  it('marks each flower/season group with one shared disc colour', () => {
    const disc = (svg: string) => svg.match(/<circle cx="160" cy="223" r="138" fill="([^"]+)"/)?.[1]
    const flowers = new Set(allFaces.filter((f) => f.suit === 'flower').map((f) => disc(faceSvg(set, f))))
    const seasons = new Set(allFaces.filter((f) => f.suit === 'season').map((f) => disc(faceSvg(set, f))))
    expect(flowers.size).toBe(1)
    expect(seasons.size).toBe(1)
    expect([...flowers][0]).not.toBe([...seasons][0])
  })
})
