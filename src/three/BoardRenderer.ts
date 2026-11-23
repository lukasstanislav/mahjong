import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Tile } from '../game/deal'
import type { Surface } from '../fx/sound'
import { SelectionFx, type SelectionTarget } from './SelectionFx'
import { Debris } from './Debris'
import { Fireworks } from './Fireworks'
import { matchKey } from '../game/tiles'
import { CELL_UV, FACE_ASPECT, IVORY, cellIndex, cellOffset, createAtlas } from './atlas'

/**
 * WebGL board (three.js). Imperative and framework-free; GameBoard3D.vue owns it.
 *
 * World: table in the XZ plane, +Y up, camera on +Z looking down at ~55°.
 * Layout half-tile units map to X/Z; layer z maps to Y = z * TH (tiles rest
 * on each other). Tile ids are layout indices, used directly as instance ids.
 *
 * Per tile, 3 InstancedMeshes share one instance matrix (offsets baked into
 * geometry): green back half, ivory top half, face quad. A 4th, invisible
 * box InstancedMesh is the cheap raycast target for hover/pick.
 *
 * Face quads use MeshStandardMaterial + onBeforeCompile to read a per-instance
 * atlas cell (aCell) and highlight state (aState = selected, hover, dim).
 *
 * Animation is CPU-side: while anything animates, all matrices are recomposed
 * each frame. Landing events fire from the frame loop when a tile crosses
 * LAND_AT of its drop. Renders only when something changed.
 */

// tile dimensions (world units): width X, depth Z, thickness Y
const TW = 1
const TD = 1.36
const TH = 0.62
const GAP = 0.07
const RADIUS = 0.085
const STEP_X = (TW + GAP) / 2
const STEP_Z = (TD + GAP) / 2
const MAX_SPIN = THREE.MathUtils.degToRad(2)

// intro / animation timing (seconds)
const STAGGER = 0.028
const DROP = 0.42
const LAND_AT = 0.6
const DROP_H = 4.5
const LEAVE = 0.45 // matched tile dissolve duration

// Matched pair: both tiles fly up FLY_LIFT, lean back and turn their long sides
// to face each other (wind-up), then slam together; the dissolve starts on impact.
const FLY_LIFT = 4 * TH // "four storeys" above the higher of the two
const FLY_CLEAR = 0.6 * TH // minimum clearance over any stack between them
const FLY_RISE = 0.3 // s, ease-out climb + wind-up
const FLY_OVERSHOOT = 0.18 // the climb peaks this far above the meeting height
const FLY_WINDUP = 0.35 // world units each tile backs away from the other while rising
const FLY_SLAM: [number, number] = [0.13, 0.3] // s, accelerating dash; longer for distant pairs
const FLY_SLAM_PER_UNIT = 0.012 // s of slam per world unit of distance
const FLY_LEAN_BACK = 0.3 // rad, tops tilt away during the wind-up
const FLY_LEAN_IN = 0.12 // rad, tops tilt toward each other at impact

// Dissolve field, shared by the shader and the debris release timing:
// f = FIELD_NOISE * noise + FIELD_HEIGHT * (1 - y/TH)  → the top crumbles first.
// A fragment is discarded once progress (0 → OVERSHOOT over LEAVE) passes f.
const FIELD_NOISE = 0.6
const FIELD_HEIGHT = 0.4
const OVERSHOOT = 1.1 // progress past 1 so every fragment is gone before the tile is hidden
const HF_CELL = 0.08 // crumb heightfield resolution (world units)
const dissolveField = (y01: number, n: number) => FIELD_NOISE * n + FIELD_HEIGHT * (1 - y01)

// parallax
const TILT_MAX = 0.17 // rad at full deflection (0.17 ≈ 10°)
const TILT_RATE = 6 // 1/s, exponential smoothing
const CAM_ORBIT = 0.35 // world units of camera shift at full tilt
const PAN = 0.45 // world units the table slides AWAY from the cursor at full deflection
const CAM_ELEVATION = THREE.MathUtils.degToRad(70)
const VIEW_SHIFT_Y = 0.05 // move the whole image up by this fraction of viewport height (negative = down)
// "Show pickable": blocked tiles are darkened by this fraction (face shader + body instance colour)
const DIM = 0.8
const WHITE = new THREE.Color(1, 1, 1)
const DIMMED = new THREE.Color(1 - DIM, 1 - DIM, 1 - DIM)

// engraving: bump strength of the face art (0 = flat print)
const ENGRAVE_DEPTH = 10.0

// lighting
const SUN_INTENSITY = 5.2 // key spotlight ("sun"); was 3.4
const SUN_COLOR = '#ffecc8' // warm sunlight
const AMBIENT = 0.45 // hemisphere fill: how light the shade stays

// palm-shadow light cookie (SpotLight.map) — see setupPalm()
const PALM_URL = 'palm-cookie.jpg'
const PALM_SHADOW = 0.5 // key-light multiplier inside the leaf shadows (0 = black, 1 = no shadow)
const PALM_LEVELS: [number, number] = [0.36, 0.78] // source luminance mapped to full shadow … full light
const PALM_RES = 256 // processing/texture size; downscaling doubles as blur (soft edges, no wall grain)
const SWAY_ROLL = THREE.MathUtils.degToRad(1.4) // max rotation of the shadow pattern
const SWAY_SHIFT = 0.012 // max translation, fraction of the light cone
const SWAY_SPEED = 1 // 1 = gentle breeze
// Help hint: the pair floats up and bobs
const HINT_LIFT = 0.45 // world units above its rest position
const HINT_BOB = 0.09 // bob amplitude
const HINT_SPEED = 3.2 // rad/s
const HINT_EASE = 7 // 1/s, ease in/out of the lift
const FIT_FILL = 1.15 // fraction of the viewport the board may use (headroom for tilt + lift)
// victory: fireworks start this long after the last pair finished dissolving
const CELEBRATE_DELAY = 0.25
const CLICK_BURST_Y = 4.4 // height of a shell launched by clicking the empty table
const DUSK_SUN = 0.22 // key light multiplier at full dusk (fireworks glow on a dark cloth)
const DUSK_AMBIENT = 0.35 // hemisphere multiplier at full dusk

