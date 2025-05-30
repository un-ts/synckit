import recommended from '@1stg/eslint-config'

export default [
  ...recommended,
  {
    ignores: ['**/*.pnp.*'],
  },
  {
    files: ['benchmarks/*'],
    rules: {
      'unicorn-x/no-anonymous-default-export': 'off',
    },
  },
  {
    rules: {
      'sonarjs/no-nested-conditional': 'off',
      'sonarjs/no-nested-assignment': 'off',
      'unicorn-x/no-nested-ternary': 'off',
    },
  },
]
