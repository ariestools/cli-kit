import {
  describe, expect, it,
} from 'vitest'

import {
  ActorReadinessError,
  ActorReadinessTimeoutError,
  ActorRegistrationError,
  ActorShutdownError,
  ActorStartupError,
  ActorSupervisor,
  ActorSupervisorStateError,
} from '../ActorSupervisor.ts'
import type {
  ManagedActor,
  ReadyState,
} from '../ManagedActor.ts'

interface TestActorOptions {
  readiness?: (timeoutMs?: number) => Promise<void>
  readyError?: Error
  shouldPreservePendingState?: boolean
  startError?: Error
  startResult?: boolean
  stopError?: Error
  stopResult?: boolean
}

class TestActor implements ManagedActor {
  readonly name: string
  readyError?: Error
  readyState: ReadyState = 'pending'
  private readonly events: string[]
  private readonly options: TestActorOptions

  constructor(
    name: string,
    events: string[],
    options: TestActorOptions = {},
  ) {
    this.name = name
    this.events = events
    this.options = options
  }

  async start(): Promise<boolean | void> {
    this.events.push(`start:${this.name}`)
    if (this.options.startError !== undefined) throw this.options.startError
    return this.options.startResult
  }

  async stop(): Promise<boolean | void> {
    this.events.push(`stop:${this.name}`)
    if (this.options.stopError !== undefined) throw this.options.stopError
    return this.options.stopResult
  }

  async whenReady(timeoutMs?: number): Promise<void> {
    this.events.push(`ready:${this.name}`)
    if (this.options.readiness !== undefined) await this.options.readiness(timeoutMs)
    if (this.options.readyError !== undefined) {
      this.readyError = this.options.readyError
      if (this.options.shouldPreservePendingState !== true) this.readyState = 'failed'
      throw this.options.readyError
    }
    this.readyState = 'ready'
  }
}

