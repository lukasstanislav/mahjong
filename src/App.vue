<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, ref } from 'vue'
import GameBoard from './components/GameBoard.vue'
// three.js is ~175 kB gz: load it in its own chunk while the player types their name
const GameBoard3D = defineAsyncComponent(() => import('./components/GameBoard3D.vue'))
import NameForm from './components/NameForm.vue'
import { useGame } from './game/useGame'
import { setMuted, unlockAudio } from './fx/sound'
import { setAmbienceEnabled, startAmbience } from './fx/ambience'

const STORAGE_KEY = 'mahjong.playerName'
const SOUND_KEY = 'mahjong.sound'
const AMBIENCE_KEY = 'mahjong.ambience'

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
const { tiles, dealId, selectedId, hintIds, freeIds, availablePairs, won, stuck, newGame, pick, hint } = useGame()

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

onBeforeUnmount(() => window.clearTimeout(autoHelpTimer))

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

function deal() {
  unlockAudio() // must run inside a user gesture
  void startAmbience() // idempotent: starts once, keeps playing across games
  boardReady = false
  window.clearTimeout(autoHelpTimer)
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
      <div v-if="won || stuck" class="banner">
        <p v-if="won">Well done, {{ player }}! The table is clear.</p>
        <p v-else>No more moves.</p>
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
</style>
