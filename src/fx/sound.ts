/**
 * Tile sounds (Web Audio).
 *
 * Landing clack: recorded one-shots in public/sounds/ (CLACK_FILES). Each hit
 * picks one at random and varies it: playback rate (pitch), low-pass cutoff
 * (brightness), level, a tiny start jitter and stereo pan from the tile's
 * screen position. Only the first SHAPE.slice seconds are played, with a
 * fade, because intro landings arrive every ~28 ms. Per surface the ranges
 * differ: 'felt' (layer 0, on cloth) is lower and duller than 'tile'.
 *
 * Every file is prepared once after decoding: leading silence is skipped
 * (onset detection) so the impact lines up with the visual landing, and the
 * level is peak-normalised so random choice doesn't jump in loudness.
 *
 * Pick: the older tap recording (PICK_FILE), played short when a free tile
 * is selected.
 *
 * If no clack file loads, a synthesised clack (modal synthesis, below) is
 * used: a ~1 ms noise impulse excites inharmonic high-Q resonators plus a
 * surface thump and a contact click, pre-rendered in several variants.
 *
 * Browsers only allow audio after a user gesture, so call `unlockAudio()`
 * from a click/submit handler. Until buffers are ready, plays are no-ops.
 */
export type Surface = 'felt' | 'tile'

const VARIANTS = 6
const CLACK_SECONDS = 0.22

const CLACK_FILES = ['sounds/clack-1.mp3', 'sounds/clack-2.mp3']
const PICK_FILE = 'sounds/tap.mp3'
/** Reward sound for a matched pair (shatter + sparkle). One is chosen at random per match. */
const MATCH_FILES = ['sounds/crumble-1.mp3', 'sounds/crumble-2.mp3']
const MATCH_DEDUPE_S = 0.15 // both tiles of a pair report a removal; play once
const SAMPLE_LEVEL = 0.6 // after peak normalisation

interface Variation {
  slice: number // seconds played (incl. fade)
  rate: [number, number] // playback-rate range: pitch ±
  lowpass: [number, number] // cutoff range in Hz: brightness ±
  level: [number, number]
}
const CRUMBLE_GRAINS = 16
const SHAPE: Record<Surface | 'pick' | 'crumb' | 'match', Variation> = {
  // files are ~1.6 s of sound after the (auto-trimmed) onset, padded to 3 s; keep pitch variation small, it's tonal
  match: { slice: 1.75, rate: [0.97, 1.03], lowpass: [15000, 19000], level: [0.85, 1] },
  felt: { slice: 0.12, rate: [0.84, 0.95], lowpass: [1800, 3400], level: [0.7, 0.95] }, // on cloth
  tile: { slice: 0.18, rate: [0.94, 1.08], lowpass: [5000, 12000], level: [0.7, 1] }, // on a tile
  crumb: { slice: 0.035, rate: [1.6, 2.6], lowpass: [6000, 14000], level: [0.7, 1] }, // tiny grains
  pick: { slice: 0.14, rate: [0.97, 1.05], lowpass: [6000, 10000], level: [0.45, 0.55] },
}

interface Sample {
  buffer: AudioBuffer
  offset: number // seconds of leading silence to skip
  norm: number // gain that brings the peak to 1
}

// Fetching needs no user gesture, so start early; decoding waits for the AudioContext.
const fetchBytes = (path: string): Promise<ArrayBuffer | null> =>
  typeof fetch === 'undefined'
    ? Promise.resolve(null)
    : fetch(`${import.meta.env.BASE_URL}${path}`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
const clackBytes = CLACK_FILES.map(fetchBytes)
const pickBytes = fetchBytes(PICK_FILE)
const matchBytes = MATCH_FILES.map(fetchBytes)

let ctx: AudioContext | null = null
let master: GainNode | null = null
let clackSamples: Sample[] = []
let pickSample: Sample | null = null
let matchSamples: Sample[] = []
let lastMatchAt = -Infinity
let synthClacks: Record<Surface, AudioBuffer[]> | null = null
let muted = false

const rand = (a: number, b: number) => a + Math.random() * (b - a)

async function prepare(ac: AudioContext, bytes: Promise<ArrayBuffer | null>): Promise<Sample | null> {
  try {
    const data = await bytes
    if (!data) return null
    const buffer = await ac.decodeAudioData(data)
    let peak = 0
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v))
    }
    if (peak === 0) return null
    // onset = first sample above 10 % of peak on any channel, minus 1 ms of pre-roll
    let onset = buffer.length
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c)
      for (let i = 0; i < onset; i++) {
        if (Math.abs(ch[i]) > peak * 0.1) {
          onset = i
          break
        }
      }
    }
    return { buffer, offset: Math.max(0, onset / buffer.sampleRate - 0.001), norm: 1 / peak }
  } catch {
    return null
  }
}

