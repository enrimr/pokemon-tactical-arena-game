module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2022: true, browser: true, node: true, worker: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  ignorePatterns: ['dist', 'node_modules', '*.cjs', 'coverage'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-constant-condition': ['error', { checkLoops: false }],
  },
};
