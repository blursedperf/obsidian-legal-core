/**
 * Builds Legal Core to main.js (see scripts/build-plugin.mjs). "production" builds once; otherwise it watches.
 * Generated from blursedperf/obsidian-aglc4 by scripts/export-legal-core.mjs: change it there, not here.
 */
import process from 'process';
import { buildAll, watchAll } from './scripts/build-plugin.mjs';

const PLUGINS = [{ id: 'legal-core', name: 'Legal Core', entry: 'src/main.ts', outfile: 'main.js' }];

if (process.argv[2] === 'production') {
	await buildAll(PLUGINS);
	process.exit(0);
} else {
	await watchAll(PLUGINS);
}
