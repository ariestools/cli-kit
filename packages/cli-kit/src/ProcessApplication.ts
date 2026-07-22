import { ProcessExitError, type ProcessHost } from './ProcessHost.ts'

/** Application entry point executed against an explicit process boundary. */
export type ProcessApplication = (host: ProcessHost) => Promise<void>

/**
 * Where an unexpected failure originated.
 *
 * - `'parse'`: argument parsing or validation failed before any command
 *   handler ran (for example a Yargs usage error).
 * - `'handler'`: the app body, command handler, or middleware failed after
 *   arguments were accepted.
 */
export type FailureOrigin = 'handler' | 'parse'

/**
 * Optional application-supplied failure policy. Returning a number selects
 * the exit code for that failure; returning `undefined` retains the default
 * exit code one. The `origin` argument distinguishes parse/validation
 * failures from handler failures so mappers such as `usage` (64) versus
 * `software` (70) need no runner-specific error sniffing. Intentional exits
 * carried by `ProcessExitError` are never offered to the mapper.
 *
 * Results outside the integer range 0–255 (including `NaN`) and errors
 * thrown by the mapper itself fall back to exit code one; the mapper is
 * inside the failure boundary, not above it. Prefer drawing codes from
 * `SYS_EXITS`.
 */
export type FailureExitCodeMapper = (error: unknown, origin: FailureOrigin) => number | undefined

/**
 * Resolves the exit code for an unexpected failure through an optional
 * mapper. A missing mapper, an `undefined` result, a thrown mapper, or a
 * result outside the integer range 0–255 all resolve to the default exit
 * code one, keeping the failure boundary intact.
 */
export function resolveFailureExitCode(
  mapFailureToExitCode: FailureExitCodeMapper | undefined,
  error: unknown,
  origin: FailureOrigin,
): number {
  if (mapFailureToExitCode === undefined) return 1
  try {
    const code = mapFailureToExitCode(error, origin)
    return code !== undefined && Number.isSafeInteger(code) && code >= 0 && code <= 255 ? code : 1
  } catch {
    return 1
  }
}

export interface RunProcessApplicationOptions {
  readonly application: ProcessApplication
  readonly host: ProcessHost
  readonly mapFailureToExitCode?: FailureExitCodeMapper
}

/**
 * Runs one CLI app at the outermost process boundary.
 *
 * Immediate exits requested through `exitProcess` have already been
 * routed to the host and are absorbed here. Unexpected failures retain the
 * established CLI policy of logging details only in development before
 * requesting exit code one, or the code selected by `mapFailureToExitCode`.
 */
export async function runProcessApplication({
  application,
  host,
  mapFailureToExitCode,
}: RunProcessApplicationOptions): Promise<void> {
  try {
    await application(host)
  } catch (error) {
    if (error instanceof ProcessExitError) return
    if (host.isDevelopment) host.io.error('An error occurred during startup:', error)
    host.exit(resolveFailureExitCode(mapFailureToExitCode, error, 'handler'))
  }
}
