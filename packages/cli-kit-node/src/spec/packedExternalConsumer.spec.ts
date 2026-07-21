import CHILD_PROCESS from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import PATH from 'node:path'
import { fileURLToPath } from 'node:url'
import ZLIB from 'node:zlib'

import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest'

interface PackageUnderTest {
  readonly name: string
  readonly root: string
}

interface PackedPackage {
  readonly filename: string
  readonly manifest: PackedPackageManifest
  readonly name: string
}

interface PackedPackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly name: string
  readonly version: string
}

const specDirectory = PATH.dirname(fileURLToPath(import.meta.url))
const nodePackageRoot = PATH.resolve(specDirectory, '../..')
const repoRoot = PATH.resolve(nodePackageRoot, '../..')
const packages: readonly PackageUnderTest[] = [
  { name: '@ariestools/cli-kit', root: PATH.join(repoRoot, 'packages/cli-kit') },
  { name: '@ariestools/cli-kit-node', root: nodePackageRoot },
  { name: '@ariestools/cli-kit-yargs', root: PATH.join(repoRoot, 'packages/cli-kit-yargs') },
]

function assertCommandSucceeded(
  description: string,
  result: CHILD_PROCESS.SpawnSyncReturns<string>,
): void {
  if (result.error === undefined && result.status === 0) return
  throw new Error([
    `${description} failed.`,
    result.stdout.trim(),
    result.stderr.trim(),
    result.error?.message ?? '',
  ].filter(Boolean).join('\n'))
}

function cleanDirectory(directory: string | undefined): void {
  if (directory !== undefined) fs.rmSync(directory, { recursive: true, force: true })
}

function readTarString(header: Uint8Array, offset: number, length: number): string {
  const bytes = header.subarray(offset, offset + length)
  const terminator = bytes.indexOf(0)
  return Buffer.from(terminator === -1 ? bytes : bytes.subarray(0, terminator)).toString('utf8')
}

function parsePackedManifest(value: unknown, filename: string): PackedPackageManifest {
  if (
    typeof value !== 'object'
    || value === null
    || !('name' in value)
    || typeof value.name !== 'string'
    || !('version' in value)
    || typeof value.version !== 'string'
  ) {
    throw new Error(`Packed package has an invalid package.json: ${filename}`)
  }
  if ('dependencies' in value && value.dependencies !== undefined) {
    if (typeof value.dependencies !== 'object' || value.dependencies === null) {
      throw new Error(`Packed package has invalid dependencies: ${filename}`)
    }
    for (const [name, version] of Object.entries(value.dependencies)) {
      if (typeof version !== 'string') {
        throw new TypeError(`Packed package has an invalid dependency version for ${name}: ${filename}`)
      }
    }
  }
  return value as PackedPackageManifest
}

function readPackedManifest(filename: string): PackedPackageManifest {
  const archive = ZLIB.gunzipSync(fs.readFileSync(filename))
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const path = prefix.length > 0 ? `${prefix}/${name}` : name
    const sizeText = readTarString(header, 124, 12).trim()
    const size = Number.parseInt(sizeText, 8)
    if (!Number.isFinite(size)) throw new Error(`Packed package has an invalid tar entry size: ${filename}`)
    const contentOffset = offset + 512
    if (path === 'package/package.json') {
      const content = archive.subarray(contentOffset, contentOffset + size).toString('utf8')
      return parsePackedManifest(JSON.parse(content), filename)
    }
    offset = contentOffset + (Math.ceil(size / 512) * 512)
  }
  throw new Error(`Packed package does not contain package/package.json: ${filename}`)
}

function assertPackedCoreDependency(package_: PackedPackage, coreVersion: string): void {
  const expected = `~${coreVersion}`
  const actual = package_.manifest.dependencies?.['@ariestools/cli-kit']
  if (actual !== expected) {
    throw new Error(`${package_.name} must pack @ariestools/cli-kit as ${expected}; received ${String(actual)}`)
  }
}

