<script setup lang="ts">
/**
 * Board = absolutely positioned tile <div>s (GPU-animatable). The tile body
 * and its thickness are pure CSS (gradient + stacked box-shadows, see .tile);
 * only the face art is a small inline SVG. Board coordinates are unscaled
 * px; the whole board is fitted to the viewport with one CSS scale and
 * tilted with rotateX (perspective set on .board-wrap).
 *
 * Stacking: z-index = layer, then x+y, then x, so right/lower neighbours
 * cover the visible thickness of left/upper ones.
 *
 * FX: on every new deal tiles drop in one by one (CSS keyframes, staggered
 * by build order). Landing sounds/dust are fired by timers that match the
 * keyframe's impact point (LAND_AT). Any click during the intro skips it.
 * A canvas overlay renders particles; matched tiles sparkle on leave.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Tile } from '../game/deal'
import { ParticleLayer } from '../fx/particles'
import { playChime, playClack, playHonk, playPick } from '../fx/sound'
import TileFace from './TileFace.vue'

const props = defineProps<{
  tiles: Tile[]
  dealId: number
  freeIds: Set<number>
  selectedId: number | null
  showFree: boolean
}>()
const emit = defineEmits<{ pick: [id: number] }>()

const W = 60 // face width
const H = 80 // face height
const LAYER_SHIFT = 7
const GAP = 7 // space between neighbouring tiles; must absorb MAX_SPIN corner swing (~3px per side)
const MAX_SPIN = 2 // random resting rotation, ±deg
const STEP_X = (W + GAP) / 2 // px per half-tile unit
const STEP_Y = (H + GAP) / 2
const VIEW = { x: -40, y: -50, w: 14 * (W + GAP) + W + 80, h: 7 * (H + GAP) + H + 100 }
const TILT_DEG = 16
const FIT = 0.94 // headroom for the tilt's perspective growth

const STAGGER_MS = 28
const DROP_MS = 420
const LAND_AT = 0.6 // keyframe fraction where the tile hits the table

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ---- layout ----------------------------------------------------------------

const drawn = computed(() =>
  props.tiles.map((t) => ({
    tile: t,
    left: t.pos.x * STEP_X - t.pos.z * LAYER_SHIFT - VIEW.x,
    top: t.pos.y * STEP_Y - t.pos.z * LAYER_SHIFT - VIEW.y,
    zIndex: t.pos.z * 10000 + (t.pos.x + t.pos.y) * 100 + t.pos.x,
    free: props.freeIds.has(t.id),
    selected: props.selectedId === t.id,
  })),
)

// ---- fit to viewport ---------------------------------------------------------

const wrap = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const scale = ref(1)
let particles: ParticleLayer | null = null
let ro: ResizeObserver | null = null

onMounted(() => {
  particles = new ParticleLayer(canvas.value!)
  ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    scale.value = Math.min(width / VIEW.w, height / VIEW.h) * FIT
    particles?.resize(width, height)
  })
  ro.observe(wrap.value!)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  particles?.destroy()
  clearTimers()
})

// ---- intro (drop-in deal) ----------------------------------------------------

const intro = ref(false)
const dropStyle = ref(new Map<number, Record<string, string>>())
/** Per-deal random resting rotation (`--rz`), kept for the whole game. */
const spin = ref(new Map<number, string>())
let timers: number[] = []

function clearTimers() {
  timers.forEach(clearTimeout)
  timers = []
}

function onDeal() {
  spin.value = new Map(props.tiles.map((t) => [t.id, `${((Math.random() * 2 - 1) * MAX_SPIN).toFixed(2)}deg`]))
  startIntro()
}

function startIntro() {
  clearTimers()
  if (reducedMotion || props.tiles.length === 0) {
    intro.value = false
    return
  }
  // Build order: bottom layer first, then rows top→bottom, left→right.
  const order = [...props.tiles].sort((a, b) => a.pos.z - b.pos.z || a.pos.y - b.pos.y || a.pos.x - b.pos.x)
  const styles = new Map<number, Record<string, string>>()
  order.forEach((t, i) => {
    const delay = i * STAGGER_MS
    styles.set(t.id, {
      '--delay': `${delay}ms`,
      '--rot': `${(Math.random() * 6 - 3).toFixed(2)}deg`,
      '--dx': `${(Math.random() * 16 - 8).toFixed(1)}px`,
    })
    timers.push(window.setTimeout(() => land(t), delay + DROP_MS * LAND_AT))
  })
  dropStyle.value = styles
  intro.value = true
  timers.push(window.setTimeout(() => (intro.value = false), order.length * STAGGER_MS + DROP_MS + 50))
}

function land(t: Tile) {
  // base layer lands on the cloth; upper layers clack onto the tiles below
  playClack(t.pos.z === 0 ? 'felt' : 'tile', t.pos.z === 0 ? 0.9 : 0.7)
  const el = wrap.value?.querySelector<HTMLElement>(`[data-id="${t.id}"]`)
  if (!el || !particles || !wrap.value) return
  const r = el.getBoundingClientRect()
  const o = wrap.value.getBoundingClientRect()
  particles.dust(r.left + r.width / 2 - o.left, r.bottom - o.top, r.width)
}

function skipIntro() {
  clearTimers()
  intro.value = false
}

watch(() => props.dealId, onDeal, { immediate: true })

