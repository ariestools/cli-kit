import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    watch: false,
    include: ['packages/**/src/**/spec/**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
})