export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new AudioContext()
      // Hidden tab: suspend audio. Background timers are throttled, which would starve
      // scheduled audio (ambience); nothing needs to play while the game isn't visible.
      document.addEventListener('visibilitychange', () => {
        if (!ctx) return
        if (document.hidden) void ctx.suspend()
        else void ctx.resume()
      })
      master = ctx.createGain()
      master.gain.value = muted ? 0 : 0.7
      master.connect(ctx.destination)
      const ac = ctx
      void Promise.all(clackBytes.map((b) => prepare(ac, b))).then((list) => {
        clackSamples = list.filter((x): x is Sample => x !== null)
      })
      void prepare(ac, pickBytes).then((x) => (pickSample = x))
      void Promise.all(matchBytes.map((b) => prepare(ac, b))).then((list) => {
        matchSamples = list.filter((x): x is Sample => x !== null)
      })
      void renderClackSamples(ac.sampleRate).then((s) => {
        const toBuffers = (arr: Float32Array[]) =>
          arr.map((data) => {
            const b = ac.createBuffer(1, data.length, ac.sampleRate)
            b.copyToChannel(data as Float32Array<ArrayBuffer>, 0)
            return b
          })
        synthClacks = { felt: toBuffers(s.felt), tile: toBuffers(s.tile) }
      })
    }
    void ctx.resume()
  } catch {
    ctx = null // Web Audio unavailable: stay silent
  }
}

/** The shared audio graph (after unlockAudio), for other audio modules such as ambience. */
export function audioGraph(): { ctx: AudioContext; master: GainNode } | null {
  return ctx && master ? { ctx, master } : null
}

export function setMuted(value: boolean) {
  muted = value
  if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 0.7, ctx.currentTime, 0.01)
}

/** A tile landing on `surface`. `gain` 0..1, `pan` -1 (left) … 1 (right). */
export function playClack(surface: Surface, gain = 1, pan = 0) {
  if (!ctx || !master || muted) return
  if (clackSamples.length) {
    const s = clackSamples[Math.floor(Math.random() * clackSamples.length)]
    return playVaried(s, SHAPE[surface], gain, pan)
  }
  if (!synthClacks) return
  const list = synthClacks[surface]
  const src = ctx.createBufferSource()
  src.buffer = list[Math.floor(Math.random() * list.length)]
  src.playbackRate.value = rand(0.95, 1.05)
  const g = ctx.createGain()
  g.gain.value = gain * rand(0.8, 1)
  src.connect(g).connect(master)
  src.start()
}

/**
 * Acrylic crumbling for a matched tile: a burst of tiny, high-pitched, very
 * short grains of the clack samples, front-loaded (crack, then trickle).
 */
/**
 * A pair was matched: one of the recorded reward sounds, at random, slightly
 * varied. Safe to call once per removed tile (deduped per pair). Falls back
 * to the synthesised crumble + chime if the files didn't load.
 */
export function playMatch(pan = 0) {
  if (!ctx || !master || muted) return
  if (ctx.currentTime - lastMatchAt < MATCH_DEDUPE_S) return
  lastMatchAt = ctx.currentTime
  if (matchSamples.length) {
    const s = matchSamples[Math.floor(Math.random() * matchSamples.length)]
    playVaried(s, SHAPE.match, 1, pan * 0.6)
  } else {
    playCrumble(pan)
    playChime()
  }
}

export function playCrumble(pan = 0) {
  if (!ctx || !master || muted || !clackSamples.length) return
  for (let i = 0; i < CRUMBLE_GRAINS; i++) {
    const s = clackSamples[Math.floor(Math.random() * clackSamples.length)]
    const delay = Math.pow(Math.random(), 2.2) * 0.42 // most grains early
    const gain = (i === 0 ? 0.8 : rand(0.12, 0.35)) * (1 - delay)
    playVaried(s, SHAPE.crumb, gain, pan + rand(-0.3, 0.3), i === 0 ? 0 : delay)
  }
}

/** Short tap when a free tile is picked. */
export function playPick(pan = 0) {
  if (!ctx || !master || muted || !pickSample) return
  playVaried(pickSample, SHAPE.pick, 1, pan)
}