// ---- interaction -------------------------------------------------------------

function onClickCapture(e: MouseEvent) {
  if (!intro.value) return
  e.stopPropagation()
  skipIntro()
}

function onTileClick(id: number, free: boolean) {
  if (free) {
    playPick()
    emit('pick', id)
  }
  else playHonk() // blocked tile: not pickable
}

let lastChime = 0
function onLeave(el: Element) {
  if (particles && wrap.value && !reducedMotion) {
    const r = el.getBoundingClientRect()
    const o = wrap.value.getBoundingClientRect()
    particles.sparkle(r.left + r.width / 2 - o.left, r.top + r.height / 2 - o.top)
  }
  const now = performance.now()
  if (now - lastChime > 80) playChime()
  lastChime = now
}
</script>

<template>
  <div ref="wrap" class="board-wrap" @click.capture="onClickCapture">
    <div
      class="board"
      :style="{
        width: `${VIEW.w}px`,
        height: `${VIEW.h}px`,
        transform: `translate(-50%, -50%) scale(${scale}) rotateX(${TILT_DEG}deg)`,
      }"
    >
      <TransitionGroup :key="dealId" name="tile" tag="div" @before-leave="onLeave">
        <div
          v-for="d in drawn"
          :key="d.tile.id"
          :data-id="d.tile.id"
          class="tile"
          :class="{ free: d.free, selected: d.selected, dim: showFree && !d.free, dropping: intro }"
          :style="{ left: `${d.left}px`, top: `${d.top}px`, zIndex: d.zIndex, '--rz': spin.get(d.tile.id), ...dropStyle.get(d.tile.id) }"
          @click="onTileClick(d.tile.id, d.free)"
        >
          <svg class="art" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true">
            <TileFace :face="d.tile.face" />
          </svg>
        </div>
      </TransitionGroup>
    </div>

    <canvas ref="canvas" class="fx" />
  </div>
</template>

<style scoped>
.board-wrap {
  position: absolute;
  inset: 12px 16px 20px;
  perspective: 1800px;
  overflow: hidden;
}
.board {
  position: absolute;
  left: 50%;
  top: 50%;
  transform-origin: 50% 50%;
}
.fx {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.tile {
  position: absolute;
  width: 60px;
  height: 80px;
  border-radius: 6px;
  background: linear-gradient(135deg, #fffdf5, #efe6cf);
  /*
   * Tile thickness = stacked 1px-offset shadows. They follow border-radius,
   * so the body has the same rounded edges as the face. Ivory body (light →
   * dark), then the green back layer, then the soft drop shadow on the cloth.
   * Shadows are not hit-tested: only the face is clickable.
   */
  --depth:
    inset 0 0 0 1px rgba(150, 130, 85, 0.55),
    1px 1px 0 #e6dcc0, 2px 2px 0 #ddd0ae, 3px 3px 0 #d4c59f, 4px 4px 0 #cbbb92, 5px 5px 0 #bfae83,
    6px 6px 0 #22775a, 7px 7px 0 #1d6b4c, 8px 8px 0 #18603f, 9px 9px 0 #155239,
    12px 14px 8px rgba(0, 0, 0, 0.35);
  box-shadow: var(--depth);
  /* rotate around the face centre; every keyframe/transition below must keep rotate(var(--rz)) */
  transform-origin: 30px 40px;
  transform: rotate(var(--rz, 0deg));
}
.tile .art { display: block; pointer-events: none; }
/* hover / dim / selection veil over the face */
.tile::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  transition: background-color 120ms;
}
.tile.free { cursor: pointer; }
.tile.free:hover::after { background-color: rgba(255, 255, 255, 0.18); }
.tile.dim::after { background-color: rgba(40, 30, 10, 0.28); }
.tile.selected {
  background: linear-gradient(135deg, #fff6c2, #f3d77a);
  box-shadow: inset 0 0 0 2.5px #c58a00, var(--depth);
}
.tile.selected { animation: pulse 1.2s ease-in-out infinite; }

/* Drop-in: fall, hit the table at 60 %, small bounce, settle. */
.tile.dropping {
  animation: drop 420ms cubic-bezier(0.4, 0, 0.7, 1) var(--delay, 0ms) both;
}
@keyframes drop {
  0% { opacity: 0; transform: translate(var(--dx), -150px) rotate(var(--rz)) rotate(var(--rot)) scale(1.12); }
  15% { opacity: 1; }
  60% { transform: translate(0, 0) rotate(var(--rz)) rotate(calc(var(--rot) * -0.35)) scale(1); }
  78% { transform: translate(0, -6px) rotate(var(--rz)) rotate(calc(var(--rot) * 0.15)); }
  100% { transform: rotate(var(--rz)); }
}
@keyframes pulse {
  50% { transform: translateY(-3px) rotate(var(--rz)); }
}

/* Matched pair: lift and fade. */
/* animation: none — the infinite selection pulse would otherwise make Vue
   wait for it and keep the leaving element in the DOM. */
.tile.tile-leave-active { animation: none; transition: transform 320ms ease-out, opacity 320ms ease-out; }
.tile-leave-to { opacity: 0; transform: translateY(-28px) rotate(var(--rz)) scale(1.12); }

@media (prefers-reduced-motion: reduce) {
  .tile.selected { animation: none; }
  .tile-leave-active { transition: none; }
}
</style>
