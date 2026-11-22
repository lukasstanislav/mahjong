import * as THREE from 'three'

/**
 * Selection effects for the picked tile, in table-local 3D space (add `group`
 * to the table so it tilts with it):
 *
 * - Glow outline: one additive quad slightly larger than the tile, at its top
 *   face. The fragment shader evaluates a rounded-rectangle SDF of the tile
 *   top: a bright line on the edge (exp(-|d|/w)) plus a softer outer halo,
 *   pulsing in sync with the selection bob.
 * - Rays: a pool of particles emitted from random points on the top-face
 *   perimeter, flying outward along the edge normal and upward with drag.
 *   Each has a glowing head (Points) and a streak tail along its velocity
 *   (LineSegments). Additive + vertex colours: black = invisible, so dead
 *   particles need no compaction.
 */

export interface TileDims {
  w: number // X
  d: number // Z
  h: number // Y (thickness)
  radius: number
}

export interface SelectionTarget {
  pos: THREE.Vector3 // tile base centre (table-local), incl. bob
  spin: number // rotation about Y
}

const COLOR = new THREE.Color('#ffcf5a')
const CORE = new THREE.Color('#fff4d6') // ray heads: hotter, whiter than the rim
const POOL = 256
const EMIT_RATE = 70 // particles / second while selected
const SPEED: [number, number] = [0.7, 1.6] // outward, units/s
const RISE: [number, number] = [0.25, 0.8] // upward, units/s
const LIFE: [number, number] = [0.45, 0.9] // seconds
const DRAG = 2.2 // 1/s
const TAIL = 0.16 // streak length = velocity × TAIL seconds
const HEAD_SIZE = 0.22
const GLOW_MARGIN = 0.45 // quad extends this far beyond the tile edge
const GLOW_WIDTH = 0.035 // edge-line falloff
const GLOW_INTENSITY = 1.3

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export class SelectionFx {
  readonly group = new THREE.Group()

  private glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private heads: THREE.Points
  private tails: THREE.LineSegments
  private headPos: Float32Array
  private headCol: Float32Array
  private tailPos: Float32Array
  private tailCol: Float32Array
  private p: Float32Array // x y z per particle
  private v: Float32Array // vx vy vz
  private age = new Float32Array(POOL)
  private life = new Float32Array(POOL).fill(0)
  private next = 0
  private emitDebt = 0
  private alive = 0
  private disposables: Array<{ dispose(): void }> = []

  constructor(
    private dims: TileDims,
    private reducedMotion = false,
  ) {
    // --- glow quad -----------------------------------------------------------
    const gw = dims.w + 2 * GLOW_MARGIN
    const gd = dims.d + 2 * GLOW_MARGIN
    const geo = new THREE.PlaneGeometry(gw, gd).rotateX(-Math.PI / 2)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHalf: { value: new THREE.Vector2(dims.w / 2, dims.d / 2) },
        uRadius: { value: dims.radius },
        uWidth: { value: GLOW_WIDTH },
        uColor: { value: COLOR.clone() },
        uIntensity: { value: GLOW_INTENSITY },
        uPulse: { value: 1 },
        uMargin: { value: GLOW_MARGIN },
      },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          vP = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uHalf;
        uniform float uRadius, uWidth, uIntensity, uPulse, uMargin;
        uniform vec3 uColor;
        varying vec2 vP;
        float sdRoundBox(vec2 p, vec2 b, float r) {
          vec2 q = abs(p) - b + r;
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }
        void main() {
          float d = sdRoundBox(vP, uHalf, uRadius);
          // rim: falls off fast inward (keeps the face readable), softer outward
          float line = d < 0.0 ? exp(d / (uWidth * 0.5)) : exp(-d / uWidth);
          float halo = d > 0.0 ? exp(-d / (uWidth * 4.0)) * 0.3 : 0.0;  // soft aura
          float window = 1.0 - smoothstep(uMargin * 0.5, uMargin * 0.95, d); // exactly 0 before the quad border
          float a = (line + halo) * window * uIntensity * uPulse;
          gl_FragColor = vec4(uColor * a, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.glow = new THREE.Mesh(geo, mat)
    this.glow.visible = false
    this.glow.renderOrder = 10
    this.group.add(this.glow)

    // --- particles -----------------------------------------------------------
    this.p = new Float32Array(POOL * 3)
    this.v = new Float32Array(POOL * 3)
    this.headPos = new Float32Array(POOL * 3)
    this.headCol = new Float32Array(POOL * 3)
    this.tailPos = new Float32Array(POOL * 6)
    this.tailCol = new Float32Array(POOL * 6)

    const headGeo = new THREE.BufferGeometry()
    headGeo.setAttribute('position', new THREE.BufferAttribute(this.headPos, 3).setUsage(THREE.DynamicDrawUsage))
    headGeo.setAttribute('color', new THREE.BufferAttribute(this.headCol, 3).setUsage(THREE.DynamicDrawUsage))
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
    tailGeo.setAttribute('color', new THREE.BufferAttribute(this.tailCol, 3).setUsage(THREE.DynamicDrawUsage))
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
      o.renderOrder = 11
      this.group.add(o)
    }
    this.disposables.push(geo, mat, headGeo, headMat, sprite, tailGeo, tailMat)
  }

  /** Advance one frame. Returns true while anything is visible (keep rendering). */
  update(dt: number, now: number, target: SelectionTarget | null): boolean {
    // glow follows the selected tile
    if (target) {
      this.glow.visible = true
      this.glow.position.set(target.pos.x, target.pos.y + this.dims.h + 0.006, target.pos.z)
      this.glow.rotation.y = target.spin
      this.glow.material.uniforms.uPulse.value = this.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin(now * 5.5)
    } else {
      this.glow.visible = false
    }

    if (this.reducedMotion) return target !== null

    // emit
    if (target) {
      this.emitDebt += EMIT_RATE * dt
      while (this.emitDebt >= 1) {
        this.emitDebt -= 1
        this.spawn(target)
      }
    } else {
      this.emitDebt = 0
    }

    // integrate + write buffers
    const k = Math.exp(-DRAG * dt)
    this.alive = 0
    for (let i = 0; i < POOL; i++) {
      const i3 = i * 3
      const i6 = i * 6
      let a = 0
      if (this.life[i] > 0) {
        this.age[i] += dt
        if (this.age[i] >= this.life[i]) {
          this.life[i] = 0
        } else {
          this.alive++
          this.v[i3] *= k
          this.v[i3 + 1] *= k
          this.v[i3 + 2] *= k
          this.p[i3] += this.v[i3] * dt
          this.p[i3 + 1] += this.v[i3 + 1] * dt
          this.p[i3 + 2] += this.v[i3 + 2] * dt
          const t = this.age[i] / this.life[i]
          a = (1 - t) * (1 - t) * Math.min(1, t * 12) // quick fade-in, eased fade-out
        }
      }
      for (let c = 0; c < 3; c++) {
        this.headPos[i3 + c] = this.p[i3 + c]
        this.tailPos[i6 + c] = this.p[i3 + c]
        this.tailPos[i6 + 3 + c] = this.p[i3 + c] - this.v[i3 + c] * TAIL
      }
      this.headCol.set([CORE.r * a, CORE.g * a, CORE.b * a], i3)
      // tail: gold at the head, fading to nothing
      this.tailCol.set([COLOR.r * a, COLOR.g * a, COLOR.b * a, 0, 0, 0], i6)
    }
    for (const o of [this.heads, this.tails]) {
      o.geometry.attributes.position.needsUpdate = true
      o.geometry.attributes.color.needsUpdate = true
    }
    return target !== null || this.alive > 0
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
  }

  /** One particle from a random point on the tile-top perimeter, moving outward. */
  private spawn(target: SelectionTarget) {
    const { w, d, h } = this.dims
    // pick a side weighted by its length; local x/z on the edge + outward normal
    const along = Math.random() * (2 * w + 2 * d)
    let lx: number, lz: number, nx: number, nz: number
    if (along < w) [lx, lz, nx, nz] = [along - w / 2, -d / 2, 0, -1]
    else if (along < 2 * w) [lx, lz, nx, nz] = [along - w * 1.5, d / 2, 0, 1]
    else if (along < 2 * w + d) [lx, lz, nx, nz] = [-w / 2, along - 2 * w - d / 2, -1, 0]
    else [lx, lz, nx, nz] = [w / 2, along - 2 * w - d * 1.5, 1, 0]
    // a little spread so it reads as radiating rays, not a wall
    nx += rand(-0.25, 0.25)
    nz += rand(-0.25, 0.25)

    const c = Math.cos(target.spin)
    const s = Math.sin(target.spin)
    const rot = (x: number, z: number): [number, number] => [x * c + z * s, -x * s + z * c]
    const [px, pz] = rot(lx, lz)
    const [vx, vz] = rot(nx, nz)
    const speed = rand(SPEED[0], SPEED[1])

    const i = this.next
    this.next = (this.next + 1) % POOL
    const i3 = i * 3
    this.p[i3] = target.pos.x + px
    this.p[i3 + 1] = target.pos.y + h + rand(-0.04, 0.02)
    this.p[i3 + 2] = target.pos.z + pz
    this.v[i3] = vx * speed
    this.v[i3 + 1] = rand(RISE[0], RISE[1])
    this.v[i3 + 2] = vz * speed
    this.age[i] = 0
    this.life[i] = rand(LIFE[0], LIFE[1])
  }
}

/** Soft radial sprite for particle heads. */
function softDisc(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