function playVaried(s: Sample, v: Variation, gain: number, pan: number, delay = 0) {
  const c = ctx!
  const t = c.currentTime + delay
  const src = c.createBufferSource()
  src.buffer = s.buffer
  src.playbackRate.value = rand(v.rate[0], v.rate[1])

  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = rand(v.lowpass[0], v.lowpass[1])
  lp.Q.value = 0.5

  const g = c.createGain()
  const level = gain * s.norm * SAMPLE_LEVEL * rand(v.level[0], v.level[1])
  g.gain.setValueAtTime(level, t)
  g.gain.setValueAtTime(level, t + v.slice - Math.min(0.25, v.slice * 0.3)) // longer slices get a longer fade
  g.gain.linearRampToValueAtTime(0, t + v.slice)

  const p = c.createStereoPanner()
  p.pan.value = Math.max(-1, Math.min(1, pan * 0.5 + rand(-0.08, 0.08)))

  src.connect(lp).connect(g).connect(p).connect(master!)
  src.start(t, s.offset + rand(0, 0.002))
  src.stop(t + v.slice + 0.01)
}

// ---- offline rendering ---------------------------------------------------------

/** Renders VARIANTS clacks per surface as raw mono samples (also used for auditioning). */
export async function renderClackSamples(sampleRate = 44100): Promise<Record<Surface, Float32Array[]>> {
  const out: Record<Surface, Float32Array[]> = { felt: [], tile: [] }
  for (const surface of ['felt', 'tile'] as const) {
    for (let i = 0; i < VARIANTS; i++) out[surface].push(await renderClack(sampleRate, surface))
  }
  return out
}

async function renderClack(sampleRate: number, surface: Surface): Promise<Float32Array> {
  const oc = new OfflineAudioContext(1, Math.ceil(sampleRate * CLACK_SECONDS), sampleRate)
  const tile = surface === 'tile'

  // Impulse: ~1.5 ms of noise with a fast exponential decay. Shorter = harder material.
  const impulse = oc.createBuffer(1, Math.ceil(sampleRate * 0.0015), sampleRate)
  const d = impulse.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.0003))

  // One set of modes per variant (same tile), shared by all hits in it.
  const base = tile ? rand(2100, 2700) : rand(1500, 1900)
  const ratios = [1, rand(1.42, 1.55), rand(2.05, 2.2), rand(2.7, 2.95), rand(3.5, 3.9)]
  const ringMs = tile ? rand(28, 45) : rand(9, 14) // how long modes ring (felt damps hard)

  const hit = (t: number, strength: number) => {
    const fan = (node: AudioNode, level: number) => {
      const src = oc.createBufferSource()
      src.buffer = impulse
      const g = oc.createGain()
      g.gain.value = level * strength
      src.connect(node).connect(g).connect(oc.destination)
      src.start(t)
    }

    ratios.forEach((r, i) => {
      const f = base * r
      const bp = oc.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f
      // Q ≈ π·f·τ gives a decay time τ; upper modes die faster.
      bp.Q.value = Math.PI * f * (ringMs / 1000) / (1 + i * 0.35)
      fan(bp, (tile ? 9 : 6) * rand(0.6, 1) / (1 + i * 0.6))
    })

    // Surface thump (much stronger on felt)
    const lp = oc.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = tile ? 600 : rand(260, 380)
    lp.Q.value = 2
    fan(lp, tile ? 0.6 : 2.2)

    // Contact click — the hard "tick" edge
    const hp = oc.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 5000
    fan(hp, tile ? 0.5 : 0.25)
  }

  hit(0.002, 1)
  // Rocking/settling: a smaller second contact a few ms later
  if (Math.random() < (tile ? 0.6 : 0.3)) hit(0.002 + rand(0.008, 0.024), rand(0.2, 0.45))

  const data = (await oc.startRendering()).getChannelData(0)
  let peak = 0
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
  const norm = peak > 0 ? 0.9 / peak : 1
  // normalise + short fade-out so the tail never clicks
  const fade = Math.floor(sampleRate * 0.02)
  for (let i = 0; i < data.length; i++) {
    const k = i > data.length - fade ? (data.length - i) / fade : 1
    data[i] *= norm * k
  }
  return data
}

// ---- chime -----------------------------------------------------------------------

function env(g: GainNode, t: number, peak: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
}

let lastHonk = 0

/**
 * Subtle two-tone "honk" for clicking a blocked tile: two detuned square
 * waves a minor third apart (like a car horn), low-passed and very quiet,
 * with a slight downward bend. Throttled so rapid clicks don't stack.
 */
