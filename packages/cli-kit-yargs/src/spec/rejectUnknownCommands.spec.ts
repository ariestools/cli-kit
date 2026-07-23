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

  // Yargs' default `parse-positional-numbers` configuration coerces a bare
  // numeric token in `argv._` to a JS number, so a stray `0`/`123`/`-5` never
  // arrives as a string. The fixtures below deliberately leave that default
  // enabled: the check must reject a numeric stray without the consumer
  // workaround of `.parserConfiguration({ 'parse-positional-numbers': false })`.
  it.each(['0', '123', '-5'])('rejects the numeric stray positional %s coerced to a number by yargs', async (stray) => {
    const result = fakeHost([stray])
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

    expect(localHandler).not.toHaveBeenCalled()
    expect(mapFailureToExitCode).toHaveBeenCalledOnce()
    expect(mapFailureToExitCode).toHaveBeenCalledWith(expect.any(Error), 'parse')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.[0]).toContain(`Unknown command: ${stray}`)
    expect(result.exits).toEqual([64])
    expect(result.logs).toEqual([])
  })

  it('rejects a numeric stray positional that yargs coerced to the falsy number zero', async () => {
    const result = fakeHost(['0'])
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

    // `0` is both a number (skipped by a `typeof token === 'string'` narrowing)
    // and falsy (lost by a truthiness test), so it is the token most likely to
    // slip through and let the command silently proceed.
    expect(localHandler).not.toHaveBeenCalled()
    expect(result.errors[0]?.[0]).toContain('Unknown command: 0')
    expect(result.exits).toEqual([1])
  })

  // Yargs leaves `populate--` off by default, which merges the tokens after a
  // `--` separator into `argv._` instead of `argv['--']`, so they reach this
  // check like any other leftover token. `--` passthrough was never supported
  // here — the string form was rejected before the numeric widening too — and
  // these pin that it is now uniformly rejected rather than type-dependent.
  it.each(['raw', '5'])('rejects the post-`--` token %s that the default populate-- configuration leaves in argv._', async (token) => {
    const result = fakeHost(['local', '--', token])
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

    expect(result.errors[0]?.[0]).toContain(`Unknown command: ${token}`)
    expect(result.exits).toEqual([1])
  })

  it('leaves post-`--` passthrough tokens untouched once populate-- is enabled', async () => {
    const result = fakeHost(['local', '--', '5', 'raw'])
    const handler = vi.fn()

    await runYargsApplication({
      configure: (parser) => {
        const command: CommandModule = { command: 'local', handler }
        return rejectUnknownCommands(
          parser.scriptName('fixture').parserConfiguration({ 'populate--': true }).command(command),
          [command],
        ).help().version(false)
      },
      host: result.host,
    })

    // The documented escape hatch: `populate--` routes passthrough tokens to
    // `argv['--']`, out of `argv._` and out of this check's reach.
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ '--': [5, 'raw'] })
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([])
  })

  it('runs a matched named command handler to completion before surfacing the flagged exit', async () => {
    const result = fakeHost(['publish', '0'])
    const effects: string[] = []
    const handler = vi.fn(async () => {
      await Promise.resolve()
      effects.push('committed')
    })

    try {
      await runYargsApplication({
        configure: (parser) => {
          const command: CommandModule = { command: 'publish', handler }
          return rejectUnknownCommands(
            parser.scriptName('fixture').command(command),
            [command],
          ).help().version(false)
        },
        host: result.host,
      })
    } catch (error) {
      expectExit(error, 1)
    }

    // The "handler still runs" quirk is NOT scoped to the `$0` default command:
    // a matched named command with a stray token runs too, and `parseAsync`
    // awaits an async handler to completion, so its side effects commit before
    // the parse failure surfaces. Any handler reachable alongside a stray token
    // must be side-effect-free for the flagged exit to stay authoritative.
    expect(handler).toHaveBeenCalledOnce()
    expect(effects).toEqual(['committed'])
    expect(result.errors[0]?.[0]).toContain('Unknown command: 0')
    expect(result.exits).toEqual([1])
  })

  it('rejects a subcommand nested in a parent builder while it is absent from commands', async () => {
    const result = fakeHost(['db', 'migrate'])
    const migrate: CommandModule = { command: 'migrate', handler: vi.fn() }
    const database: CommandModule = {
      builder: command => command.command(migrate),
      command: 'db',
      handler: vi.fn(),
    }

    try {
      await runYargsApplication({
        configure: parser => rejectUnknownCommands(
          parser.scriptName('fixture').command(database),
          [database],
        ).help().version(false),
        host: result.host,
      })
    } catch (error) {
      expectExit(error, 1)
    }

    // Documented constraint: Yargs leaves both tokens in `argv._`, so a nested
    // name missing from the array passed here reads as unknown.
    expect(result.errors[0]?.[0]).toContain('Unknown command: migrate')
    expect(result.exits).toEqual([1])
  })

  it('accepts a nested subcommand once its module is also passed in commands', async () => {
    const result = fakeHost(['db', 'migrate'])
    const migrateHandler = vi.fn()
    const migrate: CommandModule = { command: 'migrate', handler: migrateHandler }
    const database: CommandModule = {
      builder: command => command.command(migrate),
      command: 'db',
      handler: vi.fn(),
    }

    await runYargsApplication({
      configure: parser => rejectUnknownCommands(
        parser.scriptName('fixture').command(database),
        [database, migrate],
      ).help().version(false),
      host: result.host,
    })

    expect(migrateHandler).toHaveBeenCalledOnce()
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([])
  })

  it('skips an empty leftover token and falls through to the $0 default command', async () => {
    const result = fakeHost([''])
    const localHandler = vi.fn()
    const defaultHandler = vi.fn()

    await runYargsApplication({
      configure: configureWith(commandsFor(localHandler, defaultHandler)),
      host: result.host,
    })

    // An empty token names no command and would report as a blank
    // `Unknown command: `, so it is the one exclusion from the widened check.
    expect(defaultHandler).toHaveBeenCalledOnce()
    expect(localHandler).not.toHaveBeenCalled()
    expect(result.errors).toEqual([])
    expect(result.exits).toEqual([])
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

  // The key regression guard for widening the check beyond string tokens: a
  // declared positional given a numeric value must still reach its handler.
  it.each([
    { invoked: '8080', expected: 8080 },
    { invoked: '0', expected: 0 },
  ])('does not flag the numeric declared positional value $invoked as unknown', async ({ invoked, expected }) => {
    const result = fakeHost(['serve', invoked])
    const handler = vi.fn()

    await runYargsApplication({
      configure: (parser) => {
        const command: CommandModule = { command: 'serve <port>', handler }
        return rejectUnknownCommands(
          parser.scriptName('fixture').command(command),
          [command],
        ).help().version(false)
      },
      host: result.host,
    })

    // Yargs consumes the declared `<port>` positional into a named key before
    // the check runs, leaving only the matched command name in `argv._`, so
    // inspecting every token (not just the string ones) stays safe here.
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ port: expected })
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
