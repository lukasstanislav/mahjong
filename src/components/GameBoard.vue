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
 * Clearing the board starts a 2D fireworks show on the same canvas (the
 * WebGL board has its own, in 3D); it loops slowly until the next deal.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Tile } from '../game/deal'
import { ParticleLayer } from '../fx/particles'
import { playBurst, playClack, playHonk, playLaunch, playMatch, playPick } from '../fx/sound'
import TileFace from './TileFace.vue'
import type { FaceSetId } from '../faces/faceSets'

const props = defineProps<{
  tiles: Tile[]
  dealId: number
  freeIds: Set<number>
  selectedId: number | null
  hintIds: readonly [number, number] | null
  showFree: boolean
  faceSet: FaceSetId
}>()
const emit = defineEmits<{ pick: [id: number]; ready: [] }>()

const W = 60 // face width
const H = 80 // face height
const LAYER_SHIFT = 7
const GAP = 7 // space between neighbouring tiles; must absorb MAX_SPIN corner swing (~3px per side)
const MAX_SPIN = 2 // random resting rotation, ±deg
const STEP_X = (W + GAP) / 2 // px per half-tile unit
const STEP_Y = (H + GAP) / 2
/** Board bounds in unscaled px, recomputed per deal (layouts differ in size and may use negative coordinates). */
const view = ref({ x: -40, y: -50, w: 14 * (W + GAP) + W + 80, h: 7 * (H + GAP) + H + 100 })
const wrapSize = ref({ w: 1, h: 1 })

function fitView(tiles: Tile[]) {
  if (!tiles.length) return
  const xs = tiles.map((t) => t.pos.x * STEP_X - t.pos.z * LAYER_SHIFT)
  const ys = tiles.map((t) => t.pos.y * STEP_Y - t.pos.z * LAYER_SHIFT)
  const x0 = Math.min(...xs) - 40
  const y0 = Math.min(...ys) - 50
  view.value = { x: x0, y: y0, w: Math.max(...xs) + W + 40 - x0, h: Math.max(...ys) + H + 50 - y0 }
}
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
    left: t.pos.x * STEP_X - t.pos.z * LAYER_SHIFT - view.value.x,
    top: t.pos.y * STEP_Y - t.pos.z * LAYER_SHIFT - view.value.y,
    // hinted tiles float, so draw them above everything
    zIndex: (props.hintIds?.includes(t.id) ? 100000 : 0) + t.pos.z * 10000 + (t.pos.x + t.pos.y) * 100 + t.pos.x,
    hint: props.hintIds ? props.hintIds.indexOf(t.id) : -1,
    free: props.freeIds.has(t.id),
    selected: props.selectedId === t.id,
  })),
)

// ---- fit to viewport ---------------------------------------------------------

const wrap = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const scale = computed(() => Math.min(wrapSize.value.w / view.value.w, wrapSize.value.h / view.value.h) * FIT)
let particles: ParticleLayer | null = null
let ro: ResizeObserver | null = null

onMounted(() => {
  particles = new ParticleLayer(canvas.value!)
  particles.onBurst = (x, twinkle) => playBurst(panAt(x), 0.7, twinkle)
  ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    wrapSize.value = { w: width, h: height }
    particles?.resize(width, height)
  })
  ro.observe(wrap.value!)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  particles?.destroy()
  clearTimers()
  stopShow()
})

// ---- victory fireworks ---------------------------------------------------------

const SHOW_START_MS = 900 // after the last pair's crash
const SHOW_BARRAGE_MS = [0, 450, 850, 1350, 1650, 2150, 2400, 2900, 3700, 3800, 3900, 4000]
const SHOW_IDLE_MS: [number, number] = [1800, 3400]
let showTimers: number[] = []
/** Lights down for the show (a dark vignette), like the WebGL board's dusk. */
const dusk = ref(false)

