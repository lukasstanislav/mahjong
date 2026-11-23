/**
 * Simple vector icons for the generated face sets. Each is SVG markup drawn
 * in a 100×100 box (centre 50,50); `place()` positions and scales it. Kept
 * deliberately chunky: tiles can be ~40 px wide on a phone.
 */

export const INK = {
  red: '#d0202e',
  black: '#1d1d1d',
  blue: '#1f5fbf',
  gold: '#e8a317',
  green: '#2e8b3e',
  brown: '#7a4a1e',
  orange: '#f07c1a',
  navy: '#22346b',
  sky: '#cfe6fb',
  pink: '#fbd9e6',
}

/** Icon `body` (100×100) centred at (cx, cy) with width `size` (in the 320×446 face space). */
export function place(body: string, cx: number, cy: number, size: number): string {
  const s = size / 100
  return `<g transform="translate(${cx - 50 * s} ${cy - 50 * s}) scale(${s})">${body}</g>`
}

const starPoints = (cx: number, cy: number, r: number, inner: number, n = 5) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI * i) / n - Math.PI / 2
    const rr = i % 2 ? inner : r
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`
  }).join(' ')

// ---- card suits ------------------------------------------------------------------

export const heart = (c = INK.red) =>
  `<path fill="${c}" d="M50 92 C22 70 4 52 4 32 C4 15 16 5 30 5 C40 5 46 11 50 19 C54 11 60 5 70 5 C84 5 96 15 96 32 C96 52 78 70 50 92Z"/>`

export const spade = (c = INK.black) =>
  `<path fill="${c}" d="M50 3 C78 28 96 44 96 62 C96 77 85 85 73 85 C64 85 57 80 53 74 L59 97 L41 97 L47 74 C43 80 36 85 27 85 C15 85 4 77 4 62 C4 44 22 28 50 3Z"/>`

export const diamond = (c = INK.blue) => `<path fill="${c}" d="M50 2 L90 50 L50 98 L10 50Z"/>`

// ---- counting objects ----------------------------------------------------------------

export const apple = () =>
  `<path fill="${INK.brown}" d="M48 30 C48 20 51 12 57 5 L62 8 C57 14 55 21 55 30Z"/>` +
  `<path fill="${INK.green}" d="M58 18 C64 6 80 4 88 8 C82 20 68 24 58 18Z"/>` +
  `<path fill="${INK.red}" d="M50 30 C32 18 6 24 8 52 C10 80 30 99 50 90 C70 99 90 80 92 52 C94 24 68 18 50 30Z"/>` +
  `<ellipse cx="30" cy="46" rx="7" ry="12" fill="#fff" opacity=".45"/>`

export const star = (c = INK.gold) =>
  `<polygon fill="${c}" stroke="#b3770a" stroke-width="3" stroke-linejoin="round" points="${starPoints(50, 54, 48, 20)}"/>`

export const fish = () =>
  `<path fill="${INK.blue}" d="M68 50 L97 26 L92 50 L97 74Z"/>` +
  `<ellipse cx="42" cy="50" rx="38" ry="25" fill="${INK.blue}"/>` +
  `<path fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" d="M50 34 C58 42 58 58 50 66"/>` +
  `<circle cx="22" cy="45" r="7" fill="#fff"/><circle cx="20" cy="45" r="3.5" fill="${INK.black}"/>`

// ---- honours (single pictures) ----------------------------------------------------------

export const sun = () =>
  Array.from({ length: 12 }, (_, i) => `<rect x="46" y="1" width="8" height="22" rx="4" fill="${INK.orange}" transform="rotate(${i * 30} 50 50)"/>`).join('') +
  `<circle cx="50" cy="50" r="27" fill="${INK.gold}" stroke="${INK.orange}" stroke-width="4"/>`

export const moon = () => `<path fill="${INK.navy}" d="M62 4 A46 46 0 1 0 96 70 A38 38 0 1 1 62 4Z"/>`

export const rainbow = () =>
  [INK.red, INK.orange, INK.gold, INK.green, INK.blue]
    .map((c, i) => `<path fill="none" stroke="${c}" stroke-width="8" d="M${6 + i * 8} 82 A${44 - i * 8} ${44 - i * 8} 0 0 1 ${94 - i * 8} 82"/>`)
    .join('')

