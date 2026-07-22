import {
  describe, expect, it,
} from 'vitest'

import { SYS_EXITS, type SysExitCode } from '../sysExits.ts'

describe('SYS_EXITS', () => {
  it('matches the supported sysexits.h vocabulary exactly', () => {
    expect(SYS_EXITS).toEqual({
      config: 78,
      dataErr: 65,
      ioErr: 74,
      noInput: 66,
      ok: 0,
      software: 70,
      usage: 64,
    })
  })

  it('narrows codes to the derived literal union', () => {
    // Type-level usage: a SysExitCode accepts every member of the vocabulary.
    const codes: readonly SysExitCode[] = [
      SYS_EXITS.ok,
      SYS_EXITS.usage,
      SYS_EXITS.dataErr,
      SYS_EXITS.noInput,
      SYS_EXITS.software,
      SYS_EXITS.ioErr,
      SYS_EXITS.config,
    ]

    // @ts-expect-error 1 is not part of the sysexits vocabulary
    const invalid: SysExitCode = 1
    void invalid

    expect(codes).toEqual([0, 64, 65, 66, 70, 74, 78])
  })
})
