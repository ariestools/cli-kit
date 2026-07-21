import {
  describe, expect, it,
} from 'vitest'

import { createActorBuilderCatalog } from '../ActorBuilderCatalog.ts'

describe('createActorBuilderCatalog', () => {
  it('preserves registration order and dispatches the original context', async () => {
    const observed: { context: object; name: string }[] = []
    const context = { requestId: 'request-1' }
    const catalog = createActorBuilderCatalog([
      {
        name: 'api',
        build: async (value: object) => {
          observed.push({ context: value, name: 'api' })
          return 'api-actor'
        },
      },
      {
        name: 'producer',
        build: async (value: object) => {
          observed.push({ context: value, name: 'producer' })
          return 'producer-actor'
        },
      },
    ])

    expect(catalog.names).toEqual(['api', 'producer'])
    await expect(catalog.build('producer', context)).resolves.toBe('producer-actor')
    expect(observed).toEqual([{ context, name: 'producer' }])
    expect(observed[0]?.context).toBe(context)
  })

  it('rejects duplicate actor names', () => {
    expect(() => createActorBuilderCatalog([
      { name: 'api', build: async () => 'first' },
      { name: 'api', build: async () => 'second' },
    ])).toThrow('Actor builder "api" is already registered')
  })

  it('preserves the existing unknown actor error', async () => {
    const catalog = createActorBuilderCatalog<object, string>([])

    await expect(catalog.build('unknown', {})).rejects.toThrow('Unknown actor: unknown')
  })
})