export const house = () =>
  `<rect x="18" y="46" width="64" height="48" fill="${INK.gold}"/>` +
  `<polygon fill="${INK.red}" points="50,8 96,50 4,50"/>` +
  `<rect x="42" y="64" width="18" height="30" fill="${INK.brown}"/>` +
  `<rect x="24" y="56" width="14" height="14" fill="#fff" stroke="${INK.brown}" stroke-width="3"/>`

export const tree = () =>
  `<rect x="42" y="56" width="16" height="40" fill="${INK.brown}"/>` +
  `<circle cx="50" cy="36" r="30" fill="${INK.green}"/>` +
  `<circle cx="30" cy="52" r="18" fill="${INK.green}"/><circle cx="70" cy="52" r="18" fill="${INK.green}"/>` +
  `<circle cx="40" cy="30" r="5" fill="${INK.red}"/><circle cx="62" cy="44" r="5" fill="${INK.red}"/>`

export const boat = () =>
  `<rect x="47" y="6" width="6" height="66" fill="${INK.brown}"/>` +
  `<polygon fill="#fff" stroke="${INK.navy}" stroke-width="3" points="53,10 88,64 53,64"/>` +
  `<polygon fill="${INK.red}" points="47,18 47,60 18,60"/>` +
  `<path fill="${INK.navy}" d="M4 70 L96 70 L80 92 L20 92Z"/>`

export const bell = () =>
  `<path fill="${INK.gold}" stroke="#b3770a" stroke-width="3" d="M50 8 C30 8 22 26 22 46 L22 64 L10 78 L90 78 L78 64 L78 46 C78 26 70 8 50 8Z"/>` +
  `<circle cx="50" cy="86" r="9" fill="#b3770a"/><circle cx="50" cy="8" r="6" fill="#b3770a"/>`

// ---- flowers & seasons (each group on its own coloured disc) ------------------------------

/** Flower head with `n` petals and a stem; the four flowers differ in colour and petal shape. */
export function flower(petal: string, centre: string, n: number, long: number): string {
  const petals = Array.from(
    { length: n },
    (_, i) => `<ellipse cx="50" cy="${40 - long}" rx="${long * 0.55}" ry="${long}" fill="${petal}" transform="rotate(${(360 / n) * i} 50 40)"/>`,
  ).join('')
  return (
    `<path fill="none" stroke="${INK.green}" stroke-width="6" d="M50 50 L50 98"/>` +
    `<path fill="${INK.green}" d="M50 80 C60 66 76 66 82 70 C74 80 60 82 50 80Z"/>` +
    petals +
    `<circle cx="50" cy="40" r="${long * 0.6}" fill="${centre}"/>`
  )
}

export const sprout = () =>
  `<path fill="${INK.brown}" d="M14 82 C30 72 70 72 86 82 L86 96 L14 96Z"/>` +
  `<path fill="none" stroke="${INK.green}" stroke-width="6" d="M50 76 L50 40"/>` +
  `<path fill="${INK.green}" d="M50 48 C34 50 18 40 14 20 C32 18 48 28 50 48Z"/>` +
  `<path fill="${INK.green}" d="M50 42 C60 28 76 20 92 24 C88 42 70 50 50 42Z"/>`

export const iceCream = () =>
  `<polygon fill="${INK.gold}" stroke="${INK.brown}" stroke-width="3" points="28,50 72,50 50,98"/>` +
  `<circle cx="50" cy="38" r="22" fill="#f7a6c1"/><circle cx="36" cy="26" r="14" fill="#fff4d6"/><circle cx="64" cy="26" r="14" fill="#8a5a3b"/>` +
  `<circle cx="50" cy="10" r="7" fill="${INK.red}"/>`

export const leaf = () =>
  `<path fill="${INK.orange}" d="M50 4 L60 30 L84 20 L76 44 L98 50 L76 60 L84 84 L60 72 L50 92 L40 72 L16 84 L24 60 L2 50 L24 44 L16 20 L40 30Z"/>` +
  `<path fill="none" stroke="${INK.brown}" stroke-width="4" d="M50 30 L50 99"/>`

export const snowflake = () =>
  Array.from({ length: 6 }, (_, i) =>
    `<g transform="rotate(${i * 60} 50 50)" stroke="${INK.blue}" stroke-width="6" stroke-linecap="round">` +
    `<line x1="50" y1="50" x2="50" y2="6"/><line x1="50" y1="22" x2="38" y2="12"/><line x1="50" y1="22" x2="62" y2="12"/></g>`,
  ).join('') + `<circle cx="50" cy="50" r="7" fill="${INK.blue}"/>`
