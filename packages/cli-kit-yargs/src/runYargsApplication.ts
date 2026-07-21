import {
  exitProcess, ProcessExitError, type ProcessHost,
} from '@ariestools/cli-kit'
import type { Argv } from 'yargs'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

export interface RunYargsApplicationOptions {
  readonly configure: (parser: Argv) => Argv
  readonly host: ProcessHost
  readonly onFailure?: (error: unknown) => Promise<void> | void
}

interface CapturedParseOutput {
  error: Error | undefined
  output: string
}

interface FailureHandlerResult {
  readonly error?: unknown
  readonly hasError: boolean
}

async function invokeFailureHandler(
  handler: RunYargsApplicationOptions['onFailure'],
  error: unknown,
): Promise<FailureHandlerResult> {
  try {
    await handler?.(error)
    return { hasError: false }
  } catch (failureHandlerError) {
    return { error: failureHandlerError, hasError: true }
  }
}

function reportFailureHandlerError(host: ProcessHost, result: FailureHandlerResult): void {
  if (result.hasError) host.io.error('Error handling application failure:', result.error)
}

/**
 * Runs a configured Yargs application through the supplied process boundary.
 * Yargs' parse callback prevents its default console and process.exit calls;
 * the adapter then routes the equivalent output and exit through ProcessHost.
 */
export async function runYargsApplication({
  configure,
  host,
  onFailure,
}: RunYargsApplicationOptions): Promise<void> {
  const applicationArguments = hideBin([...host.argv])
  const parser = configure(yargs(applicationArguments))
  const captured: CapturedParseOutput = { error: undefined, output: '' }

  try {
    await parser.parseAsync(applicationArguments, {}, (error, _argv, output) => {
      // Yargs 18 reports `null` on success at runtime despite @types/yargs
      // declaring this callback value as `Error | undefined`.
      captured.error = error ?? undefined
      captured.output = output
    })
  } catch (error) {
    if (error instanceof ProcessExitError) throw error
    const failureHandlerResult = await invokeFailureHandler(onFailure, error)
    host.io.error(await parser.getHelp())
    host.io.error()
    host.io.error(error)
    reportFailureHandlerError(host, failureHandlerResult)
    exitProcess(host, 1)
  }

  if (captured.error !== undefined) {
    const failureHandlerResult = await invokeFailureHandler(onFailure, captured.error)
    if (captured.output.length > 0) {
      host.io.error(captured.output)
    } else {
      host.io.error(captured.error)
    }
    reportFailureHandlerError(host, failureHandlerResult)
    exitProcess(host, 1)
  }

  if (captured.output.length > 0) {
    host.io.log(captured.output)
    exitProcess(host, 0)
  }
}
