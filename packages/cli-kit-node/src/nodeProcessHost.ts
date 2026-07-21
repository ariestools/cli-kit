import PROCESS from 'node:process'
import { createInterface } from 'node:readline/promises'

import type { ProcessHost, ProcessIO } from '@ariestools/cli-kit'

const nodeProcessIO: ProcessIO = {
  get columns(): number | undefined {
    return PROCESS.stdout.columns
  },
  get isInteractive(): boolean {
    return Boolean(PROCESS.stdin.isTTY && PROCESS.stdout.isTTY)
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

/** Node.js adapter for the reusable CLI process boundary. */
export const nodeProcessHost: ProcessHost = {
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
    PROCESS.on('SIGINT', handleInterrupt)
    return () => {
      PROCESS.off('SIGINT', handleInterrupt)
    }
  },
}
