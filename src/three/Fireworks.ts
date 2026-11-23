import * as THREE from 'three'

/**
 * Victory fireworks over the (empty) table, in table-local 3D space: add
 * `group` and `light` to the table so they tilt with it.
 *
 * Shells launch from beyond the near edge of the board (bottom of the screen),
 * climb along an eased path to their burst point above the cloth, and break
 * into a pool of sparks. Sparks are CPU-integrated (drag + gravity) and drawn
 * like SelectionFx's rays: a Points head plus a LineSegments tail along the
 * velocity, additive, RGBA vertex colours (alpha 0 = dead, no compaction).
 * Additive light on the sunlit cloth would wash every colour to yellow-green,
 * so the show runs at dusk: `dusk` eases to 1 while a show is on and the
 * renderer dims its lights by it. A spark
 * that reaches the cloth (`groundAt`) stops and glows out there as an ember.
 *
 * Colour over life: white-hot at the break, then the shell colour, then fades;
 * crackle shells twinkle near the end. Each burst also flashes a PointLight
 * (always in the scene at intensity 0, so its appearance never forces a
 * shader recompile) that lights the cloth from above.
 *
 * Shows are scheduled on the renderer's clock: `start()` queues an opening
 * barrage and a finale, then a slow idle loop until `stop()` / `clear()`.
 */

export interface FireworkHooks {
  /** A shell left the ground. `x` is table-local X (for stereo pan). */
  onLaunch?: (x: number) => void
  /** A shell burst. `size` 0..1, `crackle` = twinkling shell. */
  onBurst?: (x: number, size: number, crackle: boolean) => void
}

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

type Kind = 'peony' | 'chrysanthemum' | 'willow' | 'ring' | 'crackle'

interface Rocket {
  from: THREE.Vector3
  to: THREE.Vector3
  start: number
  dur: number
  kind: Kind
  colors: THREE.Color[]
  trailDebt: number
  launched: boolean
}

const POOL = 4096
const HEAD_SIZE = 0.34
const BURST_Y: [number, number] = [3, 5] // burst height above the cloth
const FLIGHT: [number, number] = [0.85, 1.15] // s, launch → burst
const TRAIL_RATE = 320 // rocket trail sparks / second
const FLASH = 160 // PointLight peak intensity (candela-ish, decay 2)
const FLASH_DECAY = 0.22 // s
const IDLE_GAP: [number, number] = [1.8, 3.4] // s between shells after the finale
const DUSK_LEAD = 0.6 // s before the first launch that the lights start to dim
const DUSK_RATE = 2.2 // 1/s, exponential easing of the dimming
const MANUAL_GAP = 0.15 // s, min interval between click-launched shells
const EMBER_LIFE: [number, number] = [0.35, 0.9] // s a spark glows on the cloth

// barrage: shell offsets (s) after start(); the finale is a near-simultaneous volley
const BARRAGE = [0, 0.45, 0.85, 1.35, 1.65, 2.15, 2.4, 2.9]
const FINALE_AT = 3.7
const FINALE_SHELLS = 6

const PALETTE = {
  gold: new THREE.Color('#ffc23d'),
  red: new THREE.Color('#ff3527'),
  magenta: new THREE.Color('#ff4fb0'), // complementary to the cloth; green sparks vanish on it
  azure: new THREE.Color('#3fa9ff'),
  violet: new THREE.Color('#c46bff'),
  silver: new THREE.Color('#fff1dc'),
}
// colour pairings (main, pistil) that read well together on green cloth
const SCHEMES: Array<[THREE.Color, THREE.Color]> = [
  [PALETTE.red, PALETTE.gold],
  [PALETTE.gold, PALETTE.red],
  [PALETTE.magenta, PALETTE.silver],
  [PALETTE.azure, PALETTE.gold],
  [PALETTE.violet, PALETTE.silver],
  [PALETTE.silver, PALETTE.red],
  [PALETTE.gold, PALETTE.magenta],
]
const TRAIL = new THREE.Color('#ffb347')
const WHITE = new THREE.Color(1, 1, 1)

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pickOf = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)]

