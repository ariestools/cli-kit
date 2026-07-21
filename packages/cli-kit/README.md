# @ariestools/cli-kit

Reusable, instance-scoped actor lifecycle primitives for command-line applications.

This package is intentionally independent of XL1 and xyo-chain. Application packages supply structural actors that implement `ManagedActor`; the core only coordinates registration, startup, readiness, rollback, and shutdown.

The package also provides structural `ProcessHost` and `ProcessIO` boundaries for adapting an application's concrete process runtime without importing Node APIs into the core. Arguments, environment values, terminal width, output, prompts, interrupts, and exits are all supplied by the host. Use `exitProcess` at exit points that occur before the end of a command: production hosts may terminate immediately, while recording hosts receive a `ProcessExitError` that stops control flow deterministically. `RuntimeSession` owns one application-supplied stop operation and preserves fail-fast shutdown behavior while making repeated stop requests idempotent. It can also own one structural interrupt binding, coalesce repeated interrupts while the application listener settles, and dispose the binding at the correct manual or interrupt-driven shutdown boundary.

`runProcessApplication` owns the outermost application failure boundary. It absorbs standardized exit signals that have already been routed through a `ProcessHost`, hides unexpected error details outside development, and requests exit code one for unhandled failures. Concrete process adapters remain separate packages; Node applications can use `@ariestools/cli-kit-node`.

`createCommandCatalog` registers ordered command factories against a structural `CliApplicationContext`. The command type is supplied by the application, so parser-specific types and domain-specific configuration remain outside the core. A catalog is immutable and reusable; each application invocation materializes fresh command objects with its own context.

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
- Process applications absorb host-routed exits and map unexpected failures to exit code one.
- Command catalogs preserve registration order and reject blank or duplicate ids.
- Command factories receive the exact per-application context and are invoked again for each materialization.

## License

LGPL-3.0-only
