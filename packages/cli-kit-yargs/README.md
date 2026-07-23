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

Two constraints keep the check accurate. The `commands` array must equal the set registered on the parser — the accepted-name set is derived from it, not read back from the parser, so any drift silently rejects a valid command or accepts an unhandled one. And every accepted positional must be declared in its command string (`serve <file>`, `serve [file]`, `serve [files..]`): Yargs consumes declared positionals out of `argv._` before the check runs, but a command that reads ad-hoc positionals it never declared would leave them in `argv._` and see the first rejected as `Unknown command: <value>`.

For an unknown token Yargs runs the failing check first, then still invokes the `$0` default command's handler before surfacing the parse failure, so keep that handler side-effect-free (printing a usage block is the intended shape).

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
