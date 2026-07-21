import {
  describe, expect, it,
} from 'vitest'

import { environmentToYargsConfig } from '../environmentToYargsConfig.ts'

describe('environmentToYargsConfig', () => {
  it('matches Yargs environment prefix and segment normalization', () => {
    const config = environmentToYargsConfig({
      OTHER_MNEMONIC: 'ignored',
      XL1_ACTORS__0__ACCOUNT_PATH: '7',
      XL1_CHAIN_ID: '0x01',
      XL1_MNEMONIC: 'root words',
      XL1alreadyMixed__childValue: 'mixed',
    }, 'XL1')

    expect(config).toEqual({
      'actors.0.accountPath': '7',
      'alreadyMixed.childValue': 'mixed',
      'chainId': '0x01',
      'mnemonic': 'root words',
    })
  })

  it('preserves enumeration order and undefined values', () => {
    const config = environmentToYargsConfig({
      XL1_FIRST: 'one',
      XL1_SECOND: undefined,
      XL1_THIRD: 'three',
    }, 'XL1')

    expect(Object.keys(config)).toEqual(['first', 'second', 'third'])
    expect(config.second).toBeUndefined()
  })

  it('supports an empty prefix with the same key conversion', () => {
    expect(environmentToYargsConfig({ FOO_BAR__BAZ_QUX: 'value' }, '')).toEqual({ 'fooBar.bazQux': 'value' })
  })

  it('keeps the first value when environment names normalize to the same key', () => {
    expect(environmentToYargsConfig({
      'XL1_FOO_BAR': 'first',
      'XL1_FOO__BAR': 'nested',
      'XL1_FOO-BAR': 'later',
    }, 'XL1')).toEqual({
      'foo.bar': 'nested',
      'fooBar': 'first',
    })
  })
})
