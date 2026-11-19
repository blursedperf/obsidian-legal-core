/**
 * Extension points for the Markdown pipeline: new syntax, and renderers for the nodes it produces.
 *
 * Syntax comes in two forms, both read from the parsed document so that the core parser is unchanged:
 * - a fenced block with a language of its own (```case-note … ```), turned into blocks;
 * - an inline pattern in text (such as [[cite:mabo]]), turned into inline nodes.
 * Either may produce `custom` nodes, which a renderer then turns into ordinary nodes before the document
 * is written, so every writer (Word, HTML, the page preview) can show them.
 */
import type { Block, Inline, MdDocument } from '@legal-core/ldm';
import type { Transform } from './transforms';

export interface FenceSyntax {
	type: 'fence';
	/** The language after the opening fence, eg "case-note". */
	lang: string;
	parse(source: string): Block[];
}

export interface InlineSyntax {
	type: 'inline';
	/** Matched in text (not in code or URLs). Must have the global flag. */
	pattern: RegExp;
	parse(match: RegExpExecArray): Inline[];
}

export type SyntaxExtension = FenceSyntax | InlineSyntax;

export interface Renderer {
	/** The `kind` of the custom nodes it renders. */
	kind: string;
	/** Ordinary blocks for a custom block. */
	block?(data: unknown): Block[];
	/** Ordinary inline nodes for a custom inline node. */
	inline?(data: unknown): Inline[];
}

/** Run over every block list, including those inside quotations, lists and footnotes. */
function mapBlocks(blocks: Block[], fn: (b: Block) => Block[]): Block[] {
	const out: Block[] = [];
	for (const b of blocks) {
		if (b.t === 'quote') out.push(...fn({ ...b, blocks: mapBlocks(b.blocks, fn) }));
		else if (b.t === 'list') out.push(...fn({ ...b, items: b.items.map((it) => mapBlocks(it, fn)) }));
		else if (b.t === 'ooxml') out.push(...fn({ ...b, fallback: mapBlocks(b.fallback, fn) }));
		else out.push(...fn(b));
	}
	return out;
}

function mapInlines(nodes: Inline[], fn: (n: Inline) => Inline[]): Inline[] {
	const out: Inline[] = [];
	for (const n of nodes) {
		if ('c' in n) out.push(...fn({ ...n, c: mapInlines(n.c, fn) }));
		else out.push(...fn(n));
	}
	return out;
}

/** Apply `fn` to the inline content of every block. */
function eachInlines(blocks: Block[], fn: (nodes: Inline[]) => Inline[]): Block[] {
	return mapBlocks(blocks, (b) => {
		switch (b.t) {
			case 'heading':
			case 'para': return [{ ...b, c: fn(b.c) }];
			case 'table': return [{ ...b, header: b.header.map(fn), rows: b.rows.map((r) => r.map(fn)) }];
			default: return [b];
		}
	});
}

function everywhere(doc: MdDocument, fn: (blocks: Block[]) => Block[]) {
	doc.blocks = fn(doc.blocks);
	for (const [label, blocks] of doc.footnotes) doc.footnotes.set(label, fn(blocks));
}

function inlineSyntax(nodes: Inline[], syntax: InlineSyntax[]): Inline[] {
	return mapInlines(nodes, (n) => {
		if (n.t !== 'text') return [n];
		let parts: Inline[] = [n];
		for (const s of syntax) {
			parts = parts.flatMap((p) => {
				if (p.t !== 'text') return [p];
				const out: Inline[] = [];
				const re = new RegExp(s.pattern.source, s.pattern.flags.includes('g') ? s.pattern.flags : `${s.pattern.flags}g`);
				let last = 0;
				let m: RegExpExecArray | null;
				while ((m = re.exec(p.v))) {
					if (m[0].length === 0) { re.lastIndex++; continue; }
					if (m.index > last) out.push({ t: 'text', v: p.v.slice(last, m.index) });
					out.push(...s.parse(m));
					last = m.index + m[0].length;
				}
				if (last === 0) return [p];
				if (last < p.v.length) out.push({ t: 'text', v: p.v.slice(last) });
				return out;
			});
		}
		return parts;
	});
}

/** The transform that reads registered syntax. It runs first, before any other transform. */
export function syntaxTransform<C>(id: string, syntax: readonly SyntaxExtension[]): Transform<C> {
	const fences = new Map(syntax.filter((s): s is FenceSyntax => s.type === 'fence').map((s) => [s.lang, s]));
	const inline = syntax.filter((s): s is InlineSyntax => s.type === 'inline');
	return {
		id,
		run: (doc) => {
			if (fences.size > 0) {
				everywhere(doc, (blocks) => mapBlocks(blocks, (b) => (b.t === 'code' && fences.has(b.lang) ? fences.get(b.lang)!.parse(b.v) : [b])));
			}
			if (inline.length > 0) everywhere(doc, (blocks) => eachInlines(blocks, (nodes) => inlineSyntax(nodes, inline)));
		},
	};
}

/**
 * The transform that renders custom nodes into ordinary ones, after the transforms named in `after`.
 * A custom node with no renderer is left out, so it never reaches a writer.
 */
export function renderTransform<C>(id: string, renderers: readonly Renderer[], after: string[]): Transform<C> {
	const byKind = new Map(renderers.map((r) => [r.kind, r]));
	return {
		id,
		after,
		run: (doc) => {
			everywhere(doc, (blocks) => mapBlocks(blocks, (b) => (b.t === 'custom' ? byKind.get(b.kind)?.block?.(b.data) ?? [] : [b])));
			everywhere(doc, (blocks) => eachInlines(blocks, (nodes) => mapInlines(nodes, (n) => (n.t === 'custom' ? byKind.get(n.kind)?.inline?.(n.data) ?? [] : [n]))));
		},
	};
}
