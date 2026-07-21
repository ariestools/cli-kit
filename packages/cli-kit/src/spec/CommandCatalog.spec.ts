import {
  describe, expect, it, vi,
} from 'vitest'

import { createCommandCatalog } from '../CommandCatalog.ts'
import type { ProcessHost } from '../ProcessHost.ts'

function createHost(): ProcessHost {
  return {
    argv: [],
    environment: {},
    exit: vi.fn(),
    io: {
      error: vi.fn(),
      isInteractive: false,
      log: vi.fn(),
      question: vi.fn(),
      warn: vi.fn(),
    },
    isDevelopment: false,
    onInterrupt: vi.fn(() => vi.fn()),
  }
}

describe('createCommandCatalog', () => {
  it('preserves order and passes the exact application context to every factory', () => {
    const observedContexts: object[] = []
    const context = { host: createHost(), requestId: 'request-1' }
    const catalog = createCommandCatalog([
      {
        id: 'first',
        create: (value: typeof context) => {
          observedContexts.push(value)
          return { name: 'first' }
        },
      },
      {
        id: 'second',
        create: (value: typeof context) => {
          observedContexts.push(value)
          return { name: 'second' }
        },
      },
    ])

    expect(catalog.ids).toEqual(['first', 'second'])
    expect(catalog.createCommands(context)).toEqual([{ name: 'first' }, { name: 'second' }])
    expect(observedContexts).toHaveLength(2)
    expect(observedContexts[0]).toBe(context)
    expect(observedContexts[1]).toBe(context)
  })

  it('materializes fresh command results for every application context', () => {
    const create = vi.fn(() => ({ created: true }))
    const catalog = createCommandCatalog([{ id: 'command', create }])
    const context = { host: createHost() }

    const first = catalog.createCommands(context)
    const second = catalog.createCommands(context)

    expect(create).toHaveBeenCalledTimes(2)
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
  })

  it('exposes immutable catalog and command snapshots', () => {
    const catalog = createCommandCatalog([{ id: 'command', create: () => ({}) }])
    const commands = catalog.createCommands({ host: createHost() })

    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog.ids)).toBe(true)
    expect(Object.isFrozen(commands)).toBe(true)
  })

  it('snapshots definitions so later input mutation cannot alter the catalog', () => {
    const originalFactory = vi.fn(() => ({ name: 'original' }))
    const replacementFactory = vi.fn(() => ({ name: 'replacement' }))
    const definition = { id: 'original', create: originalFactory }
    const definitions = [definition]
    const catalog = createCommandCatalog(definitions)

    definition.id = 'replacement'
    definition.create = replacementFactory
    definitions.push({ id: 'additional', create: replacementFactory })

    expect(catalog.ids).toEqual(['original'])
    expect(catalog.createCommands({ host: createHost() })).toEqual([{ name: 'original' }])
    expect(originalFactory).toHaveBeenCalledOnce()
    expect(replacementFactory).not.toHaveBeenCalled()
  })

  it('rejects blank command ids', () => {
    expect(() => createCommandCatalog([{ id: '  ', create: () => ({}) }]))
      .toThrow('Command id must not be empty')
  })

  it('rejects duplicate command ids', () => {
    expect(() => createCommandCatalog([
      { id: 'command', create: () => ({}) },
      { id: 'command', create: () => ({}) },
    ])).toThrow('Command "command" is already registered')
  })

  it('rethrows the original factory error without invoking later factories', () => {
    const expectedError = new Error('factory failed')
    const laterFactory = vi.fn(() => ({ name: 'later' }))
    const catalog = createCommandCatalog([
      {
        id: 'failing',
        create: () => {
          throw expectedError
        },
      },
      { id: 'later', create: laterFactory },
    ])

    let receivedError: unknown
    try {
      catalog.createCommands({ host: createHost() })
    } catch (error) {
      receivedError = error
    }

    expect(receivedError).toBe(expectedError)
    expect(laterFactory).not.toHaveBeenCalled()
  })
})
