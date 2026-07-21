/** Result convention used by managed actor lifecycle operations. */
export type ManagedActorLifecycleResult = boolean | void

/** Observable readiness state for an actor or actor supervisor. */
export type ReadyState = 'failed' | 'pending' | 'ready'

/** Structural readiness contract; implementations do not need to inherit a kit class. */
export interface ReadinessSignal {
  readonly readyError?: Error
  readonly readyState: ReadyState
  whenReady(timeoutMs?: number): Promise<void>
}

/**
 * Structural lifecycle contract coordinated by {@link ActorSupervisor}.
 * Returning `false` from `start` or `stop` reports a lifecycle failure.
 */
export interface ManagedActor extends ReadinessSignal {
  readonly name: string
  start(): ManagedActorLifecycleResult | Promise<ManagedActorLifecycleResult>
  stop(): ManagedActorLifecycleResult | Promise<ManagedActorLifecycleResult>
}
