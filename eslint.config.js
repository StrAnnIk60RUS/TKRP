import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const unusedVarsRule = [
  'warn',
  { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
];

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/dist-ssr/**']
  },
  {
    ...js.configs.recommended,
    files: ['apps/api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': unusedVarsRule
    }
  },
  eslintConfigPrettier,
  {
    files: ['apps/web/**/*.{js,jsx}'],
    ...js.configs.recommended,
    ...reactPlugin.configs.flat.recommended,
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser }
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': unusedVarsRule
    },
    settings: {
      react: { version: 'detect' }
    }
  }
];
