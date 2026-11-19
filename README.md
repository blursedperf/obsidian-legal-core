# Legal Core (Australia)

The shared foundation for Australian legal-writing plugins in Obsidian. On its own it does little that you see: it gives the plugins built on it one place to keep the cases, legislation and sources your work relies on, and one Word export engine with AGLC4 formatting.

- **Shared authorities.** Cases, legislation and secondary sources, kept in your vault in `.legal-core/authorities.json`, so that the plugins you use (citations, case notes, exam summaries) see the same sources.
- **Word export engine.** Real Word footnotes and AGLC4 headings, typography and bibliography, which plugins extend with their own content.
- **Templates.** A reference Word document whose styles exports take on.

Every plugin built on Legal Core also works without it. AGLC4 Citations, for example, works on its own, and with Legal Core installed it also shares its citations.

## Settings

- **Authorities file:** where the shared authorities are kept (default `.legal-core/authorities.json`, hidden from the file list).
- **Stored authorities:** how many there are, by kind.
- **Registered extensions:** the plugins that build on Legal Core and are running.
- **Default template:** the reference Word document used by default in exports.

## Privacy

Like AGLC4 Citations, Legal Core is fully offline. It makes no network requests, uses no AI and has no telemetry, and the repository's offline audit checks its code and bundle too.

## For plugin authors

See [API.md](API.md) for the API, and [`examples/case-notes`](examples/case-notes) for a plugin built on it.

## Development

Legal Core is developed in [blursedperf/obsidian-aglc4](https://github.com/blursedperf/obsidian-aglc4), together with AGLC4 Citations and the packages they share, and this repository is generated from it (`scripts/export-legal-core.mjs`). Make changes there; this repository is for releasing Legal Core.

```bash
npm install
npm run build   # type-check and build main.js
npm test        # tests, golden exports and the offline audit
npm run lint
```
