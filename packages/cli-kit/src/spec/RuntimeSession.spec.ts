import {
  describe, expect, it, vi,
} from 'vitest'

import { RuntimeSession } from '../RuntimeSession.ts'

interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
}

interface InterruptHost {
  readonly dispose: ReturnType<typeof vi.fn>
  readonly onInterrupt: (listener: () => Promise<void> | void) => () => void
  interrupt(): Promise<void> | void
}

function createDeferred(): Deferred {
  const { promise, resolve } = Promise.withResolvers<void>()
  return { promise, resolve }
}

function interruptHost(events: string[] = []): InterruptHost {
  let listener: (() => Promise<void> | void) | undefined
  const dispose = vi.fn(() => {
    events.push('interrupt:dispose')
    listener = undefined
  })
  return {
    dispose,
    interrupt: () => listener?.(),
    onInterrupt: (registeredListener) => {
      listener = registeredListener
      return dispose
    },
  }
}

describe('RuntimeSession', () => {
  it('coalesces competing process exits and retains the failure code', async () => {
    const exit = vi.fn()
    const session = new RuntimeSession(vi.fn())

    const interruptExit = session.requestExit({ exit }, 0)
    const failureExit = session.requestExit({ exit }, 1)

    expect(failureExit).toBe(interruptExit)
    await interruptExit
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(1)

    expect(session.requestExit({ exit }, 0)).toBe(interruptExit)
    expect(exit).toHaveBeenCalledOnce()
  })

  it('runs one asynchronous stop operation and shares its promise', async () => {
    const deferred = createDeferred()
    const stopDelegate = vi.fn(async () => await deferred.promise)
    const session = new RuntimeSession(stopDelegate)

    expect(session.state).toBe('active')
    const firstStop = session.stop()
    const secondStop = session.stop()

    expect(firstStop).toBe(secondStop)
    expect(session.state).toBe('stopping')
    await Promise.resolve()
    expect(stopDelegate).toHaveBeenCalledOnce()

    deferred.resolve()
    await firstStop

    expect(session.state).toBe('stopped')
    expect(session.stopError).toBeUndefined()
    await expect(session.stop()).resolves.toBeUndefined()
    expect(stopDelegate).toHaveBeenCalledOnce()
  })

  it('shares the pending promise with a reentrant stop request', async () => {
    let reentrantStop: Promise<void> | undefined
    const stopDelegate = vi.fn((): void => {
      reentrantStop = session.stop()
    })
    const session = new RuntimeSession(stopDelegate)

    const firstStop = session.stop()
    await firstStop

    expect(reentrantStop).toBe(firstStop)
    expect(stopDelegate).toHaveBeenCalledOnce()
    expect(session.state).toBe('stopped')
  })

  it('supports a synchronous stop delegate', async () => {
    const stopDelegate = vi.fn()
    const session = new RuntimeSession(stopDelegate)

    await session.stop()

    expect(session.state).toBe('stopped')
    expect(stopDelegate).toHaveBeenCalledOnce()
  })

  it('preserves and rethrows the original asynchronous stop error', async () => {
    const originalError = new Error('shutdown failed')
    const stopDelegate = vi.fn(async () => {
      throw originalError
    })
    const session = new RuntimeSession(stopDelegate)

    const firstStop = session.stop()
    const secondStop = session.stop()

    expect(firstStop).toBe(secondStop)
    await expect(firstStop).rejects.toBe(originalError)
    expect(session.state).toBe('failed')
    expect(session.stopError).toBe(originalError)
    await expect(session.stop()).rejects.toBe(originalError)
    expect(stopDelegate).toHaveBeenCalledOnce()
  })

  it('preserves an error thrown synchronously by the stop delegate', async () => {
    const originalError = new Error('synchronous shutdown failure')
    const stopDelegate = vi.fn(() => {
      throw originalError
    })
    const session = new RuntimeSession(stopDelegate)

    await expect(session.stop()).rejects.toBe(originalError)

    expect(session.state).toBe('failed')
    expect(session.stopError).toBe(originalError)
    expect(stopDelegate).toHaveBeenCalledOnce()
  })

  it('coalesces repeated interrupts and retains the binding until the listener settles', async () => {
    const events: string[] = []
    const host = interruptHost(events)
    const cleanup = createDeferred()
    const session = new RuntimeSession(async () => {
      events.push('cleanup:start')
      await cleanup.promise
    })
    const listener = vi.fn(async () => {
      events.push('listener:start')
      await session.stop()
      events.push('listener:end')
    })
    session.bindInterrupt(host, listener)

    const firstInterrupt = host.interrupt()
    await vi.waitFor(() => expect(events).toContain('cleanup:start'))
    const repeatedInterrupt = host.interrupt()
    expect(repeatedInterrupt).toBe(firstInterrupt)
    expect(host.dispose).not.toHaveBeenCalled()
    cleanup.resolve()
    await firstInterrupt
    await repeatedInterrupt

    expect(events).toEqual([
      'listener:start',
      'cleanup:start',
      'listener:end',
      'interrupt:dispose',
    ])
    expect(listener).toHaveBeenCalledOnce()
    expect(host.dispose).toHaveBeenCalledOnce()
  })

  it('disposes the interrupt binding before a successful manual stop', async () => {
    const events: string[] = []
    const host = interruptHost(events)
    const session = new RuntimeSession(() => {
      events.push('cleanup:start')
    })
    const listener = vi.fn()
    session.bindInterrupt(host, listener)

    await session.stop()
    await host.interrupt()

    expect(events).toEqual(['interrupt:dispose', 'cleanup:start'])
    expect(listener).not.toHaveBeenCalled()
    expect(host.dispose).toHaveBeenCalledOnce()
  })

  it('disposes the interrupt binding before a failing manual stop', async () => {
    const events: string[] = []
    const failure = new Error('cleanup failed')
    const host = interruptHost(events)
    const session = new RuntimeSession(async () => {
      events.push('cleanup:start')
      throw failure
    })
    const listener = vi.fn()
    session.bindInterrupt(host, listener)

    await expect(session.stop()).rejects.toBe(failure)
    await host.interrupt()

    expect(events).toEqual(['interrupt:dispose', 'cleanup:start'])
    expect(listener).not.toHaveBeenCalled()
    expect(host.dispose).toHaveBeenCalledOnce()
  })

  it('shares an interrupt listener failure and still disposes the binding', async () => {
    const events: string[] = []
    const failure = new Error('listener failed')
    const host = interruptHost(events)
    const session = new RuntimeSession(vi.fn())
    const listener = vi.fn(async () => {
      events.push('listener:start')
      throw failure
    })
    session.bindInterrupt(host, listener)

    const firstInterrupt = host.interrupt()
    const repeatedInterrupt = host.interrupt()

    expect(repeatedInterrupt).toBe(firstInterrupt)
    await expect(firstInterrupt).rejects.toBe(failure)
    await expect(repeatedInterrupt).rejects.toBe(failure)
    expect(events).toEqual(['listener:start', 'interrupt:dispose'])
    expect(listener).toHaveBeenCalledOnce()
    expect(host.dispose).toHaveBeenCalledOnce()
  })

  it('retains the disposer before handling an interrupt delivered during registration', async () => {
    const events: string[] = []
    const listener = vi.fn(() => {
      events.push('listener')
    })
    const session = new RuntimeSession(vi.fn())

    session.bindInterrupt({
      onInterrupt(registeredListener): () => void {
        void registeredListener()
        return () => {
          events.push('interrupt:dispose')
        }
      },
    }, listener)
    await vi.waitFor(() => expect(events).toEqual(['listener', 'interrupt:dispose']))

    expect(listener).toHaveBeenCalledOnce()
  })

  it('rejects a second interrupt binding', () => {
    const session = new RuntimeSession(vi.fn())
    session.bindInterrupt(interruptHost(), vi.fn())

    expect(() => session.bindInterrupt(interruptHost(), vi.fn()))
      .toThrow('An interrupt listener is already bound to this runtime session.')
  })

  it('rejects interrupt binding after shutdown has started', async () => {
    const session = new RuntimeSession(vi.fn())

    const stop = session.stop()

    expect(() => session.bindInterrupt(interruptHost(), vi.fn()))
      .toThrow('An interrupt listener cannot be bound after runtime shutdown has started.')
    await stop
  })
})
