/**
 * The Legal Core API, independent of Obsidian so that it can be tested on its own. main.ts creates it
 * with the vault's authority store and file access, and exposes it as the plugin's `api`.
 */
import type { ExportDocxOptions, FileRef, LegalCoreApi, LegalExtension, MdDocument, TemplateInfo } from '@legal-core/api';
import { EventIndex } from '@legal-core/chronology';
import { type AuthorityStore } from '@legal-core/authority-store';
import { AGLC_TRANSFORMS, DEFAULT_EXPORT, type ExportOptions, styles } from '@legal-core/aglc';
import { type Renderer, type SyntaxExtension, type Transform, orderTransforms, parseMarkdown, renderTransform, runTransforms, syntaxTransform } from '@legal-core/md-pipeline';
import { applyTemplate, templateStyles, writeDocx } from '@legal-core/docx-engine';
import { satisfies } from './semver';

/**
 * The version of the API, which changes by semver: a breaking change is a new major version, an addition
 * a new minor version. 1.1.0 added events, registerEventSource and exportDocument.
 */
export const API_VERSION = '1.1.0';

export interface CoreHost {
	/** The Markdown of a note. */
	readFile(file: FileRef): Promise<string>;
	/** The template chosen in settings, and a way to save a new choice. */
	selectedTemplate(): string | null;
	saveSelectedTemplate(id: string | null): void;
}

interface Context {
	opts: ExportOptions;
	markdown: string;
}

/** Legal Core's own steps, in order: syntax, AGLC4 headings and bibliography, renderers, typography. */
export const CORE_STEPS = ['syntax', 'aglc-headings', 'aglc-bibliography', 'render', 'aglc-ordinals', 'aglc-quotes'] as const;

export class ExtensionError extends Error {}

/**
 * The API, over the authority store and the event index. The index is fed by the plugin (from the vault);
 * by default it is empty and resolves no links, which suits tests and exports of plain Markdown.
 */
export function createLegalCoreApi(store: AuthorityStore, host: CoreHost, index: EventIndex = new EventIndex({ resolve: () => null })): LegalCoreApi & { extensionIds(): string[] } {
	const extensions = new Map<string, LegalExtension>();
	const templates = new Map<string, { name: string; docx: Uint8Array }>();

	/** Every step of an export, in a form the transform runner orders. */
	function steps(list: Iterable<LegalExtension>): Transform<Context>[] {
		const all = [...list];
		const syntax: SyntaxExtension[] = all.flatMap((e) => e.syntax ?? []);
		const renderers: Renderer[] = all.flatMap((e) => e.renderers ?? []);
		const aglc = new Map(AGLC_TRANSFORMS.map((t) => [t.id, t]));
		const core: Transform<Context>[] = [
			syntaxTransform<Context>('syntax', syntax),
			{ ...aglc.get('aglc-headings')!, after: ['syntax'] },
			aglc.get('aglc-bibliography')!,
			renderTransform<Context>('render', renderers, ['aglc-bibliography']),
			{ ...aglc.get('aglc-ordinals')!, after: ['render'] },
			aglc.get('aglc-quotes')!,
		];
		const own = all.flatMap((e) => (e.transforms ?? []).map((t): Transform<Context> => ({
			id: `${e.id}:${t.id}`,
			after: (t.after && t.after.length > 0) || (t.before && t.before.length > 0) ? t.after : ['aglc-quotes'],
			before: t.before,
			run: (doc) => { t.fn(doc); },
		})));
		return [...core, ...own];
	}

	function validate(e: LegalExtension) {
		if (!e || typeof e.id !== 'string' || !e.id.trim()) throw new ExtensionError('An extension needs an id.');
		if (extensions.has(e.id)) throw new ExtensionError(`An extension with the id "${e.id}" is already registered.`);
		for (const s of e.syntax ?? []) {
			if (s.type === 'fence' && !s.lang) throw new ExtensionError(`Extension "${e.id}": fenced syntax needs a language.`);
			if (s.type === 'inline' && !(s.pattern instanceof RegExp)) throw new ExtensionError(`Extension "${e.id}": inline syntax needs a pattern.`);
		}
		// A cycle is reported now, not at the first export. A dependency on a step that is not registered
		// (yet) is allowed: extensions load in any order, and "after" means "after it, if it is there".
		orderTransforms(steps([...extensions.values(), e]), { optionalDependencies: true });
	}

	/** Prepare a parsed document (every step and extension) and write it, with the template applied. */
	async function write(doc: MdDocument, markdown: string, options: ExportDocxOptions): Promise<Uint8Array> {
		const { template, ...rest } = options;
		const opts: ExportOptions = { ...DEFAULT_EXPORT, ...rest };
		runTransforms(doc, steps(extensions.values()), { opts, markdown }, { optionalDependencies: true });
		const result = await writeDocx(doc, opts, styles(opts));
		let bytes: Uint8Array = new Uint8Array(result.data);
		const id = template === undefined ? host.selectedTemplate() : template;
		if (id) {
			const t = templates.get(id);
			if (!t) throw new ExtensionError(`There is no template "${id}".`);
			bytes = applyTemplate(bytes, t.docx);
		}
		return bytes;
	}

	const api: LegalCoreApi & { extensionIds(): string[] } = {
		version: API_VERSION,
		satisfies: (range) => satisfies(API_VERSION, range),

		registerExtension(extension) {
			validate(extension);
			extensions.set(extension.id, extension);
			return () => { if (extensions.get(extension.id) === extension) extensions.delete(extension.id); };
		},

		extensionIds: () => [...extensions.keys()],

		authorities: {
			get: (id) => store.get(id),
			query: (q) => store.query(q),
			upsert: (input) => store.upsert(input),
			subscribe: (fn) => store.subscribe(fn),
		},

		async exportDocx(source, options: ExportDocxOptions = {}) {
			const markdown = typeof source === 'string' ? source : await host.readFile(source);
			return write(parseMarkdown(markdown), markdown, options);
		},

		exportDocument(doc, options = {}) {
			// Work on a copy: the caller's document is left as it was.
			return write(structuredClone(doc), '', options);
		},

		events: {
			query: (q) => index.query(q),
			get: (id) => index.get(id),
			problems: (path) => index.problems(path),
			subscribe: (fn) => index.subscribe(fn),
			ready: () => index.ready(),
		},

		registerEventSource: (source) => index.registerSource(source),

		templates: {
			register(id, name, docx) {
				templateStyles(docx);
				templates.set(id, { name, docx });
				return () => { templates.delete(id); };
			},
			select(id) {
				if (id !== null && !templates.has(id)) throw new ExtensionError(`There is no template "${id}".`);
				host.saveSelectedTemplate(id);
			},
			selected: () => {
				const id = host.selectedTemplate();
				return id && templates.has(id) ? id : null;
			},
			list: (): TemplateInfo[] => [...templates].map(([id, t]) => ({ id, name: t.name })),
		},
	};
	return api;
}