describe('ActorSupervisor', () => {
  it('starts actors and observes readiness in registration order', async () => {
    const events: string[] = []
    const supervisor = new ActorSupervisor([
      new TestActor('api', events),
      new TestActor('producer', events),
      new TestActor('finalizer', events),
    ])

    await supervisor.start()
    await supervisor.whenReady()

    expect(events).toEqual([
      'start:api',
      'start:producer',
      'start:finalizer',
      'ready:api',
      'ready:producer',
      'ready:finalizer',
    ])
    expect(supervisor.isReady()).toBe(true)
    expect(supervisor.readyState).toBe('ready')
    expect(supervisor.state).toBe('started')
  })

  it('rolls back already-started actors in reverse order after a startup exception', async () => {
    const events: string[] = []
    const supervisor = new ActorSupervisor([
      new TestActor('first', events),
      new TestActor('second', events),
      new TestActor('failing', events, { startError: new Error('boom') }),
      new TestActor('never-started', events),
    ])

    const start = supervisor.start()

    await expect(start).rejects.toMatchObject({
      actorName: 'failing',
      name: 'ActorStartupError',
      rollbackErrors: [],
    } satisfies Partial<ActorStartupError>)
    expect(events).toEqual([
      'start:first',
      'start:second',
      'start:failing',
      'stop:second',
      'stop:first',
    ])
    expect(supervisor.state).toBe('failed')
    await supervisor.stop()
    expect(events).toHaveLength(5)
    expect(supervisor.state).toBe('stopped')
  })

  it('treats a false startup result as failure and reports rollback errors', async () => {
    const events: string[] = []
    const supervisor = new ActorSupervisor([
      new TestActor('rollback-fails', events, { stopResult: false }),
      new TestActor('start-fails', events, { startResult: false }),
    ])

    let thrown: unknown
    try {
      await supervisor.start()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ActorStartupError)
    expect((thrown as ActorStartupError).actorName).toBe('start-fails')
    expect((thrown as ActorStartupError).rollbackErrors).toHaveLength(1)
    expect(events).toEqual([
      'start:rollback-fails',
      'start:start-fails',
      'stop:rollback-fails',
    ])
  })

  it('stops in reverse order and does not stop actors more than once', async () => {
    const events: string[] = []
    const supervisor = new ActorSupervisor([
      new TestActor('first', events),
      new TestActor('second', events),
      new TestActor('third', events),
    ])
    await supervisor.start()

    await Promise.all([supervisor.stop(), supervisor.stop()])
    await supervisor.stop()

    expect(events).toEqual([
      'start:first',
      'start:second',
      'start:third',
      'stop:third',
      'stop:second',
      'stop:first',
    ])
    expect(supervisor.state).toBe('stopped')
  })

  it('attempts every reverse-order stop before reporting aggregated failures', async () => {
    const events: string[] = []
    const supervisor = new ActorSupervisor([
      new TestActor('first', events, { stopError: new Error('first stop failed') }),
      new TestActor('second', events),
      new TestActor('third', events, { stopResult: false }),
    ])
    await supervisor.start()

    let thrown: unknown
    try {
      await supervisor.stop()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ActorShutdownError)
    expect((thrown as ActorShutdownError).errors).toHaveLength(2)
    expect(events.slice(3)).toEqual(['stop:third', 'stop:second', 'stop:first'])
    expect(supervisor.state).toBe('stopped')
    await expect(supervisor.stop()).rejects.toBeInstanceOf(ActorShutdownError)
    expect(events).toHaveLength(6)
  })

  it('attributes readiness failures to the actor and preserves failed readiness state', async () => {
    const events: string[] = []
    const supervisor = new ActorSupervisor([
      new TestActor('ready', events),
      new TestActor('not-ready', events, { readyError: new Error('warming failed') }),
    ])
    await supervisor.start()

    await expect(supervisor.whenReady()).rejects.toMatchObject({
      actorName: 'not-ready',
      name: 'ActorReadinessError',
    } satisfies Partial<ActorReadinessError>)
    expect(supervisor.readyState).toBe('failed')
    expect(supervisor.readyError).toBeInstanceOf(ActorReadinessError)
  })

  it('makes a readiness rejection authoritative when the actor leaves its state pending', async () => {
    const events: string[] = []
    const supervisor = new ActorSupervisor([
      new TestActor('pending', events, {
        readyError: new Error('rejected without a state transition'),
        shouldPreservePendingState: true,
      }),
    ])
    await supervisor.start()

    await expect(supervisor.whenReady()).rejects.toBeInstanceOf(ActorReadinessError)
    expect(supervisor.actors[0]?.readyState).toBe('pending')
    expect(supervisor.readyState).toBe('failed')
    expect(supervisor.readyError).toBeInstanceOf(ActorReadinessError)
  })

  it('enforces a finite supervisor timeout and passes the remaining budget to the actor', async () => {
    const events: string[] = []
    let receivedTimeoutMs: number | undefined
    const neverReady = new Promise<void>(() => {
      // The supervisor deadline must settle this wait.
    })
    const supervisor = new ActorSupervisor([
      new TestActor('never-ready', events, {
        readiness: async (timeoutMs) => {
          receivedTimeoutMs = timeoutMs
          await neverReady
        },
      }),
    ])
    await supervisor.start()

    let thrown: unknown
    try {
      await supervisor.whenReady(5)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ActorReadinessError)
    expect((thrown as ActorReadinessError).cause).toBeInstanceOf(ActorReadinessTimeoutError)
    expect(receivedTimeoutMs).toBeTypeOf('number')
    expect(receivedTimeoutMs).toBeGreaterThanOrEqual(0)
    expect(receivedTimeoutMs).toBeLessThanOrEqual(5)
    expect(supervisor.readyState).toBe('failed')
  })

  it('rejects duplicate registrations and lifecycle mutation after startup', async () => {
    const events: string[] = []
    const supervisor = new ActorSupervisor()
    supervisor.register(new TestActor('api', events))

    expect(() => supervisor.register(new TestActor('api', events))).toThrow(ActorRegistrationError)
    await supervisor.start()
    expect(() => supervisor.register(new TestActor('producer', events))).toThrow(ActorSupervisorStateError)
  })
})
