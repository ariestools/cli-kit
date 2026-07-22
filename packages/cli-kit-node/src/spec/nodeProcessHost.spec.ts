import fs from 'node:fs'
import os from 'node:os'
import PATH from 'node:path'

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

const processRuntime = vi.hoisted(() => {
  const env: Record<string, string | undefined> = { NODE_ENV: 'development' }
  return {
    argv: ['node', 'application.mjs', '--help'],
    env,
    exit: vi.fn<(code: number) => void>(),
    on: vi.fn<(event: string, listener: () => void) => void>(),
    off: vi.fn<(event: string, listener: () => void) => void>(),
    stdin: { isTTY: true },
    stdout: { columns: 120, isTTY: true },
  }
})

const readlineRuntime = vi.hoisted(() => ({
  close: vi.fn<() => void>(),
  createInterface: vi.fn<(options: unknown) => unknown>(),
  question: vi.fn<(prompt: string) => Promise<string>>(),
}))

vi.mock('node:process', () => ({ default: processRuntime }))
vi.mock('node:readline/promises', () => ({ createInterface: readlineRuntime.createInterface }))

import {
  createNodeProcessHost, createNodeProcessHostWithDotEnv, nodeProcessHost,
} from '../nodeProcessHost.ts'

describe('nodeProcessHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    processRuntime.argv = ['node', 'application.mjs', '--help']
    processRuntime.env = { NODE_ENV: 'development' }
    processRuntime.stdin.isTTY = true
    processRuntime.stdout.columns = 120
    processRuntime.stdout.isTTY = true
    readlineRuntime.question.mockResolvedValue('answer')
    readlineRuntime.createInterface.mockReturnValue({
      close: readlineRuntime.close,
      question: readlineRuntime.question,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reflects live Node process and terminal state', () => {
    expect(nodeProcessHost.argv).toBe(processRuntime.argv)
    expect(nodeProcessHost.environment).toBe(processRuntime.env)
    expect(nodeProcessHost.io.columns).toBe(120)
    expect(nodeProcessHost.io.isInteractive).toBe(true)
    expect(nodeProcessHost.isDevelopment).toBe(true)

    processRuntime.argv = ['node', 'application.mjs', 'start']
    processRuntime.env = { NODE_ENV: 'production' }
    processRuntime.stdin.isTTY = false
    processRuntime.stdout.columns = 80

    expect(nodeProcessHost.argv).toBe(processRuntime.argv)
    expect(nodeProcessHost.environment).toBe(processRuntime.env)
    expect(nodeProcessHost.io.columns).toBe(80)
    expect(nodeProcessHost.io.isInteractive).toBe(false)
    expect(nodeProcessHost.isDevelopment).toBe(false)
  })

  it('uses an explicit environment override instead of process.env', () => {
    const environment = { NODE_ENV: 'production', XL1_FOO: 'override' }
    const host = createNodeProcessHost({ environment })

    expect(host.environment).toBe(environment)
    expect(host.isDevelopment).toBe(false)
  })

  it('merges environmentDefaults under live process.env without mutation', () => {
    processRuntime.env = { NODE_ENV: 'development', SHARED: 'process' }
    const host = createNodeProcessHost({ environmentDefaults: { FROM_FILE: 'file', SHARED: 'file' } })

    expect(host.environment).toEqual({
      FROM_FILE: 'file',
      NODE_ENV: 'development',
      SHARED: 'process',
    })
    expect(processRuntime.env).toEqual({ NODE_ENV: 'development', SHARED: 'process' })

    processRuntime.env = { NODE_ENV: 'production', SHARED: 'later' }
    expect(host.environment).toEqual({
      FROM_FILE: 'file',
      NODE_ENV: 'production',
      SHARED: 'later',
    })
    expect(host.isDevelopment).toBe(false)
  })

  it('loads dotenv defaults through createNodeProcessHostWithDotEnv', () => {
    const cwd = fs.mkdtempSync(PATH.join(os.tmpdir(), 'cli-kit-host-dotenv-'))
    try {
      fs.writeFileSync(PATH.join(cwd, '.env'), 'FROM_FILE=yes\nSHARED=file\n')
      processRuntime.env = { SHARED: 'process' }

      const host = createNodeProcessHostWithDotEnv({ cwd })

      expect(host.environment).toEqual({
        FROM_FILE: 'yes',
        SHARED: 'process',
      })
      expect(processRuntime.env).toEqual({ SHARED: 'process' })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('routes output through the Node console', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => false)
    const log = vi.spyOn(console, 'log').mockImplementation(() => false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => false)

    nodeProcessHost.io.error('error', 1)
    nodeProcessHost.io.log('log', 2)
    nodeProcessHost.io.warn('warn', 3)

    expect(error).toHaveBeenCalledWith('error', 1)
    expect(log).toHaveBeenCalledWith('log', 2)
    expect(warn).toHaveBeenCalledWith('warn', 3)
  })

  it('closes the scoped readline interface after a successful question', async () => {
    await expect(nodeProcessHost.io.question('Continue?')).resolves.toBe('answer')

    expect(readlineRuntime.createInterface).toHaveBeenCalledWith({
      input: processRuntime.stdin,
      output: processRuntime.stdout,
    })
    expect(readlineRuntime.question).toHaveBeenCalledWith('Continue?')
    expect(readlineRuntime.close).toHaveBeenCalledOnce()
  })

  it('closes the scoped readline interface after a failed question', async () => {
    const failure = new Error('input failed')
    readlineRuntime.question.mockRejectedValue(failure)

    await expect(nodeProcessHost.io.question('Continue?')).rejects.toBe(failure)

    expect(readlineRuntime.close).toHaveBeenCalledOnce()
  })

  it('delegates exit requests to the Node process', () => {
    nodeProcessHost.exit(7)

    expect(processRuntime.exit).toHaveBeenCalledWith(7)
  })

  it('registers one disposable listener for both SIGINT and SIGTERM', async () => {
    const listener = vi.fn<() => Promise<void>>().mockResolvedValue()

    const dispose = nodeProcessHost.onInterrupt(listener)

    expect(processRuntime.on).toHaveBeenCalledTimes(2)
    expect(processRuntime.on).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    expect(processRuntime.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    const sigintListener = processRuntime.on.mock.calls[0]?.[1]
    const sigtermListener = processRuntime.on.mock.calls[1]?.[1]
    expect(sigintListener).toBeDefined()
    expect(sigtermListener).toBe(sigintListener)

    sigintListener?.()
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    sigtermListener?.()
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))

    dispose()

    expect(processRuntime.off).toHaveBeenCalledTimes(2)
    expect(processRuntime.off).toHaveBeenCalledWith('SIGINT', sigintListener)
    expect(processRuntime.off).toHaveBeenCalledWith('SIGTERM', sigtermListener)
  })

  it('narrows interrupt binding to the signals supplied to the factory', async () => {
    const host = createNodeProcessHost({ signals: ['SIGINT'] })
    const listener = vi.fn<() => Promise<void>>().mockResolvedValue()

    const dispose = host.onInterrupt(listener)

    expect(processRuntime.on).toHaveBeenCalledOnce()
    expect(processRuntime.on).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    const registeredListener = processRuntime.on.mock.calls[0]?.[1]
    registeredListener?.()
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())

    dispose()

    expect(processRuntime.off).toHaveBeenCalledOnce()
    expect(processRuntime.off).toHaveBeenCalledWith('SIGINT', registeredListener)
  })

  it('binds nothing and disposes nothing when the factory receives no signals', () => {
    const host = createNodeProcessHost({ signals: [] })
    const listener = vi.fn<() => void>()

    const dispose = host.onInterrupt(listener)
    dispose()

    expect(processRuntime.on).not.toHaveBeenCalled()
    expect(processRuntime.off).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })
})