export class Fireworks {
  readonly group = new THREE.Group()
  readonly light = new THREE.PointLight('#ffffff', 0, 0, 2)
  hooks: FireworkHooks = {}
  /** 0 = daylight … 1 = show lighting; eased. The renderer dims its lights by it. */
  dusk = 0
  /** Surface height under a table-local (x, z); sparks land there. */
  groundAt: (x: number, z: number) => number = () => 0

  private heads: THREE.Points
  private tails: THREE.LineSegments
  private headPos = new Float32Array(POOL * 3)
  private headCol = new Float32Array(POOL * 4)
  private tailPos = new Float32Array(POOL * 6)
  private tailCol = new Float32Array(POOL * 8)

  private p = new Float32Array(POOL * 3)
  private v = new Float32Array(POOL * 3)
  private col = new Float32Array(POOL * 3) // base colour
  private age = new Float32Array(POOL)
  private life = new Float32Array(POOL) // 0 = dead
  private drag = new Float32Array(POOL)
  private grav = new Float32Array(POOL)
  private tail = new Float32Array(POOL) // streak length factor (s)
  private glow = new Float32Array(POOL) // peak brightness
  private hot = new Float32Array(POOL) // seconds of white-hot start
  private twinkle = new Uint8Array(POOL)
  private landed = new Uint8Array(POOL)
  private next = 0
  private alive = 0

  private rockets: Rocket[] = []
  private queue: Array<{ at: number; finale: boolean }> = []
  private idleAt = Infinity
  private bounds: Bounds = { minX: -6, maxX: 6, minZ: -4, maxZ: 4 }
  private flashAt = -Infinity
  private flashGain = 0
  private now = 0
  private showFrom = Infinity // dusk falls from here until clear()
  private lastManual = -Infinity
  private disposables: Array<{ dispose(): void }> = []

