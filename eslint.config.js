// @ts-check
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/assets/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The two rules the code is written against. The plugin's newer React-Compiler rules
      // (set-state-in-effect, refs, purity) flag idioms this codebase uses deliberately —
      // "reset state when a prop changes", "latest ref" — and there is no compiler here.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // The pure modules and tests sometimes take a `_` they do not read.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['vite.config.ts', 'manifest.config.ts', 'vitest.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
)
