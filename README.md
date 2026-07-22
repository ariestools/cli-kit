# @ariestools/cli-kit

Reusable, instance-scoped actor lifecycle primitives for command-line applications.

This monorepo is intentionally independent of XL1 and xyo-chain. Application packages supply structural actors that implement `ManagedActor`; the core only coordinates registration, startup, readiness, rollback, and shutdown.

## Packages

| Package | Description |
|---------|-------------|
| [`@ariestools/cli-kit`](packages/cli-kit) | Core actor lifecycle, process application boundary, command catalog |
| [`@ariestools/cli-kit-node`](packages/cli-kit-node) | Node.js `ProcessHost` adapter, pure dotenv load/merge helpers |
| [`@ariestools/cli-kit-yargs`](packages/cli-kit-yargs) | Yargs adapter routed through `ProcessHost` |

## Install

```sh
pnpm add @ariestools/cli-kit @ariestools/cli-kit-node @ariestools/cli-kit-yargs
```

## Development

```sh
pnpm install
pnpm xy build
pnpm xy test
```

## Migration from `@xyo-network/actor-cli-kit*`

These packages previously lived in [xyo-chain](https://github.com/XYOracleNetwork/xyo-chain) as `@xyo-network/actor-cli-kit`, `@xyo-network/actor-cli-kit-node`, and `@xyo-network/actor-cli-kit-yargs` (versioned with that monorepo). They now publish under `@ariestools/*` starting at **1.0.0**.

Deprecated re-export shims remain in xyo-chain for one release cycle; prefer the `@ariestools/cli-kit*` names for new code.

## License

LGPL-3.0-only
