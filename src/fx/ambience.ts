import { audioGraph } from './sound'

/**
 * Background ambience (stream, wind in palms, distant jungle) without an
 * audible loop.
 *
 * The source takes are only ~8 s and not loopable, so instead of looping we
 * run a "texture extender": an endless chain of short grains (GRAIN seconds)
 * cut from random positions of the buffer, each slightly re-pitched, joined
 * by equal-power (sin/cos) crossfades of XFADE seconds. For noise-like
 * material (water, wind) equal-power keeps loudness constant across the
 * join, so there is no seam, and random order removes any 8 s periodicity.
 *
 * Grains are scheduled LOOKAHEAD seconds ahead on the audio clock by a 0.5 s
 * timer. Background tabs throttle timers, so the AudioContext is suspended
 * while the page is hidden (see sound.ts) and the queue never runs dry.
 *
 * One take is picked at random per session and only that file is fetched.
 * At load it is trimmed (EDGE_TRIM: generator fades / MP3 padding) and
 * loudness-normalised (TARGET_RMS), then played at LEVEL.
 */
const FILES = ['sounds/ambience-1.mp3', 'sounds/ambience-2.mp3']
const EDGE_TRIM = 0.15 // s cut from both ends of the source
const TARGET_RMS = 0.12 // loudness after normalisation (before LEVEL)
const LEVEL = 0.1 // ambience volume relative to the other sounds
const GRAIN: [number, number] = [2.6, 4.2] // s per grain (must be > 2 × XFADE)
const XFADE = 0.9 // s equal-power crossfade between grains
const RATE: [number, number] = [0.97, 1.03] // per-grain re-pitch, decorrelates repeats
const MIN_JUMP = 1.0 // s: next grain must start at least this far from the previous one
const LOOKAHEAD = 6 // s of audio kept scheduled
const FADE_IN = 2.5 // s on start

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const CURVE_N = 64
const FADE_UP = Float32Array.from({ length: CURVE_N }, (_, i) => Math.sin(((i / (CURVE_N - 1)) * Math.PI) / 2))
const FADE_DOWN = Float32Array.from({ length: CURVE_N }, (_, i) => Math.cos(((i / (CURVE_N - 1)) * Math.PI) / 2))

let started = false
let enabled = true
let bus: GainNode | null = null
let buffer: AudioBuffer | null = null
let nextAt = 0
let lastOffset = -Infinity
let pumpTimer: number | undefined

/** Start the ambience (idempotent). Call after unlockAudio(), e.g. when a game starts. */
export async function startAmbience() {
  const graph = audioGraph()
  if (!graph || started) return
  started = true
  const { ctx, master } = graph
  try {
    const file = FILES[Math.floor(Math.random() * FILES.length)]
    const res = await fetch(`${import.meta.env.BASE_URL}${file}`)
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
    buffer = prepare(ctx, await ctx.decodeAudioData(await res.arrayBuffer()))
  } catch (e) {
    console.warn('Ambience unavailable', e)
    return
  }
  bus = ctx.createGain()
  bus.gain.value = 0
  bus.connect(master)
  bus.gain.setTargetAtTime(enabled ? LEVEL : 0, ctx.currentTime, FADE_IN / 3)
  nextAt = ctx.currentTime + 0.05
  pump()
  pumpTimer = window.setInterval(pump, 500)
}

/** Ambience on/off (separate from the global Sound mute, which also silences it). */
export function setAmbienceEnabled(on: boolean) {
  enabled = on
  const graph = audioGraph()
  if (bus && graph) bus.gain.setTargetAtTime(on ? LEVEL : 0, graph.ctx.currentTime, 0.4)
}

export function stopAmbience() {
  window.clearInterval(pumpTimer)
  bus?.disconnect()
  bus = null
  started = false
}

function pump() {
  const graph = audioGraph()
  if (!graph || !buffer || !bus) return
  const { ctx } = graph
  // after a long suspension the clock may have passed nextAt: restart the chain cleanly
  if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05
  while (nextAt < ctx.currentTime + LOOKAHEAD) scheduleGrain(ctx)
}

function scheduleGrain(ctx: AudioContext) {
  const buf = buffer!
  const dur = rand(GRAIN[0], GRAIN[1])
  const rate = rand(RATE[0], RATE[1])
  const maxOffset = Math.max(0, buf.duration - dur * rate - 0.01)
  let offset = rand(0, maxOffset)
  for (let tries = 0; tries < 8 && Math.abs(offset - lastOffset) < MIN_JUMP; tries++) offset = rand(0, maxOffset)
  lastOffset = offset

  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  const g = ctx.createGain()
  const t0 = nextAt
  g.gain.setValueCurveAtTime(FADE_UP, t0, XFADE)
  g.gain.setValueCurveAtTime(FADE_DOWN, t0 + dur - XFADE, XFADE)
  src.connect(g).connect(bus!)
  src.start(t0, offset)
  src.stop(t0 + dur + 0.02)
  src.onended = () => g.disconnect()

  nextAt = t0 + dur - XFADE // the next grain fades in while this one fades out
}

/** Trim the edges and normalise loudness into a fresh buffer. */
function prepare(ctx: AudioContext, src: AudioBuffer): AudioBuffer {
  const trim = Math.floor(EDGE_TRIM * src.sampleRate)
  const len = Math.max(1, src.length - 2 * trim)
  let sum = 0
  for (let c = 0; c < src.numberOfChannels; c++) {
    const d = src.getChannelData(c)
    for (let i = trim; i < trim + len; i++) sum += d[i] * d[i]
  }
  const rms = Math.sqrt(sum / (len * src.numberOfChannels)) || 1
  // RMS only: float buffers may exceed 1.0 and LEVEL × master leave headroom, so
  // a peak cap would just make the takes unequally loud. Sanity-cap the gain.
  const gain = Math.min(TARGET_RMS / rms, 40)
  const out = ctx.createBuffer(src.numberOfChannels, len, src.sampleRate)
  for (let c = 0; c < src.numberOfChannels; c++) {
    const d = src.getChannelData(c)
    const o = out.getChannelData(c)
    for (let i = 0; i < len; i++) o[i] = d[i + trim] * gain
  }
  return out
}
