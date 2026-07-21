import {
  describe, expect, it, vi,
} from 'vitest'

import { exitProcess, ProcessExitError } from '../ProcessHost.ts'

describe('exitProcess', () => {
  it('records the requested exit before stopping non-terminating host control flow', () => {
    const exit = vi.fn()

    expect(() => exitProcess({ exit }, 7)).toThrow(new ProcessExitError(7))
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(7)
  })
})
