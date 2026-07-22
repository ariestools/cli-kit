import { ProcessExitError, type ProcessHost } from '@ariestools/cli-kit'
import {
  describe, expect, it, vi,
} from 'vitest'
import type { ArgumentsCamelCase } from 'yargs'

import { runYargsApplication } from '../runYargsApplication.ts'

interface FakeHostResult {
  readonly errors: unknown[][]
  readonly exits: number[]
  readonly host: ProcessHost
  readonly logs: unknown[][]
}

function fakeHost(arguments_: readonly string[]): FakeHostResult {
  const errors: unknown[][] = []
  const exits: number[] = []
  const logs: unknown[][] = []
  const host: ProcessHost = {
    argv: ['node', 'fixture.mjs', ...arguments_],
    environment: {},
    exit(code: number): void {
      exits.push(code)
    },
    io: {
      error(...values: readonly unknown[]): void {
        errors.push([...values])
      },
      isInteractive: false,
      log(...values: readonly unknown[]): void {
        logs.push([...values])
      },
      question: async () => '',
      warn(...values: readonly unknown[]): void {
        errors.push(['warn', ...values])
      },
    },
    isDevelopment: false,
    onInterrupt: listener => () => {
      void listener
    },
  }
  return {
    errors, exits, host, logs,
  }
}

function expectExit(error: unknown, exitCode: number): void {
  expect(error).toBeInstanceOf(ProcessExitError)
  expect(error).toMatchObject({ exitCode })
}

