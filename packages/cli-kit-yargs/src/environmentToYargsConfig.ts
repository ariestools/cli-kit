export type CliEnvironment = Readonly<Record<string, string | undefined>>

/**
 * Matches the segment normalization used by yargs-parser for environment keys.
 * Keeping this local avoids coupling the adapter to an unexported parser helper.
 */
function camelCaseEnvironmentSegment(value: string): string {
  const isCamelCase = value !== value.toLowerCase() && value !== value.toUpperCase()
  const normalized = isCamelCase ? value : value.toLowerCase()
  if (!normalized.includes('-') && !normalized.includes('_')) return normalized

  let result = ''
  let isNextCharacterUpper = false
  const leadingHyphens = /^-+/.exec(normalized)
  const start = leadingHyphens?.[0].length ?? 0
  for (let index = start; index < normalized.length; index++) {
    let character = normalized.charAt(index)
    if (isNextCharacterUpper) {
      isNextCharacterUpper = false
      character = character.toUpperCase()
    }
    if (index !== 0 && (character === '-' || character === '_')) {
      isNextCharacterUpper = true
    } else if (character !== '-' && character !== '_') {
      result += character
    }
  }
  return result
}

/**
 * Converts a prefixed environment into the flat dotted config shape accepted
 * by Yargs. Values remain strings so Yargs applies its normal option typing and
 * coercion after command-line arguments have taken precedence.
 */
export function environmentToYargsConfig(
  environment: CliEnvironment,
  prefix: string,
): Record<string, string | undefined> {
  const config: Record<string, string | undefined> = {}
  for (const environmentName of Object.keys(environment)) {
    if (!environmentName.startsWith(prefix)) continue
    const keys = environmentName.split('__').map((key, index) => {
      return camelCaseEnvironmentSegment(index === 0 ? key.slice(prefix.length) : key)
    })
    const configKey = keys.join('.')
    if (!Object.hasOwn(config, configKey)) config[configKey] = environment[environmentName]
  }
  return config
}
