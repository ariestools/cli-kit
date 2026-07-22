import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  afterEach, describe, expect, it,
} from 'vitest'

import { loadDotEnvFile } from '../loadDotEnvFile.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories.length = 0
})

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-kit-dotenv-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('loadDotEnvFile', () => {
  it('loads a relative dotenv file from the supplied cwd', () => {
    const cwd = temporaryDirectory()
    fs.writeFileSync(path.join(cwd, '.env'), 'XL1_FOO=from-file\n')

    expect(loadDotEnvFile({ cwd })).toEqual({ XL1_FOO: 'from-file' })
  })

  it('loads an absolute dotenv path', () => {
    const cwd = temporaryDirectory()
    const absolutePath = path.join(cwd, 'custom.env')
    fs.writeFileSync(absolutePath, 'BAR=absolute\n')

    expect(loadDotEnvFile({ path: absolutePath })).toEqual({ BAR: 'absolute' })
  })

  it('returns an empty object when the file is missing', () => {
    const cwd = temporaryDirectory()

    expect(loadDotEnvFile({ cwd, path: 'missing.env' })).toEqual({})
  })

  it('propagates non-ENOENT filesystem errors', () => {
    const cwd = temporaryDirectory()
    const directoryPath = path.join(cwd, 'not-a-file')
    fs.mkdirSync(directoryPath)

    expect(() => loadDotEnvFile({ path: directoryPath })).toThrow()
  })
})
