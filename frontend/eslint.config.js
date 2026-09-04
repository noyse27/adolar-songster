// Flat config (ESLint 9+) replacing .eslintrc.json - see README/commit for
// why: the old .eslintrc setup pulled in eslint@8, itself deprecated along
// with its @humanwhocodes/* internals.
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const reactHooksRecommended = reactHooks.configs['flat/recommended'] ?? {
  plugins: {
    'react-hooks': reactHooks,
  },
  rules: reactHooks.configs.recommended?.rules ?? {},
};

export default [
  js.configs.recommended,
  ...tseslint.configs['flat/recommended'],
  ...(Array.isArray(reactHooksRecommended)
    ? reactHooksRecommended
    : [reactHooksRecommended].filter(Boolean)),
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
