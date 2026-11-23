<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import GameBoard from './components/GameBoard.vue'
// three.js is ~175 kB gz: load it in its own chunk while the player types their name
const GameBoard3D = defineAsyncComponent(() => import('./components/GameBoard3D.vue'))
import NameForm from './components/NameForm.vue'
import { useGame } from './game/useGame'
import { DEFAULT_LAYOUT, LAYOUTS } from './game/layouts'
import { playFanfare, setMuted, unlockAudio } from './fx/sound'
import { setAmbienceEnabled, startAmbience } from './fx/ambience'

const STORAGE_KEY = 'mahjong.playerName'
const SOUND_KEY = 'mahjong.sound'
const AMBIENCE_KEY = 'mahjong.ambience'
const LAYOUT_KEY = 'mahjong.layout'

function loadName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** WebGL board when available; the DOM/CSS board is the fallback. */
const webgl = (() => {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
})()

if (webgl) void import('./components/GameBoard3D.vue') // prefetch

const player = ref<string | null>(null)
const showFree = ref(false)
const sound = ref(readSound())
setMuted(!sound.value)
const { layoutId, tiles, dealId, selectedId, hintIds, freeIds, availablePairs, won, stuck, newGame, pick, hint, solveStep } = useGame()

function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

function toggleSound() {
  setMuted(!sound.value)
  try {
    localStorage.setItem(SOUND_KEY, sound.value ? 'on' : 'off')
  } catch {
    /* ignore */
  }
}

// ---- auto Help -------------------------------------------------------------
// Help engages by itself AUTO_HELP_START_MS after the tiles are laid, and after
// AUTO_HELP_IDLE_MS without a click. It never replaces a hint that is showing.
const AUTO_HELP_START_MS = 5_000
const AUTO_HELP_IDLE_MS = 15_000
let autoHelpTimer: number | undefined
let boardReady = false

function armAutoHelp(ms: number) {
  window.clearTimeout(autoHelpTimer)
  autoHelpTimer = window.setTimeout(autoHelp, ms)
}

function autoHelp() {
  if (player.value === null || !boardReady || won.value || stuck.value || hintIds.value) return
  hint()
}

/** Board finished laying the tiles (intro done or skipped). */
function onBoardReady() {
  boardReady = true
  armAutoHelp(AUTO_HELP_START_MS)
}

/** Any click in the game counts as activity. */
function onActivity() {
  if (boardReady) armAutoHelp(AUTO_HELP_IDLE_MS)
}

// ---- victory -----------------------------------------------------------------
// The boards run the visuals (fireworks in 3D, a 2D canvas show in the DOM
// board); the overlay and the fanfare live here. The fanfare lands with the
// title, which appears once the last pair has dissolved (CSS delay, VICTORY_MS).
const VICTORY_MS = 1300 // flight (~0.5 s) + dissolve + a beat
let fanfareTimer: number | undefined
watch(won, (w) => {
  window.clearTimeout(fanfareTimer)
  if (w) fanfareTimer = window.setTimeout(playFanfare, VICTORY_MS)
})

// dev only: __mahjong.solve(ms, leavePairs) plays the deal's solution, to reach the win quickly
let solveTimer: number | undefined
if (import.meta.env.DEV) {
  const w = window as unknown as { __mahjong?: Record<string, unknown> }
  w.__mahjong = Object.assign(w.__mahjong ?? {}, {
    solve(ms = 120, leavePairs = 0) {
      window.clearTimeout(solveTimer)
      const step = () => {
        if (tiles.value.length / 2 <= leavePairs || !solveStep()) return
        solveTimer = window.setTimeout(step, ms)
      }
      step()
    },
  })
}

onBeforeUnmount(() => {
  window.clearTimeout(autoHelpTimer)
  window.clearTimeout(fanfareTimer)
  window.clearTimeout(solveTimer)
})

function leaveGame() {
  boardReady = false
  window.clearTimeout(autoHelpTimer)
  player.value = null
}

const ambience = ref(readFlag(AMBIENCE_KEY))
setAmbienceEnabled(ambience.value)

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off'
  } catch {
    return true
  }
}

function toggleAmbience() {
  setAmbienceEnabled(ambience.value)
  try {
    localStorage.setItem(AMBIENCE_KEY, ambience.value ? 'on' : 'off')
  } catch {
    /* ignore */
  }
}

// layout choice: remembered, and picking one starts a new game
layoutId.value = (() => {
  try {
    const id = localStorage.getItem(LAYOUT_KEY)
    return LAYOUTS.some((l) => l.id === id) ? id! : DEFAULT_LAYOUT
  } catch {
    return DEFAULT_LAYOUT
  }
})()

function changeLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, layoutId.value)
  } catch {
    /* ignore */
  }
  deal()
}

function deal() {
  unlockAudio() // must run inside a user gesture
  void startAmbience() // idempotent: starts once, keeps playing across games
  boardReady = false
  window.clearTimeout(autoHelpTimer)
  window.clearTimeout(solveTimer)
  newGame()
}

function start(name: string) {
  player.value = name
  try {
    localStorage.setItem(STORAGE_KEY, name)
  } catch {
    /* storage unavailable — name just won't be remembered */
  }
  deal()
}
</script>