export function playHonk() {
  if (!ctx || !master || muted) return
  const t = ctx.currentTime
  if (t - lastHonk < 0.15) return
  lastHonk = t

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1100
  lp.Q.value = 0.8
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.07, t + 0.015)
  g.gain.setValueAtTime(0.07, t + 0.09)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17)
  lp.connect(g).connect(master)

  for (const f of [220, 262]) {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(f, t)
    osc.frequency.exponentialRampToValueAtTime(f * 0.94, t + 0.17)
    osc.connect(lp)
    osc.start(t)
    osc.stop(t + 0.19)
  }
}

/** Light chime for a matched pair. */
export function playChime() {
  if (!ctx || !master || muted) return
  const t = ctx.currentTime
  for (const [f, delay] of [[1320, 0], [1980, 0.05]] as const) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = f
    const g = ctx.createGain()
    env(g, t + delay, 0.18, 0.35)
    osc.connect(g).connect(master)
    osc.start(t + delay)
    osc.stop(t + delay + 0.4)
  }
}

// ---- victory -------------------------------------------------------------------
// All synthesised: a soft launch "fwip", a burst (low thump + filtered noise
// bloom, optional crackle tail) and a short rising fanfare. Kept quiet and
// toy-scale: these are fireworks over a card table, not a stadium.

let noise: AudioBuffer | null = null
function noiseBuffer(c: AudioContext) {
  if (noise && noise.sampleRate === c.sampleRate) return noise
  noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return noise
}

function panner(c: AudioContext, pan: number) {
  const p = c.createStereoPanner()
  p.pan.value = Math.max(-1, Math.min(1, pan * 0.6))
  p.connect(master!)
  return p
}

/** A firework shell leaving the ground: short rising band of noise. */
export function playLaunch(pan = 0) {
  if (!ctx || !master || muted) return
  const c = ctx
  const t = c.currentTime
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 6
  bp.frequency.setValueAtTime(rand(500, 700), t)
  bp.frequency.exponentialRampToValueAtTime(rand(2600, 3600), t + 0.45)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.08)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
  src.connect(bp).connect(g).connect(panner(c, pan))
  src.start(t, rand(0, 1.4))
  src.stop(t + 0.55)
}

/** A shell bursting. `size` 0..1; `crackle` adds a tail of tiny pops. */
export function playBurst(pan = 0, size = 0.7, crackle = false) {
  if (!ctx || !master || muted) return
  const c = ctx
  const t = c.currentTime
  const out = panner(c, pan)

  // thump: a sine dropping in pitch
  const osc = c.createOscillator()
  osc.frequency.setValueAtTime(rand(110, 140), t)
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.3)
  const og = c.createGain()
  env(og, t, 0.35 * size, 0.35)
  osc.connect(og).connect(out)
  osc.start(t)
  osc.stop(t + 0.4)

  // bloom: noise through a closing low-pass
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(rand(3000, 4500), t)
  lp.frequency.exponentialRampToValueAtTime(300, t + 0.9)
  const ng = c.createGain()
  env(ng, t, 0.22 * size, 1.0)
  src.connect(lp).connect(ng).connect(out)
  src.start(t, rand(0, 0.9))
  src.stop(t + 1.05)

  if (!crackle) return
  // crackle: sparse high clicks, starting as the sparks start to twinkle
  for (let i = 0; i < 26; i++) {
    const at = t + rand(0.7, 1.9)
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    const hp = c.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = rand(3000, 6000)
    const g = c.createGain()
    env(g, at, rand(0.03, 0.09), 0.025)
    const p = c.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan * 0.6 + rand(-0.25, 0.25)))
    s.connect(hp).connect(g).connect(p).connect(master)
    s.start(at, rand(0, 1.9))
    s.stop(at + 0.03)
  }
}

/** Victory: a quick rising pentatonic run ending on a held chord (bell-ish tones). */
export function playFanfare() {
  if (!ctx || !master || muted) return
  const c = ctx
  const t0 = c.currentTime + 0.02
  // C major pentatonic, two octaves up to the tonic, then C-E-G together
  const run = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]
  const step = 0.085
  const tone = (f: number, at: number, peak: number, decay: number) => {
    for (const [mult, lvl, type] of [[1, 1, 'triangle'], [2, 0.25, 'sine'], [3.01, 0.08, 'sine']] as const) {
      const o = c.createOscillator()
      o.type = type
      o.frequency.value = f * mult
      const g = c.createGain()
      env(g, at, peak * lvl, decay)
      o.connect(g).connect(master!)
      o.start(at)
      o.stop(at + decay + 0.05)
    }
  }
  run.forEach((f, i) => tone(f, t0 + i * step, 0.11, 0.45))
  const chordAt = t0 + run.length * step + 0.04
  for (const f of [523.25, 659.25, 783.99, 1046.5]) tone(f, chordAt, 0.07, 1.8)
}
