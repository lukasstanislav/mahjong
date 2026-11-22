import * as THREE from 'three'

/**
 * Acrylic crumbs for a matched tile. One InstancedMesh of irregular chunks
 * (low-poly icosahedra, scaled non-uniformly), CPU-integrated: ballistic
 * motion + spin + gravity, one fake bounce on the table.
 *
 * Crumbs are released progressively, in step with the tile's dissolve front
 * (see DISSOLVE_FIELD in BoardRenderer): a crumb at height y appears roughly
 * when the shader has eaten the tile there. Velocity has a strong component
 * toward the camera, so crumbs grow and fly out of the viewport; near the
 * camera they shrink to nothing instead of popping through the near plane.
 *
 * All coordinates are table-local (the mesh lives in the tilting table group).
 */

export interface DebrisDims {
  w: number
  d: number
  h: number
  backFrac: number // lower fraction of thickness that is the green back
}

const POOL = 640
const PER_TILE = 32
const SIZE: [number, number] = [0.05, 0.14]
const OUT: [number, number] = [0.3, 1.0] // outward from tile centre, units/s
const UP: [number, number] = [2.2, 6.2]
const TOWARD_CAM: [number, number] = [2.5, 4.5] // tune: 0 = no "out of the screen" flight
const SPIN: [number, number] = [5, 16] // rad/s
const GRAVITY = 20
const LIFE = 2.2 // s, hard cap
const NEAR_FADE: [number, number] = [1.2, 4.0] // shrink to 0 between these camera distances

