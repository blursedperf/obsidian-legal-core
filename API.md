# Legal Core API (version 1)

Legal Core (Australia), plugin id `au-legal-core`, is the shared foundation of the legal-writing plugins. It provides one store of the cases, legislation and sources a user's work relies on, a Word export engine with AGLC4 formatting, and extension points other plugins use to add their own syntax and output.

**Every plugin that uses Legal Core must also work without it.** Use only the API's types (`import type` from `@legal-core/api`), so your plugin has no run-time dependency on Legal Core, and carry on with your own behaviour when it is not installed. AGLC4 Citations works this way. [`examples/case-notes`](examples/case-notes/src/main.ts) shows the whole pattern.

## Finding Legal Core

Plugins load in any order, and Legal Core can be enabled or disabled while your plugin is running. Look for it when the workspace is ready, and listen for its two workspace events:

```ts
import type { LegalCoreApi } from '@legal-core/api';
import type { App, EventRef, Events } from 'obsidian';

function findLegalCore(app: App): LegalCoreApi | null {
	const plugins = (app as unknown as { plugins?: { getPlugin(id: string): { api?: LegalCoreApi } | null } }).plugins;
	const api = plugins?.getPlugin('au-legal-core')?.api;
	return api?.satisfies('^1.0') ? api : null;
}

// Obsidian's typings list only the workspace's own events; custom events go through Events.
const on = (app: App, name: string, fn: (...data: unknown[]) => void): EventRef => (app.workspace as unknown as Events).on(name, fn);

// In onload():
this.app.workspace.onLayoutReady(() => connect(findLegalCore(this.app)));
this.registerEvent(on(this.app, 'legal-core:ready', (api) => connect(api as LegalCoreApi)));   // enabled or reloaded
this.registerEvent(on(this.app, 'legal-core:unload', () => disconnect()));                    // disabled
```

- **`legal-core:ready`** is triggered with the API when Legal Core loads (after the workspace is ready).
- **`legal-core:unload`** is triggered when it unloads. Stop using the API; its registrations go with it.

`app.plugins` is not part of Obsidian's public API. Keep your lookup in one function, as above.

## `version` and `satisfies(range)`

`version` is the API's semantic version, such as `"1.0.0"`. A breaking change is a new major version. Check the range you were built for before using anything:

```ts
api.satisfies('^1.0');          // 1.x
api.satisfies('>=1.1.0 <2');    // a comparison
api.satisfies('^1.0 || ^2.0');  // either
```

Supported: caret (`^`), tilde (`~`), comparisons (`>=`, `>`, `<=`, `<`), x-ranges (`1.x`, `1.2.*`, `*`), exact versions, and alternatives with `||`.

## `registerExtension(extension)`

Adds syntax, transforms and renderers to Legal Core's exports. It returns a function that removes them again (call it in your `onunload`).

```ts
const unregister = api.registerExtension({
	id: 'case-notes',
	syntax: [{ type: 'fence', lang: 'case-note', parse: (source) => [{ t: 'custom', kind: 'case-note', data: parse(source) }] }],
	renderers: [{ kind: 'case-note', block: (data) => render(data) }],
	transforms: [{ id: 'number', after: ['render'], before: ['aglc-quotes'], fn: (doc) => numberCaseNotes(doc) }],
});
```

An export runs these steps:

| Step | What it does |
| --- | --- |
| `syntax` | Reads every extension's syntax |
| `aglc-headings` | Numbers the headings in the AGLC4 hierarchy (if asked) |
| `aglc-bibliography` | Adds the bibliography (if asked) |
| `render` | Turns custom nodes into ordinary ones, with each extension's renderers |
| `aglc-ordinals` | Sets ordinal suffixes in superscript |
| `aglc-quotes` | Curls quotation marks |
| your transforms | Placed by `after` and `before`, or after all of the above |

**Syntax** works on the parsed document, so Legal Core's Markdown parser is unchanged:
- `{ type: 'fence', lang, parse(source) => Block[] }`: a fenced block with its own language.
- `{ type: 'inline', pattern, parse(match) => Inline[] }`: text matching a pattern, outside code and URLs.

Either kind may produce `custom` nodes, `{ t: 'custom', kind, data }`.

