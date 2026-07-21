import {
  describe, expect, it, vi,
} from 'vitest'

import { type ProcessApplication, runProcessApplication } from '../ProcessApplication.ts'
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
})
