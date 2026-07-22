/** Environment map accepted by process hosts and dotenv composition helpers. */
export type ProcessEnvironment = Readonly<Record<string, string | undefined>>

function resolveEnvironmentValue(
  key: string,
  layers: readonly ProcessEnvironment[],
): string | undefined {
  for (const layer of layers) {
    if (!Object.hasOwn(layer, key)) continue
    const value = layer[key]
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * Merges environment layers with primary-first precedence.
 *
 * For each key, the first layer that owns the key with a value other than
 * `undefined` wins. Later layers only fill missing or undefined entries.
 *
 * Standard dotenv non-override composition (process wins over file):
 *
 * ```ts
 * mergeEnvironments(process.env, loadDotEnvFile())
 * ```
 */
export function mergeEnvironments(
  primary: ProcessEnvironment,
  ...fallbacks: readonly ProcessEnvironment[]
): Record<string, string | undefined> {
  const layers = [primary, ...fallbacks]
  const keys = new Set<string>()
  for (const layer of layers) {
    for (const key of Object.keys(layer)) keys.add(key)
  }

  const result: Record<string, string | undefined> = {}
  for (const key of keys) {
    result[key] = resolveEnvironmentValue(key, layers)
  }
  return result
}