function packPackage(package_: PackageUnderTest, packDirectory: string): PackedPackage {
  const result = CHILD_PROCESS.spawnSync(
    'pnpm',
    ['pack', '--json', '--pack-destination', packDirectory],
    {
      cwd: package_.root,
      encoding: 'utf8',
      timeout: 60_000,
    },
  )
  assertCommandSucceeded(`Packing ${package_.name}`, result)

  const value: unknown = JSON.parse(result.stdout)
  if (
    typeof value !== 'object'
    || value === null
    || !('filename' in value)
    || typeof value.filename !== 'string'
    || !('name' in value)
    || typeof value.name !== 'string'
  ) {
    throw new Error(`pnpm pack returned an invalid result for ${package_.name}`)
  }
  if (value.name !== package_.name) {
    throw new Error(`pnpm pack returned ${value.name} while packing ${package_.name}`)
  }
  if (!fs.existsSync(value.filename)) {
    throw new Error(`pnpm pack did not create ${value.filename}`)
  }
  const manifest = readPackedManifest(value.filename)
  if (manifest.name !== package_.name) {
    throw new Error(`Packed manifest contains ${manifest.name} while packing ${package_.name}`)
  }
  return {
    filename: value.filename, manifest, name: value.name,
  }
}

function assertPackagesBuilt(): void {
  for (const package_ of packages) {
    const builtEntries = ['dist/node/index.mjs', 'dist/node/index.d.ts']
      .map(entry => PATH.join(package_.root, entry))
    for (const builtEntry of builtEntries) {
      if (!fs.existsSync(builtEntry)) {
        throw new Error(
          `Missing ${builtEntry}. Run \`pnpm xy compile ${package_.name}\` first.`,
        )
      }
    }
    const oldestBuiltAt = Math.min(...builtEntries.map(entry => fs.statSync(entry).mtimeMs))
    const newestSourceAt = newestPublishedSourceModification(PATH.join(package_.root, 'src'))
    if (newestSourceAt > oldestBuiltAt) {
      throw new Error(`Stale build output for ${package_.name}. Run \`pnpm xy compile ${package_.name}\` first.`)
    }
  }
}

function newestPublishedSourceModification(directory: string): number {
  let newest = 0
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name !== 'spec') {
        newest = Math.max(newest, newestPublishedSourceModification(PATH.join(directory, entry.name)))
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.spec.')) {
      newest = Math.max(newest, fs.statSync(PATH.join(directory, entry.name)).mtimeMs)
    }
  }
  return newest
}

function assertPackedAdapterDependencies(packedPackages: readonly PackedPackage[]): string {
  const packageByName = new Map(packedPackages.map(package_ => [package_.name, package_]))
  const corePackage = packageByName.get('@ariestools/cli-kit')
  if (corePackage === undefined) throw new Error('The packed core CLI kit tarball was not created')
  const nodePackage = packageByName.get('@ariestools/cli-kit-node')
  const yargsPackage = packageByName.get('@ariestools/cli-kit-yargs')
  if (nodePackage === undefined || yargsPackage === undefined) {
    throw new Error('The packed CLI kit adapter tarballs were not created')
  }
  assertPackedCoreDependency(nodePackage, corePackage.manifest.version)
  assertPackedCoreDependency(yargsPackage, corePackage.manifest.version)
  return corePackage.filename
}

function runConsumerCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  timeout: number,
): CHILD_PROCESS.SpawnSyncReturns<string> {
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== 'NO_COLOR'),
  )
  return CHILD_PROCESS.spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...inheritedEnvironment,
      npm_config_link_workspace_packages: 'false',
      npm_config_node_linker: 'isolated',
      npm_config_prefer_workspace_packages: 'false',
    },
    timeout,
  })
}