describe('runYargsApplication', () => {
  it('routes help through the host and exits zero without running a handler', async () => {
    const result = fakeHost(['--help'])
    const handler = vi.fn()

    try {
      await runYargsApplication({
        configure: parser => parser
          .scriptName('fixture')
          .command({ command: ['$0'], handler })
          .help()
          .version('1.2.3'),
        host: result.host,
      })
    } catch (error) {
      expectExit(error, 0)
    }

    expect(handler).not.toHaveBeenCalled()
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([0])
    expect(result.logs).toHaveLength(1)
    expect(result.logs[0]?.[0]).toContain('Show help')
  })

  it('routes version through the host and exits zero', async () => {
    const result = fakeHost(['--version'])

    try {
      await runYargsApplication({
        configure: parser => parser.scriptName('fixture').version('1.2.3'),
        host: result.host,
      })
    } catch (error) {
      expectExit(error, 0)
    }

    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([0])
    expect(result.logs).toEqual([['1.2.3']])
  })

  it('routes validation help and error output through the host before exiting one', async () => {
    const result = fakeHost(['serve'])
    const handler = vi.fn()

    try {
      await runYargsApplication({
        configure: parser => parser
          .scriptName('fixture')
          .command({
            builder: command => command.demandOption('required'),
            command: 'serve',
            handler,
          })
          .help()
          .version(false),
        host: result.host,
      })
    } catch (error) {
      expectExit(error, 1)
    }

    expect(handler).not.toHaveBeenCalled()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.[0]).toContain('fixture serve')
    expect(result.errors[0]?.[0]).toContain('Missing required argument: required')
    expect(result.exits).toEqual([1])
    expect(result.logs).toEqual([])
  })

  it('renders active help and preserves the original rejected handler error', async () => {
    const result = fakeHost(['serve'])
    const failure = new Error('handler failed')

    try {
      await runYargsApplication({
        configure: parser => parser
          .scriptName('fixture')
          .command({
            builder: command => command.option('local', { type: 'string' }),
            command: 'serve',
            handler: async () => {
              throw failure
            },
          })
          .help()
          .version(false),
        host: result.host,
      })
    } catch (error) {
      expectExit(error, 1)
    }

    expect(result.errors).toHaveLength(3)
    expect(result.errors[0]?.[0]).toContain('fixture serve')
    expect(result.errors[0]?.[0]).toContain('--local')
    expect(result.errors[1]).toEqual([])
    expect(result.errors[2]).toEqual([failure])
    expect(result.exits).toEqual([1])
  })

  it('awaits the failure handler before rendering a rejected handler error and exiting', async () => {
    const result = fakeHost(['serve'])
    const failure = new Error('handler failed')
    const onFailure = vi.fn(async (error: unknown) => {
      expect(error).toBe(failure)
      expect(result.errors).toEqual([])
      expect(result.exits).toEqual([])
    })

    try {
      await runYargsApplication({
        configure: parser => parser
          .scriptName('fixture')
          .command({
            command: 'serve',
            handler: async () => {
              throw failure
            },
          })
          .help()
          .version(false),
        host: result.host,
        onFailure,
      })
    } catch (error) {
      expectExit(error, 1)
    }

    expect(onFailure).toHaveBeenCalledOnce()
    expect(result.errors).toHaveLength(3)
    expect(result.errors[2]).toEqual([failure])
    expect(result.exits).toEqual([1])
  })

  it('reports a failure-handler error without replacing the original handler error', async () => {
    const result = fakeHost(['serve'])
    const failure = new Error('handler failed')
    const failureHandlerError = new Error('cleanup failed')

    try {
      await runYargsApplication({
        configure: parser => parser
          .scriptName('fixture')
          .command({
            command: 'serve',
            handler: async () => {
              throw failure
            },
          })
          .help()
          .version(false),
        host: result.host,
        onFailure: async () => {
          throw failureHandlerError
        },
      })
    } catch (error) {
      expectExit(error, 1)
    }

    expect(result.errors).toHaveLength(4)
    expect(result.errors[2]).toEqual([failure])
    expect(result.errors[3]).toEqual(['Error handling application failure:', failureHandlerError])
    expect(result.exits).toEqual([1])
  })

  it('renders active help and preserves the original rejected middleware error', async () => {
    const result = fakeHost(['serve'])
    const failure = new Error('middleware failed')
    const handler = vi.fn()

    try {
      await runYargsApplication({
        configure: parser => parser
          .scriptName('fixture')
          .middleware(async () => {
            throw failure
          })
          .command({ command: 'serve', handler })
          .help()
          .version(false),
        host: result.host,
      })
    } catch (error) {
      expectExit(error, 1)
    }

    expect(handler).not.toHaveBeenCalled()
    expect(result.errors).toHaveLength(3)
    expect(result.errors[0]?.[0]).toContain('fixture serve')
    expect(result.errors[1]).toEqual([])
    expect(result.errors[2]).toEqual([failure])
    expect(result.exits).toEqual([1])
  })

  it('rethrows an intentional process exit without adding parser output or another exit', async () => {
    const result = fakeHost(['stop'])
    const requestedExit = new ProcessExitError(0)
    const onFailure = vi.fn()

    const promise = runYargsApplication({
      configure: parser => parser.command({
        command: 'stop',
        handler: () => {
          result.host.exit(0)
          throw requestedExit
        },
      }),
      host: result.host,
      onFailure,
    })

    await expect(promise).rejects.toBe(requestedExit)
    expect(onFailure).not.toHaveBeenCalled()
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([0])
    expect(result.logs).toEqual([])
  })

  it('exits with the mapper-selected code for a rejected handler error', async () => {
    const result = fakeHost(['serve'])
    const failure = new Error('handler failed')
    const mapFailureToExitCode = vi.fn((error: unknown) => (error === failure ? 70 : undefined))

    try {
      await runYargsApplication({
        configure: parser => parser
          .scriptName('fixture')
          .command({
            command: 'serve',
            handler: async () => {
              throw failure
            },
          })
          .help()
          .version(false),
        host: result.host,
        mapFailureToExitCode,
      })
    } catch (error) {
      expectExit(error, 70)
    }

    expect(mapFailureToExitCode).toHaveBeenCalledOnce()
    expect(mapFailureToExitCode).toHaveBeenCalledWith(failure, 'handler')
    expect(result.errors).toHaveLength(3)
    expect(result.errors[2]).toEqual([failure])
    expect(result.exits).toEqual([70])
  })

  it('routes a parse failure through the mapper while keeping its help output', async () => {
    const result = fakeHost(['serve'])
    const handler = vi.fn()
    const mapFailureToExitCode = vi.fn(() => 64)

    try {
      await runYargsApplication({
        configure: parser => parser
          .scriptName('fixture')
          .command({
            builder: command => command.demandOption('required'),
            command: 'serve',
            handler,
          })
          .help()
          .version(false),
        host: result.host,
        mapFailureToExitCode,
      })
    } catch (error) {
      expectExit(error, 64)
    }

    expect(handler).not.toHaveBeenCalled()
    expect(mapFailureToExitCode).toHaveBeenCalledOnce()
    expect(mapFailureToExitCode).toHaveBeenCalledWith(expect.any(Error), 'parse')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.[0]).toContain('fixture serve')
    expect(result.errors[0]?.[0]).toContain('Missing required argument: required')
    expect(result.exits).toEqual([64])
    expect(result.logs).toEqual([])
  })

  it('retains exit code one when the mapper returns undefined', async () => {
    const result = fakeHost(['serve'])

    try {
      await runYargsApplication({
        configure: parser => parser
          .scriptName('fixture')
          .command({
            command: 'serve',
            handler: async () => {
              throw new Error('handler failed')
            },
          })
          .help()
          .version(false),
        host: result.host,
        mapFailureToExitCode: error => (error instanceof RangeError ? 78 : undefined),
      })
    } catch (error) {
      expectExit(error, 1)
    }

    expect(result.exits).toEqual([1])
  })

  it('retains exit code one and the failure output when the mapper itself throws', async () => {
    const result = fakeHost(['serve'])
    const failure = new Error('handler failed')

    try {
      await runYargsApplication({
        configure: parser => parser
          .scriptName('fixture')
          .command({
            command: 'serve',
            handler: async () => {
              throw failure
            },
          })
          .help()
          .version(false),
        host: result.host,
        mapFailureToExitCode: () => {
          throw new Error('mapper failure')
        },
      })
    } catch (error) {
      expectExit(error, 1)
    }

    expect(result.errors).toHaveLength(3)
    expect(result.errors[2]).toEqual([failure])
    expect(result.exits).toEqual([1])
  })

  it('never offers an intentional process exit to the mapper', async () => {
    const result = fakeHost(['stop'])
    const requestedExit = new ProcessExitError(7)
    const mapFailureToExitCode = vi.fn(() => 78)

    const promise = runYargsApplication({
      configure: parser => parser.command({
        command: 'stop',
        handler: () => {
          result.host.exit(7)
          throw requestedExit
        },
      }),
      host: result.host,
      mapFailureToExitCode,
    })

    await expect(promise).rejects.toBe(requestedExit)
    expect(mapFailureToExitCode).not.toHaveBeenCalled()
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([7])
  })

  it('passes only arguments after the runtime and executable entries', async () => {
    const result = fakeHost(['inspect', '--value', 'kept'])
    let received: ArgumentsCamelCase<{ value?: string }> | undefined

    await runYargsApplication({
      configure: parser => parser.command({
        builder: command => command.option('value', { type: 'string' }),
        command: 'inspect',
        handler: (arguments_) => {
          received = arguments_
        },
      }),
      host: result.host,
    })

    expect(received?._).toEqual(['inspect'])
    expect(received?.value).toBe('kept')
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([])
    expect(result.logs).toEqual([])
  })
})
