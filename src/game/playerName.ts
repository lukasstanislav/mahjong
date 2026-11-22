export const NAME_MAX = 15

/**
 * Allowed: Unicode letters (incl. combining marks, so "Lukáš" works), digits,
 * space, "_" and "-". 1–15 characters after trimming. Counted in code points,
 * not UTF-16 units. The name is only ever rendered via Vue text interpolation
 * (auto-escaped) — never use v-html with it.
 */
const NAME_RE = /^[\p{L}\p{M}\p{N} _-]+$/u

export function normalizeName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function validateName(raw: string): string | null {
  const name = normalizeName(raw)
  const len = [...name].length
  if (len === 0) return 'Please enter a name.'
  if (len > NAME_MAX) return `At most ${NAME_MAX} characters.`
  if (!NAME_RE.test(name)) return 'Use letters, digits, spaces, "_" or "-" only.'
  return null
}
