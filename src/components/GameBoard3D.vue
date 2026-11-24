<script setup lang="ts">
/**
 * Vue shell around the WebGL BoardRenderer: owns the canvases, forwards game
 * state, translates pointer events, and plays sounds/particles on renderer
 * callbacks. All rendering lives in src/three/BoardRenderer.ts.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Tile } from '../game/deal'
import { ParticleLayer } from '../fx/particles'
import { playBurst, playClack, playHonk, playLaunch, playMatch, playPick } from '../fx/sound'
import { BoardRenderer } from '../three/BoardRenderer'
import type { FaceSetId } from '../faces/faceSets'

const props = defineProps<{
  tiles: Tile[]
  dealId: number
  freeIds: Set<number>
  selectedId: number | null
  hintIds: readonly [number, number] | null
  showFree: boolean
  faceSet: FaceSetId
  parallax: boolean
}>()
const emit = defineEmits<{ pick: [id: number]; ready: [] }>()

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const wrap = ref<HTMLDivElement>()
const gl = ref<HTMLCanvasElement>()
const fx = ref<HTMLCanvasElement>()
const hoverFree = ref(false)

let board: BoardRenderer | null = null
let particles: ParticleLayer | null = null
let ro: ResizeObserver | null = null

const state = () => ({
  tiles: props.tiles,
  freeIds: props.freeIds,
  selectedId: props.selectedId,
  hintIds: props.hintIds,
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
      onLeave: (x) => playMatch(panAt(x)), // called per tile; playMatch plays once per pair
      onHover: (id) => (hoverFree.value = id !== null && props.freeIds.has(id)),
      onReady: () => emit('ready'),
      onLaunch: (x) => playLaunch(panAt(x)),
      onBurst: (x, size, crackle) => playBurst(panAt(x), size, crackle),
    },
    reducedMotion,
    144,
    props.faceSet,
  )
  board.setParallax(props.parallax)
  ro = new ResizeObserver(([e]) => {
    const { width, height } = e.contentRect
    board?.resize(width, height)
    particles?.resize(width, height)
  })
  ro.observe(wrap.value!)
  board.deal(props.tiles)
  board.sync(state())
  // dev-only handle for automated browser checks (stripped from production builds)
  if (import.meta.env.DEV) {
    const w = window as unknown as { __mahjong?: Record<string, unknown> }
    w.__mahjong = Object.assign(w.__mahjong ?? {}, { board, props })
  }
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
watch(() => props.faceSet, (id) => board?.setFaceSet(id))
watch(() => props.parallax, (on) => board?.setParallax(on))
watch(() => [props.tiles, props.freeIds, props.selectedId, props.hintIds, props.showFree], () => board?.sync(state()))

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
  // cleared table: every click launches a shell that bursts under the cursor
  if (props.tiles.length === 0 && board.celebrating) return board.launchAt(ndc(e))
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
