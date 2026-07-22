import {
  describe, expect, it,
} from 'vitest'

import { parseDotEnv } from '../parseDotEnv.ts'

describe('parseDotEnv', () => {
  it('parses plain, exported, and quoted assignments', () => {
    expect(parseDotEnv(String.raw`
# comment
export XL1_MNEMONIC="root words"
XL1_PORT=8080
XL1_EMPTY=
XL1_SINGLE='keep # hash'
XL1_DOUBLE="line\nbreak"
UNQUOTED=value # trailing comment
`)).toEqual({
      XL1_DOUBLE: 'line\nbreak',
      XL1_EMPTY: '',
      XL1_MNEMONIC: 'root words',
      XL1_PORT: '8080',
      XL1_SINGLE: 'keep # hash',
      UNQUOTED: 'value',
    })
  })

  it('strips a leading UTF-8 BOM', () => {
    expect(parseDotEnv('\u{FEFF}FOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('keeps the last assignment when a key is repeated', () => {
    expect(parseDotEnv('FOO=one\nFOO=two')).toEqual({ FOO: 'two' })
  })

  it('returns an empty object for blank content', () => {
    expect(parseDotEnv('\n# only comments\n')).toEqual({})
  })
})
