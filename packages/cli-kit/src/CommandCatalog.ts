import type { ProcessHost } from './ProcessHost.ts'

/** Process capability shared by every command created for one CLI application. */
export interface CliApplicationContext {
  readonly host: ProcessHost
}

/** Adapter-neutral factory for one parser-specific command object. */
export interface CommandDefinition<TContext extends CliApplicationContext, TCommand> {
  readonly create: (context: TContext) => TCommand
  /** Internal registration identity; it does not define parser syntax or aliases. */
  readonly id: string
}

/** Ordered command factories materialized for one application context. */
export interface CommandCatalog<TContext extends CliApplicationContext, TCommand> {
  readonly createCommands: (context: TContext) => readonly TCommand[]
  readonly ids: readonly string[]
}

/** Creates an immutable, adapter-neutral command catalog. */
export function createCommandCatalog<TContext extends CliApplicationContext, TCommand>(
  definitions: readonly CommandDefinition<TContext, TCommand>[],
): CommandCatalog<TContext, TCommand> {
  const registeredIds = new Set<string>()
  const retainedDefinitions = definitions.map(definition => Object.freeze({
    create: definition.create,
    id: definition.id,
  }))
  const ids: string[] = []

  for (const definition of retainedDefinitions) {
    if (definition.id.trim().length === 0) throw new Error('Command id must not be empty')
    if (registeredIds.has(definition.id)) throw new Error(`Command "${definition.id}" is already registered`)
    registeredIds.add(definition.id)
    ids.push(definition.id)
  }

  return Object.freeze({
    ids: Object.freeze(ids),
    createCommands: (context: TContext): readonly TCommand[] =>
      Object.freeze(retainedDefinitions.map(definition => definition.create(context))),
  })
}