function panAt(x: number) {
  return (x / (wrap.value?.clientWidth || 1)) * 2 - 1
}

function launch() {
  const w = wrapSize.value.w
  const h = wrapSize.value.h
  const x = w * (0.2 + Math.random() * 0.6)
  particles?.firework(x, h * (0.42 + Math.random() * 0.3)) // below the victory title
  playLaunch(panAt(x))
}

function startShow() {
  stopShow()
  if (reducedMotion) return
  dusk.value = true
  for (const t of SHOW_BARRAGE_MS) showTimers.push(window.setTimeout(launch, SHOW_START_MS + t))
  const idle = (delay: number) =>
    showTimers.push(
      window.setTimeout(() => {
        launch()
        idle(SHOW_IDLE_MS[0] + Math.random() * (SHOW_IDLE_MS[1] - SHOW_IDLE_MS[0]))
      }, delay),
    )
  idle(SHOW_START_MS + SHOW_BARRAGE_MS[SHOW_BARRAGE_MS.length - 1] + 2600)
}

function stopShow() {
  dusk.value = false
  showTimers.forEach(clearTimeout)
  showTimers = []
}

watch(
  () => props.tiles.length,
  (n, old) => {
    if (n === 0 && old > 0) startShow()
  },
)

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
  stopShow()
  fitView(props.tiles)
  spin.value = new Map(props.tiles.map((t) => [t.id, `${((Math.random() * 2 - 1) * MAX_SPIN).toFixed(2)}deg`]))
  startIntro()
}

