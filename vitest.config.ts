import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// The obsidian package has only type definitions: tests use a stand-in.
		alias: { obsidian: fileURLToPath(new URL("./test/obsidian-stub.ts", import.meta.url)) },
	},
	test: {
		include: ["test/**/*.test.ts"],
	},
});
