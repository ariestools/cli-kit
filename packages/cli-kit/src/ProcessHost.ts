/** Process-facing input and output used by a command-line app. */
export interface ProcessIO {
  /** Available terminal width when output is attached to a sized terminal. */
  readonly columns?: number
  readonly isInteractive: boolean
  error(...values: readonly unknown[]): void
  log(...values: readonly unknown[]): void
  question(prompt: string): Promise<string>
  warn(...values: readonly unknown[]): void
}

/** Control-flow signal used when a non-terminating host records an immediate exit. */
export class ProcessExitError extends Error {
  readonly exitCode: number

  constructor(exitCode: number) {
    super(`Process requested exit with code ${exitCode}`)
    this.name = 'ProcessExitError'
    this.exitCode = exitCode
  }
}

/**
 * Structural process boundary for a command-line app.
 *
 * Production implementations may terminate from {@link exit}; recording hosts
 * may return after retaining the requested status.
 */
export interface ProcessHost {
  /** Full argument vector, including the executable and script entries. */
  readonly argv: readonly string[]
  /** Environment visible to this app invocation. */
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly io: ProcessIO
  readonly isDevelopment: boolean
  exit(code: number): void
  onInterrupt(listener: () => Promise<void> | void): () => void
}

/**
 * Requests immediate process termination and prevents a recording host from
 * accidentally continuing through code that follows the exit point.
 */
export function exitProcess(host: Pick<ProcessHost, 'exit'>, exitCode: number): never {
  host.exit(exitCode)
  throw new ProcessExitError(exitCode)
}
