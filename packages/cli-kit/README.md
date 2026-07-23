# @ariestools/cli-kit

Reusable, instance-scoped actor lifecycle primitives for command-line applications.

This package is intentionally independent of XL1 and xyo-chain. Application packages supply structural actors that implement `ManagedActor`; the core only coordinates registration, startup, readiness, rollback, and shutdown.

The package also provides structural `ProcessHost` and `ProcessIO` boundaries for adapting an application's concrete process runtime without importing Node APIs into the core. Arguments, environment values, terminal width, output, prompts, interrupts, and exits are all supplied by the host. Use `exitProcess` at exit points that occur before the end of a command: production hosts may terminate immediately, while recording hosts receive a `ProcessExitError` that stops control flow deterministically. `RuntimeSession` owns one application-supplied stop operation and preserves fail-fast shutdown behavior while making repeated stop requests idempotent. It can also own one structural interrupt binding, coalesce repeated interrupts while the application listener settles, and dispose the binding at the correct manual or interrupt-driven shutdown boundary.

`runProcessApplication` owns the outermost application failure boundary. It absorbs standardized exit signals that have already been routed through a `ProcessHost`, hides unexpected error details outside development, and requests exit code one for unhandled failures. An optional `mapFailureToExitCode` mapper lets the application select a different exit code per failure; it receives the error plus a `FailureOrigin` (`'parse'` or `'handler'`), returning `undefined` retains the default one, and intentional `ProcessExitError` exits are never offered to the mapper. The mapper stays inside the failure boundary: a mapper that throws, or returns a code outside the integer range 0–255, falls back to exit code one instead of escaping the boundary. Concrete process adapters remain separate packages; Node applications can use `@ariestools/cli-kit-node`.

`SYS_EXITS` supplies the BSD `sysexits.h` exit-code vocabulary used across applications (`ok`, `usage`, `dataErr`, `noInput`, `software`, `ioErr`, `config`), with `SysExitCode` as the derived literal union. Use it with `exitProcess` or a `mapFailureToExitCode` mapper instead of repeating numeric literals.

`createCommandCatalog` registers ordered command factories against a structural `CliApplicationContext`. The command type is supplied by the application, so parser-specific types and domain-specific configuration remain outside the core. A catalog is immutable and reusable; each application invocation materializes fresh command objects with its own context.

`runServiceUntilInterrupt` blocks a long-running command handler until the first host interrupt, disposes the listener, then awaits an application-supplied `stop` cleanup. Use it for serve-style commands that should drain cleanly on SIGINT/SIGTERM.

## Application shell pattern (reference)

The public package [`@xyo-network/lifehash-indexer`](https://github.com/XYOracleNetwork/lifehash/tree/main/packages/indexer) is the golden template for a product CLI on this kit:

1. **Bin / process boundary** — `runProcessApplication` + `createNodeProcessHost` (or `nodeProcessHost`) so the library bundle stays free of process side effects.
2. **Yargs adapter** — `runYargsApplication` with an app-owned `configure*` helper that applies `rejectUnknownCommands`, `.strictOptions()`, help/version, and `host.io.columns` wrapping.
3. **Command catalog** — `createCommandCatalog` over a `CliApplicationContext` that at least carries `host`, so tests inject a recording `ProcessHost` without touching `process`.
4. **Failure policy** — a `FailureExitCodeMapper` that maps parse vs handler failures onto `SYS_EXITS` (`usage` / `config` / `software`, …).
5. **Domain commands** — yargs `CommandModule` factories that take context and never import Node process globals for env/argv/exit.

Sibling shells that follow the same shape include `@xyo-network/webble-cli` and `@xyo-network/webble-dapp`. Actor-heavy CLIs (for example `@xyo-network/xl1-cli-lib`) layer `createActorBuilderCatalog`, `ManagedActor`, and `RuntimeSession` on top of the same process boundary.

## Lifecycle guarantees

- Actors start sequentially in registration order.
- A failed startup rolls back every actor that already started, in reverse order.
- Readiness is observed in registration order with an optional supervisor-wide timeout.
- Shutdown runs in reverse startup order and is idempotent.
- Shutdown attempts every started actor before reporting aggregated failures.
- A runtime session invokes its stop delegate once and shares one stop promise.
- Runtime stop failures retain and rethrow the original value without wrapping.
- A runtime session accepts at most one interrupt binding while active.
- Repeated interrupts share one listener promise and retain the binding until that listener settles.
- Manual shutdown disposes its interrupt binding before cleanup begins.
- Process applications absorb host-routed exits and map unexpected failures to exit code one, or to the code selected by an application-supplied mapper.
- Command catalogs preserve registration order and reject blank or duplicate ids.
- Command factories receive the exact per-application context and are invoked again for each materialization.
- Service-until-interrupt disposes its host listener before stop and surfaces stop failures to the caller.

## License

LGPL-3.0-only
