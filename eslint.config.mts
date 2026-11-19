import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'**/main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
				'test',
		'scripts',
		'sample-vault',
		'vitest.config.ts',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Packages and plugins must run on mobile: no Node APIs. And a package is used only through its
		// public entry point (its index.ts), never its internal files.
		files: ['packages/*/src/**/*.ts', 'src/**/*.ts', 'examples/*/src/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', {
				patterns: [
					{ regex: '^node:', message: 'Node APIs are not available on mobile.' },
					{ regex: '^(fs|path|os|child_process|crypto|buffer|stream|util|url|http|https|net)(/|$)', message: 'Node APIs are not available on mobile.' },
					{ regex: '^@legal-core/[^/]+/', message: 'Import a package through its entry point: @legal-core/<name>.' },
				],
			}],
			'no-restricted-globals': ['error',
				{ name: 'Buffer', message: 'Buffer is a Node API: use Uint8Array.' },
				{ name: 'process', message: 'process is a Node API.' },
				{ name: 'require', message: 'Use import.' },
			],
		},
	},
);
