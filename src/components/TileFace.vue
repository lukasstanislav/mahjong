<script setup lang="ts">
/**
 * Draws a tile face inside a 60×80 box (origin top-left). Must be rendered
 * inside an <svg>.
 *
 * Suits, winds and dragons come from the sprite `public/tiles.svg` (used
 * unmodified). Each of its symbols starts with `<use href="#tile">`, a rect
 * with no fill of its own. It inherits `fill` from our <use>, so we pass
 * `fill="transparent"` to keep the ivory tile body drawn by GameBoard.
 * The sprite has no flowers or seasons, so those are still drawn here.
 *
 * Generated face sets (src/faces) are standalone SVGs, shown as an <image>.
 */
import { computed } from 'vue'
import type { Face } from '../game/tiles'
import { faceDataUrl, type FaceSetId } from '../faces/faceSets'

const props = defineProps<{ face: Face; faceSet: FaceSetId }>()
const generated = computed(() => (props.faceSet === 'classic' ? null : faceDataUrl(props.faceSet, props.face)))

const SPRITE = `${import.meta.env.BASE_URL}tiles.svg`
const WINDS = ['tan', 'nan', 'xia', 'pei'] // E S W N
const DRAGONS = ['chun', 'hatsu', 'haku'] // red, green, white (blank)
const FLOWERS = ['梅', '蘭', '菊', '竹']
const SEASONS = ['春', '夏', '秋', '冬']

const symbolId = computed((): string | null => {
  const { suit, rank } = props.face
  switch (suit) {
    case 'characters': return `m${rank}`
    case 'dots': return `p${rank}`
    case 'bamboo': return `s${rank}`
    case 'wind': return WINDS[rank - 1]
    case 'dragon': return DRAGONS[rank - 1]
    default: return null
  }
})
</script>

<template>
  <g class="face">
    <image v-if="generated" :href="generated" x="2" y="2" width="56" height="76" />
    <use v-else-if="symbolId" :href="`${SPRITE}#${symbolId}`" x="2" y="2" width="56" height="76" fill="transparent" />
    <template v-else>
      <text x="30" y="52" class="glyph" font-size="34"
            :fill="face.suit === 'flower' ? '#b0306a' : '#1f5fa8'">
        {{ (face.suit === 'flower' ? FLOWERS : SEASONS)[face.rank - 1] }}
      </text>
      <text x="48" y="74" class="glyph" font-size="11" fill="#1d2a4a">{{ face.rank }}</text>
    </template>
  </g>
</template>

<style scoped>
.glyph {
  text-anchor: middle;
  font-family: 'Noto Serif SC', 'Songti SC', 'SimSun', 'Noto Serif CJK SC', serif;
  font-weight: 700;
  user-select: none;
}
</style>
