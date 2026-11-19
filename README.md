# Legal Core (Australia)

The foundation for professional legal plugins in Obsidian, for lawyers and legal assistants. On its own it does little that you see: it gives the plugins built on it one place to keep the cases, legislation and sources a practice relies on, and one Word export engine.

- **Shared authorities.** Cases, legislation and secondary sources, kept in your vault in `.legal-core/authorities.json`, so that the professional plugins you use see the same sources.
- **Word export engine.** Real Word footnotes, AGLC4 headings, typography and bibliography, which plugins extend with their own content.
- **Templates.** A reference Word document (a firm's house style, say) whose styles exports take on.

Plugins built on Legal Core need it installed, and tell you clearly when it is missing or too old; none of them stops working without warning.

## Settings

- **Authorities file:** where the shared authorities are kept (default `.legal-core/authorities.json`, hidden from the file list).
- **Stored authorities:** how many there are, by kind.
- **Registered extensions:** the plugins that build on Legal Core and are running.
- **Default template:** the reference Word document used by default in exports.

## Privacy

Legal Core works locally only. It makes no network requests, uses no AI and has no telemetry, and the repository's offline audit checks its code and bundle.

## For plugin authors

See [API.md](API.md) for the API, and [`examples/case-notes`](examples/case-notes) for a plugin built on it.

## Development

```bash
npm install
npm run build   # type-check and build main.js
npm run dev     # rebuild on every change
npm run dev:vault -- <vault>   # build and link into a test vault (settings stay in the vault)
npm test        # tests, golden exports and the offline audit
npm run lint
```

- **Layout:** the plugin's source is in `src/`. The packages it is built from are in `packages/`, and are bundled into `main.js`:
  - `ldm`, the document model;
  - `md-pipeline`, Markdown and extensions;
  - `docx-engine`, the Word and HTML writers;
  - `aglc`, AGLC4 formatting;
  - `authority-store`;
  - `legal-core-api`, the API's types.
- **Golden exports:** `test/golden` holds the Word XML of the notes in `test/fixtures`. Any change to the export fails the tests; regenerate them only when the output is meant to change, with `UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts`.
- **Releasing:** `npm version <x.y.z>` updates `manifest.json` and `versions.json`; pushing the tag runs the release workflow, which builds `main.js` with a build attestation and drafts the release.