  constructor() {
    const headGeo = new THREE.BufferGeometry()
    headGeo.setAttribute('position', new THREE.BufferAttribute(this.headPos, 3).setUsage(THREE.DynamicDrawUsage))
    headGeo.setAttribute('color', new THREE.BufferAttribute(this.headCol, 4).setUsage(THREE.DynamicDrawUsage))
    const sprite = softDisc()
    const headMat = new THREE.PointsMaterial({
      size: HEAD_SIZE,
      map: sprite,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.heads = new THREE.Points(headGeo, headMat)

    const tailGeo = new THREE.BufferGeometry()
    tailGeo.setAttribute('position', new THREE.BufferAttribute(this.tailPos, 3).setUsage(THREE.DynamicDrawUsage))
    tailGeo.setAttribute('color', new THREE.BufferAttribute(this.tailCol, 4).setUsage(THREE.DynamicDrawUsage))
    const tailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.tails = new THREE.LineSegments(tailGeo, tailMat)

    for (const o of [this.heads, this.tails]) {
      o.frustumCulled = false
      o.renderOrder = 12
      this.group.add(o)
    }
    this.disposables.push(headGeo, headMat, sprite, tailGeo, tailMat)
  }

  get active() {
    return this.alive > 0 || this.rockets.length > 0 || this.queue.length > 0 || this.idleAt < Infinity
  }

  /** Queue the show: opening barrage, finale, then an idle shell every few seconds. */
  start(now: number, bounds: Bounds) {
    this.bounds = bounds
    this.showFrom = now - DUSK_LEAD
    this.queue = BARRAGE.map((t) => ({ at: now + t, finale: false }))
    for (let i = 0; i < FINALE_SHELLS; i++) this.queue.push({ at: now + FINALE_AT + rand(0, 0.3), finale: true })
    this.idleAt = now + FINALE_AT + 2.6
  }

  /** One shell bursting above table-local (x, z), e.g. where the player clicked. */
  launchAt(now: number, x: number, z: number) {
    if (now - this.lastManual < MANUAL_GAP) return // click spam would just churn the pool
    this.lastManual = now
    this.launch(now, x, z, false)
  }

  /** No more launches; what is in the air finishes. */
  stop() {
    this.queue = []
    this.idleAt = Infinity
  }

  /** Remove everything immediately (new deal). */
  clear() {
    this.stop()
    this.showFrom = Infinity
    this.rockets = []
    this.life.fill(0)
    this.alive = 0
    this.light.intensity = 0
    this.flashGain = 0
    this.headCol.fill(0)
    this.tailCol.fill(0)
    for (const o of [this.heads, this.tails]) o.geometry.attributes.color.needsUpdate = true
  }

  /** Advance one frame. Returns true while anything is scheduled or visible. */
  update(dt: number, now: number): boolean {
    this.now = now
    // scheduled launches
    if (this.queue.length) {
      const due = this.queue.filter((q) => q.at <= now)
      if (due.length) {
        this.queue = this.queue.filter((q) => q.at > now)
        for (const q of due) this.launchRandom(now, q.finale)
      }
    }
    if (now >= this.idleAt) {
      this.launchRandom(now, false)
      this.idleAt = now + rand(IDLE_GAP[0], IDLE_GAP[1])
    }

    // rockets: eased climb, sparkling trail, burst at the top
    const tmp = new THREE.Vector3()
    this.rockets = this.rockets.filter((r) => {
      const u = (now - r.start) / r.dur
      if (u < 0) return true
      if (!r.launched) {
        r.launched = true
        this.hooks.onLaunch?.(r.from.x)
      }
      if (u >= 1) {
        this.burst(r.to, r.kind, r.colors)
        return false
      }
      const e = 1 - (1 - u) * (1 - u) // decelerating climb
      tmp.lerpVectors(r.from, r.to, e)
      r.trailDebt += TRAIL_RATE * dt
      while (r.trailDebt >= 1) {
        r.trailDebt -= 1
        const i = this.alloc()
        this.p.set([tmp.x + rand(-0.02, 0.02), tmp.y, tmp.z + rand(-0.02, 0.02)], i * 3)
        this.v.set([rand(-0.3, 0.3), rand(-0.6, 0), rand(-0.3, 0.3)], i * 3)
        this.init(i, TRAIL, rand(0.25, 0.55), 3, 2, 0.05, u < 0.92 ? 0.9 : 0.5, 0.04, false)
      }
      return true
    })

    // dusk eases in shortly before the first launch and lifts after clear()
    const duskTarget = now >= this.showFrom ? 1 : 0
    const prevDusk = this.dusk
    this.dusk += (duskTarget - this.dusk) * (1 - Math.exp(-DUSK_RATE * dt))
    if (Math.abs(duskTarget - this.dusk) < 1e-3) this.dusk = duskTarget
    const fading = this.dusk !== prevDusk

    // flash light decays
    const f = this.flashGain * Math.exp(-(now - this.flashAt) / FLASH_DECAY)
    this.light.intensity = f < 0.05 ? 0 : f

    this.integrate(dt)
    return this.active || this.light.intensity > 0 || fading
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
  }

  // ---- internals -----------------------------------------------------------------

  private launchRandom(now: number, finale: boolean) {
    const b = this.bounds
    const w = b.maxX - b.minX
    const d = b.maxZ - b.minZ
    // keep bursts over the board and toward the near side: raised bursts project
    // higher on screen, and the victory title occupies the top. The finale spreads wider.
    const sx = finale ? 0.42 : 0.32
    this.launch(now, rand(-sx, sx) * w + (b.minX + b.maxX) / 2, rand(0.02, 0.4) * d + (b.minZ + b.maxZ) / 2, finale)
  }

  private launch(now: number, x: number, z: number, finale: boolean) {
    const kinds: Kind[] = finale ? ['peony', 'chrysanthemum', 'crackle', 'peony'] : ['peony', 'chrysanthemum', 'willow', 'ring', 'crackle']
    const kind = pickOf(kinds)
    const [main, pistil] = kind === 'willow' ? [PALETTE.gold, PALETTE.gold] : pickOf(SCHEMES)
    const to = new THREE.Vector3(x, rand(BURST_Y[0], BURST_Y[1]) + (finale ? 0.6 : 0), z)
    // launch from beyond the near edge (screen bottom), roughly below the burst in X
    const from = new THREE.Vector3(x * 0.8 + rand(-1, 1), 0, this.bounds.maxZ + rand(1.5, 2.5))
    this.rockets.push({ from, to, start: now, dur: rand(FLIGHT[0], FLIGHT[1]), kind, colors: [main, pistil], trailDebt: 0, launched: false })
  }

  private burst(at: THREE.Vector3, kind: Kind, [main, pistil]: THREE.Color[]) {
    const dir = new THREE.Vector3()
    let n = 220
    let speed = 6.2
    let drag = 1.6
    let grav = 2.4
    let life: [number, number] = [1.5, 2.2]
    let tail = 0.07
    let size = 0.7
    switch (kind) {
      case 'chrysanthemum':
        n = 240
        speed = 6.6
        tail = 0.16
        life = [1.7, 2.4]
        size = 0.85
        break
      case 'willow':
        n = 180
        speed = 5.6
        drag = 2.3
        grav = 1.4
        tail = 0.22
        life = [2.6, 3.4]
        size = 0.8
        break
      case 'ring':
        n = 120
        speed = 5.8
        size = 0.55
        break
      case 'crackle':
        n = 200
        speed = 5.6
        size = 0.75
        break
    }
    // ring plane: mostly facing the camera (which is high above, +Y/+Z), tilted at random
    const ringN = new THREE.Vector3(rand(-0.5, 0.5), 1, rand(0.2, 0.8)).normalize()
    const ringU = new THREE.Vector3(1, 0, 0).projectOnPlane(ringN).normalize()
    const ringV = new THREE.Vector3().crossVectors(ringN, ringU)

    for (let k = 0; k < n; k++) {
      const isPistil = kind !== 'ring' && kind !== 'willow' && k < n * 0.22
      if (kind === 'ring') {
        const a = (k / n) * Math.PI * 2
        dir.copy(ringU).multiplyScalar(Math.cos(a)).addScaledVector(ringV, Math.sin(a))
      } else {
        randomUnit(dir)
      }
      const s = speed * (isPistil ? rand(0.35, 0.5) : rand(0.86, 1))
      const i = this.alloc()
      this.p.set([at.x, at.y, at.z], i * 3)
      this.v.set([dir.x * s, dir.y * s, dir.z * s], i * 3)
      this.init(i, isPistil ? pistil : main, rand(life[0], life[1]) * (isPistil ? 0.7 : 1), drag, grav, tail, 1, 0.12, kind === 'crackle')
    }
    // the pistil of a ring shell: a small round core
    if (kind === 'ring') {
      for (let k = 0; k < 40; k++) {
        randomUnit(dir)
        const s = speed * rand(0.25, 0.35)
        const i = this.alloc()
        this.p.set([at.x, at.y, at.z], i * 3)
        this.v.set([dir.x * s, dir.y * s, dir.z * s], i * 3)
        this.init(i, pistil, rand(0.9, 1.3), drag, grav, tail, 1, 0.1, false)
      }
    }

    this.light.position.copy(at)
    this.light.color.copy(main).lerp(WHITE, 0.35)
    this.flashAt = this.now
    this.flashGain = FLASH * size
    this.hooks.onBurst?.(at.x, size, kind === 'crackle')
  }

  private alloc(): number {
    const i = this.next
    this.next = (this.next + 1) % POOL
    return i
  }

  private init(i: number, c: THREE.Color, life: number, drag: number, grav: number, tail: number, glow: number, hot: number, twinkle: boolean) {
    this.col.set([c.r, c.g, c.b], i * 3)
    this.age[i] = 0
    this.life[i] = life
    this.drag[i] = drag
    this.grav[i] = grav
    this.tail[i] = tail
    this.glow[i] = glow
    this.hot[i] = hot
    this.twinkle[i] = twinkle ? 1 : 0
    this.landed[i] = 0
  }

  private integrate(dt: number) {
    let alive = 0
    const { p, v, col } = this
    for (let i = 0; i < POOL; i++) {
      const i3 = i * 3
      const i6 = i * 6
      let a = 0
      let r = 0
      let g = 0
      let b = 0
      if (this.life[i] > 0) {
        this.age[i] += dt
        if (this.age[i] >= this.life[i]) {
          this.life[i] = 0
        } else {
          alive++
          if (!this.landed[i]) {
            const k = Math.exp(-this.drag[i] * dt)
            v[i3] *= k
            v[i3 + 1] = v[i3 + 1] * k - this.grav[i] * dt
            v[i3 + 2] *= k
            p[i3] += v[i3] * dt
            p[i3 + 1] += v[i3 + 1] * dt
            p[i3 + 2] += v[i3 + 2] * dt
            const ground = this.groundAt(p[i3], p[i3 + 2]) + 0.01
            if (p[i3 + 1] <= ground) {
              // ember on the cloth: stop, glow out shortly
              p[i3 + 1] = ground
              v[i3] = v[i3 + 1] = v[i3 + 2] = 0
              this.landed[i] = 1
              this.life[i] = Math.min(this.life[i], this.age[i] + rand(EMBER_LIFE[0], EMBER_LIFE[1]))
            }
          }
          const t = this.age[i] / this.life[i]
          a = this.glow[i] * Math.min(1, this.age[i] * 40) * Math.pow(1 - t, 1.4)
          if (this.twinkle[i] && t > 0.45) a *= Math.random() < 0.45 ? 1.7 : 0.08
          // white-hot right after the break, then the shell colour; landed embers go warm
          const heat = Math.max(0, 1 - this.age[i] / Math.max(1e-3, this.hot[i]))
          r = col[i3] + (1 - col[i3]) * heat
          g = col[i3 + 1] + (1 - col[i3 + 1]) * heat
          b = col[i3 + 2] + (1 - col[i3 + 2]) * heat
          if (this.landed[i]) {
            g *= 0.7
            b *= 0.4
          }
        }
      }
      a = Math.min(1, a)
      this.headPos[i3] = this.tailPos[i6] = p[i3]
      this.headPos[i3 + 1] = this.tailPos[i6 + 1] = p[i3 + 1]
      this.headPos[i3 + 2] = this.tailPos[i6 + 2] = p[i3 + 2]
      const tl = this.tail[i]
      this.tailPos[i6 + 3] = p[i3] - v[i3] * tl
      this.tailPos[i6 + 4] = p[i3 + 1] - v[i3 + 1] * tl
      this.tailPos[i6 + 5] = p[i3 + 2] - v[i3 + 2] * tl
      const i4 = i * 4
      const i8 = i * 8
      this.headCol[i4] = this.tailCol[i8] = this.tailCol[i8 + 4] = r
      this.headCol[i4 + 1] = this.tailCol[i8 + 1] = this.tailCol[i8 + 5] = g
      this.headCol[i4 + 2] = this.tailCol[i8 + 2] = this.tailCol[i8 + 6] = b
      this.headCol[i4 + 3] = a
      this.tailCol[i8 + 3] = a * 0.85 // tail fades to nothing behind the head
      this.tailCol[i8 + 7] = 0
    }
    // skip GPU uploads once everything has been dark for a frame
    if (alive > 0 || this.alive > 0) {
      for (const o of [this.heads, this.tails]) {
        o.geometry.attributes.position.needsUpdate = true
        o.geometry.attributes.color.needsUpdate = true
      }
    }
    this.alive = alive
  }
}

function randomUnit(out: THREE.Vector3) {
  const z = rand(-1, 1)
  const a = rand(0, Math.PI * 2)
  const r = Math.sqrt(1 - z * z)
  return out.set(r * Math.cos(a), z, r * Math.sin(a))
}

/** Soft radial sprite for spark heads. */
function softDisc(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.2, 'rgba(255,255,255,0.8)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
