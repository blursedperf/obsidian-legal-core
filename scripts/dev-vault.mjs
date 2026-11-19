#!/usr/bin/env node
/*
 * Build Legal Core and link it into a test vault, so the vault always runs the latest build.
 *
 *   node scripts/dev-vault.mjs <vault>           build once and link
 *   node scripts/dev-vault.mjs <vault> --copy    copy the files instead (for a vault that syncs)
 *   npm run dev:vault -- <vault>
 *
 * Only main.js and manifest.json are linked, each on its own, so the plugin's settings (data.json) stay
 * in the vault and are never written into the repository.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll } from "./build-plugin.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const copy = args.includes("--copy");
const vaultArg = args.find((a) => !a.startsWith("--"));
if (!vaultArg || !existsSync(join(resolve(vaultArg), ".obsidian"))) {
	console.error("Usage: node scripts/dev-vault.mjs <vault> [--copy]   (the vault must have a .obsidian folder)");
	process.exit(1);
}
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

await buildAll([{ id: "legal-core", name: "Legal Core", entry: "src/main.ts", outfile: "main.js" }]);
const { id } = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const target = join(resolve(vaultArg), ".obsidian", "plugins", id);
mkdirSync(target, { recursive: true });
for (const file of ["main.js", "manifest.json"]) {
	const dest = join(target, file);
	if (existsSync(dest) || isLink(dest)) rmSync(dest, { force: true });
	if (copy) copyFileSync(join(ROOT, file), dest);
	else symlinkSync(join(ROOT, file), dest);
}
console.log(`${copy ? "Copied" : "Linked"} main.js and manifest.json into ${target}. Reload the plugin in Obsidian.`);
process.exit(0);
