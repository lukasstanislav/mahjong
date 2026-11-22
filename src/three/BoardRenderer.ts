import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Tile } from '../game/deal'
import type { Surface } from '../fx/sound'
import { SelectionFx, type SelectionTarget } from './SelectionFx'
import { Debris } from './Debris'
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

// Dissolve field, shared by the shader and the debris release timing:
// f = FIELD_NOISE * noise + FIELD_HEIGHT * (1 - y/TH)  → the top crumbles first.
// A fragment is discarded once progress (0 → OVERSHOOT over LEAVE) passes f.
const FIELD_NOISE = 0.6
const FIELD_HEIGHT = 0.4
const OVERSHOOT = 1.1 // progress past 1 so every fragment is gone before the tile is hidden
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
const FIT_FILL = 1.15 // fraction of the viewport the board may use (headroom for tilt + lift)

export interface BoardCallbacks {
  /** Tile hit the surface (intro). Screen coords in CSS px of the canvas. */
  onLand?: (surface: Surface, x: number, y: number, width: number) => void
  /** A tile started its removal animation. */
  onLeave?: (x: number, y: number) => void
  onHover?: (id: number | null) => void
}

export interface BoardState {
  tiles: Tile[]
  freeIds: Set<number>
  selectedId: number | null
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
  private camLocal = new THREE.Vector3()
  private disposables: Array<{ dispose(): void }> = []
  private key!: THREE.SpotLight
  private palm: THREE.Texture | null = null
  private keyDir = new THREE.Vector3()
  private keyUp0 = new THREE.Vector3()

  private rt: TileRt[] = []
  private state: BoardState = { tiles: [], freeIds: new Set(), selectedId: null, showFree: false }
  private hovered: number | null = null
  private introEnd = 0

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
    const atlas = createAtlas(`${import.meta.env.BASE_URL}tiles.svg`)
    atlas.anisotropy = r.capabilities.getMaxAnisotropy()
    const faceMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.38 })
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

    this.debris = new Debris({ w: TW, d: TD, h: TH, backFrac: 0.28 }) // fewer green crumbs than the true back thickness: reads better
    this.table.add(this.debris.mesh)
    this.disposables.push(this.debris)

    this.disposables.push(back, body, face, pick, backMat, bodyMat, faceMat, atlas, this.pickMesh.material as THREE.Material)

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
      })
    }
    this.aCell.needsUpdate = true
    ;(this.aDissolve.array as Float32Array).fill(0)
    this.aDissolve.needsUpdate = true
    this.debris.clear()
    for (const m of this.meshes) m.count = tiles.length
    this.introEnd = animate ? now + 0.05 + order.length * STAGGER + DROP : 0
    this.fitCamera()
    this.sync({ ...this.state, tiles })
    this.dirty = true
  }

  /** Apply game state; tiles missing from `tiles` start their removal animation. */
  sync(state: BoardState) {
    this.state = state
    const present = new Set(state.tiles.map((t) => t.id))
    const now = this.timer.getElapsed()
    for (const r of this.rt) {
      if (r.present && !present.has(r.tile.id)) {
        r.present = false
        if (this.reducedMotion) this.hide(r)
        else {
          r.leaveStart = now
          this.updateCamLocal()
          this.debris.spawn(r.base, r.spin, now, LEAVE / OVERSHOOT, this.camLocal, dissolveField)
          const p = this.screenOf(r, TH)
          this.cb.onLeave?.(p.x, p.y)
        }
      }
    }
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
    this.scene.add(new THREE.HemisphereLight('#fff4dc', '#0b2a18', AMBIENT))
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
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aCell + uv * uCellSize;\nvState = aState;')
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

    const animating = this.updateMatrices(now)
    const selFxActive = this.selFx.update(dt, now, this.selTarget)
    this.updateCamLocal()
    const debrisActive = this.debris.update(dt, now, this.camLocal)
    const swaying = this.palm !== null && !this.reducedMotion
    if (swaying) this.swayPalm(now)
    if (this.dirty || animating || tilting || swaying || selFxActive || debrisActive) {
      this.dirty = false
      this.renderer.render(this.scene, this.camera)
    }
  }

  /** Recompose instance matrices. Returns true while anything is in motion. */
  private updateMatrices(now: number): boolean {
    let animating = false
    const sel = this.state.selectedId
    this.selTarget = null
    for (const r of this.rt) {
      const id = r.tile.id
      if (r.hidden) continue

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

      if (!Number.isNaN(r.leaveStart)) {
        const t = (now - r.leaveStart) / LEAVE
        if (t >= 1) {
          r.leaveStart = NaN
          this.hide(r)
          this.aDissolve.setX(id, 0)
          this.aDissolve.needsUpdate = true
          animating = true // one more frame to show the removal
          continue
        }
        animating = true
        this.aDissolve.setX(id, t * OVERSHOOT)
        this.aDissolve.needsUpdate = true
        y += 0.04 * t // the crumbling tile lifts a hair as it breaks
      } else if (id === sel && r.present && !this.reducedMotion) {
        y += 0.1 + 0.03 * Math.sin(now * 5.5) // lifted + gentle bob
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
    const box = new THREE.Box3()
    for (const r of this.rt) {
      box.expandByPoint(this.tmpV.set(r.base.x - TW / 2, r.base.y, r.base.z - TD / 2))
      box.expandByPoint(this.tmpV.set(r.base.x + TW / 2, r.base.y + TH, r.base.z + TD / 2))
    }
    box.expandByScalar(0.3)
    const corners: THREE.Vector3[] = []
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z))

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
      this.camDist *= halfRange / FIT_FILL
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

  private screenWidth(r: TileRt) {
    const a = this.table.localToWorld(r.base.clone().setX(r.base.x - TW / 2)).project(this.camera)
    const b = this.table.localToWorld(r.base.clone().setX(r.base.x + TW / 2)).project(this.camera)
    return (Math.abs(b.x - a.x) / 2) * this.width
  }
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
