import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react },
    rules: {
      // `motion` from framer-motion is used as `<motion.div>` in JSX; without
      // eslint-plugin-react's jsx-uses-vars, eslint flags it as unused. Adding
      // it to the ignore pattern avoids a per-file disable comment.
      'no-unused-vars': ['error', { varsIgnorePattern: '^(motion|[A-Z_])' }],
      // The plugin is registered for its RULES only — its recommended set is
      // deliberately not extended, so this stays a targeted addition rather
      // than a few hundred new findings across the app. Five files already
      // carry eslint-disable comments for this rule; without the plugin those
      // comments were themselves errors ("Definition for rule was not found")
      // and the rule enforced nothing.
      'react/no-array-index-key': 'warn',
    },
  },
])
