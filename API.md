# Legal Core API (version 1.1)

Legal Core (Australia), plugin id `au-legal-core`, is the foundation of professional legal plugins for lawyers and legal assistants. It provides one store of the cases, legislation and sources a user's work relies on, a Word export engine with AGLC4 formatting, and extension points other plugins use to add their own syntax and output.

**A plugin that uses Legal Core must never fail because of it.** Use only the API's types (`import type` from `@legal-core/api`), so your plugin has no run-time dependency on Legal Core's code. When Legal Core is missing, disabled or too old, tell the user plainly what is needed and wait, rather than failing. [`examples/case-notes`](examples/case-notes/src/main.ts) shows the whole pattern.

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

`version` is the API's semantic version, such as `"1.1.0"`. A breaking change is a new major version; an addition is a new minor version, so a plugin built for 1.0 works with 1.1. Check the range you were built for before using anything, and ask for the minor version that added what you use:

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

With no extensions, the result is fixed by the golden exports in the test suite (`test/golden`): any change to it fails the tests.

## `events` (1.1)

The shared chronology: dated events from every note, gathered in one index that any plugin can add to and query. Ask for `^1.1` to use it.

```ts
const events = api.events.query({ matter: '[[2026-014 Film option]]', from: '2019', to: '2021-06', tracks: ['client'] });
const stop = api.events.subscribe(({ added, removed, reset }) => { /* reset: query again */ });
api.events.ready();          // true once the whole vault has been indexed
api.events.problems(path);   // lines that look like events but are not (an impossible date, say)
```

Each event has:

| Field | |
| --- | --- |
| `id` | Stable: `<path>#^<block id>`, `<path>#e-<hash of date and title>`, or `<path>#<source id>:<key>` |
| `date` | A precise date: `{ start, end, precision, endPrecision, approximate, range }` (see below) |
| `title` | As written, in Markdown |
| `works`, `parties`, `matter` | Paths of the linked notes |
| `source` | `{ file, line?, ref? }`: where it is written, to link back |
| `confidence` | `confirmed`, `probable` or `unverified` |
| `kind`, `track` | Optional; `track` separates the columns of a two-track comparison |
| `contributedBy` | `inline`, or the id of the event source |
| `sensitive` | Derived from sensitive data (ICIP): left out of queries unless `includeSensitive` is set |

**Query fields:**
- `matter`, `work` and `party` (each a path or a `[[link]]`);
- `from` and `to` (events overlapping the period);
- `kinds`, `tracks` and `confidence`;
- `file`;
- `includeSensitive`.

Results come in date order. A date covers every day it could mean, so a month sorts as the range it is: by first day, then the shorter span first. It never sorts as a made-up day.

**Inline events** are written in any note as a list item: a date, then ` :: `, then the title, with optional attributes in braces and an optional block id:

```markdown
- 2019-03-14 :: Demo recorded [[Song X]] {track=client conf=confirmed ref="CB 45"}
- ~2019-03 :: First draft shared with [[Jo Rivers]] {kind=creation}
- 2019-03..2019-05 :: Recording sessions {conf=probable work=[[Song Y]]}
- 2021-06-30 :: Option expires {kind=option-deadline matter="[[2026-014 Film option]]"} ^opt1
```

- **Dates:**
  - `2019`, `2019-03` and `2019-03-14`;
  - ranges such as `2019-03..2019-05`, and open-ended ranges `2019-03..` and `..2020`;
  - approximate dates, such as `~2019-03`.
- **Attributes:**
  - `track`;
  - `conf` (the default is `unverified`);
  - `ref`;
  - `kind`;
  - `matter`, and `work` and `party` (which may repeat).
- **Links in the title** are classified by the linked note's `type`: a `work` note is a work, a `matter` note is the matter, and anything else is a party.
- **The matter** comes from the `matter` attribute, then a matter link in the title, then the matter note in the nearest folder above.

## `registerEventSource(source)` (1.1)

Adds events derived from notes' frontmatter, for notes of the given `type`s. It returns a function that removes them.

```ts
const remove = api.registerEventSource({
	id: 'au-arts-rights',
	types: ['licence'],
	events: ({ path, frontmatter }) => [
		{ key: 'end', date: String(frontmatter?.end ?? ''), title: 'Licence ends', kind: 'licence-end', works: [/* links */] },
	],
});
```

- **Ids:** each event's `key` must be stable within its note; the event's id is `<path>#<source id>:<key>`.
- **Invalid input:** dates that are not valid are skipped, and a source that throws is ignored, so it never breaks the index.
- **Sensitive data:** set `sensitive: true` on events derived from it.

## `exportDocument(doc, options)` (1.1)

Writes a document built in the document model (`MdDocument`), such as a chronology table or a report, to Word. It applies Legal Core's typography (curly quotes, superscript ordinals), every registered extension and the template, exactly as `exportDocx` does for Markdown. The document passed in is not changed.

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
