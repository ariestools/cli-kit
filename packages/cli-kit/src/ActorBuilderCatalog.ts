export interface ActorBuilderDefinition<TContext, TActor> {
  readonly name: string
  build(context: TContext): Promise<TActor>
}

export interface ActorBuilderCatalog<TContext, TActor> {
  readonly names: readonly string[]
  build(name: string, context: TContext): Promise<TActor>
}

/** Creates an ordered, instance-scoped actor builder catalog. */
export function createActorBuilderCatalog<TContext, TActor>(
  definitions: readonly ActorBuilderDefinition<TContext, TActor>[],
): ActorBuilderCatalog<TContext, TActor> {
  const definitionsByName = new Map<string, ActorBuilderDefinition<TContext, TActor>>()
  const names: string[] = []
  for (const definition of definitions) {
    if (definitionsByName.has(definition.name)) {
      throw new Error(`Actor builder "${definition.name}" is already registered`)
    }
    definitionsByName.set(definition.name, definition)
    names.push(definition.name)
  }

  return {
    names: Object.freeze(names),
    async build(name: string, context: TContext): Promise<TActor> {
      const definition = definitionsByName.get(name)
      if (definition === undefined) throw new Error(`Unknown actor: ${name}`)
      return await definition.build(context)
    },
  }
}
