import type {
  ManagedActor, ManagedActorLifecycleResult, ReadinessSignal, ReadyState,
} from './ManagedActor.ts'

export type ActorSupervisorState = 'failed' | 'idle' | 'started' | 'starting' | 'stopped' | 'stopping'

export class ActorRegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActorRegistrationError'
  }
}

export class ActorSupervisorStateError extends Error {
  readonly state: ActorSupervisorState

  constructor(operation: string, state: ActorSupervisorState) {
    super(`Cannot ${operation} while actor supervisor is ${state}`)
    this.name = 'ActorSupervisorStateError'
    this.state = state
  }
}

export class ActorStartupError extends Error {
  readonly actorName: string
  readonly rollbackErrors: readonly Error[]

  constructor(actorName: string, cause: unknown, rollbackErrors: readonly Error[]) {
    super(`Actor "${actorName}" failed to start`, { cause })
    this.name = 'ActorStartupError'
    this.actorName = actorName
    this.rollbackErrors = rollbackErrors
  }
}

export class ActorReadinessError extends Error {
  readonly actorName: string

  constructor(actorName: string, cause: unknown) {
    super(`Actor "${actorName}" failed to become ready`, { cause })
    this.name = 'ActorReadinessError'
    this.actorName = actorName
  }
}

export class ActorReadinessTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Actors did not become ready within ${timeoutMs}ms`)
    this.name = 'ActorReadinessTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export class ActorShutdownError extends AggregateError {
  constructor(errors: readonly Error[]) {
    super(errors, `${errors.length} actor(s) failed to stop`)
    this.name = 'ActorShutdownError'
  }
}

interface TimerHost {
  clearTimeout(handle: unknown): void
  setTimeout(callback: () => void, timeoutMs: number): unknown
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function assertLifecycleSucceeded(actor: ManagedActor, operation: 'start' | 'stop', result: ManagedActorLifecycleResult): void {
  if (result === false) {
    throw new Error(`Actor "${actor.name}" ${operation}() reported failure`)
  }
}

function assertTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError('Readiness timeout must be a finite, non-negative number')
  }
}

async function waitWithTimeout(signal: ReadinessSignal, timeoutMs: number): Promise<void> {
  const timerHost = globalThis as unknown as TimerHost
  let timeoutHandle: unknown
  const expired = new Promise<never>((_resolve, reject) => {
    timeoutHandle = timerHost.setTimeout(() => reject(new ActorReadinessTimeoutError(timeoutMs)), timeoutMs)
  })
  try {
    await Promise.race([signal.whenReady(timeoutMs), expired])
  } finally {
    timerHost.clearTimeout(timeoutHandle)
  }
}

/**
 * Instance-scoped coordinator for structural managed actors.
 *
 * Startup and readiness follow registration order. Rollback and ordinary shutdown
 * follow reverse startup order. A supervisor is single-use after it has stopped or
 * failed; construct a new instance for a new lifecycle.
 */
export class ActorSupervisor implements ReadinessSignal {
  private readonly _actorNames = new Set<string>()
  private readonly _actors: ManagedActor[] = []
  private _readyError?: Error
  private _startPromise?: Promise<void>
  private readonly _startedActors: ManagedActor[] = []
  private _state: ActorSupervisorState = 'idle'
  private _stopPromise?: Promise<void>

  constructor(actors: readonly ManagedActor[] = []) {
    for (const actor of actors) this.register(actor)
  }

  get actors(): readonly ManagedActor[] {
    return [...this._actors]
  }

  get readyError(): Error | undefined {
    if (this._readyError !== undefined) return this._readyError
    return this._actors.find(actor => actor.readyState === 'failed')?.readyError
  }

  get readyState(): ReadyState {
    if (this._readyError !== undefined || this._state === 'failed' || this._actors.some(actor => actor.readyState === 'failed')) {
      return 'failed'
    }
    if (this._state === 'started' && this._actors.every(actor => actor.readyState === 'ready')) return 'ready'
    return 'pending'
  }

  get state(): ActorSupervisorState {
    return this._state
  }

  isReady(): boolean {
    return this.readyState === 'ready'
  }

  register(actor: ManagedActor): void {
    if (this._state !== 'idle') throw new ActorSupervisorStateError('register an actor', this._state)
    if (actor.name.trim().length === 0) throw new ActorRegistrationError('Actor name must not be empty')
    if (this._actorNames.has(actor.name)) {
      throw new ActorRegistrationError(`Actor "${actor.name}" is already registered`)
    }
    this._actorNames.add(actor.name)
    this._actors.push(actor)
  }

  start(): Promise<void> {
    if (this._startPromise !== undefined) return this._startPromise
    if (this._state !== 'idle') return Promise.reject(new ActorSupervisorStateError('start', this._state))
    this._state = 'starting'
    this._startPromise = this.startActors()
    return this._startPromise
  }

  stop(): Promise<void> {
    this._stopPromise ??= this.stopActors()
    return this._stopPromise
  }

  async whenReady(timeoutMs?: number): Promise<void> {
    if (timeoutMs !== undefined) assertTimeout(timeoutMs)
    if (this._state === 'starting' && this._startPromise !== undefined) {
      await this._startPromise
    }
    if (this._state !== 'started') throw new ActorSupervisorStateError('wait for readiness', this._state)

    const startedAt = Date.now()
    for (const actor of this._actors) {
      try {
        if (timeoutMs === undefined) {
          await actor.whenReady()
        } else {
          const elapsed = Date.now() - startedAt
          const remainingTimeoutMs = timeoutMs - elapsed
          if (remainingTimeoutMs < 0) throw new ActorReadinessTimeoutError(timeoutMs)
          await waitWithTimeout(actor, remainingTimeoutMs)
        }
      } catch (error) {
        const readinessError = new ActorReadinessError(actor.name, error)
        this._readyError = readinessError
        throw readinessError
      }
    }
  }

  private async startActors(): Promise<void> {
    for (const actor of this._actors) {
      try {
        const result = await actor.start()
        assertLifecycleSucceeded(actor, 'start', result)
        this._startedActors.push(actor)
      } catch (error) {
        const rollbackErrors = await this.stopStartedActors()
        const startupError = new ActorStartupError(actor.name, error, rollbackErrors)
        this._readyError = startupError
        this._state = 'failed'
        throw startupError
      }
    }
    this._state = 'started'
  }

  private async stopActors(): Promise<void> {
    if (this._state === 'starting' && this._startPromise !== undefined) {
      try {
        await this._startPromise
      } catch {
        // Startup already rolled back every actor that reached started state.
      }
    }

    if (this._state === 'stopped') return
    if (this._state === 'idle' || (this._state === 'failed' && this._startedActors.length === 0)) {
      this._state = 'stopped'
      return
    }

    this._state = 'stopping'
    const errors = await this.stopStartedActors()
    this._state = 'stopped'
    if (errors.length > 0) throw new ActorShutdownError(errors)
  }

  private async stopStartedActors(): Promise<Error[]> {
    const errors: Error[] = []
    while (this._startedActors.length > 0) {
      const actor = this._startedActors.pop()
      if (actor === undefined) continue
      try {
        const result = await actor.stop()
        assertLifecycleSucceeded(actor, 'stop', result)
      } catch (error) {
        errors.push(new Error(`Actor "${actor.name}" failed to stop`, { cause: asError(error) }))
      }
    }
    return errors
  }
}
