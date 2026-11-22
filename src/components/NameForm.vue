<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAME_MAX, normalizeName, validateName } from '../game/playerName'

const props = defineProps<{ initial?: string }>()
const emit = defineEmits<{ submit: [name: string] }>()

const name = ref(props.initial ?? '')
const touched = ref(false)
const error = computed(() => validateName(name.value))

function onSubmit() {
  touched.value = true
  if (!error.value) emit('submit', normalizeName(name.value))
}
</script>

<template>
  <form class="card" @submit.prevent="onSubmit" novalidate>
    <h1>Mahjong</h1>
    <p class="sub">Match pairs of free tiles to clear the table.</p>
    <label for="player-name">Your name</label>
    <input
      id="player-name"
      v-model="name"
      :maxlength="NAME_MAX * 2"
      autocomplete="nickname"
      autofocus
      @blur="touched = true"
    />
    <p class="error" :class="{ visible: touched && error }">{{ error ?? ' ' }}</p>
    <button type="submit">Play</button>
  </form>
</template>

<style scoped>
.card {
  background: rgba(10, 40, 24, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 32px 36px;
  width: min(360px, calc(100vw - 32px));
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
h1 { margin: 0; font-size: 32px; letter-spacing: 0.04em; }
.sub { margin: 0 0 12px; opacity: 0.8; }
label { font-size: 14px; opacity: 0.85; }
input {
  font: inherit;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.95);
  color: #1d2a1f;
}
.error { margin: 0; min-height: 1.2em; font-size: 13px; color: #ffc9a8; visibility: hidden; }
.error.visible { visibility: visible; }
button {
  font: inherit;
  font-weight: 600;
  padding: 10px;
  border: 0;
  border-radius: 8px;
  background: #e8c35a;
  color: #2a2208;
  cursor: pointer;
}
button:hover { background: #f2d272; }
</style>