const runtimeSource = `import {
  RuntimeSession,
  createActorBuilderCatalog,
  createCommandCatalog,
} from '@ariestools/cli-kit'
import { nodeProcessHost } from '@ariestools/cli-kit-node'
import {
  environmentToYargsConfig,
  runYargsApplication,
} from '@ariestools/cli-kit-yargs'

const errors = []
const exits = []
const logs = []
let parsedValue
const host = {
  argv: ['node', 'consumer.mjs', 'inspect', '--value', 'packed'],
  environment: {},
  exit(code) {
    exits.push(code)
  },
  io: {
    error(...values) {
      errors.push(values)
    },
    isInteractive: false,
    log(...values) {
      logs.push(values)
    },
    async question() {
      return ''
    },
    warn(...values) {
      errors.push(values)
    },
  },
  isDevelopment: false,
  onInterrupt() {
    return () => undefined
  },
}

const catalog = createCommandCatalog([{
  create: context => context.label + ':' + context.host.argv.at(-1),
  id: 'status',
}])
const commands = catalog.createCommands({ host, label: 'core' })
if (catalog.ids.join(',') !== 'status' || commands.join(',') !== 'core:packed') {
  throw new Error('Core command catalog contract failed')
}

const actorCatalog = createActorBuilderCatalog([{
  name: 'fixture',
  build: async context => 'actor:' + context.label,
}])
const actor = await actorCatalog.build('fixture', { label: 'packed' })
if (actorCatalog.names.join(',') !== 'fixture' || actor !== 'actor:packed') {
  throw new Error('Core actor builder catalog contract failed')
}

let stopCount = 0
const session = new RuntimeSession(() => {
  stopCount += 1
})
await Promise.all([session.stop(), session.stop()])
if (session.state !== 'stopped' || stopCount !== 1) {
  throw new Error('Core runtime session contract failed')
}
const sessionExits = []
const sessionExitHost = { exit: code => sessionExits.push(code) }
await Promise.all([
  session.requestExit(sessionExitHost, 0),
  session.requestExit(sessionExitHost, 1),
])
if (sessionExits.join(',') !== '1') {
  throw new Error('Core runtime exit coalescing contract failed')
}

if (nodeProcessHost.argv !== process.argv || nodeProcessHost.environment !== process.env) {
  throw new Error('Node process adapter did not reflect the active process')
}
const disposeInterrupt = nodeProcessHost.onInterrupt(() => undefined)
disposeInterrupt()

const environment = environmentToYargsConfig({
  OTHER_VALUE: 'ignored',
  PACKED_ACTORS__0__ACCOUNT_PATH: '7',
}, 'PACKED')
if (environment['actors.0.accountPath'] !== '7' || Object.keys(environment).length !== 1) {
  throw new Error('Yargs environment adapter contract failed')
}

await runYargsApplication({
  configure: parser => parser
    .scriptName('packed-consumer')
    .command({
      builder: command => command.option('value', { demandOption: true, type: 'string' }),
      command: 'inspect',
      handler: arguments_ => {
        parsedValue = arguments_.value
      },
    })
    .strict()
    .version(false),
  host,
})
if (parsedValue !== 'packed' || errors.length !== 0 || exits.length !== 0 || logs.length !== 0) {
  throw new Error('Yargs application adapter contract failed')
}

console.log('actor CLI kit packed consumer ok')
`

const declarationSource = `import {
  RuntimeSession,
  createActorBuilderCatalog,
  createCommandCatalog,
  type ActorBuilderCatalog,
  type ActorBuilderDefinition,
  type CliApplicationContext,
  type ProcessHost,
} from '@ariestools/cli-kit'
import { nodeProcessHost } from '@ariestools/cli-kit-node'
import {
  environmentToYargsConfig,
  runYargsApplication,
} from '@ariestools/cli-kit-yargs'

interface ConsumerContext extends CliApplicationContext {
  readonly label: string
}

const host: ProcessHost = nodeProcessHost
const catalog = createCommandCatalog<ConsumerContext, string>([{
  create: context => context.label,
  id: 'typed-command',
}])
const commands: readonly string[] = catalog.createCommands({ host, label: 'typed' })
const actorDefinitions: readonly ActorBuilderDefinition<ConsumerContext, string>[] = [{
  name: 'typed-actor',
  build: async context => context.label,
}]
const actorCatalog: ActorBuilderCatalog<ConsumerContext, string> = createActorBuilderCatalog(actorDefinitions)
const actor: Promise<string> = actorCatalog.build('typed-actor', { host, label: 'typed' })
const environment: Record<string, string | undefined> = environmentToYargsConfig(
  { PACKED_VALUE: 'typed' },
  'PACKED',
)
const session = new RuntimeSession(() => undefined)
const exitRequest: Promise<void> = session.requestExit(host, 1)
const run: Promise<void> = runYargsApplication({
  configure: parser => parser.option('value', { type: 'string' }),
  host,
})

void commands
void actor
void actorCatalog
void environment
void exitRequest
void run
void session
`

