<script setup lang="ts">
/**
 * Vue shell around the WebGL BoardRenderer: owns the canvases, forwards game
 * state, translates pointer events, and plays sounds/particles on renderer
 * callbacks. All rendering lives in src/three/BoardRenderer.ts.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Tile } from '../game/deal'
import { ParticleLayer } from '../fx/particles'
import { playChime, playClack, playCrumble, playHonk, playPick } from '../fx/sound'
import { BoardRenderer } from '../three/BoardRenderer'

const props = defineProps<{
  tiles: Tile[]
  dealId: number
  freeIds: Set<number>
  selectedId: number | null
  showFree: boolean
}>()
const emit = defineEmits<{ pick: [id: number] }>()

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const wrap = ref<HTMLDivElement>()
const gl = ref<HTMLCanvasElement>()
const fx = ref<HTMLCanvasElement>()
const hoverFree = ref(false)

let board: BoardRenderer | null = null
let particles: ParticleLayer | null = null
let ro: ResizeObserver | null = null
let lastChime = 0

const state = () => ({
  tiles: props.tiles,
  freeIds: props.freeIds,
  selectedId: props.selectedId,
  showFree: props.showFree,
})

onMounted(() => {
  particles = new ParticleLayer(fx.value!)
  board = new BoardRenderer(
    gl.value!,
    {
      onLand: (surface, x, y, w) => {
        playClack(surface, surface === 'felt' ? 0.9 : 0.7, panAt(x))
        if (!reducedMotion) particles?.dust(x, y, w)
      },
      // matched tile: the renderer dissolves it into 3D crumbs; we add the sound
      onLeave: (x) => {
        playCrumble(panAt(x))
        const now = performance.now()
        if (now - lastChime > 80) playChime()
        lastChime = now
      },
      onHover: (id) => (hoverFree.value = id !== null && props.freeIds.has(id)),
    },
    reducedMotion,
  )
  ro = new ResizeObserver(([e]) => {
    const { width, height } = e.contentRect
    board?.resize(width, height)
    particles?.resize(width, height)
  })
  ro.observe(wrap.value!)
  board.deal(props.tiles)
  board.sync(state())
  // dev-only handle for automated browser checks (stripped from production builds)
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__mahjong = { board, props }
})

onBeforeUnmount(() => {
  ro?.disconnect()
  board?.dispose()
  particles?.destroy()
})

watch(() => props.dealId, () => {
  board?.deal(props.tiles)
  board?.sync(state())
})
watch(() => [props.tiles, props.freeIds, props.selectedId, props.showFree], () => board?.sync(state()))

/** Stereo pan (-1..1) from a canvas x coordinate in CSS px. */
function panAt(x: number) {
  const w = wrap.value?.clientWidth || 1
  return (x / w) * 2 - 1
}

function ndc(e: PointerEvent | MouseEvent) {
  const r = gl.value!.getBoundingClientRect()
  return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) }
}

function onMove(e: PointerEvent) {
  board?.pointer(ndc(e))
}

function onLeaveCanvas() {
  board?.pointer(null)
}

function onClick(e: MouseEvent) {
  if (!board) return
  if (board.introRunning) return board.skipIntro()
  const id = board.pick(ndc(e))
  if (id === null) return
  if (props.freeIds.has(id)) {
    playPick(ndc(e).x)
    emit('pick', id)
  } else playHonk() // blocked tile
}
</script>

<template>
  <div ref="wrap" class="wrap" :class="{ hand: hoverFree }">
    <canvas ref="gl" class="gl" @pointermove="onMove" @pointerleave="onLeaveCanvas" @click="onClick" />
    <canvas ref="fx" class="fx" />
  </div>
</template>

<style scoped>
.wrap { position: absolute; inset: 0; }
.wrap.hand .gl { cursor: pointer; }
.gl, .fx { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.fx { pointer-events: none; }
</style>
