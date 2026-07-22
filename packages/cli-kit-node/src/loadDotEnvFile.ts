import fs from 'node:fs'
import path from 'node:path'
import PROCESS from 'node:process'

import { parseDotEnv } from './parseDotEnv.ts'

export interface LoadDotEnvFileOptions {
  /**
   * Directory used to resolve a relative {@link path}. Defaults to
   * `process.cwd()`.
   */
  readonly cwd?: string
  /**
   * Absolute or cwd-relative path to the dotenv file. Defaults to `.env`.
   */
  readonly path?: string
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

/**
 * Reads and parses a dotenv file without mutating `process.env`.
 *
 * Missing files resolve to an empty object. Other filesystem errors propagate.
 */
export function loadDotEnvFile(options: LoadDotEnvFileOptions = {}): Record<string, string> {
  const cwd = options.cwd ?? PROCESS.cwd()
  const relativePath = options.path ?? '.env'
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(cwd, relativePath)

  try {
    return parseDotEnv(fs.readFileSync(absolutePath, 'utf8'))
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return {}
    throw error
  }
}
