import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      // The rule that would have caught the blank-page bug
      'no-undef': 'error',

      // Without this, ESLint thinks components used only in JSX are unused
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',

      // Catches adjacent-JSX and other structural mistakes early
      'react/jsx-no-undef': 'error',

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      'no-unused-vars': ['warn', {
        varsIgnorePattern: '^_', argsIgnorePattern: '^_',
      }],
    },
  },
]