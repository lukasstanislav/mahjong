import * as THREE from 'three'
import type { Face } from '../game/tiles'

/**
 * Face texture atlas, built at runtime on a 2D canvas.
 *
 * - 34 faces rasterised from the SVG sprite `public/tiles.svg` (unmodified):
 *   each symbol is wrapped in a standalone <svg> that inlines the whole sprite
 *   (symbols reference shared <g>s), loaded as an <img>, drawn into its cell.
 * - 8 flowers/seasons (absent from the sprite) drawn as CJK text.
 *
 * Recolouring: the sprite stays unmodified on disk. Each cell gets its own
 * copy of the sprite text, so for bamboo cells (s1–s9) black fills are
 * swapped for BAMBOO_GREEN in that copy only. Red accent sticks stay red.
 *
 * Cells are filled with IVORY, the same colour as the tile body material, so
 * the face quad blends seamlessly into the rounded top. The texture exists
 * immediately (blank ivory) and is updated in place once the sprite loads.
 */
export const IVORY = '#f6efdc'
/** Bamboo ink. The sprite draws bamboo sticks black; we recolour them per cell. */
const BAMBOO_GREEN = '#0f6b35'

const COLS = 8
const ROWS = 6
const CW = 256
const CH = 357 // 256 / (320/446): the sprite's aspect
/** UV size of one cell (for the shader). */
export const CELL_UV = { u: 1 / COLS, v: 1 / ROWS }
/** Aspect (w/h) of the face art. */
export const FACE_ASPECT = CW / CH

const SPRITE_IDS = [
  ...Array.from({ length: 9 }, (_, i) => `m${i + 1}`), // characters 0–8
  ...Array.from({ length: 9 }, (_, i) => `p${i + 1}`), // dots 9–17
  ...Array.from({ length: 9 }, (_, i) => `s${i + 1}`), // bamboo 18–26
  'tan', 'nan', 'xia', 'pei', // winds 27–30
  'chun', 'hatsu', 'haku', // dragons 31–33
]
const FLOWERS = ['梅', '蘭', '菊', '竹'] // 34–37
const SEASONS = ['春', '夏', '秋', '冬'] // 38–41

export function cellIndex(f: Face): number {
  const r = f.rank - 1
  switch (f.suit) {
    case 'characters': return r
    case 'dots': return 9 + r
    case 'bamboo': return 18 + r
    case 'wind': return 27 + r
    case 'dragon': return 31 + r
    case 'flower': return 34 + r
    case 'season': return 38 + r
  }
}

/** Bottom-left UV of a cell (texture has flipY = true, so row 0 is at v = 1). */
export function cellOffset(i: number): [number, number] {
  const col = i % COLS
  const row = Math.floor(i / COLS)
  return [col / COLS, 1 - (row + 1) / ROWS]
}

export function createAtlas(spriteUrl: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CW * COLS
  canvas.height = CH * ROWS
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = IVORY
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const cellXY = (i: number) => [(i % COLS) * CW, Math.floor(i / COLS) * CH] as const

  // Flowers & seasons
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ;[...FLOWERS, ...SEASONS].forEach((glyph, k) => {
    const [x, y] = cellXY(34 + k)
    const flower = k < 4
    ctx.fillStyle = flower ? '#b0306a' : '#1f5fa8'
    ctx.font = `bold ${Math.round(CH * 0.4)}px "Songti SC", "Noto Serif SC", "Noto Serif CJK SC", SimSun, serif`
    ctx.fillText(glyph, x + CW / 2, y + CH * 0.47)
    ctx.fillStyle = '#1d2a4a'
    ctx.font = `bold ${Math.round(CH * 0.1)}px serif`
    ctx.fillText(String((k % 4) + 1), x + CW * 0.8, y + CH * 0.87)
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter

  void (async () => {
    try {
      const text = await (await fetch(spriteUrl)).text()
      const inner = text.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
      await Promise.all(
        SPRITE_IDS.map(async (id, i) => {
          const defs = /^s\d$/.test(id) ? inner.replaceAll('fill: #000000', `fill: ${BAMBOO_GREEN}`) : inner
          const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
            `width="${CW}" height="${CH}" viewBox="0 0 320 446">${defs}` +
            // the sprite's #tile rect has no fill and inherits ours
            `<use href="#${id}" xlink:href="#${id}" fill="transparent"/></svg>`
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
          try {
            const img = new Image()
            img.src = url
            await img.decode()
            const [x, y] = cellXY(i)
            ctx.drawImage(img, x, y, CW, CH)
          } finally {
            URL.revokeObjectURL(url)
          }
        }),
      )
      texture.needsUpdate = true
    } catch (e) {
      console.warn('Tile atlas: sprite failed to load', e)
    }
  })()

  return texture
}
