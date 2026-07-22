import PROCESS from 'node:process'
import { createInterface } from 'node:readline/promises'

import type { ProcessHost, ProcessIO } from '@ariestools/cli-kit'

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
   * Signals bound to interrupt listeners registered through `onInterrupt`.
   * Defaults to {@link DEFAULT_INTERRUPT_SIGNALS} (`SIGINT` and `SIGTERM`).
   * An empty list is honored literally: `onInterrupt` binds nothing, the
   * listener is never invoked, and the returned disposer is a no-op.
   */
  readonly signals?: readonly NodeInterruptSignal[]
}

/**
 * Creates a Node.js adapter for the reusable CLI process boundary.
 *
 * Use this factory only when the default interrupt signals must be narrowed
 * or extended; otherwise prefer the shared {@link nodeProcessHost} instance.
 */
export function createNodeProcessHost(options?: NodeProcessHostOptions): ProcessHost {
  const signals = options?.signals ?? DEFAULT_INTERRUPT_SIGNALS
  return {
    get argv(): readonly string[] {
      return PROCESS.argv
    },
    get environment(): Readonly<Record<string, string | undefined>> {
      return PROCESS.env
    },
    exit(code: number): void {
      PROCESS.exit(code)
    },
    get io(): ProcessIO {
      return nodeProcessIO
    },
    get isDevelopment(): boolean {
      return PROCESS.env.NODE_ENV === 'development'
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

/** Node.js adapter for the reusable CLI process boundary. */
export const nodeProcessHost: ProcessHost = createNodeProcessHost()
