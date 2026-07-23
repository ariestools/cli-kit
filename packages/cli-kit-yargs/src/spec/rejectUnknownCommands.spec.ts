import { ProcessExitError, type ProcessHost } from '@ariestools/cli-kit'
import {
  describe, expect, it, vi,
} from 'vitest'
import type { CommandModule } from 'yargs'

import { rejectUnknownCommands } from '../rejectUnknownCommands.ts'
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

function commandsFor(localHandler: () => void, defaultHandler: () => void): readonly CommandModule[] {
  const local: CommandModule = {
    builder: command => command.option('port', { type: 'number' }),
    command: 'local',
    handler: localHandler,
  }
  return [
    {
      command: '$0', describe: false, handler: defaultHandler,
    },
    local,
  ]
}

function configureWith(commands: readonly CommandModule[]): (parser: Parameters<typeof rejectUnknownCommands>[0]) => ReturnType<typeof rejectUnknownCommands> {
  return (parser) => {
    let configured = parser.scriptName('fixture')
    for (const command of commands) configured = configured.command(command)
    return rejectUnknownCommands(configured, commands).help().version(false)
  }
}

describe('rejectUnknownCommands', () => {
  it('rejects an unknown command as a parse-origin failure routed through the mapper', async () => {
    const result = fakeHost(['bogus'])
    const localHandler = vi.fn()
    const defaultHandler = vi.fn()
    const mapFailureToExitCode = vi.fn((_error: unknown, origin: 'handler' | 'parse') => (origin === 'parse' ? 64 : undefined))

    try {
      await runYargsApplication({
        configure: configureWith(commandsFor(localHandler, defaultHandler)),
        host: result.host,
        mapFailureToExitCode,
      })
    } catch (error) {
      expectExit(error, 64)
    }

    // The wrong named command must not run; Yargs still invokes the `$0`
    // default handler before surfacing the flagged parse failure (documented).
    // This assertion guards that quirk so adopters keep their `$0` handler
    // side-effect-free — the flagged exit stays authoritative regardless.
    expect(localHandler).not.toHaveBeenCalled()
    expect(defaultHandler).toHaveBeenCalledOnce()
    expect(mapFailureToExitCode).toHaveBeenCalledOnce()
    expect(mapFailureToExitCode).toHaveBeenCalledWith(expect.any(Error), 'parse')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.[0]).toContain('Unknown command: bogus')
    expect(result.exits).toEqual([64])
    expect(result.logs).toEqual([])
  })

  it('defaults an unknown command to exit one without a mapper', async () => {
    const result = fakeHost(['bogus'])
    const localHandler = vi.fn()
    const defaultHandler = vi.fn()

    try {
      await runYargsApplication({
        configure: configureWith(commandsFor(localHandler, defaultHandler)),
        host: result.host,
      })
    } catch (error) {
      expectExit(error, 1)
    }

    expect(result.errors[0]?.[0]).toContain('Unknown command: bogus')
    expect(result.exits).toEqual([1])
  })

  it('runs a registered command and its options without treating the command name as unknown', async () => {
    const result = fakeHost(['local', '--port', '3000'])
    const localHandler = vi.fn()
    const defaultHandler = vi.fn()

    await runYargsApplication({
      configure: configureWith(commandsFor(localHandler, defaultHandler)),
      host: result.host,
    })

    expect(localHandler).toHaveBeenCalledOnce()
    expect(localHandler.mock.calls[0]?.[0]).toMatchObject({ port: 3000 })
    expect(defaultHandler).not.toHaveBeenCalled()
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([])
  })

  it('leaves the $0 default command path untouched for a bare invocation', async () => {
    const result = fakeHost([])
    const localHandler = vi.fn()
    const defaultHandler = vi.fn()

    await runYargsApplication({
      configure: configureWith(commandsFor(localHandler, defaultHandler)),
      host: result.host,
    })

    expect(defaultHandler).toHaveBeenCalledOnce()
    expect(localHandler).not.toHaveBeenCalled()
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([])
  })

  it('leaves the help path untouched and exits zero', async () => {
    const result = fakeHost(['--help'])
    const localHandler = vi.fn()
    const defaultHandler = vi.fn()

    try {
      await runYargsApplication({
        configure: configureWith(commandsFor(localHandler, defaultHandler)),
        host: result.host,
      })
    } catch (error) {
      expectExit(error, 0)
    }

    expect(localHandler).not.toHaveBeenCalled()
    expect(defaultHandler).not.toHaveBeenCalled()
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([0])
    expect(result.logs).toHaveLength(1)
    expect(result.logs[0]?.[0]).toContain('Show help')
  })

  it('does not flag a declared positional argument of a registered command as unknown', async () => {
    const result = fakeHost(['serve', 'config.json'])
    const handler = vi.fn()

    await runYargsApplication({
      configure: (parser) => {
        const command: CommandModule = { command: 'serve <file>', handler }
        return rejectUnknownCommands(
          parser.scriptName('fixture').command(command),
          [command],
        ).help().version(false)
      },
      host: result.host,
    })

    // Yargs consumes the declared `<file>` positional out of `argv._`, so the
    // check sees only the command name and does not reject the argument value.
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ file: 'config.json' })
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([])
  })

  it('reaches a command through an alias without flagging the alias as unknown', async () => {
    const result = fakeHost(['l'])
    const handler = vi.fn()

    await runYargsApplication({
      configure: (parser) => {
        const command: CommandModule = {
          aliases: ['l'], command: 'local', handler,
        }
        return rejectUnknownCommands(
          parser.scriptName('fixture').command(command),
          [command],
        ).help().version(false)
      },
      host: result.host,
    })

    expect(handler).toHaveBeenCalledOnce()
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([])
  })
})
