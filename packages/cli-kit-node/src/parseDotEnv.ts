/**
 * Parses dotenv-format content into a plain key/value map.
 *
 * Supports the common dotenv grammar used by local CLI configuration:
 * - optional `export` prefix
 * - single-quoted, double-quoted, and unquoted values
 * - `#` comments (including trailing comments on unquoted values)
 * - multi-line double-quoted values with `\\n` escape sequences
 *
 * Does not expand variable references (`$VAR` / `${VAR}`). Does not mutate
 * `process.env`.
 */
export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const text = content.codePointAt(0) === 0xFE_FF ? content.slice(1) : content
  const linePattern = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg

  let match: RegExpExecArray | null
  while ((match = linePattern.exec(text)) !== null) {
    const key = match[1]
    if (key === undefined) continue
    let value = (match[2] ?? '').trim()

    const isDoubleQuoted = value.startsWith('"') && value.endsWith('"')
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'")
    const isBacktickQuoted = value.startsWith('`') && value.endsWith('`')

    if (isSingleQuoted || isDoubleQuoted || isBacktickQuoted) {
      value = value.slice(1, -1)
      if (isDoubleQuoted) {
        value = value
          .replaceAll(String.raw`\n`, '\n')
          .replaceAll(String.raw`\r`, '\r')
          .replaceAll(String.raw`\\"`, '"')
          .replaceAll(String.raw`\\`, '\\')
      }
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }

    result[key] = value
  }

  return result
}
