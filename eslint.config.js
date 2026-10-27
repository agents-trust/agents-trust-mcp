import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ ignores: ['dist/**', 'node_modules/**'] }, { files: ['scripts/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly' } } }, js.configs.recommended, ...ts.configs.recommended);
