import { ProcessExitError, type ProcessHost } from './ProcessHost.ts'

/** Application entry point executed against an explicit process boundary. */
export type ProcessApplication = (host: ProcessHost) => Promise<void>

export interface RunProcessApplicationOptions {
  readonly application: ProcessApplication
  readonly host: ProcessHost
}

/**
 * Runs one CLI app at the outermost process boundary.
 *
 * Immediate exits requested through `exitProcess` have already been
 * routed to the host and are absorbed here. Unexpected failures retain the
 * established CLI policy of logging details only in development before
 * requesting exit code one.
 */
export async function runProcessApplication({
  application,
  host,
}: RunProcessApplicationOptions): Promise<void> {
  try {
    await application(host)
  } catch (error) {
    if (error instanceof ProcessExitError) return
    if (host.isDevelopment) host.io.error('An error occurred during startup:', error)
    host.exit(1)
  }
}
