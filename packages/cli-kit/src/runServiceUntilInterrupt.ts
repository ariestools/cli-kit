import type { ProcessHost } from './ProcessHost.ts'

/** Application-owned cleanup invoked on the first process interrupt. */
export type ServiceStop = () => Promise<void> | void

/**
 * Blocks until the first process interrupt (SIGINT/SIGTERM via the host),
 * disposes the listener, then awaits `stop()`.
 *
 * Resolves once shutdown completes so the caller can drain to a clean exit.
 * Rejects if `stop()` fails so the failure surfaces through the normal exit-code
 * mapper (typically `software`, 70) rather than being reported as success.
 *
 * Use this for long-running command handlers that start a server or actor and
 * should exit only when the operator interrupts the process.
 */
export async function runServiceUntilInterrupt(
  host: Pick<ProcessHost, 'onInterrupt'>,
  stop: ServiceStop,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const dispose = host.onInterrupt(async () => {
      dispose()
      try {
        await stop()
        resolve()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}