function startIntro() {
  clearTimers()
  if (reducedMotion || props.tiles.length === 0) {
    intro.value = false
    if (props.tiles.length) emit('ready')
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
  timers.push(
    window.setTimeout(() => {
      intro.value = false
      emit('ready')
    }, order.length * STAGGER_MS + DROP_MS + 50),
  )
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
  const wasRunning = intro.value
  intro.value = false
  if (wasRunning) emit('ready')
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

// Matched pair: both tiles lift (scale up = closer to the viewer), back off a
// little, then slam together; sparkle + sound on impact. Mirrors the WebGL
// board's flight. The keyframes (`crash`) read --wx/--wy (wind-up) and
// --cx/--cy (contact offset), set per tile once both of the pair are known.
const CRASH_MS = 520
const CRASH_IMPACT = 0.8 // keyframe fraction of the impact
const WINDUP_PX = 14
let leaving: HTMLElement[] = []

function onLeave(el: Element) {
  if (reducedMotion) return playMatch()
  leaving.push(el as HTMLElement)
  // both tiles of a pair leave in the same flush; pair them up after it
  if (leaving.length === 1) queueMicrotask(launchLeaving)
}

function launchLeaving() {
  const els = leaving
  leaving = []
  for (let i = 0; i < els.length; i += 2) crash(els[i], els[i + 1])
}

function crash(a: HTMLElement, b: HTMLElement | undefined) {
  // board-local px (offsetLeft/Top ignore the board's scale and tilt, like the keyframes)
  const ax = a.offsetLeft + W / 2
  const ay = a.offsetTop + H / 2
  const bx = b ? b.offsetLeft + W / 2 : ax
  const by = b ? b.offsetTop + H / 2 : ay
  const len = Math.hypot(bx - ax, by - ay) || 1
  const dx = (bx - ax) / len
  const dy = (by - ay) / len
  const reach = Math.abs(dx) * (W / 2) + Math.abs(dy) * (H / 2) + 1 // half extent along the line
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  for (const [el, x, y, s] of [[a, ax, ay, 1], [b, bx, by, -1]] as const) {
    if (!el) continue
    const cx = b ? mx - s * dx * reach - x : 0
    const cy = b ? my - s * dy * reach - y : 0
    el.style.setProperty('--wx', `${b ? -s * dx * WINDUP_PX : 0}px`)
    el.style.setProperty('--wy', `${b ? -s * dy * WINDUP_PX : 0}px`)
    el.style.setProperty('--cx', `${cx}px`)
    el.style.setProperty('--cy', `${cy}px`)
    el.style.zIndex = '200000' // fly above everything
  }
  window.setTimeout(() => {
    if (particles && wrap.value) {
      const r = a.getBoundingClientRect()
      const o = wrap.value.getBoundingClientRect()
      const ex = b ? (r.left + r.width / 2 + (b.getBoundingClientRect().left + r.width / 2)) / 2 : r.left + r.width / 2
      particles.sparkle(ex - o.left, r.top + r.height / 2 - o.top)
    }
    playMatch()
  }, CRASH_MS * CRASH_IMPACT)
}
</script>

<template>
  <div ref="wrap" class="board-wrap" :class="{ dusk }" @click.capture="onClickCapture">
    <div
      class="board"
      :style="{
        width: `${view.w}px`,
        height: `${view.h}px`,
        transform: `translate(-50%, -50%) scale(${scale}) rotateX(${TILT_DEG}deg)`,
      }"
    >
      <TransitionGroup :key="dealId" name="tile" tag="div" @before-leave="onLeave">
        <div
          v-for="d in drawn"
          :key="d.tile.id"
          :data-id="d.tile.id"
          class="tile"
          :class="{ free: d.free, selected: d.selected, dim: showFree && !d.free, dropping: intro, hint: d.hint >= 0, 'hint-b': d.hint === 1 }"
          :style="{ left: `${d.left}px`, top: `${d.top}px`, zIndex: d.zIndex, '--rz': spin.get(d.tile.id), ...dropStyle.get(d.tile.id) }"
          @click="onTileClick(d.tile.id, d.free)"
        >
          <svg class="art" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true">
            <TileFace :face="d.tile.face" :face-set="faceSet" />
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
.board-wrap::before {
  content: '';
  position: absolute;
  inset: 0;
  /* fades out before the edges: the wrap is inset from the table, a hard dark box would show */
  background: radial-gradient(ellipse at 50% 55%, rgba(0, 14, 7, 0.62) 40%, rgba(0, 14, 7, 0) 72%);
  opacity: 0;
  transition: opacity 1.2s ease;
  pointer-events: none;
}
.board-wrap.dusk::before { opacity: 1; }
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
/* Help: float up and bob; the second tile is out of phase */
.tile.hint { animation: hint 1.9s ease-in-out infinite; }
.tile.hint-b { animation-delay: -0.65s; }
@keyframes hint {
  0%, 100% { transform: translateY(-16px) rotate(var(--rz)); }
  50% { transform: translateY(-22px) rotate(calc(var(--rz) + 1.5deg)); }
}
@keyframes pulse {
  50% { transform: translateY(-3px) rotate(var(--rz)); }
}

/* Matched pair: fly up, back off, slam together (offsets set in crash()), burst.
   The leave animation replaces the infinite selection pulse, which would
   otherwise make Vue wait for it and keep the element in the DOM. */
.tile.tile-leave-active { animation: crash 520ms linear both; }
@keyframes crash {
  0% { transform: translate(0, 0) scale(1) rotate(var(--rz)); animation-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1); }
  45% { transform: translate(var(--wx), calc(var(--wy) - 34px)) scale(1.22) rotate(0deg); animation-timing-function: cubic-bezier(0.6, 0, 1, 0.6); }
  80% { opacity: 1; transform: translate(var(--cx), calc(var(--cy) - 30px)) scale(1.2) rotate(0deg); }
  100% { opacity: 0; transform: translate(var(--cx), calc(var(--cy) - 34px)) scale(1.32) rotate(0deg); }
}

@media (prefers-reduced-motion: reduce) {
  .tile.hint { animation: none; transform: translateY(-16px) rotate(var(--rz)); }
  .tile.selected { animation: none; }
  .tile.tile-leave-active { animation: none; }
}
</style>
