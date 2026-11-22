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
}

const DUST = ['240,232,205', '225,214,182', '255,250,235']
const SPARK = ['255,214,102', '255,240,180', '255,180,80', '255,255,255']

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

export class ParticleLayer {
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
    for (const p of this.parts) {
      p.age += dt
      if (p.age >= p.life) continue
      p.vy += p.gravity * dt
      p.vx *= 0.985
      p.x += p.vx * dt
      p.y += p.vy * dt
      const k = 1 - p.age / p.life
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
    this.parts = alive
    this.raf = alive.length ? requestAnimationFrame(this.tick) : 0
  }
}