<template>
  <main v-if="player === null" class="center">
    <NameForm :initial="loadName()" @submit="start" />
  </main>

  <main v-else class="game" @pointerdown.capture="onActivity">
    <header class="hud">
      <span class="player">{{ player }}</span>
      <label class="toggle">
        Layout
        <select v-model="layoutId" @change="changeLayout">
          <option v-for="l in LAYOUTS" :key="l.id" :value="l.id">{{ l.name }}</option>
        </select>
      </label>
      <span>Tiles: {{ tiles.length }}</span>
      <span>Moves available: {{ availablePairs }}</span>
      <label class="toggle"><input v-model="showFree" type="checkbox" /> Show pickable</label>
      <label class="toggle"><input v-model="sound" type="checkbox" @change="toggleSound" /> Sound</label>
      <label class="toggle"><input v-model="ambience" type="checkbox" @change="toggleAmbience" /> Ambience</label>
      <button :disabled="stuck || won" title="Highlight a possible match" @click="hint">Help</button>
      <button @click="deal">New game</button>
      <button class="ghost" @click="leaveGame">Change name</button>
    </header>

    <section class="table">
      <component :is="webgl ? GameBoard3D : GameBoard" :tiles="tiles" :deal-id="dealId" :free-ids="freeIds" :selected-id="selectedId" :hint-ids="hintIds" :show-free="showFree" @pick="pick" @ready="onBoardReady" />
      <div v-if="won" class="victory" :style="{ '--delay': `${VICTORY_MS}ms` }">
        <p class="kicker">The table is clear</p>
        <h1 class="title">Well done!</h1>
        <p class="who">{{ player }}</p>
        <button class="again" @click="deal">Play again</button>
        <p v-if="webgl" class="tip">Click the table for more fireworks</p>
      </div>
      <div v-else-if="stuck" class="banner">
        <p>No more moves.</p>
        <button @click="deal">New game</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.center { min-height: 100vh; display: grid; place-items: center; }
.game { height: 100vh; display: flex; flex-direction: column; }
.hud {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 20px;
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 15px;
}
.player { font-weight: 700; margin-right: auto; }
.toggle { display: flex; gap: 6px; align-items: center; cursor: pointer; }
button {
  font: inherit;
  padding: 6px 14px;
  border: 0;
  border-radius: 6px;
  background: #e8c35a;
  color: #2a2208;
  font-weight: 600;
  cursor: pointer;
}
select {
  font: inherit;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(0, 0, 0, 0.25);
  color: inherit;
}
select option { color: #1d2a1f; }
button:disabled { opacity: 0.45; cursor: default; }
button.ghost { background: transparent; color: inherit; border: 1px solid rgba(255, 255, 255, 0.35); }
.table { position: relative; flex: 1; min-height: 0; padding: 16px; }
.banner {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: rgba(10, 40, 24, 0.9);
  padding: 24px 32px;
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.banner p { margin: 0 0 14px; font-size: 20px; }

/* ---- victory overlay: sits above the fireworks, lets clicks through to the table ---- */
.victory {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 7vh 16px 0;
  text-align: center;
  pointer-events: none;
}
.victory > * { animation: rise 900ms cubic-bezier(0.2, 1.4, 0.4, 1) var(--delay) both; }
.victory .kicker { animation-delay: calc(var(--delay) + 0ms); }
.victory .title { animation-delay: calc(var(--delay) + 120ms); }
.victory .who { animation-delay: calc(var(--delay) + 320ms); }
.victory .again { animation-delay: calc(var(--delay) + 520ms); }
.victory .tip { animation-delay: calc(var(--delay) + 2600ms); }
.kicker {
  margin: 0;
  font-size: clamp(13px, 1.6vw, 17px);
  letter-spacing: 0.35em;
  text-transform: uppercase;
  color: #f3dfa2;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}
.title {
  margin: 0.05em 0 0;
  font: 700 clamp(52px, 10vw, 132px) / 1 Georgia, 'Times New Roman', serif;
  letter-spacing: 0.01em;
  /* gold leaf with a moving highlight */
  background: linear-gradient(100deg, #a86f0c 0%, #f7d774 30%, #fff8dc 45%, #f7d774 60%, #a86f0c 100%);
  background-size: 250% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 3px 0 #5a3a05) drop-shadow(0 10px 24px rgba(0, 0, 0, 0.55)) drop-shadow(0 0 30px rgba(255, 200, 90, 0.35));
  animation-name: rise, shimmer;
  animation-duration: 900ms, 3.2s;
  animation-timing-function: cubic-bezier(0.2, 1.4, 0.4, 1), linear;
  animation-iteration-count: 1, infinite;
  animation-fill-mode: both, none;
}
.who {
  margin: 0.25em 0 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: clamp(20px, 3vw, 32px);
  font-weight: 600;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.7);
}
.again {
  margin-top: 22px;
  padding: 10px 26px;
  font-size: 18px;
  pointer-events: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.tip { margin: 14px 0 0; font-size: 14px; color: rgba(255, 255, 255, 0.7); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7); }
@keyframes rise {
  from { opacity: 0; transform: translateY(24px) scale(0.8); }
  to { opacity: 1; transform: none; }
}
@keyframes shimmer {
  from { background-position: 100% 0; }
  to { background-position: -150% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .victory > * { animation: fade 400ms ease-out var(--delay) both; }
  .victory .title { animation: fade 400ms ease-out var(--delay) both; }
  .victory .tip { display: none; }
}
@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
