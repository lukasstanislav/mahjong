/**
 * Minimal 2D-canvas particle layer drawn over the board. The rAF loop runs
 * only while particles are alive. Coordinates are CSS pixels of the canvas.
 */
interface Particle {
  x: number
  y: number
  vx: number // px/ms
  vy: number
  age: number
  life: number
  size: number
  color: string
  gravity: number
  glow: boolean
  drag?: number // velocity kept per ms (default 0.985 per frame-ish)
  streak?: number // draw a tail of velocity × streak ms
  twinkle?: boolean
  rocket?: boolean // leaves a trail; bursts on death
  palette?: string[]
}

const DUST = ['240,232,205', '225,214,182', '255,250,235']
const SPARK = ['255,214,102', '255,240,180', '255,180,80', '255,255,255']
/** Firework shells: [main, pistil] colours (same family as the 3D board's). */
const SHELLS = [
  ['255,53,39', '255,194,61'],
  ['255,194,61', '255,53,39'],
  ['255,79,176', '255,241,220'], // magenta: green sparks vanish on the cloth
  ['63,169,255', '255,194,61'],
  ['196,107,255', '255,241,220'],
  ['255,241,220', '255,53,39'],
]
const ROCKET_G = 0.0009 // px/ms²

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

export class ParticleLayer {
  /** A firework shell burst at canvas x (CSS px); `twinkle` = crackling shell. */
  onBurst?: (x: number, twinkle: boolean) => void
  private ctx: CanvasRenderingContext2D
  private parts: Particle[] = []
  private raf = 0
  private last = 0
  private w = 0
  private h = 0

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
  }

  resize(w: number, h: number) {
    const dpr = window.devicePixelRatio || 1
    this.w = w
    this.h = h
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** Puff of felt dust kicked sideways where a tile lands. */
  dust(x: number, y: number, width: number) {
    for (let i = 0; i < 9; i++) {
      const side = Math.random() < 0.5 ? -1 : 1
      this.parts.push({
        x: x + side * rand(0.2, 0.5) * width,
        y: y + rand(-2, 2),
        vx: side * rand(0.03, 0.12),
        vy: -rand(0.01, 0.06),
        age: 0,
        life: rand(350, 650),
        size: rand(1, 2.6),
        color: pick(DUST),
        gravity: 0.00012,
        glow: false,
      })
    }
    this.start()
  }

  /** Radial burst of golden sparks for a matched tile. */
  sparkle(x: number, y: number) {
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2)
      const v = rand(0.05, 0.28)
      this.parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 0.05,
        age: 0,
        life: rand(450, 900),
        size: rand(1.2, 3),
        color: pick(SPARK),
        gravity: 0.0003,
        glow: true,
      })
    }
    this.start()
  }

  /** A firework shell launched from the bottom edge, bursting at (x, y). */
  firework(x: number, y: number) {
    const h = Math.max(60, this.h + 10 - y)
    const v = Math.sqrt(2 * ROCKET_G * h)
    this.parts.push({
      x: x + rand(-30, 30),
      y: this.h + 10,
      vx: 0,
      vy: -v,
      age: 0,
      life: v / ROCKET_G,
      size: 2,
      color: '255,200,120',
      gravity: ROCKET_G,
      glow: true,
      drag: 1,
      rocket: true,
      palette: pick(SHELLS),
    })
    this.start()
  }

  private burst(x: number, y: number, [main, pistil]: string[], out: Particle[]) {
    const scale = Math.min(this.w, this.h) / 700 // shell size follows the viewport
    const twinkle = Math.random() < 0.3
    this.onBurst?.(x, twinkle)
    for (let i = 0; i < 160; i++) {
      const core = i < 34
      const a = rand(0, Math.PI * 2)
      const v = (core ? rand(0.16, 0.22) : rand(0.4, 0.47)) * Math.max(0.6, scale)
      out.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        life: rand(1300, 1900) * (core ? 0.7 : 1),
        size: rand(1.6, 2.6),
        color: core ? pistil : main,
        gravity: 0.00009,
        glow: true,
        drag: 0.9975,
        streak: 40,
        twinkle,
      })
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.parts = []
  }

  private start() {
    if (this.raf) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    const dt = Math.min(50, now - this.last)
    this.last = now
    const { ctx } = this
    ctx.clearRect(0, 0, this.w, this.h)

    const alive: Particle[] = []
    const born: Particle[] = []
    for (const p of this.parts) {
      p.age += dt
      if (p.age >= p.life) {
        if (p.rocket && p.palette) this.burst(p.x, p.y, p.palette, born)
        continue
      }
      // fireworks add light; dust is matte
      ctx.globalCompositeOperation = p.streak || p.rocket ? 'lighter' : 'source-over'
      p.vy += p.gravity * dt
      if (p.drag !== undefined) {
        const k = Math.pow(p.drag, dt)
        p.vx *= k
        p.vy *= k
      } else p.vx *= 0.985
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.rocket) {
        born.push({ x: p.x + rand(-1, 1), y: p.y, vx: rand(-0.02, 0.02), vy: rand(0, 0.03), age: 0, life: rand(250, 450), size: rand(0.8, 1.5), color: '255,190,100', gravity: 0.0002, glow: false })
      }
      let k = 1 - p.age / p.life
      if (p.twinkle && k < 0.5) k *= Math.random() < 0.45 ? 1.6 : 0.1
      if (p.streak) {
        ctx.strokeStyle = `rgba(${p.color},${0.5 * k})`
        ctx.lineWidth = p.size * 0.8
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x - p.vx * p.streak, p.y - p.vy * p.streak)
        ctx.stroke()
      }
      if (p.glow) {
        ctx.fillStyle = `rgba(${p.color},${0.18 * k})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = `rgba(${p.color},${(p.glow ? 0.95 : 0.55) * k})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * (p.glow ? k : 1), 0, Math.PI * 2)
      ctx.fill()
      alive.push(p)
    }
    ctx.globalCompositeOperation = 'source-over'
    this.parts = born.length ? alive.concat(born) : alive
    this.raf = this.parts.length ? requestAnimationFrame(this.tick) : 0
  }
}
