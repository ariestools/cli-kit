# @ariestools/cli-kit-yargs

Yargs adapter for reusable actor command-line applications.

The package keeps Yargs out of `@ariestools/cli-kit` while routing parser help, version, validation errors, asynchronous failures, and exits through the core `ProcessHost` boundary. This makes a configured CLI safe to exercise with a recording host instead of allowing Yargs to write to the ambient console or terminate the test process.

`runYargsApplication` accepts an optional `mapFailureToExitCode` mapper applied to parser and handler failures alike: the mapper receives the failure origin (`'parse'` for validation failures, `'handler'` for handler or middleware rejections), returning a number selects the exit code, `undefined` retains the default exit code one. A mapper that throws, or returns a code outside the integer range 0–255, falls back to exit code one. Intentional `ProcessExitError` exits pass through untouched.

Failure output is scoped by that same origin. A **parse-origin** failure (a Yargs validation or usage error, including one raised by `rejectUnknownCommands`) still prints the usage/help block, because the caller mis-invoked the CLI. A **handler-origin** failure (a thrown command handler or middleware — for example a mapped configuration error that exits `78`) prints the raw error to stderr, including its stack when present, with no usage dump. Production keeps full diagnostics so fatal handler failures remain diagnosable; only the noisy usage block is suppressed. The exit code and `mapFailureToExitCode` contract are unchanged; only what is printed per origin differs.

## Rejecting unknown commands

`.strictCommands()` cannot flag an unknown command once a `$0` default command is registered — the default command consumes the stray token as a positional and Yargs accepts it silently. `rejectUnknownCommands(parser, commands)` closes that gap with a `.check()` that compares each leftover positional against the command names (and aliases) declared by `commands`, throwing a parse-origin `Unknown command: <token>` for anything unrecognized. A bare invocation, a registered command with its options, and the `help`/`$0` paths are left untouched. Apply it after every `.command(...)` registration and before `.help()`, passing the same array you registered:

```ts
import { rejectUnknownCommands, runYargsApplication } from '@ariestools/cli-kit-yargs'

await runYargsApplication({
  host,
  mapFailureToExitCode: (_error, origin) => (origin === 'parse' ? 64 : undefined),
  configure: (parser) => {
    let configured = parser.scriptName('app')
    for (const command of commands) configured = configured.command(command)
    return rejectUnknownCommands(configured, commands).help().version(version)
  },
})
```

Every non-empty leftover token is inspected regardless of its runtime type. Yargs types `argv._` as `(string | number)[]` and, with its default `parse-positional-numbers` enabled, coerces a bare numeric token to a JS number — so `app 0`, `app 123`, and `app -5` are flagged as `Unknown command: 0` (and so on) just like a word. No `.parserConfiguration({ 'parse-positional-numbers': false })` workaround is needed to catch a numeric stray. The message echoes the coerced value rather than the raw text, so an exotic numeric literal is reported normalized — `1e3` reads `Unknown command: 1000`, `0x10` reads `16`, `1.50` reads `1.5` — because Yargs has already coerced by the time a `.check()` runs. Rejection is correct in every case; only the echoed text differs. An empty token (`app ""`) is the one exclusion: it names no command and falls through to `$0`.

Four constraints keep the check accurate.

- The `commands` array must equal the set registered on the parser — the accepted-name set is derived from it, not read back from the parser, so any drift silently rejects a valid command or accepts an unhandled one.
- Every accepted positional must be declared in its command string (`serve <file>`, `serve [file]`, `serve [files..]`): Yargs consumes declared positionals out of `argv._` into named keys before the check runs — including numeric-valued ones, so `serve <port>` invoked as `serve 8080` is unaffected — but a command that reads ad-hoc positionals it never declared would leave them in `argv._` and see the first rejected as `Unknown command: <value>`.
- A subcommand registered inside a parent command's `builder` must also appear in `commands`. Yargs leaves both tokens in `argv._` (`db migrate` yields `['db', 'migrate']`), so a nested name missing from the array is rejected as `Unknown command: migrate`. Passing the nested modules alongside the top-level ones fixes that, at the cost of a flat accepted-name set: the nested name is then also accepted at the top level, where it falls through to `$0`.
- Tokens after a `--` separator are not passthrough unless the caller enables `.parserConfiguration({ 'populate--': true })`. Yargs leaves `populate--` off by default, which merges those tokens into `argv._` rather than `argv['--']`, so `app local -- raw` is rejected as `Unknown command: raw` (and `app local -- 5` as `Unknown command: 5`). Enabling `populate--` routes them to `argv['--']`, out of `argv._` and out of this check's reach.

For an unknown token Yargs runs the failing check first, then still invokes the matched command's handler before surfacing the parse failure — the `$0` default command for a bare stray token, and the named command for `app publish 0`. `parseAsync` awaits an async handler to completion, so its side effects commit before the flagged exit. Keep any handler reachable alongside a stray token side-effect-free (for `$0`, printing a usage block is the intended shape).

Use `environmentToYargsConfig` when an application owns config-file loading and wants to replace Yargs' process-global `.env()` lookup with an explicitly supplied environment. The resulting flat dotted object preserves Yargs' environment key normalization and can be passed to `.config()` before parsing:

```ts
import { createNodeProcessHostWithDotEnv } from '@ariestools/cli-kit-node'
import { environmentToYargsConfig, runYargsApplication } from '@ariestools/cli-kit-yargs'

const host = createNodeProcessHostWithDotEnv()

await runYargsApplication({
  host,
  configure: parser => parser
    .config(environmentToYargsConfig(host.environment, 'XL1'))
    .scriptName('xl1')
    .command(commands)
    .help()
    .version(version),
})
```

Load dotenv files through `@ariestools/cli-kit-node` (`loadDotEnvFile` / `createNodeProcessHostWithDotEnv`) so values reach `host.environment` without mutating `process.env`. This conversion preserves command-line-over-environment precedence, but it is not a general substitute for Yargs-native config-file options: Yargs ranks config objects below config files, and treats a top-level `extends` key in a config object specially. Such applications should resolve those precedence and reserved-key rules before passing the object to `.config()`.

## License

LGPL-3.0-only