describe('packed actor CLI kit external consumer', () => {
  let consumerDirectory: string | undefined
  let runtimeFile: string | undefined
  let typeScriptConfig: string | undefined
  let workDirectory: string | undefined

  beforeAll(() => {
    assertPackagesBuilt()

    workDirectory = fs.mkdtempSync(PATH.join(os.tmpdir(), 'cli-kit-pack-'))
    try {
      const packDirectory = PATH.join(workDirectory, 'pack')
      const initializedConsumerDirectory = PATH.join(workDirectory, 'consumer')
      consumerDirectory = initializedConsumerDirectory
      fs.mkdirSync(packDirectory, { recursive: true })
      fs.mkdirSync(initializedConsumerDirectory, { recursive: true })

      const packedPackages = packages.map(package_ => packPackage(package_, packDirectory))
      const coreTarball = assertPackedAdapterDependencies(packedPackages)

      const dependencies = Object.fromEntries(
        packedPackages.map(package_ => [package_.name, `file:${package_.filename}`]),
      )
      fs.writeFileSync(PATH.join(initializedConsumerDirectory, 'package.json'), `${JSON.stringify({
        name: 'cli-kit-packed-consumer',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies,
        pnpm: { overrides: { '@ariestools/cli-kit': `file:${coreTarball}` } },
      }, null, 2)}\n`)

      const install = runConsumerCommand(
        'pnpm',
        ['install', '--offline', '--ignore-scripts', '--no-frozen-lockfile'],
        initializedConsumerDirectory,
        120_000,
      )
      assertCommandSucceeded('Installing packed CLI kits in the external consumer', install)

      runtimeFile = PATH.join(initializedConsumerDirectory, 'consumer.mjs')
      fs.writeFileSync(runtimeFile, runtimeSource)
      fs.writeFileSync(PATH.join(initializedConsumerDirectory, 'declarations.ts'), declarationSource)
      typeScriptConfig = PATH.join(initializedConsumerDirectory, 'tsconfig.json')
      fs.writeFileSync(typeScriptConfig, `${JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: 'ES2022',
          types: [],
        },
        include: ['declarations.ts'],
      }, null, 2)}\n`)
    } catch (error) {
      cleanDirectory(workDirectory)
      workDirectory = undefined
      throw error
    }
  }, 180_000)

  afterAll(() => {
    cleanDirectory(workDirectory)
  })

  it('resolves declarations for every public package root', () => {
    if (consumerDirectory === undefined || typeScriptConfig === undefined) {
      throw new Error('Packed consumer was not initialized')
    }
    const typeScript = PATH.join(repoRoot, 'node_modules/typescript/bin/tsc')
    const result = runConsumerCommand(
      process.execPath,
      [typeScript, '--project', typeScriptConfig],
      consumerDirectory,
      60_000,
    )

    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  })

  it('loads and exercises every public package root at runtime', () => {
    if (consumerDirectory === undefined || runtimeFile === undefined) {
      throw new Error('Packed consumer was not initialized')
    }
    const result = runConsumerCommand(
      process.execPath,
      [runtimeFile],
      consumerDirectory,
      60_000,
    )

    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('actor CLI kit packed consumer ok')
  })
})