const IVORY = new THREE.Color('#f6efdc')
const IVORY_DARK = new THREE.Color('#e4d9bd')
const GREEN = new THREE.Color('#1b6a48')
const INK = [new THREE.Color('#1d1d1d'), new THREE.Color('#ba1920'), new THREE.Color('#0f6b35')]

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export class Debris {
  readonly mesh: THREE.InstancedMesh
  private pos = new Float32Array(POOL * 3)
  private vel = new Float32Array(POOL * 3)
  private axis: THREE.Vector3[] = []
  private angle = new Float32Array(POOL)
  private spin = new Float32Array(POOL)
  private scale: THREE.Vector3[] = []
  private release = new Float32Array(POOL).fill(Infinity) // clock time when it appears
  private born = new Float32Array(POOL).fill(-1) // -1 = free slot
  private bounced = new Uint8Array(POOL)
  private next = 0
  private active = 0

  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private zero = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(private dims: DebrisDims) {
    const geo = new THREE.IcosahedronGeometry(1, 0)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0, flatShading: true })
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.frustumCulled = false
    for (let i = 0; i < POOL; i++) {
      this.axis.push(new THREE.Vector3(0, 1, 0))
      this.scale.push(new THREE.Vector3(1, 1, 1))
      this.mesh.setMatrixAt(i, this.zero)
      this.mesh.setColorAt(i, IVORY)
    }
  }

  /**
   * Break one tile into crumbs.
   * @param base tile base centre (table-local), @param spin its Y rotation,
   * @param now clock time, @param dissolve seconds of the dissolve,
   * @param field (y01, noise) → dissolve-field value in 0..1 (must match the shader's weighting)
   */
  spawn(base: THREE.Vector3, spin: number, now: number, dissolve: number, camLocal: THREE.Vector3, field: (y01: number, n: number) => number) {
    const { w, d, h, backFrac } = this.dims
    const c = Math.cos(spin)
    const sn = Math.sin(spin)
    for (let k = 0; k < PER_TILE; k++) {
      const i = this.next
      this.next = (this.next + 1) % POOL
      const i3 = i * 3

      const lx = rand(-w / 2, w / 2)
      const ly = rand(0, h)
      const lz = rand(-d / 2, d / 2)
      const px = base.x + lx * c + lz * sn
      const py = base.y + ly
      const pz = base.z - lx * sn + lz * c
      this.pos.set([px, py, pz], i3)

      // velocity: outward + up + toward the camera
      const ox = px - base.x
      const oz = pz - base.z
      const ol = Math.hypot(ox, oz) || 1
      const out = rand(OUT[0], OUT[1])
      this.v.set(camLocal.x - px, camLocal.y - py, camLocal.z - pz).normalize().multiplyScalar(rand(TOWARD_CAM[0], TOWARD_CAM[1]))
      this.vel.set([this.v.x + (ox / ol) * out, this.v.y + rand(UP[0], UP[1]), this.v.z + (oz / ol) * out], i3)

      this.axis[i].set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize()
      this.angle[i] = rand(0, Math.PI * 2)
      this.spin[i] = rand(SPIN[0], SPIN[1])
      const sz = rand(SIZE[0], SIZE[1])
      this.scale[i].set(sz * rand(0.6, 1.4), sz * rand(0.5, 1.2), sz * rand(0.6, 1.4))

      const y01 = ly / h
      this.release[i] = now + Math.min(1, field(y01, Math.random())) * dissolve
      this.born[i] = this.release[i]
      this.bounced[i] = 0

      const col = ly < h * backFrac ? GREEN : Math.random() < 0.06 ? INK[Math.floor(Math.random() * INK.length)] : Math.random() < 0.5 ? IVORY : IVORY_DARK
      this.mesh.setColorAt(i, col)
    }
    this.mesh.instanceColor!.needsUpdate = true
  }

  clear() {
    this.born.fill(-1)
    this.release.fill(Infinity)
    for (let i = 0; i < POOL; i++) this.mesh.setMatrixAt(i, this.zero)
    this.mesh.instanceMatrix.needsUpdate = true
    this.active = 0
  }

  /** Integrate one frame. Returns true while any crumb is pending or flying. */
  update(dt: number, now: number, camLocal: THREE.Vector3): boolean {
    if (this.active === 0 && !this.anyPending()) return false
    this.active = 0
    for (let i = 0; i < POOL; i++) {
      if (this.born[i] < 0) continue
      if (now < this.release[i]) {
        this.active++ // pending; stays hidden
        this.mesh.setMatrixAt(i, this.zero)
        continue
      }
      const age = now - this.born[i]
      if (age > LIFE) {
        this.born[i] = -1
        this.mesh.setMatrixAt(i, this.zero)
        continue
      }
      const i3 = i * 3
      this.vel[i3 + 1] -= GRAVITY * dt
      this.pos[i3] += this.vel[i3] * dt
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt
      // one damped bounce on the table, then let it settle/slide out
      if (this.pos[i3 + 1] < 0 && this.vel[i3 + 1] < 0) {
        this.pos[i3 + 1] = 0
        this.vel[i3 + 1] *= this.bounced[i] ? 0 : -0.3
        this.vel[i3] *= 0.5
        this.vel[i3 + 2] *= 0.5
        this.spin[i] *= 0.4
        this.bounced[i] = 1
      }
      this.angle[i] += this.spin[i] * dt

      // shrink near the camera instead of clipping through the near plane; fade out at end of life
      this.v.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2])
      const dist = this.v.distanceTo(camLocal)
      let k = THREE.MathUtils.clamp((dist - NEAR_FADE[0]) / (NEAR_FADE[1] - NEAR_FADE[0]), 0, 1)
      k *= Math.min(1, (LIFE - age) / 0.3)
      if (k <= 0.001) {
        this.born[i] = -1
        this.mesh.setMatrixAt(i, this.zero)
        continue
      }
      this.active++
      this.q.setFromAxisAngle(this.axis[i], this.angle[i])
      this.s.copy(this.scale[i]).multiplyScalar(k)
      this.m.compose(this.v, this.q, this.s)
      this.mesh.setMatrixAt(i, this.m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    return this.active > 0
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }

  private anyPending() {
    for (let i = 0; i < POOL; i++) if (this.born[i] >= 0) return true
    return false
  }
}
