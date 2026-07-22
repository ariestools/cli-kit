import {
  describe, expect, it, vi,
} from 'vitest'

import {
  type FailureExitCodeMapper, type ProcessApplication, resolveFailureExitCode, runProcessApplication,
} from '../ProcessApplication.ts'
import { exitProcess, type ProcessHost } from '../ProcessHost.ts'

interface RecordingHost {
  readonly errors: unknown[][]
  readonly exits: number[]
  readonly host: ProcessHost
}

function recordingHost(isDevelopment: boolean): RecordingHost {
  const errors: unknown[][] = []
  const exits: number[] = []
  return {
    errors,
    exits,
    host: {
      argv: [],
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
          void values
        },
        question: async () => '',
        warn(...values: readonly unknown[]): void {
          void values
        },
      },
      isDevelopment,
      onInterrupt: listener => () => {
        void listener
      },
    },
  }
}

describe('runProcessApplication', () => {
  it('passes the exact host to the application', async () => {
    const recording = recordingHost(false)
    const application = vi.fn<ProcessApplication>().mockResolvedValue(undefined)

    await runProcessApplication({ application, host: recording.host })

    expect(application).toHaveBeenCalledOnce()
    expect(application).toHaveBeenCalledWith(recording.host)
    expect(recording.errors).toEqual([])
    expect(recording.exits).toEqual([])
  })

  it('absorbs an exit already requested through the process host', async () => {
    const recording = recordingHost(true)
    const application: ProcessApplication = async (host) => {
      exitProcess(host, 7)
    }

    await runProcessApplication({ application, host: recording.host })

    expect(recording.errors).toEqual([])
    expect(recording.exits).toEqual([7])
  })

  it('logs an unexpected failure and requests exit one in development', async () => {
    const recording = recordingHost(true)
    const failure = new Error('startup failure')
    const application: ProcessApplication = async () => {
      throw failure
    }

    await runProcessApplication({ application, host: recording.host })

    expect(recording.errors).toEqual([['An error occurred during startup:', failure]])
    expect(recording.exits).toEqual([1])
  })

  it('does not expose unexpected failure details outside development', async () => {
    const recording = recordingHost(false)
    const application: ProcessApplication = async () => {
      throw new Error('startup failure')
    }

    await runProcessApplication({ application, host: recording.host })

    expect(recording.errors).toEqual([])
    expect(recording.exits).toEqual([1])
  })

  it('requests the exit code selected by the failure mapper', async () => {
    const recording = recordingHost(false)
    const failure = new Error('bad configuration')
    const application: ProcessApplication = async () => {
      throw failure
    }
    const mapFailureToExitCode = vi.fn((error: unknown) => (error === failure ? 78 : undefined))

    await runProcessApplication({
      application,
      host: recording.host,
      mapFailureToExitCode,
    })

    expect(mapFailureToExitCode).toHaveBeenCalledOnce()
    expect(mapFailureToExitCode).toHaveBeenCalledWith(failure, 'handler')
    expect(recording.exits).toEqual([78])
  })

  it('retains exit code one when the failure mapper itself throws', async () => {
    const recording = recordingHost(false)
    const application: ProcessApplication = async () => {
      throw new Error('startup failure')
    }

    await runProcessApplication({
      application,
      host: recording.host,
      mapFailureToExitCode: () => {
        throw new Error('mapper failure')
      },
    })

    expect(recording.exits).toEqual([1])
  })

  it('retains exit code one when the failure mapper returns a non-integer code', async () => {
    const recording = recordingHost(false)
    const application: ProcessApplication = async () => {
      throw new Error('startup failure')
    }

    await runProcessApplication({
      application,
      host: recording.host,
      mapFailureToExitCode: () => NaN,
    })

    expect(recording.exits).toEqual([1])
  })

  it('retains exit code one when the failure mapper returns undefined', async () => {
    const recording = recordingHost(false)
    const application: ProcessApplication = async () => {
      throw new Error('unmapped failure')
    }

    await runProcessApplication({
      application,
      host: recording.host,
      mapFailureToExitCode: error => (error instanceof RangeError ? 78 : undefined),
    })

    expect(recording.exits).toEqual([1])
  })

  it('never offers an intentional process exit to the failure mapper', async () => {
    const recording = recordingHost(false)
    const application: ProcessApplication = async (host) => {
      exitProcess(host, 7)
    }
    const mapFailureToExitCode = vi.fn(() => 78)

    await runProcessApplication({
      application,
      host: recording.host,
      mapFailureToExitCode,
    })

    expect(mapFailureToExitCode).not.toHaveBeenCalled()
    expect(recording.exits).toEqual([7])
  })
})

describe('resolveFailureExitCode', () => {
  const failure = new Error('unexpected failure')

  it('resolves to one without a mapper', () => {
    expect(resolveFailureExitCode(undefined, failure, 'handler')).toBe(1)
  })

  it('passes the error and origin to the mapper and returns its code', () => {
    const mapper = vi.fn<FailureExitCodeMapper>(() => 64)

    expect(resolveFailureExitCode(mapper, failure, 'parse')).toBe(64)
    expect(mapper).toHaveBeenCalledOnce()
    expect(mapper).toHaveBeenCalledWith(failure, 'parse')
  })

  it('accepts the boundary codes zero and 255', () => {
    expect(resolveFailureExitCode(() => 0, failure, 'handler')).toBe(0)
    expect(resolveFailureExitCode(() => 255, failure, 'handler')).toBe(255)
  })

  it('resolves to one when the mapper declines', () => {
    const mapper: FailureExitCodeMapper = error => (error instanceof RangeError ? 78 : undefined)

    expect(resolveFailureExitCode(mapper, failure, 'handler')).toBe(1)
  })

  it('resolves to one when the mapper throws', () => {
    const mapper: FailureExitCodeMapper = () => {
      throw new Error('mapper failure')
    }

    expect(resolveFailureExitCode(mapper, failure, 'handler')).toBe(1)
  })

  it.each([
    ['NaN', NaN],
    ['a fractional code', 64.5],
    ['a negative code', -1],
    ['a code above 255', 256],
    ['an unsafe magnitude', Infinity],
  ])('resolves to one for %s', (_label, code) => {
    expect(resolveFailureExitCode(() => code, failure, 'handler')).toBe(1)
  })
})
