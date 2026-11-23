import { computed, ref, shallowRef } from 'vue'
import { dealSolvable, type Tile } from './deal'
import { isFree } from './layout'
import { DEFAULT_LAYOUT, getLayout } from './layouts'
import { canMatch, matchKey } from './tiles'
import { findPairs, randomHint, type Pair } from './hint'

/** Game state + rules. Pure UI components consume this; it has no DOM access. */
export function useGame() {
  /** Layout for the next deal (see layouts.ts). Changing it doesn't redeal by itself. */
  const layoutId = ref(DEFAULT_LAYOUT)
  const tiles = shallowRef<Tile[]>([])
  const selectedId = ref<number | null>(null)
  const moves = ref(0)
  /** Increments on every deal; the board keys animations on it. */
  const dealId = ref(0)
  /** Pair currently shown by Help, or null. Cleared by any match and by a new deal. */
  const hintIds = shallowRef<Pair | null>(null)

  function newGame() {
    tiles.value = dealSolvable(getLayout(layoutId.value).positions).tiles
    dealId.value++
    selectedId.value = null
    moves.value = 0
    hintIds.value = null
  }

  /** Show a random available matching pair (a different one on each press, when possible). */
  function hint() {
    hintIds.value = randomHint(findPairs(tiles.value, freeIds.value), hintIds.value)
  }

  const freeIds = computed(() => {
    const positions = tiles.value.map((t) => t.pos)
    return new Set(tiles.value.filter((t) => isFree(t.pos, positions)).map((t) => t.id))
  })

  /** Number of matching pairs currently available among free tiles. */
  const availablePairs = computed(() => {
    const counts = new Map<string, number>()
    for (const t of tiles.value) {
      if (!freeIds.value.has(t.id)) continue
      const k = matchKey(t.face)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    let n = 0
    for (const c of counts.values()) n += (c * (c - 1)) / 2
    return n
  })

  const won = computed(() => tiles.value.length === 0 && moves.value > 0)
  const stuck = computed(() => tiles.value.length > 0 && availablePairs.value === 0)

  /**
   * Click rule: first pick highlights; a matching second pick removes both;
   * a non-matching second pick becomes the new first pick. Covered/blocked
   * tiles are ignored.
   */
  function pick(id: number) {
    if (!freeIds.value.has(id)) return
    const current = selectedId.value
    if (current === id) {
      selectedId.value = null
      return
    }
    const a = current === null ? undefined : tiles.value.find((t) => t.id === current)
    const b = tiles.value.find((t) => t.id === id)!
    if (a && canMatch(a.face, b.face)) {
      tiles.value = tiles.value.filter((t) => t.id !== a.id && t.id !== b.id)
      selectedId.value = null
      moves.value++
      hintIds.value = null
    } else {
      selectedId.value = id
    }
  }

  return { layoutId, tiles, dealId, selectedId, hintIds, freeIds, availablePairs, moves, won, stuck, newGame, pick, hint }
}