export interface BoardCallbacks {
  /** Tile hit the surface (intro). Screen coords in CSS px of the canvas. */
  onLand?: (surface: Surface, x: number, y: number, width: number) => void
  /** A tile started its removal animation. */
  onLeave?: (x: number, y: number) => void
  onHover?: (id: number | null) => void
  /** All tiles are on the table: intro finished, skipped, or not played (reduced motion). Once per deal. */
  onReady?: () => void
  /** Victory fireworks: a shell launched / burst. `x` = screen x in CSS px. */
  onLaunch?: (x: number) => void
  onBurst?: (x: number, size: number, crackle: boolean) => void
}

export interface BoardState {
  tiles: Tile[]
  freeIds: Set<number>
  selectedId: number | null
  /** Pair highlighted by Help: those tiles float and bob. */
  hintIds: readonly [number, number] | null
  showFree: boolean
}

interface TileRt {
  tile: Tile
  base: THREE.Vector3
  spin: number
  wobble: number
  present: boolean
  dropStart: number // seconds (clock), NaN = no drop
  landed: boolean
  leaveStart: number // NaN = not leaving
  hidden: boolean // matrix collapsed (removed)
  hintAmt: number // 0..1, eased toward 1 while the tile is part of the Help pair
  fly: Flight | null // matched: flying to the crash, then dissolving at the contact point
}

/** Path of one matched tile toward its partner (table-local). */
interface Flight {
  start: number
  rise: number
  slam: number
  from: THREE.Vector3
  apex: THREE.Vector3
  contact: THREE.Vector3
  impact: THREE.Vector3 // shared contact point of the pair; crumbs spray away from it
  yaw0: number
  yaw1: number
  side: number // +1/-1: which local X edge faces the partner (sign of the lean)
  gold: boolean
  crashed: boolean
}

