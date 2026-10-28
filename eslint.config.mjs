import eslint from '@eslint/js';
import { base as ali } from 'eslint-config-ali';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  // Reuse the project's plugin instance to avoid Flat Config plugin collisions.
  ...ali.map((config) => {
    if (!config.plugins?.['@typescript-eslint']) return config;
    return {
      ...config,
      plugins: {
        ...config.plugins,
        '@typescript-eslint': tseslint.plugin,
      },
    };
  }),
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^\\u0000'], // 副作用导入
            ['^node:'], // Node.js 内置模块（node: 前缀）
            ['^@?\\w'], // 第三方包
            ['^'], // 其他绝对路径或别名
            ['^\\.'], // 相对路径
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'no-void': ['error', { allowAsStatement: true }],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
