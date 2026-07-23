import type { Argv, CommandModule } from 'yargs'

function firstToken(entry: string): string | undefined {
  const token = entry.trim().split(/\s+/, 1)[0]
  return token !== undefined && token.length > 0 ? token : undefined
}

function toEntries(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return []
  return typeof value === 'string' ? [value] : value
}

/**
 * Collects the accepted command names (and aliases) declared by a set of
 * command modules. A command declared as `'serve <file>'` contributes `serve`;
 * a `$0` default command contributes `$0`. Aliases are included so an invocation
 * that reaches a command through an alias is not mistaken for an unknown token.
 */
function knownCommandNames(commands: readonly CommandModule[]): ReadonlySet<string> {
  const names = new Set<string>()
  for (const command of commands) {
    for (const entry of toEntries(command.command)) {
      const token = firstToken(entry)
      if (token !== undefined) names.add(token)
    }
    for (const alias of toEntries(command.aliases)) {
      const token = firstToken(alias)
      if (token !== undefined) names.add(token)
    }
  }
  return names
}

/**
 * Rejects any leftover positional token that does not name a registered
 * command, turning `app bogus` into a parse-origin failure (exit 64 via the
 * usage path when a mapper selects it) while leaving a bare invocation, a
 * registered command, and the `help`/`$0` paths untouched.
 *
 * A `$0` default command consumes stray tokens as its own positionals rather
 * than letting `.strictCommands()` flag them — with a default command in place
 * `.strictCommands()` silently accepts an unknown word — so this explicit,
 * command-name-aware `.check()` is what enforces the command surface. Because a
 * matched command name remains in `argv._`, the check compares each token
 * against the names declared by `commands`.
 *
 * Two constraints keep the check accurate; both are the caller's to honor:
 *
 * - `commands` MUST equal the set registered on the parser via `.command(...)`.
 *   The accepted-name set is derived from this array, not read back from the
 *   parser, so any drift is silently wrong: a command registered on the parser
 *   but omitted here has valid invocations rejected as unknown, and one listed
 *   here but never registered lets an unhandled token through. Register and pass
 *   the same array (see the example below) so the two cannot diverge.
 * - Every accepted positional MUST be declared in its command string as
 *   `<arg>`/`[arg]`/`[arg..]`. Yargs consumes declared positionals out of
 *   `argv._` before the check runs, so they are safe; but a command that reads
 *   ad-hoc or variadic positionals it never declared leaves them in `argv._`,
 *   where this check rejects the first as `Unknown command: <value>`.
 *
 * Note: for an unknown token, Yargs runs the failing check first (recording the
 * parse-origin failure) but still invokes the `$0` default command's handler
 * before surfacing that failure. Keep the default command's handler
 * side-effect-free — printing a usage block is the intended shape — so the
 * flagged exit remains authoritative.
 *
 * Apply it after every `.command(...)` registration and before `.help()`:
 *
 * ```ts
 * for (const command of commands) configured = configured.command(command)
 * return rejectUnknownCommands(configured, commands).help().version(version)
 * ```
 */
export function rejectUnknownCommands(parser: Argv, commands: readonly CommandModule[]): Argv {
  const known = knownCommandNames(commands)
  return parser.check((argv) => {
    const unknown = argv._.find(
      (token): token is string => typeof token === 'string' && token.length > 0 && !known.has(token),
    )
    if (unknown !== undefined) throw new Error(`Unknown command: ${unknown}`)
    return true
  })
}
