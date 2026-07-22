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

Application code should depend on the `ProcessHost` contract from `@ariestools/cli-kit`. Use this package only at the Node.js composition boundary.

## License

LGPL-3.0-only
