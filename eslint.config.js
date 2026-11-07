import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'dist-e2e', 'public/stockfish/', '.wrangler/'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Service worker: otro entorno (self, clients, caches) y la configuración que inyecta el build.
    files: ['src/pwa/sw-template.js'],
    languageOptions: { globals: { ...globals.serviceworker, __ESCAQUE_SW_CONFIG__: 'readonly' } },
  },
  {
    // Configuración y plugins de Vite (y sus pruebas): se ejecutan en Node.
    files: ['build-tools/**/*.js', 'vite.config.js'],
    languageOptions: { globals: globals.node },
  },
]
