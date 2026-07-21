import type { ProcessHost } from './ProcessHost.ts'

/** Lifecycle state of one active runtime session. */
export type RuntimeSessionState = 'active' | 'failed' | 'stopped' | 'stopping'

/** Application-owned cleanup invoked when a runtime session stops. */
export type RuntimeStopDelegate = () => Promise<void> | void

/** Application-owned work invoked for the first process interrupt. */
export type RuntimeInterruptListener = () => Promise<void> | void

/**
 * Instance-scoped owner for one runtime cleanup operation.
 *
 * Every call to {@link stop} returns the same promise. A cleanup failure is
 * retained and rethrown without wrapping so callers can preserve their
 * existing fail-fast behavior.
 */
export class RuntimeSession {
  private _exitCode?: number
  private _exitHost?: Pick<ProcessHost, 'exit'>
  private _exitPromise?: Promise<void>
  private _hasInterruptBinding = false
  private _interruptDisposer?: () => void
  private _interruptPromise?: Promise<void>
  private _isInterruptDisposed = false
  private _state: RuntimeSessionState = 'active'
  private readonly _stopDelegate: RuntimeStopDelegate
  private _stopError?: unknown
  private _stopPromise?: Promise<void>

  constructor(stopDelegate: RuntimeStopDelegate) {
    this._stopDelegate = stopDelegate
  }

  get state(): RuntimeSessionState {
    return this._state
  }

  get stopError(): unknown {
    return this._stopError
  }

  bindInterrupt(host: Pick<ProcessHost, 'onInterrupt'>, listener: RuntimeInterruptListener): void {
    if (this._hasInterruptBinding) throw new Error('An interrupt listener is already bound to this runtime session.')
    if (this.state !== 'active') throw new Error('An interrupt listener cannot be bound after runtime shutdown has started.')

    this._hasInterruptBinding = true
    let isRegistrationComplete = false
    let isInterruptPending = false
    const handleInterrupt = (): Promise<void> | void => {
      if (!isRegistrationComplete) {
        isInterruptPending = true
        return
      }
      return this.handleInterrupt(listener)
    }
    this._interruptDisposer = host.onInterrupt(handleInterrupt)
    isRegistrationComplete = true

    // A structural host may deliver an interrupt while registering the listener.
    // Defer that delivery until the returned disposer is retained so it can be
    // removed after the interrupt handler settles.
    if (isInterruptPending) void this.handleInterrupt(listener)
  }

  /**
   * Coalesces competing process-exit requests for this session. Requests made
   * in the same turn retain the highest exit code and every caller observes
   * the same exactly-once exit operation.
   */
  requestExit(host: Pick<ProcessHost, 'exit'>, exitCode: number): Promise<void> {
    this._exitCode = Math.max(this._exitCode ?? exitCode, exitCode)
    this._exitHost ??= host
    this._exitPromise ??= Promise.resolve().then(() => {
      this._exitHost?.exit(this._exitCode ?? exitCode)
    })
    return this._exitPromise
  }

  stop(): Promise<void> {
    // Manual shutdown owns listener disposal immediately. Interrupt-driven
    // shutdown retains the listener until its handler settles so repeated
    // interrupts are coalesced instead of reaching the host's default handler.
    if (this._interruptPromise === undefined) this.disposeInterrupt()
    if (this._stopPromise === undefined) {
      this._state = 'stopping'
      this._stopPromise = Promise.resolve().then(async () => await this.stopOnce())
    }
    return this._stopPromise
  }

  private disposeInterrupt(): void {
    if (!this._hasInterruptBinding || this._isInterruptDisposed) return
    this._isInterruptDisposed = true
    const dispose = this._interruptDisposer
    this._interruptDisposer = undefined
    dispose?.()
  }

  private handleInterrupt(listener: RuntimeInterruptListener): Promise<void> {
    if (this._interruptPromise === undefined) {
      if (this._isInterruptDisposed) return Promise.resolve()
      this._interruptPromise = Promise.resolve()
        .then(async () => await listener())
        .finally(() => this.disposeInterrupt())
    }
    return this._interruptPromise
  }

  private async stopOnce(): Promise<void> {
    try {
      await this._stopDelegate()
      this._state = 'stopped'
    } catch (error) {
      this._stopError = error
      this._state = 'failed'
      throw error
    }
  }
}