export class BoardRenderer {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200)
  private table = new THREE.Group()
  private meshes: THREE.InstancedMesh[] = []
  private pickMesh: THREE.InstancedMesh
  private faceMesh: THREE.InstancedMesh
  private bodyMeshes: THREE.InstancedMesh[] = []
  private selFx: SelectionFx
  private selTarget: SelectionTarget | null = null
  private selTargetBuf: SelectionTarget = { pos: new THREE.Vector3(), spin: 0 }
  private aCell: THREE.InstancedBufferAttribute
  private aState: THREE.InstancedBufferAttribute
  private aDissolve: THREE.InstancedBufferAttribute
  private debris: Debris
  private fireworks: Fireworks
  private camLocal = new THREE.Vector3()
  /** Heightfield of present tile tops over the board (table-local), for crumbs to land on. */
  private hf = { x0: 0, z0: 0, nx: 0, nz: 0, h: new Float32Array(0) }
  private disposables: Array<{ dispose(): void }> = []
  private key!: THREE.SpotLight
  private hemi!: THREE.HemisphereLight
  private palm: THREE.Texture | null = null
  private keyDir = new THREE.Vector3()
  private keyUp0 = new THREE.Vector3()

  private rt: TileRt[] = []
  private state: BoardState = { tiles: [], freeIds: new Set(), selectedId: null, hintIds: null, showFree: false }
  private hovered: number | null = null
  private introEnd = 0
  private readyPending = false

  private timer = new THREE.Timer()
  private width = 1
  private height = 1
  private camDist = 30
  private center = new THREE.Vector3()
  private tilt = new THREE.Vector2() // smoothed, -1..1
  private tiltTarget = new THREE.Vector2()
  private pointerNdc: THREE.Vector2 | null = null
  private pointerDirty = false
  private dirty = true

  private raycaster = new THREE.Raycaster()
  private tmpM = new THREE.Matrix4()
  private tmpQ = new THREE.Quaternion()
  private tmpE = new THREE.Euler()
  private tmpV = new THREE.Vector3()
  private tmpS = new THREE.Vector3()
  private tmpV2 = new THREE.Vector2()
  private zeroM = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(
    canvas: HTMLCanvasElement,
    private cb: BoardCallbacks = {},
    private reducedMotion = false,
    maxTiles = 144,
  ) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true })
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 1.05
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    this.renderer = r

    this.scene.background = new THREE.Color('#0b2616')
    this.scene.add(this.table)
    this.buildLights()
    this.buildTable()

    // --- tile meshes ---------------------------------------------------------
    const back = new RoundedBoxGeometry(TW, TH * 0.44, TD, 3, RADIUS).translate(0, TH * 0.22, 0)
    const body = new RoundedBoxGeometry(TW, TH * 0.62, TD, 3, RADIUS).translate(0, TH * 0.69, 0)
    const faceW = TW - 2 * RADIUS + 0.01
    const face = new THREE.PlaneGeometry(faceW, faceW / FACE_ASPECT).rotateX(-Math.PI / 2).translate(0, TH + 0.003, 0)
    const pick = new THREE.BoxGeometry(TW, TH, TD).translate(0, TH / 2, 0)

    const backMat = new THREE.MeshStandardMaterial({ color: '#1b6a48', roughness: 0.35 })
    const bodyMat = new THREE.MeshStandardMaterial({ color: IVORY, roughness: 0.38 })
    backMat.onBeforeCompile = injectDissolve
    bodyMat.onBeforeCompile = injectDissolve
    const { color: atlas, height: faceHeight } = createAtlas(`${import.meta.env.BASE_URL}tiles.svg`)
    atlas.anisotropy = faceHeight.anisotropy = r.capabilities.getMaxAnisotropy()
    // engraved face: the ink is pressed into the tile (bump map derived from the art)
    const faceMat = new THREE.MeshStandardMaterial({ map: atlas, bumpMap: faceHeight, bumpScale: ENGRAVE_DEPTH, roughness: 0.38 })
    this.patchFaceMaterial(faceMat)

    const mk = (g: THREE.BufferGeometry, m: THREE.Material, shadows: boolean) => {
      const im = new THREE.InstancedMesh(g, m, maxTiles)
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      im.castShadow = shadows
      im.receiveShadow = true
      im.frustumCulled = false // instances move; bounds would go stale
      im.count = 0
      this.table.add(im)
      return im
    }
    this.bodyMeshes = [mk(back, backMat, true), mk(body, bodyMat, true)]
    this.meshes.push(...this.bodyMeshes)
    // per-instance tint for the body (used to dim blocked tiles); start all white
    for (const m of this.bodyMeshes) for (let i = 0; i < maxTiles; i++) m.setColorAt(i, WHITE)
    this.faceMesh = mk(face, faceMat, false)
    this.meshes.push(this.faceMesh)
    this.pickMesh = mk(pick, new THREE.MeshBasicMaterial(), false)
    this.pickMesh.visible = false // raycast target only (Raycaster ignores .visible)
    this.meshes.push(this.pickMesh)

    this.aCell = new THREE.InstancedBufferAttribute(new Float32Array(maxTiles * 2), 2)
    this.aState = new THREE.InstancedBufferAttribute(new Float32Array(maxTiles * 3), 3)
    face.setAttribute('aCell', this.aCell)
    face.setAttribute('aState', this.aState)
    // per-instance dissolve progress, shared by all three tile parts
    this.aDissolve = new THREE.InstancedBufferAttribute(new Float32Array(maxTiles), 1)
    for (const g of [back, body, face]) g.setAttribute('aDissolve', this.aDissolve)

    this.debris = new Debris({ w: TW, d: TD, h: TH, backFrac: 0.28 })
    this.debris.groundAt = this.groundAt // fewer green crumbs than the true back thickness: reads better
    this.table.add(this.debris.mesh)
    this.disposables.push(this.debris)

    this.disposables.push(back, body, face, pick, backMat, bodyMat, faceMat, atlas, faceHeight, this.pickMesh.material as THREE.Material)

    this.fireworks = new Fireworks()
    this.fireworks.groundAt = this.groundAt
    this.fireworks.hooks = {
      onLaunch: (x) => this.cb.onLaunch?.(this.screenX(x)),
      onBurst: (x, size, crackle) => this.cb.onBurst?.(this.screenX(x), size, crackle),
    }
    this.table.add(this.fireworks.group, this.fireworks.light)
    this.disposables.push(this.fireworks)

    this.selFx = new SelectionFx({ w: TW, d: TD, h: TH, radius: RADIUS }, reducedMotion)
    this.table.add(this.selFx.group)
    this.disposables.push(this.selFx)

    this.timer.connect(document) // pause-aware (Page Visibility API)
    r.setAnimationLoop(this.frame)
  }

  // ---- public API ------------------------------------------------------------

  /** New deal: reset all tiles and (unless reduced motion) run the drop-in intro. */
  deal(tiles: Tile[]) {
    const ext = new THREE.Box3()
    for (const t of tiles) ext.expandByPoint(this.tmpV.set(t.pos.x * STEP_X, 0, t.pos.y * STEP_Z))
    ext.getCenter(this.center)
    this.center.y = 0

    const order = [...tiles].sort((a, b) => a.pos.z - b.pos.z || a.pos.y - b.pos.y || a.pos.x - b.pos.x)
    const startAt = new Map(order.map((t, i) => [t.id, i * STAGGER]))
    const now = this.timer.getElapsed()
    const animate = !this.reducedMotion

    this.rt = []
    for (const t of tiles) {
      if (t.id !== this.rt.length) throw new Error('Tile ids must be 0..n-1 (layout indices)')
      const [u, v] = cellOffset(cellIndex(t.face))
      this.aCell.setXY(t.id, u, v)
      this.rt.push({
        tile: t,
        base: new THREE.Vector3(t.pos.x * STEP_X - this.center.x, t.pos.z * TH, t.pos.y * STEP_Z - this.center.z),
        spin: (Math.random() * 2 - 1) * MAX_SPIN,
        wobble: (Math.random() * 2 - 1) * 0.25,
        present: true,
        dropStart: animate ? now + 0.05 + startAt.get(t.id)! : NaN,
        landed: !animate,
        leaveStart: NaN,
        hidden: false,
        fly: null,
        hintAmt: 0,
      })
    }
    this.aCell.needsUpdate = true
    this.rebuildHeightfield()
    ;(this.aDissolve.array as Float32Array).fill(0)
    this.aDissolve.needsUpdate = true
    this.debris.clear()
    this.fireworks.clear()
    for (const m of this.meshes) m.count = tiles.length
    this.introEnd = animate ? now + 0.05 + order.length * STAGGER + DROP : 0
    this.readyPending = true
    this.fitCamera()
    this.sync({ ...this.state, tiles })
    this.dirty = true
  }

  /** Apply game state; tiles missing from `tiles` start their removal animation. */
  sync(state: BoardState) {
    this.state = state
    const present = new Set(state.tiles.map((t) => t.id))
    let removed = false
    const now = this.timer.getElapsed()
    // the board is being cleared right now: last pair goes out in gold, then fireworks
    const final = present.size === 0 && this.rt.some((r) => r.present)
    const leaving: TileRt[] = []
    for (const r of this.rt) {
      if (r.present && !present.has(r.tile.id)) {
        r.present = false
        removed = true
        if (this.reducedMotion) this.hide(r)
        else leaving.push(r)
      }
    }
    if (removed) this.rebuildHeightfield() // matched tiles no longer support crumbs (nor block flights)
    let crashAt = 0
    for (const [a, b] of pairUp(leaving)) crashAt = Math.max(crashAt, this.launchPair(a, b, now, final))
    if (final && !this.reducedMotion) this.fireworks.start(now + crashAt + LEAVE + CELEBRATE_DELAY, this.boardBounds())
    if (this.hovered !== null && !present.has(this.hovered)) this.setHovered(null)
    this.writeStates()
    this.dirty = true
  }

  get introRunning() {
    return this.timer.getElapsed() < this.introEnd
  }

  skipIntro() {
    for (const r of this.rt) {
      r.dropStart = NaN
      r.landed = true
    }
    this.introEnd = 0
    this.dirty = true
  }

  /**
   * Start the flight of a matched pair (b = null: a lone tile just rises and
   * breaks). Returns seconds until impact.
   */
  private launchPair(a: TileRt, b: TileRt | null, now: number, gold: boolean): number {
    const dir = new THREE.Vector3(1, 0, 0)
    if (b) {
      dir.set(b.base.x - a.base.x, 0, b.base.z - a.base.z)
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0)
      dir.normalize()
    }
    const dist = b ? Math.hypot(b.base.x - a.base.x, b.base.z - a.base.z) : 0
    const mid = b ? a.base.clone().add(b.base).multiplyScalar(0.5) : a.base.clone()
    // meet four storeys up, and always clear of any stack between them
    let meetY = Math.max(a.base.y, b?.base.y ?? 0) + FLY_LIFT
    for (let i = 0; i <= 16 && b; i++) {
      const u = i / 16
      const g = this.groundAt(a.base.x + (b.base.x - a.base.x) * u, a.base.z + (b.base.z - a.base.z) * u)
      meetY = Math.max(meetY, g + FLY_CLEAR)
    }
    mid.y = meetY
    // turn so the local X axis (the long side's normal) lies on the line between them;
    // keep the yaw within ±90° so neither tile spins round
    let yaw1 = Math.atan2(-dir.z, dir.x)
    if (yaw1 > Math.PI / 2) yaw1 -= Math.PI
    if (yaw1 < -Math.PI / 2) yaw1 += Math.PI
    const localX = new THREE.Vector3(Math.cos(yaw1), 0, -Math.sin(yaw1))
    const slam = THREE.MathUtils.clamp(FLY_SLAM[0] + dist * FLY_SLAM_PER_UNIT, FLY_SLAM[0], FLY_SLAM[1])
    // half-width plus the lean-in, so the tilted tops just touch instead of overlapping
    const reach = TW / 2 + TH * Math.sin(FLY_LEAN_IN) + 0.005

    const make = (r: TileRt, toward: THREE.Vector3): Flight => {
      const from = r.base.clone()
      if (this.state.selectedId === r.tile.id || r.hintAmt > 0) from.y += 0.1 // it was lifted
      const apex = from.clone().addScaledVector(toward, b ? -FLY_WINDUP : 0)
      apex.y = meetY + FLY_OVERSHOOT
      const contact = b ? mid.clone().addScaledVector(toward, -reach) : from.clone().setY(meetY)
      return {
        start: now,
        rise: FLY_RISE,
        slam: b ? slam : 0.05,
        from,
        apex,
        contact,
        impact: b ? mid.clone().setY(meetY + TH / 2) : contact.clone().setY(meetY + TH / 2),
        yaw0: r.spin,
        yaw1: b ? yaw1 : r.spin,
        side: b ? Math.sign(localX.dot(toward)) || 1 : 0,
        gold,
        crashed: false,
      }
    }
    a.fly = make(a, dir)
    if (b) b.fly = make(b, dir.clone().negate())
    return a.fly.rise + a.fly.slam
  }

  /** Pose of a flying tile at `now`: writes the position into `out`, returns yaw and lean. */
  private flightPose(f: Flight, now: number, out: THREE.Vector3): { yaw: number; rz: number } {
    const t = now - f.start
    if (t < f.rise) {
      const u = t / f.rise
      const e = 1 - (1 - u) ** 3
      // climb leads, the backing-off follows
      out.set(
        THREE.MathUtils.lerp(f.from.x, f.apex.x, u * u),
        THREE.MathUtils.lerp(f.from.y, f.apex.y, e),
        THREE.MathUtils.lerp(f.from.z, f.apex.z, u * u),
      )
      return { yaw: THREE.MathUtils.lerp(f.yaw0, f.yaw1, e), rz: f.side * FLY_LEAN_BACK * e }
    }
    if (t < f.rise + f.slam) {
      const u = (t - f.rise) / f.slam
      const e = u * u * u // accelerate into the hit
      out.lerpVectors(f.apex, f.contact, e)
      return { yaw: f.yaw1, rz: f.side * THREE.MathUtils.lerp(FLY_LEAN_BACK, -FLY_LEAN_IN, e) }
    }
    out.copy(f.contact)
    return { yaw: f.yaw1, rz: -f.side * FLY_LEAN_IN }
  }

  /** Impact: the tile starts dissolving where it is and breaks into crumbs. */
  private crash(r: TileRt, now: number) {
    const f = r.fly!
    f.crashed = true
    r.leaveStart = now
    this.updateCamLocal()
    this.debris.spawn(f.contact, f.yaw1, now, LEAVE / OVERSHOOT, this.camLocal, dissolveField, f.gold, f.impact)
    this.table.updateMatrixWorld()
    const p = this.table.localToWorld(this.tmpV.copy(f.impact)).project(this.camera)
    this.cb.onLeave?.(((p.x + 1) / 2) * this.width, ((1 - p.y) / 2) * this.height)
  }

  /** Victory fireworks are scheduled or in the air. */
  get celebrating() {
    return this.fireworks.active
  }

  /** During the celebration: a shell that bursts right under the NDC point. */
  launchAt(ndc: { x: number; y: number }) {
    if (this.reducedMotion) return
    this.table.updateMatrixWorld()
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CLICK_BURST_Y).applyMatrix4(this.table.matrixWorld)
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3())
    if (!hit) return
    this.table.worldToLocal(hit)
    this.fireworks.launchAt(this.timer.getElapsed(), hit.x, hit.z)
  }

  /** Pointer in NDC (-1..1, y up), or null when it leaves the canvas. */
  pointer(ndc: { x: number; y: number } | null) {
    this.pointerNdc = ndc ? new THREE.Vector2(ndc.x, ndc.y) : null
    this.tiltTarget.set(ndc && !this.reducedMotion ? ndc.x : 0, ndc && !this.reducedMotion ? ndc.y : 0)
    this.pointerDirty = true
  }

  /** Topmost present tile under the NDC point. */
  pick(ndc: { x: number; y: number }): number | null {
    this.table.updateMatrixWorld()
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera)
    for (const hit of this.raycaster.intersectObject(this.pickMesh)) {
      const id = hit.instanceId
      if (id !== undefined && this.rt[id]?.present) return id
    }
    return null
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, w)
    this.height = Math.max(1, h)
    this.renderer.setSize(this.width, this.height, false)
    this.camera.aspect = this.width / this.height
    this.fitCamera()
    this.dirty = true
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.timer.dispose()
    for (const d of this.disposables) d.dispose()
    this.renderer.dispose()
  }

  // ---- scene setup -----------------------------------------------------------

  private buildLights() {
    this.hemi = new THREE.HemisphereLight('#fff4dc', '#0b2a18', AMBIENT)
    this.scene.add(this.hemi)
    // Key: a soft-edged lamp above the table. The penumbra falloff is the vignette.
    const key = new THREE.SpotLight(SUN_COLOR, SUN_INTENSITY, 0, 0.62, 0.85, 0)
    key.position.set(-4, 19, 9)
    key.target.position.set(0, 0, 0.5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 5
    key.shadow.camera.far = 45
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    key.shadow.radius = 3
    this.scene.add(key, key.target)
    this.key = key
    this.setupPalm()
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.3)
    fill.position.set(8, 6, 4)
    this.scene.add(fill)
  }

  /**
   * Palm-tree shadow = a light cookie: SpotLight.map multiplies the key light
   * by a texture projected through the light's shadow camera. It therefore
   * lands correctly in 3D on the table AND on tile tops and sides, on top of
   * the tiles' own cast shadows. (three requires castShadow for light maps.)
   *
   * The source is a photo of shadows on a wall, so levels are applied on a
   * canvas at load: luminance PALM_LEVELS[0]..[1] → PALM_SHADOW..1, which also
   * flattens the wall grain. Sway: see swayPalm().
   */
  private setupPalm() {
    const img = new Image()
    img.onload = () => {
      // halve repeatedly with high-quality smoothing: a cheap, portable blur
      let src: CanvasImageSource = img
      let size = Math.min(img.naturalWidth, img.naturalHeight)
      let c = document.createElement('canvas')
      do {
        size = Math.max(PALM_RES, Math.floor(size / 2))
        const next = document.createElement('canvas')
        next.width = next.height = size
        const nctx = next.getContext('2d')!
        nctx.imageSmoothingEnabled = true
        nctx.imageSmoothingQuality = 'high'
        nctx.drawImage(src, 0, 0, size, size)
        src = c = next
      } while (size > PALM_RES)
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      const data = ctx.getImageData(0, 0, c.width, c.height)
      const d = data.data
      const [lo, hi] = PALM_LEVELS
      for (let i = 0; i < d.length; i += 4) {
        const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
        const t = THREE.MathUtils.smoothstep(lum, lo, hi)
        const v = Math.round((PALM_SHADOW + (1 - PALM_SHADOW) * t) * 255)
        d[i] = d[i + 1] = d[i + 2] = v
        d[i + 3] = 255
      }
      ctx.putImageData(data, 0, 0)
      const tex = new THREE.CanvasTexture(c) // NoColorSpace: values are light multipliers
      tex.anisotropy = 4
      this.palm = tex
      this.key.map = tex
      this.disposables.push(tex)

      // roll axis = light direction; base "up" is the table's far side
      this.keyDir.subVectors(this.key.target.position, this.key.position).normalize()
      this.keyUp0.set(0, 0, -1).projectOnPlane(this.keyDir).normalize()
      this.key.shadow.camera.up.copy(this.keyUp0)
      this.dirty = true
    }
    img.src = `${import.meta.env.BASE_URL}${PALM_URL}`
  }

  /**
   * Sway the cookie without moving the light: roll the shadow camera about the
   * light axis (rotates the pattern; the tiles' cast shadows don't change) and
   * shift its projection window (translates the pattern). A few
   * incommensurate sines read as wind rather than a metronome.
   */
  private swayPalm(t: number) {
    const w = t * SWAY_SPEED
    const gust = 0.55 * Math.sin(w * 0.9) + 0.3 * Math.sin(w * 2.1 + 1.3) + 0.15 * Math.sin(w * 4.7 + 0.4)
    const drift = 0.6 * Math.sin(w * 0.7 + 2) + 0.4 * Math.sin(w * 1.9)
    const cam = this.key.shadow.camera
    cam.up.copy(this.keyUp0).applyAxisAngle(this.keyDir, gust * SWAY_ROLL)
    const size = this.key.shadow.mapSize.width
    cam.setViewOffset(size, size, gust * SWAY_SHIFT * size, drift * SWAY_SHIFT * 0.6 * size, size, size)
  }

  /** Green microfiber cloth: sheen (fabric BRDF) + fine noise map. */
  private buildTable() {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(256, 256)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = 200 + Math.random() * 55
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(40, 40)
    tex.anisotropy = 8

    const mat = new THREE.MeshPhysicalMaterial({
      color: '#1d6a3c',
      map: tex,
      roughness: 0.95,
      sheen: 1,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color('#5aae76'),
    })
    const geo = new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2)
    const plane = new THREE.Mesh(geo, mat)
    plane.receiveShadow = true
    this.table.add(plane)
    this.disposables.push(tex, mat, geo)
  }

  private patchFaceMaterial(mat: THREE.MeshStandardMaterial) {
    mat.onBeforeCompile = (shader) => {
      injectDissolve(shader)
      shader.uniforms.uCellSize = { value: new THREE.Vector2(CELL_UV.u, CELL_UV.v) }
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec2 aCell;\nattribute vec3 aState;\nuniform vec2 uCellSize;\nvarying vec3 vState;',
        )
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aCell + uv * uCellSize;\n#ifdef USE_BUMPMAP\nvBumpMapUv = vMapUv;\n#endif\nvState = aState;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vState;')
        .replace(
          '#include <map_fragment>',
          [
            '#include <map_fragment>',
            // selected: warm gold tint; hover: brighten; dim: darken
            'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.0, 0.82, 0.38), vState.x * 0.9);\n' + 'diffuseColor.rgb += vec3(0.10, 0.07, 0.0) * vState.x;',
            'diffuseColor.rgb *= 1.0 + vState.y * 0.14;',
            `diffuseColor.rgb *= 1.0 - vState.z * ${DIM.toFixed(3)};`,
          ].join('\n'),
        )
    }
  }

  // ---- per-frame ---------------------------------------------------------------

  private frame = (timestamp: number) => {
    this.timer.update(timestamp)
    const dt = Math.min(0.05, this.timer.getDelta())
    const now = this.timer.getElapsed()

    // parallax: smooth toward pointer
    const k = 1 - Math.exp(-dt * TILT_RATE)
    const before = this.tilt.clone()
    this.tilt.lerp(this.tiltTarget, k)
    const tilting = before.distanceToSquared(this.tilt) > 1e-8
    if (tilting) this.applyTilt()

    if (this.pointerDirty) {
      this.pointerDirty = false
      this.setHovered(this.pointerNdc ? this.pick(this.pointerNdc) : null)
    }

    const animating = this.updateMatrices(now, dt)
    const selFxActive = this.selFx.update(dt, now, this.selTarget)
    this.updateCamLocal()
    const debrisActive = this.debris.update(dt, now, this.camLocal)
    const fireworksActive = this.fireworks.update(dt, now)
    const dusk = this.fireworks.dusk
    this.key.intensity = SUN_INTENSITY * (1 - (1 - DUSK_SUN) * dusk)
    this.hemi.intensity = AMBIENT * (1 - (1 - DUSK_AMBIENT) * dusk)
    if (this.readyPending && !this.introRunning) {
      this.readyPending = false
      this.cb.onReady?.()
    }
    const swaying = this.palm !== null && !this.reducedMotion
    if (swaying) this.swayPalm(now)
    if (this.dirty || animating || tilting || swaying || selFxActive || debrisActive || fireworksActive) {
      this.dirty = false
      this.renderer.render(this.scene, this.camera)
    }
  }

  /** Recompose instance matrices. Returns true while anything is in motion. */
  private updateMatrices(now: number, dt: number): boolean {
    let animating = false
    const sel = this.state.selectedId
    const hint = this.state.hintIds
    const hintEase = this.reducedMotion ? 1 : 1 - Math.exp(-dt * HINT_EASE)
    this.selTarget = null
    for (const r of this.rt) {
      const id = r.tile.id
      if (r.hidden) continue

      if (r.fly) {
        animating = true
        const f = r.fly
        if (!f.crashed && now >= f.start + f.rise + f.slam) this.crash(r, now)
        if (!Number.isNaN(r.leaveStart)) {
          const t = (now - r.leaveStart) / LEAVE
          if (t >= 1) {
            r.leaveStart = NaN
            r.fly = null
            this.hide(r)
            this.aDissolve.setX(id, 0)
            this.aDissolve.needsUpdate = true
            continue
          }
          this.aDissolve.setX(id, t * OVERSHOOT)
          this.aDissolve.needsUpdate = true
        }
        const pose = this.flightPose(f, now, this.tmpV)
        this.tmpE.set(0, pose.yaw, pose.rz)
        this.tmpQ.setFromEuler(this.tmpE)
        this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS.setScalar(1))
        for (const m of this.meshes) m.setMatrixAt(id, this.tmpM)
        continue
      }

      let y = 0
      let rx = 0
      let rz = 0
      let s = 1

      if (!Number.isNaN(r.dropStart)) {
        const t = (now - r.dropStart) / DROP
        if (t < 0) {
          s = 0 // not yet dropped
          animating = true
        } else if (t < 1) {
          animating = true
          if (t < LAND_AT) {
            const p = t / LAND_AT
            y = DROP_H * (1 - p * p) // accelerating fall
            rz = r.wobble * (1 - p)
            rx = r.wobble * 0.5 * (1 - p)
          } else {
            const p = (t - LAND_AT) / (1 - LAND_AT)
            y = 0.07 * Math.sin(p * Math.PI) // small bounce
            rz = -r.wobble * 0.25 * Math.sin(p * Math.PI)
            if (!r.landed) {
              r.landed = true
              const at = this.screenOf(r, 0)
              const w = this.screenWidth(r)
              this.cb.onLand?.(r.tile.pos.z === 0 ? 'felt' : 'tile', at.x, at.y, w)
            }
          }
        } else {
          r.dropStart = NaN
          if (!r.landed) r.landed = true
        }
      }

      if (id === sel && r.present && !this.reducedMotion) {
        y += 0.1 + 0.03 * Math.sin(now * 5.5) // lifted + gentle bob
        animating = true
      }

      // Help: ease the lift in/out; the two tiles bob out of phase
      const hintIdx = hint ? hint.indexOf(id) : -1
      const hintTarget = hintIdx >= 0 && r.present && Number.isNaN(r.leaveStart) ? 1 : 0
      r.hintAmt += (hintTarget - r.hintAmt) * hintEase
      if (Math.abs(hintTarget - r.hintAmt) < 1e-3) r.hintAmt = hintTarget
      if (r.hintAmt > 0) {
        const phase = hintIdx === 1 ? 2.1 : 0
        const bob = this.reducedMotion ? 0 : HINT_BOB * Math.sin(now * HINT_SPEED + phase)
        y += r.hintAmt * (HINT_LIFT + bob)
        if (!this.reducedMotion) rz += r.hintAmt * 0.05 * Math.sin(now * HINT_SPEED * 0.7 + phase)
        animating = true
      }

      this.tmpE.set(rx, r.spin, rz)
      this.tmpQ.setFromEuler(this.tmpE)
      this.tmpV.copy(r.base).y += y
      if (id === sel && r.present && Number.isNaN(r.leaveStart)) {
        this.selTargetBuf.pos.copy(this.tmpV)
        this.selTargetBuf.spin = r.spin
        this.selTarget = this.selTargetBuf
      }
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS.setScalar(Math.max(s, 1e-4)))
      for (const m of this.meshes) m.setMatrixAt(id, this.tmpM)
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true
    return animating
  }

  /**
   * Rebuild the crumb heightfield: a grid of HF_CELL cells over the board, each
   * holding the top of the highest *present* tile covering it (0 = cloth).
   * Tile spin (±2°) is ignored. Cheap (~20k cell writes), so it runs only when
   * the set of tiles changes: on a deal and when a match starts.
   */
  private rebuildHeightfield() {
    const hf = this.hf
    if (this.rt.length === 0) {
      hf.nx = hf.nz = 0
      return
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const r of this.rt) {
      minX = Math.min(minX, r.base.x - TW / 2)
      maxX = Math.max(maxX, r.base.x + TW / 2)
      minZ = Math.min(minZ, r.base.z - TD / 2)
      maxZ = Math.max(maxZ, r.base.z + TD / 2)
    }
    hf.x0 = minX
    hf.z0 = minZ
    hf.nx = Math.ceil((maxX - minX) / HF_CELL) + 1
    hf.nz = Math.ceil((maxZ - minZ) / HF_CELL) + 1
    if (hf.h.length !== hf.nx * hf.nz) hf.h = new Float32Array(hf.nx * hf.nz)
    else hf.h.fill(0)
    for (const r of this.rt) {
      if (!r.present) continue
      const top = r.base.y + TH
      const ix0 = Math.max(0, Math.floor((r.base.x - TW / 2 - hf.x0) / HF_CELL))
      const ix1 = Math.min(hf.nx - 1, Math.floor((r.base.x + TW / 2 - hf.x0) / HF_CELL))
      const iz0 = Math.max(0, Math.floor((r.base.z - TD / 2 - hf.z0) / HF_CELL))
      const iz1 = Math.min(hf.nz - 1, Math.floor((r.base.z + TD / 2 - hf.z0) / HF_CELL))
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const k = iz * hf.nx + ix
          if (top > hf.h[k]) hf.h[k] = top
        }
      }
    }
  }

  /** Surface height at a table-local (x, z): highest present tile top, else the cloth (0). */
  private groundAt = (x: number, z: number): number => {
    const hf = this.hf
    const ix = Math.floor((x - hf.x0) / HF_CELL)
    const iz = Math.floor((z - hf.z0) / HF_CELL)
    if (ix < 0 || iz < 0 || ix >= hf.nx || iz >= hf.nz) return 0
    return hf.h[iz * hf.nx + ix]
  }

  /** Camera position in table-local space (the table tilts/pans). */
  private updateCamLocal() {
    this.table.updateMatrixWorld()
    this.table.worldToLocal(this.camLocal.copy(this.camera.position))
  }

  private hide(r: TileRt) {
    r.hidden = true
    for (const m of this.meshes) {
      m.setMatrixAt(r.tile.id, this.zeroM)
      m.instanceMatrix.needsUpdate = true
    }
  }

  private writeStates() {
    const { freeIds, selectedId, showFree } = this.state
    for (const r of this.rt) {
      const id = r.tile.id
      const dim = showFree && !freeIds.has(id)
      this.aState.setXYZ(id, id === selectedId ? 1 : 0, id === this.hovered && freeIds.has(id) ? 1 : 0, dim ? 1 : 0)
      // dim the body halves by the same factor as the face, so the whole tile darkens
      for (const m of this.bodyMeshes) m.setColorAt(id, dim ? DIMMED : WHITE)
    }
    this.aState.needsUpdate = true
    for (const m of this.bodyMeshes) m.instanceColor!.needsUpdate = true
  }

  private setHovered(id: number | null) {
    if (id === this.hovered) return
    this.hovered = id
    this.writeStates()
    this.dirty = true
    this.cb.onHover?.(id)
  }

  private applyTilt() {
    // the side under the cursor rises toward the camera
    // +x rot raises the far edge (cursor up); +z rot raises the +X edge (cursor right)
    this.table.rotation.set(this.tilt.y * TILT_MAX, 0, this.tilt.x * TILT_MAX)
    // ...and the table slides away from the cursor: cursor top-right → table down-left
    // (screen right = +X, screen up = -Z)
    this.table.position.set(-this.tilt.x * PAN, 0, this.tilt.y * PAN)
    this.placeCamera()
  }

  private placeCamera() {
    const c = this.camera
    c.position.set(
      this.tilt.x * CAM_ORBIT,
      Math.sin(CAM_ELEVATION) * this.camDist + this.tilt.y * CAM_ORBIT,
      Math.cos(CAM_ELEVATION) * this.camDist,
    )
    c.lookAt(0, TH, 0)
    c.updateProjectionMatrix()
    c.updateMatrixWorld()
  }

  /**
   * Fit the board to the viewport: choose camera distance from the projected
   * extents, then centre them with a lens shift (setViewOffset), which moves
   * the image without changing perspective. Raycasting/project() include it.
   */
  private fitCamera() {
    this.camera.clearViewOffset()
    if (this.rt.length === 0) return this.placeCamera()
    // Fit the real tiles (8 corners each, padded for spin and the selection lift),
    // not their bounding box: a box's top spans the whole area at the tallest
    // stack's height, which over-frames tall layouts and crops flat ones.
    const px = TW / 2 + 0.1
    const pz = TD / 2 + 0.1
    const corners: THREE.Vector3[] = []
    for (const r of this.rt) {
      for (const dx of [-px, px])
        for (const dz of [-pz, pz])
          for (const y of [r.base.y, r.base.y + TH + 0.15]) corners.push(new THREE.Vector3(r.base.x + dx, y, r.base.z + dz))
    }
    // FIT_FILL and VIEW_SHIFT_Y are upper bounds: zoom + shift may never push tiles off-screen
    const fill = Math.min(FIT_FILL, 0.98 - 2 * Math.abs(VIEW_SHIFT_Y))

    const savedTilt = this.tilt.clone()
    this.tilt.set(0, 0)
    const lo = new THREE.Vector2()
    const hi = new THREE.Vector2()
    for (let i = 0; i < 6; i++) {
      this.placeCamera()
      lo.set(Infinity, Infinity)
      hi.set(-Infinity, -Infinity)
      for (const p of corners) {
        const n = p.clone().project(this.camera)
        lo.min(this.tmpV2.set(n.x, n.y))
        hi.max(this.tmpV2)
      }
      const halfRange = Math.max(hi.x - lo.x, hi.y - lo.y) / 2
      this.camDist *= halfRange / fill
    }
    // shift the frustum so the projected box is centred
    const cx = (lo.x + hi.x) / 2
    const cy = (lo.y + hi.y) / 2
    this.camera.setViewOffset(
      this.width,
      this.height,
      (cx * this.width) / 2,
      (-cy * this.height) / 2 + VIEW_SHIFT_Y * this.height,
      this.width,
      this.height,
    )
    this.tilt.copy(savedTilt)
    this.placeCamera()
  }

  // ---- projections -------------------------------------------------------------

  /** Screen position (CSS px) of the tile centre at local height `h`. */
  private screenOf(r: TileRt, h: number) {
    this.table.updateMatrixWorld()
    const p = this.table.localToWorld(r.base.clone().setY(r.base.y + h)).project(this.camera)
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height }
  }

  /** Screen x (CSS px) of a table-local x, at mid burst height. For stereo pan. */
  private screenX(x: number) {
    this.table.updateMatrixWorld()
    const p = this.table.localToWorld(this.tmpV.set(x, 3, 0)).project(this.camera)
    return ((p.x + 1) / 2) * this.width
  }

  /** Table-local extents of the dealt layout (all tiles, present or not). */
  private boardBounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const r of this.rt) {
      minX = Math.min(minX, r.base.x - TW / 2)
      maxX = Math.max(maxX, r.base.x + TW / 2)
      minZ = Math.min(minZ, r.base.z - TD / 2)
      maxZ = Math.max(maxZ, r.base.z + TD / 2)
    }
    return { minX, maxX, minZ, maxZ }
  }

  private screenWidth(r: TileRt) {
    const a = this.table.localToWorld(r.base.clone().setX(r.base.x - TW / 2)).project(this.camera)
    const b = this.table.localToWorld(r.base.clone().setX(r.base.x + TW / 2)).project(this.camera)
    return (Math.abs(b.x - a.x) / 2) * this.width
  }
}

