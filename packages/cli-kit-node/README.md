# @ariestools/cli-kit-node

Node.js process adapter for reusable actor command-line applications.

The package supplies `nodeProcessHost`, a production `ProcessHost` backed by the active Node.js process. It exposes arguments and environment values through live getters, routes output through the Node console, creates a scoped readline interface for interactive questions, translates `SIGINT` and `SIGTERM` into the structural interrupt contract, and delegates exit requests to `process.exit`. When the default interrupt signals must be narrowed or extended, `createNodeProcessHost({ signals })` builds a host bound to an explicit signal list; disposal always removes every bound signal listener.

```ts
import { runProcessApplication } from '@ariestools/cli-kit'
import { nodeProcessHost } from '@ariestools/cli-kit-node'

await runProcessApplication({
  application: async (host) => {
    host.io.log('Application started')
  },
  host: nodeProcessHost,
})
```

## Dotenv composition

Prefer loading local `.env` values into the host environment instead of mutating `process.env`. File values act as defaults: defined process environment entries always win.

```ts
import { createNodeProcessHostWithDotEnv } from '@ariestools/cli-kit-node'
import { environmentToYargsConfig, runYargsApplication } from '@ariestools/cli-kit-yargs'

const host = createNodeProcessHostWithDotEnv()
// or explicitly:
// createNodeProcessHost({
//   environmentDefaults: loadDotEnvFile({ path: '.env' }),
// })

await runYargsApplication({
  host,
  configure: parser => parser
    .config(environmentToYargsConfig(host.environment, 'XL1'))
    .scriptName('xl1')
    .help(),
})
```

Helpers:

| Export | Role |
|--------|------|
| `parseDotEnv` | Pure dotenv-format string parser |
| `loadDotEnvFile` | Read a file (missing → `{}`); never mutates `process.env` |
| `mergeEnvironments` | Primary-first merge for env layers |
| `createNodeProcessHostWithDotEnv` | Host with `.env` merged under live `process.env` |

Application code should depend on the `ProcessHost` contract from `@ariestools/cli-kit`. Use this package only at the Node.js composition boundary.

## License

LGPL-3.0-only
