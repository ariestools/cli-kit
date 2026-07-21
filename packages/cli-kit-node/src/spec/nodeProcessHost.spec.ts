import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

const processRuntime = vi.hoisted(() => ({
  argv: ['node', 'application.mjs', '--help'],
  env: { NODE_ENV: 'development' },
  exit: vi.fn<(code: number) => void>(),
  on: vi.fn<(event: string, listener: () => void) => void>(),
  off: vi.fn<(event: string, listener: () => void) => void>(),
  stdin: { isTTY: true },
  stdout: { columns: 120, isTTY: true },
}))

const readlineRuntime = vi.hoisted(() => ({
  close: vi.fn<() => void>(),
  createInterface: vi.fn<(options: unknown) => unknown>(),
  question: vi.fn<(prompt: string) => Promise<string>>(),
}))

vi.mock('node:process', () => ({ default: processRuntime }))
vi.mock('node:readline/promises', () => ({ createInterface: readlineRuntime.createInterface }))

import { nodeProcessHost } from '../nodeProcessHost.ts'

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

  it('registers a disposable SIGINT listener', async () => {
    const listener = vi.fn<() => Promise<void>>().mockResolvedValue()

    const dispose = nodeProcessHost.onInterrupt(listener)

    expect(processRuntime.on).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    const registeredListener = processRuntime.on.mock.calls[0]?.[1]
    expect(registeredListener).toBeDefined()
    registeredListener?.()
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())

    dispose()

    expect(processRuntime.off).toHaveBeenCalledWith('SIGINT', registeredListener)
  })
})
