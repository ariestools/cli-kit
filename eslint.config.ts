import { recommendedConfig } from '@ariestools/eslint-config-flat'
import type { Linter } from 'eslint'

const config: Linter.Config[] = [
  { ignores: ['.yarn/**', 'build', '**/build/**', '**/dist/**', 'dist', 'node_modules/**', '**/node_modules/**', '**/*.md', '**/scripts/**', '.claude/worktrees/*'] },
  ...recommendedConfig({ tier: 4, isTypeChecked: true }),
]

export default config