/**
 * Group removed tiles into matched pairs (by match key, in order); an
 * unmatched leftover gets a null partner. A normal match removes exactly one pair.
 */
function pairUp(tiles: TileRt[]): Array<[TileRt, TileRt | null]> {
  const open = new Map<string, TileRt>()
  const out: Array<[TileRt, TileRt | null]> = []
  for (const r of tiles) {
    const k = matchKey(r.tile.face)
    const other = open.get(k)
    if (other) {
      out.push([other, r])
      open.delete(k)
    } else open.set(k, r)
  }
  for (const r of open.values()) out.push([r, null])
  return out
}

/**
 * Dissolve for the tile materials (onBeforeCompile). Per-instance progress
 * `aDissolve` (0 = intact). A fragment is discarded where the dissolve field
 * f = FIELD_NOISE·noise(local pos) + FIELD_HEIGHT·(1 − y/TH) is below the
 * progress; a thin band just above the threshold glows (emissive), so the
 * eaten edge looks hot. Local (pre-instance) position keeps the pattern
 * fixed to the tile. Note: the shadow depth pass doesn't discard, so a
 * dissolving tile keeps its full shadow for LEAVE seconds.
 */
function injectDissolve(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uDissolveGlow = { value: new THREE.Color(1.0, 0.7, 0.32).multiplyScalar(4) }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aDissolve;\nvarying float vDissolve;\nvarying vec3 vLocal;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;\nvDissolve = aDissolve;')
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform vec3 uDissolveGlow;
varying float vDissolve;
varying vec3 vLocal;
float dEdge = 0.0;
float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`,
    )
    .replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
if (vDissolve > 0.0) {
  float n = 0.65 * dNoise(vLocal * 7.0) + 0.35 * dNoise(vLocal * 17.0);
  float f = ${FIELD_NOISE.toFixed(3)} * n + ${FIELD_HEIGHT.toFixed(3)} * (1.0 - clamp(vLocal.y / ${TH.toFixed(4)}, 0.0, 1.0));
  if (f < vDissolve) discard;
  dEdge = 1.0 - smoothstep(vDissolve, vDissolve + 0.07, f);
}`,
    )
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uDissolveGlow * dEdge;')
}
