import { describe, expect, it } from 'vitest'
import { normalizeName, validateName } from './playerName'

describe('player name', () => {
  it.each(['Lukáš', 'a', 'Player_1', 'Mei-Ling', '玩家', 'fifteen chars!!'.slice(0, 15).replace(/!/g, 'x')])(
    'accepts %s', (n) => expect(validateName(n)).toBeNull(),
  )
  it.each(['', '   ', 'sixteen_chars_xx', '<script>', 'a"b', "o'neil", 'emoji😀'])(
    'rejects %s', (n) => expect(validateName(n)).not.toBeNull(),
  )
  it('normalizes whitespace', () => expect(normalizeName('  a   b ')).toBe('a b'))
})
