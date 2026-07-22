import {
  describe, expect, it,
} from 'vitest'

import { mergeEnvironments } from '../mergeEnvironments.ts'

describe('mergeEnvironments', () => {
  it('lets the primary layer win for defined values', () => {
    expect(mergeEnvironments(
      { NODE_ENV: 'production', SHARED: 'process' },
      { FROM_FILE: 'file', SHARED: 'file' },
    )).toEqual({
      FROM_FILE: 'file',
      NODE_ENV: 'production',
      SHARED: 'process',
    })
  })

  it('fills primary undefined entries from later layers', () => {
    expect(mergeEnvironments(
      { ONLY_PRIMARY: 'one', SHARED: undefined },
      { SHARED: 'from-fallback', ONLY_FALLBACK: 'two' },
    )).toEqual({
      ONLY_FALLBACK: 'two',
      ONLY_PRIMARY: 'one',
      SHARED: 'from-fallback',
    })
  })

  it('treats empty strings as defined values', () => {
    expect(mergeEnvironments(
      { EMPTY: '' },
      { EMPTY: 'from-file' },
    )).toEqual({ EMPTY: '' })
  })

  it('walks multiple fallback layers in order', () => {
    expect(mergeEnvironments(
      {},
      {
        A: undefined,
        B: 'second',
      },
      {
        A: 'third',
        B: 'third',
        C: 'third',
      },
    )).toEqual({
      A: 'third',
      B: 'second',
      C: 'third',
    })
  })
})