**Renderers** turn custom nodes into ordinary document nodes before the document is written, so Word, HTML and the page preview all show them:
- `{ kind, block?(data) => Block[], inline?(data) => Inline[] }`.
- A custom node with no renderer is left out.

**Transforms** change the parsed document, as `{ id, after?, before?, fn(doc) }`:
- **Ids:** other extensions refer to a transform as `"<extension id>:<id>"`.
- **Placement:** `after` and `before` name steps (Legal Core's above, or other extensions'). They are honoured when those steps are present, and a step that isn't registered is skipped, so a dependency on a plugin that isn't installed is harmless.
- **Cycles:** a cycle is an error when the extension is registered, naming the steps involved.

**Raw Word XML** is the escape hatch for what the document model cannot express. A block `{ t: 'ooxml', xml, fallback }` is written into the Word document exactly as given (one or more `<w:p>` or `<w:tbl>` elements). HTML, the page preview and footnotes show `fallback` instead.

The document model (`Block`, `Inline`, `MdDocument`) is exported from `@legal-core/api`.

## `authorities`

The shared store of authorities. It is saved in the vault, in `.legal-core/authorities.json` by default (atomically, so a crash part-way through a save loses nothing).

```ts
const record = await api.authorities.upsert({
	kind: 'case',
	title: '*Mabo v Queensland [No 2]*',
	citation: '*Mabo v Queensland [No 2]* (1992) 175 CLR 1',
	key: { year: '1992', volume: '175', series: 'CLR', page: '1' },
	fields: { court: 'High Court of Australia' },
	source: 'case-notes',
	notePath: 'Case notes/Mabo.md',
});
await api.authorities.get(record.id);
await api.authorities.query({ kind: 'case', text: 'mabo' });
const stop = api.authorities.subscribe((event) => { /* { type: 'upsert', record } or { type: 'remove', id } */ });
```

- **Record ids:** a record's id comes from its `kind`, `title` and `key`. `key` holds the parts that identify the source, so the same source gets the same record whichever plugin writes it, and whatever the pinpoint.
- **Merging:** `fields` are other details, merged with what is stored. Upserting adds your plugin to `sources` and the note to `notes`; it never removes what other plugins wrote.
- **Queries:** `query({ kind?, text?, source?, notePath? })` returns records sorted by title, where `text` is words that must all appear in the title or citation.

Suggested keys:

| Kind | Key |
| --- | --- |
| Reported case | `year`, `volume`, `series`, `page` |
| Medium neutral citation | `year`, `court`, `number` |
| Legislation | `jurisdiction` (the year is in the title) |
| Secondary source | `authors`, `year` |

## `exportDocx(source, options)`

Exports Markdown, or a note (anything with a `path`, such as a `TFile`), to a Word document with real footnotes, with every registered extension. Returns the `.docx` as a `Uint8Array`; write it with `app.vault.createBinary`.

```ts
const bytes = await api.exportDocx(file, { headingScheme: 'aglc', bibliography: true, lineSpacing: 2 });
```

| Option | Default |
| --- | --- |
| `font`, `fontSize`, `footnoteSize` | Times New Roman, 12, 10 |
| `lineSpacing` | 1.5 |
| `smartQuotes`, `pageNumbers` | true |
| `title` | none |
| `headingScheme` (`plain` or `aglc`), `aglcTopLevel` (`auto`, `h1`, `h2`) | plain, auto |
| `keepFootnotesTogether`, `bibliography` | true, false |
| `template` (a template id, or `null` for none) | the selected template |

With no extensions, the result is exactly what AGLC4 Citations exports for the same note and options. The test suite checks this against the AGLC4 golden exports.

## `templates`

A template is a reference Word document whose styles exports take on.

```ts
const remove = api.templates.register('firm', 'Firm style', docxBytes);
api.templates.select('firm');   // the default for exports; null for none
api.templates.selected();
api.templates.list();           // [{ id, name }]
```

- **How styles merge:** the template's styles replace the export's, so its fonts, sizes, spacing and the look of every style it defines win. Styles the export uses that the template doesn't define (footnotes, long quotations, headings) are kept from the export.
- **Version 1 merges styles only.** The template's numbering, headers and footers are not merged yet.
- **Validation:** `register` throws if the file is not a Word document with styles.
