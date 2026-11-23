import * as THREE from 'three'
import type { Face, Suit } from '../game/tiles'
import { faceSvg, type FaceSetId } from '../faces/faceSets'

/**
 * Face texture atlas, built at runtime on a 2D canvas.
 *
 * - 34 faces rasterised from the SVG sprite `public/tiles.svg` (unmodified):
 *   each symbol is wrapped in a standalone <svg> that inlines the whole sprite
 *   (symbols reference shared <g>s), loaded as an <img>, drawn into its cell.
 * - 8 flowers/seasons (absent from the sprite) drawn as CJK text.
 * - Generated face sets (src/faces) instead rasterise all 42 cells from
 *   their own standalone SVGs; recolouring and CJK text don't apply.
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

/** Inverse of cellIndex. */
export function faceAt(i: number): Face {
  const groups: Array<[Suit, number]> = [['characters', 9], ['dots', 9], ['bamboo', 9], ['wind', 4], ['dragon', 3], ['flower', 4], ['season', 4]]
  let start = 0
  for (const [suit, n] of groups) {
    if (i < start + n) return { suit, rank: i - start + 1 }
    start += n
  }
  throw new Error(`No face at cell ${i}`)
}
export const CELL_COUNT = 42

/** Bottom-left UV of a cell (texture has flipY = true, so row 0 is at v = 1). */
export function cellOffset(i: number): [number, number] {
  const col = i % COLS
  const row = Math.floor(i / COLS)
  return [col / COLS, 1 - (row + 1) / ROWS]
}

export interface FaceAtlas {
  /** Face art (sRGB). */
  color: THREE.CanvasTexture
  /** Height for bump mapping: ivory face = 1 (surface), ink = 0 (engraved), softened walls. */
  height: THREE.CanvasTexture
}

/** How far around a stroke its engraved wall slopes (px in the atlas). */
const ENGRAVE_SOFTEN = 2.5
/** Colour distance from IVORY at which a pixel starts / is fully engraved. */
const ENGRAVE_RAMP: [number, number] = [18, 110]

export function createAtlas(faceSet: FaceSetId): FaceAtlas {
  const spriteUrl = `${import.meta.env.BASE_URL}tiles.svg`
  const canvas = document.createElement('canvas')
  canvas.width = CW * COLS
  canvas.height = CH * ROWS
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = IVORY
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const cellXY = (i: number) => [(i % COLS) * CW, Math.floor(i / COLS) * CH] as const

  const heightCanvas = document.createElement('canvas')
  heightCanvas.width = canvas.width
  heightCanvas.height = canvas.height
  const height = new THREE.CanvasTexture(heightCanvas) // data, not colour: NoColorSpace
  height.generateMipmaps = true
  height.minFilter = THREE.LinearMipmapLinearFilter

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter

  const drawSvg = async (svg: string, i: number) => {
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
  }

  if (faceSet !== 'classic') {
    void Promise.all(
      Array.from({ length: CELL_COUNT }, (_, i) =>
        // the generated SVGs share the sprite's 320×446 box, so they fill the cell the same way
        drawSvg(faceSvg(faceSet, faceAt(i)).replace('<svg ', `<svg width="${CW}" height="${CH}" `), i),
      ),
    )
      .then(() => {
        texture.needsUpdate = true
        rebuildHeight()
      })
      .catch((e) => console.warn('Tile atlas: face set failed to render', e))
    return finish()
  }

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
          await drawSvg(svg, i)
        }),
      )
      texture.needsUpdate = true
      rebuildHeight()
    } catch (e) {
      console.warn('Tile atlas: sprite failed to load', e)
    }
  })()

  return finish()

  // --- height map for the engraving, derived from the colour atlas ---
  function rebuildHeight() {
    buildHeight(canvas, heightCanvas)
    height.needsUpdate = true
  }
  function finish(): FaceAtlas {
    rebuildHeight() // placeholders now; again once the art has loaded
    return { color: texture, height }
  }
}

/**
 * Ink → engraving depth. Any pixel that differs from IVORY is ink; its height
 * ramps from 1 (face surface) down to 0 (engraved floor) over ENGRAVE_RAMP.
 * A small blur gives the strokes sloped walls, which bump mapping turns into
 * a lit edge and a shaded edge. (ctx.filter is missing in older Safari; there
 * the walls are just steeper.)
 */
function buildHeight(src: HTMLCanvasElement, dst: HTMLCanvasElement) {
  const w = src.width
  const h = src.height
  const img = src.getContext('2d')!.getImageData(0, 0, w, h)
  const d = img.data
  const hex = parseInt(IVORY.slice(1), 16) // compare in canvas (sRGB) space
  const ir = (hex >> 16) & 255
  const ig = (hex >> 8) & 255
  const ib = hex & 255
  const [lo, hi] = ENGRAVE_RAMP
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.max(Math.abs(d[i] - ir), Math.abs(d[i + 1] - ig), Math.abs(d[i + 2] - ib))
    const ink = Math.min(1, Math.max(0, (dist - lo) / (hi - lo)))
    const v = Math.round(255 * (1 - ink))
    d[i] = d[i + 1] = d[i + 2] = v
    d[i + 3] = 255
  }
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  tmp.getContext('2d')!.putImageData(img, 0, 0)
  const out = dst.getContext('2d')!
  out.filter = `blur(${ENGRAVE_SOFTEN}px)`
  out.drawImage(tmp, 0, 0)
  out.filter = 'none'
}
