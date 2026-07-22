import PROCESS from 'node:process'
import { createInterface } from 'node:readline/promises'

import type { ProcessHost, ProcessIO } from '@ariestools/cli-kit'

import { loadDotEnvFile, type LoadDotEnvFileOptions } from './loadDotEnvFile.ts'
import { mergeEnvironments, type ProcessEnvironment } from './mergeEnvironments.ts'

const nodeProcessIO: ProcessIO = {
  get columns(): number | undefined {
    return PROCESS.stdout.columns
  },
  get isInteractive(): boolean {
    return PROCESS.stdin.isTTY && PROCESS.stdout.isTTY
  },
  error(...values: readonly unknown[]): void {
    console.error(...values)
  },
  log(...values: readonly unknown[]): void {
    console.log(...values)
  },
  async question(prompt: string): Promise<string> {
    const readline = createInterface({ input: PROCESS.stdin, output: PROCESS.stdout })
    try {
      return await readline.question(prompt)
    } finally {
      readline.close()
    }
  },
  warn(...values: readonly unknown[]): void {
    console.warn(...values)
  },
}

/**
 * Signal name accepted for interrupt binding.
 *
 * A self-contained subset of Node's `NodeJS.Signals` so the public
 * declaration surface stays resolvable in consumers without `@types/node`.
 * Every member is a valid `NodeJS.Signals` value. `SIGUSR1` is deliberately
 * excluded: Node.js reserves it for starting the debugger, and binding a
 * listener to it can interfere with debugger attach.
 */
export type NodeInterruptSignal = 'SIGBREAK' | 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGTERM' | 'SIGUSR2'

/** Signals translated into the structural interrupt contract by default. */
export const DEFAULT_INTERRUPT_SIGNALS: readonly NodeInterruptSignal[] = ['SIGINT', 'SIGTERM']

export interface NodeProcessHostOptions {
  /**
   * Full environment override. When set, `process.env` is not read for
   * {@link ProcessHost.environment} or {@link ProcessHost.isDevelopment}
   * unless the caller passed `process.env` itself.
   */
  readonly environment?: ProcessEnvironment
  /**
   * Values merged under the active environment (`process.env` or
   * {@link environment}). The active environment wins for defined keys, so
   * this is the right place for dotenv file values under non-override
   * semantics. The map is fixed at host construction; the host does not
   * re-read files.
   */
  readonly environmentDefaults?: ProcessEnvironment
  /**
   * Signals bound to interrupt listeners registered through `onInterrupt`.
   * Defaults to {@link DEFAULT_INTERRUPT_SIGNALS} (`SIGINT` and `SIGTERM`).
   * An empty list is honored literally: `onInterrupt` binds nothing, the
   * listener is never invoked, and the returned disposer is a no-op.
   */
  readonly signals?: readonly NodeInterruptSignal[]
}

export interface NodeProcessHostWithDotEnvOptions extends
  NodeProcessHostOptions, LoadDotEnvFileOptions {}

/**
 * Creates a Node.js adapter for the reusable CLI process boundary.
 *
 * Use this factory when interrupt signals must be narrowed or extended, when
 * a custom environment must be supplied, or when dotenv defaults should be
 * merged under the live process environment. Otherwise prefer the shared
 * {@link nodeProcessHost} instance.
 */
export function createNodeProcessHost(options?: NodeProcessHostOptions): ProcessHost {
  const signals = options?.signals ?? DEFAULT_INTERRUPT_SIGNALS
  const environmentOverride = options?.environment
  const environmentDefaults = options?.environmentDefaults

  function resolveEnvironment(): ProcessEnvironment {
    const primary = environmentOverride ?? PROCESS.env
    if (environmentDefaults === undefined) return primary
    return mergeEnvironments(primary, environmentDefaults)
  }

  return {
    get argv(): readonly string[] {
      return PROCESS.argv
    },
    get environment(): ProcessEnvironment {
      return resolveEnvironment()
    },
    exit(code: number): void {
      PROCESS.exit(code)
    },
    get io(): ProcessIO {
      return nodeProcessIO
    },
    get isDevelopment(): boolean {
      return resolveEnvironment().NODE_ENV === 'development'
    },
    onInterrupt(listener: () => Promise<void> | void): () => void {
      const handleInterrupt = (): void => {
        void listener()
      }
      for (const signal of signals) PROCESS.on(signal, handleInterrupt)
      return () => {
        for (const signal of signals) PROCESS.off(signal, handleInterrupt)
      }
    },
  }
}

/**
 * Creates a Node process host that loads a dotenv file as
 * {@link NodeProcessHostOptions.environmentDefaults}.
 *
 * The file is read once at construction. Real process environment values (or
 * an explicit {@link NodeProcessHostOptions.environment} override) win over
 * file values for shared keys. `process.env` is never mutated.
 *
 * ```ts
 * const host = createNodeProcessHostWithDotEnv()
 * // equivalent to:
 * // createNodeProcessHost({ environmentDefaults: loadDotEnvFile() })
 * ```
 */
export function createNodeProcessHostWithDotEnv(
  options: NodeProcessHostWithDotEnvOptions = {},
): ProcessHost {
  const {
    cwd, environment, path, signals,
  } = options
  return createNodeProcessHost({
    environment,
    environmentDefaults: loadDotEnvFile({ cwd, path }),
    signals,
  })
}

/** Node.js adapter for the reusable CLI process boundary. */
export const nodeProcessHost: ProcessHost = createNodeProcessHost()
