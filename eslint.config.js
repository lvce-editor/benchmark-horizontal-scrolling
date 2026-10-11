import * as config from '@lvce-editor/eslint-config'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  ...config.default,
  ...config.recommendedNode,
  {
    rules: {
      '@cspell/spellchecker': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/prefer-readonly-parameter-types': 'off',
      'no-console': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-objects': 'off',
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-nested-conditional': 'off',
      'sonarjs/no-nested-functions': 'off',
      'unicorn/no-await-expression-member': 'off',
      'unicorn/no-break-in-nested-loop': 'off',
      'unicorn/no-unreadable-for-of-expression': 'off',
      'unicorn/prefer-top-level-await': 'off'
    }
  }
])
