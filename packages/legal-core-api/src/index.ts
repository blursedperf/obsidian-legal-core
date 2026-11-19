/**
 * Types of the Legal Core API: what `app.plugins.getPlugin('au-legal-core').api` provides to other
 * plugins. Types only; import them with `import type`, so a plugin that uses Legal Core still works when
 * Legal Core is not installed. See plugins/legal-core/API.md.
 */
import type { Block, Inline, MdDocument } from '@legal-core/ldm';
import type { FenceSyntax, InlineSyntax, Renderer, SyntaxExtension } from '@legal-core/md-pipeline';
import type { AuthorityEvent, AuthorityInput, AuthorityKind, AuthorityQuery, AuthorityRecord } from '@legal-core/authority-store';

export type { Block, Inline, MdDocument, FenceSyntax, InlineSyntax, Renderer, SyntaxExtension };
export type { AuthorityEvent, AuthorityInput, AuthorityKind, AuthorityQuery, AuthorityRecord };

/** The plugin id of Legal Core. */
export type LegalCorePluginId = 'au-legal-core';

/** Workspace events Legal Core triggers: `app.workspace.on(LEGAL_CORE_READY, (api) => …)`. */
export type LegalCoreReadyEvent = 'legal-core:ready';
export type LegalCoreUnloadEvent = 'legal-core:unload';

/** A step that changes the parsed document before it is written. */
export interface ExtensionTransform {
	/** Unique within the extension. Other extensions refer to it as "<extension id>:<id>". */
	id: string;
	/**
	 * Steps that must run first, when they are present: another extension's "<extension id>:<id>", or
	 * Legal Core's own steps "syntax", "aglc-headings", "aglc-bibliography", "render" (custom nodes turned
	 * into ordinary ones), "aglc-ordinals" and "aglc-quotes". A step that is not registered (its plugin is
	 * not installed, or loads later) is skipped. With neither `after` nor `before`, it runs after Legal
	 * Core's steps.
	 */
	after?: string[];
	/** Steps that must run after this one, when they are present, eg "aglc-quotes" to have quotes curled. */
	before?: string[];
	fn(doc: MdDocument): void;
}

export interface LegalExtension {
	/** Unique among extensions, eg the plugin id "case-notes". */
	id: string;
	syntax?: SyntaxExtension[];
	transforms?: ExtensionTransform[];
	renderers?: Renderer[];
}

export interface ExportDocxOptions {
	font?: string;
	fontSize?: number;
	footnoteSize?: number;
	lineSpacing?: 1 | 1.5 | 2;
	smartQuotes?: boolean;
	pageNumbers?: boolean;
	title?: string;
	headingScheme?: 'plain' | 'aglc';
	aglcTopLevel?: 'auto' | 'h1' | 'h2';
	keepFootnotesTogether?: boolean;
	bibliography?: boolean;
	/** A registered template's id; by default the selected template, if any. `null` for none. */
	template?: string | null;
}

export interface AuthoritiesApi {
	get(id: string): Promise<AuthorityRecord | null>;
	query(q?: AuthorityQuery): Promise<AuthorityRecord[]>;
	upsert(input: AuthorityInput): Promise<AuthorityRecord>;
	/** Returns a function that stops the subscription. */
	subscribe(fn: (e: AuthorityEvent) => void): () => void;
}

export interface TemplateInfo {
	id: string;
	name: string;
}

export interface TemplatesApi {
	/** Register a reference Word document whose styles are used in exports. Returns a function that removes it. */
	register(id: string, name: string, docx: Uint8Array): () => void;
	/** Choose the template used by default (null for none). */
	select(id: string | null): void;
	selected(): string | null;
	list(): TemplateInfo[];
}

/** The file whose Markdown is exported: anything with a path, such as Obsidian's TFile. */
export interface FileRef {
	path: string;
}

export interface LegalCoreApi {
	/** The API's version (semver), eg "1.0.0". */
	readonly version: string;
	/** Whether the version satisfies a range: "^1.0", "~1.2.0", "1.x", ">=1.1.0", or an exact version. */
	satisfies(range: string): boolean;
	/** Add syntax, transforms and renderers to Legal Core's exports. Returns a function that removes them. */
	registerExtension(extension: LegalExtension): () => void;
	readonly authorities: AuthoritiesApi;
	/** Export Markdown (or a note) to a Word document, with every registered extension. */
	exportDocx(source: string | FileRef, options?: ExportDocxOptions): Promise<Uint8Array>;
	readonly templates: TemplatesApi;
}
