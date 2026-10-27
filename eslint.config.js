// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // JSON config files aren't lintable — ignore them so ESLint 10 doesn't
  // warn 'File ignored because no matching configuration was supplied'.
  { ignores: ['dist/**', 'node_modules/**', 'client/dist/**', '**/*.json'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
