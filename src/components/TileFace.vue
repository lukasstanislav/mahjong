<script setup lang="ts">
/**
 * Draws a tile face inside a 60×80 box (origin top-left). Must be rendered
 * inside an <svg>.
 *
 * Every classic face comes from the sprite `public/tiles.svg`. Each of its symbols starts with `<use href="#tile">`, a rect
 * with no fill of its own. It inherits `fill` from our <use>, so we pass
 * `fill="transparent"` to keep the ivory tile body drawn by GameBoard.
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
const DRAGONS = ['chun', 'hatsu', 'haku'] // red, green, white (framed)
const FLOWERS = ['plum', 'orchid', 'chrysanthemum', 'bamboo']
const SEASONS = ['spring', 'summer', 'autumn', 'winter']

const symbolId = computed((): string => {
  const { suit, rank } = props.face
  switch (suit) {
    case 'characters': return `m${rank}`
    case 'dots': return `p${rank}`
    case 'bamboo': return `s${rank}`
    case 'wind': return WINDS[rank - 1]
    case 'dragon': return DRAGONS[rank - 1]
    case 'flower': return FLOWERS[rank - 1]
    case 'season': return SEASONS[rank - 1]
  }
})
</script>

<template>
  <g class="face">
    <image v-if="generated" :href="generated" x="2" y="2" width="56" height="76" />
    <use v-else :href="`${SPRITE}#${symbolId}`" x="2" y="2" width="56" height="76" fill="transparent" />
  </g>
</template>

