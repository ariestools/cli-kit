import {
  describe, expect, it, vi,
} from 'vitest'

import type { ProcessHost } from '../ProcessHost.ts'
import { runServiceUntilInterrupt } from '../runServiceUntilInterrupt.ts'

interface InterruptHost {
  readonly fire: () => Promise<void>
  readonly host: Pick<ProcessHost, 'onInterrupt'>
}

function createInterruptHost(): InterruptHost {
  let listener: (() => Promise<void> | void) | undefined
  return {
    async fire(): Promise<void> {
      if (listener === undefined) throw new Error('no interrupt listener registered')
      await listener()
    },
    host: {
      onInterrupt(next) {
        listener = next
        return () => {
          listener = undefined
        }
      },
    },
  }
}

describe('runServiceUntilInterrupt', () => {
  it('awaits the first interrupt, runs stop, then resolves', async () => {
    const interrupt = createInterruptHost()
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

    const pending = runServiceUntilInterrupt(interrupt.host, stop)
    await interrupt.fire()
    await expect(pending).resolves.toBeUndefined()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('rejects when stop fails so mappers see a handler failure', async () => {
    const interrupt = createInterruptHost()
    const failure = new Error('close failed')
    const stop = vi.fn<() => Promise<void>>().mockRejectedValue(failure)

    const pending = runServiceUntilInterrupt(interrupt.host, stop)
    await interrupt.fire()
    await expect(pending).rejects.toBe(failure)
  })

  it('wraps non-Error stop rejections', async () => {
    const interrupt = createInterruptHost()
    const stop = vi.fn<() => Promise<void>>().mockRejectedValue('boom')

    const pending = runServiceUntilInterrupt(interrupt.host, stop)
    await interrupt.fire()
    await expect(pending).rejects.toThrow('boom')
  })

  it('disposes the interrupt listener before stop so a second signal is ignored', async () => {
    const listeners: (() => Promise<void> | void)[] = []
    const host: Pick<ProcessHost, 'onInterrupt'> = {
      onInterrupt(next) {
        listeners.push(next)
        return () => {
          const index = listeners.indexOf(next)
          if (index !== -1) listeners.splice(index, 1)
        }
      },
    }
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

    const pending = runServiceUntilInterrupt(host, stop)
    expect(listeners).toHaveLength(1)
    await listeners[0]()
    await pending
    expect(listeners).toHaveLength(0)
    expect(stop).toHaveBeenCalledOnce()
  })
})
