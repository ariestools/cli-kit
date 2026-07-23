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
 * Every non-empty leftover token is inspected regardless of its runtime type.
 * Yargs types `argv._` as `(string | number)[]` and, with its default
 * `parse-positional-numbers` enabled, coerces a bare numeric token to a JS
 * number — so `app 0`, `app 123`, and `app -5` are rejected as
 * `Unknown command: 0` (and so on) rather than slipping through. Consumers do
 * not need `.parserConfiguration({ 'parse-positional-numbers': false })` to get
 * a numeric stray flagged. Two details of that normalization:
 *
 * - The message echoes the coerced value rather than the raw text, so an exotic
 *   numeric literal is reported in its normalized form: `1e3` reads
 *   `Unknown command: 1000`, `0x10` reads `16`, and `1.50` reads `1.5`. The
 *   token is rejected correctly in every case; only the echoed text differs.
 *   Yargs has already coerced by the time a `.check()` runs, so the raw text is
 *   not recoverable here.
 * - An empty token (`app ""`) is skipped, because it names no command and would
 *   report as a blank `Unknown command: `. It falls through to `$0` as before.
 *
 * Four constraints keep the check accurate; all are the caller's to honor:
 *
 * - `commands` MUST equal the set registered on the parser via `.command(...)`.
 *   The accepted-name set is derived from this array, not read back from the
 *   parser, so any drift is silently wrong: a command registered on the parser
 *   but omitted here has valid invocations rejected as unknown, and one listed
 *   here but never registered lets an unhandled token through. Register and pass
 *   the same array (see the example below) so the two cannot diverge.
 * - Every accepted positional MUST be declared in its command string as
 *   `<arg>`/`[arg]`/`[arg..]`. Yargs consumes declared positionals out of
 *   `argv._` into named keys before the check runs — including numeric-valued
 *   ones, so `serve <port>` invoked as `serve 8080` is safe — but a command that
 *   reads ad-hoc or variadic positionals it never declared leaves them in
 *   `argv._`, where this check rejects the first as `Unknown command: <value>`.
 * - A subcommand registered inside a parent command's `builder` MUST also appear
 *   in `commands`. Yargs leaves both tokens in `argv._` (`db migrate` yields
 *   `['db', 'migrate']`), so a nested name absent from this array is rejected as
 *   `Unknown command: migrate`. Passing the nested modules alongside the
 *   top-level ones fixes that, at the cost of a flat accepted-name set: the
 *   nested name is then also accepted at the top level, where it falls through
 *   to `$0`.
 * - Tokens after a `--` separator are NOT passthrough unless the caller enables
 *   `.parserConfiguration({ 'populate--': true })`. Yargs leaves `populate--`
 *   off by default, which merges those tokens into `argv._` rather than
 *   `argv['--']`, so `app local -- raw` is rejected as `Unknown command: raw`
 *   (and `app local -- 5` as `Unknown command: 5`). Enabling `populate--` routes
 *   them to `argv['--']`, out of `argv._` and out of this check's reach.
 *
 * Note: for an unknown token, Yargs runs the failing check first (recording the
 * parse-origin failure) but still invokes the matched command's handler before
 * surfacing that failure — the `$0` default command for a bare stray token, and
 * the named command for `app publish 0`. `parseAsync` awaits an async handler to
 * completion, so its side effects commit before the flagged exit. Keep handlers
 * that can be reached alongside a stray token side-effect-free — for `$0`,
 * printing a usage block is the intended shape — so the flagged exit remains
 * authoritative.
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
    // `argv._` is `(string | number)[]`: with Yargs' default
    // `parse-positional-numbers` a bare numeric token is coerced to a JS number,
    // so every token is normalized to its string form before comparison.
    // Narrowing to `typeof token === 'string'` here would skip numeric strays
    // entirely and let the command silently proceed. The empty token is the one
    // exclusion: it names no command and would report as a blank message.
    const unknown = argv._.map(String).find(token => token.length > 0 && !known.has(token))
    if (unknown !== undefined) throw new Error(`Unknown command: ${unknown}`)
    return true
  })
}
