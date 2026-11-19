/**
 * Finding, numbering and tidying Markdown footnotes.
 *
 * Obsidian numbers footnotes by the order their references first appear, whatever their labels, so
 * "footnote N" here always means the N-th footnote in reading order. Cross-references "(n N)" use the
 * same numbering.
 */

export interface FootnoteRef {
	label: string;
	from: number;
	to: number;
}

export interface FootnoteDef {
	label: string;
	/** Whole definition including the "[^label]: " marker and continuation lines. */
	from: number;
	to: number;
	/** Offset of the footnote text (after the marker). */
	contentFrom: number;
	content: string;
}

export interface InlineFootnote {
	from: number;
	to: number;
	contentFrom: number;
	content: string;
}

export interface Note {
	number: number;
	/** Label for reference footnotes, null for inline ^[...] footnotes. */
	label: string | null;
	refs: FootnoteRef[];
	def: FootnoteDef | null;
	inline: InlineFootnote | null;
	/** Footnote text and its absolute offset in the document. */
	content: string;
	contentFrom: number;
}

export interface FootnoteScan {
	notes: Note[];
	refs: FootnoteRef[];
	defs: FootnoteDef[];
	inlines: InlineFootnote[];
	/** Ranges that are code, frontmatter or comments and so not prose. */
	excluded: [number, number][];
}

const DEF_RE = /^\[\^([^\]\s]+)\]:[ \t]?/;
const REF_RE = /\[\^([^\]\s]+)\](?!:)/g;

/** Ranges of fenced code, frontmatter, %% comments %% and inline code, which are never scanned. */
export function excludedRanges(text: string): [number, number][] {
	const out: [number, number][] = [];
	const fm = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
	if (fm) out.push([0, fm[0].length]);
	const fence = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1[ \t]*$|(?![\s\S]))/gm;
	let m: RegExpExecArray | null;
	while ((m = fence.exec(text))) out.push([m.index, m.index + m[0].length]);
	const comment = /%%[\s\S]*?(?:%%|$)/g;
	while ((m = comment.exec(text))) out.push([m.index, m.index + m[0].length]);
	const code = /(`+)(?!`)[^\n]*?[^`]\1(?!`)/g;
	while ((m = code.exec(text))) {
		const at = m.index;
		if (!out.some(([a, b]) => at >= a && at < b)) out.push([at, at + m[0].length]);
	}
	return out.sort((a, b) => a[0] - b[0]);
}

function inRanges(ranges: [number, number][], at: number): boolean {
	for (const [a, b] of ranges) {
		if (at >= a && at < b) return true;
		if (a > at) break;
	}
	return false;
}

/** Find the closing bracket of an inline footnote starting at `open` (the "[" after "^"). */
function closeBracket(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const c = text[i];
		if (c === '\\') { i++; continue; }
		if (c === '\n' && text[i + 1] === '\n') return -1;
		if (c === '[') depth++;
		else if (c === ']') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

export function scanFootnotes(text: string): FootnoteScan {
	const excluded = excludedRanges(text);
	const defs: FootnoteDef[] = [];
	const defRanges: [number, number][] = [];

	// Definitions: a marker at the start of a line, plus indented continuation lines.
	const lines = text.split('\n');
	let offset = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const lineStart = offset;
		offset += line.length + 1;
		if (inRanges(excluded, lineStart)) continue;
		const m = DEF_RE.exec(line);
		if (!m) continue;
		let end = lineStart + line.length;
		let j = i + 1;
		let probe = offset;
		while (j < lines.length) {
			const next = lines[j]!;
			if (/^(?: {2,}|\t)\S/.test(next)) {
				end = probe + next.length;
			} else if (next.trim() === '' && j + 1 < lines.length && /^(?: {4}|\t)\S/.test(lines[j + 1]!)) {
				// a blank line inside a multi-paragraph footnote
			} else break;
			probe += next.length + 1;
			j++;
		}
		const contentFrom = lineStart + m[0].length;
		defs.push({ label: m[1]!, from: lineStart, to: end, contentFrom, content: text.slice(contentFrom, end) });
		defRanges.push([lineStart, end]);
		offset = probe;
		i = j - 1;
	}

	const refs: FootnoteRef[] = [];
	let m: RegExpExecArray | null;
	REF_RE.lastIndex = 0;
	while ((m = REF_RE.exec(text))) {
		if (inRanges(excluded, m.index) || defRanges.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
		refs.push({ label: m[1]!, from: m.index, to: m.index + m[0].length });
	}

	const inlines: InlineFootnote[] = [];
	const inlineRe = /\^\[/g;
	while ((m = inlineRe.exec(text))) {
		if (inRanges(excluded, m.index) || defRanges.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
		const close = closeBracket(text, m.index + 1);
		if (close < 0) continue;
		inlines.push({ from: m.index, to: close + 1, contentFrom: m.index + 2, content: text.slice(m.index + 2, close) });
		inlineRe.lastIndex = close + 1;
	}

	const defByLabel = new Map<string, FootnoteDef>();
	for (const d of defs) if (!defByLabel.has(d.label)) defByLabel.set(d.label, d);

	type Item = { at: number; ref?: FootnoteRef; inline?: InlineFootnote };
	const items: Item[] = [...refs.map((r) => ({ at: r.from, ref: r })), ...inlines.map((i) => ({ at: i.from, inline: i }))]
		.sort((a, b) => a.at - b.at);
	const notes: Note[] = [];
	const byLabel = new Map<string, Note>();
	for (const item of items) {
		if (item.ref) {
			const existing = byLabel.get(item.ref.label);
			if (existing) {
				existing.refs.push(item.ref);
				continue;
			}
			const def = defByLabel.get(item.ref.label) ?? null;
			const note: Note = {
				number: notes.length + 1,
				label: item.ref.label,
				refs: [item.ref],
				def,
				inline: null,
				content: def?.content ?? '',
				contentFrom: def?.contentFrom ?? -1,
			};
			notes.push(note);
			byLabel.set(item.ref.label, note);
		} else if (item.inline) {
			notes.push({
				number: notes.length + 1,
				label: null,
				refs: [],
				def: null,
				inline: item.inline,
				content: item.inline.content,
				contentFrom: item.inline.contentFrom,
			});
		}
	}
	return { notes, refs, defs, inlines, excluded };
}

// ---------------------------------------------------------------------------------------------------------
// Tidying

export interface TidyOptions {
	/**
	 * Where the note's back matter (its bibliography) starts, or -1. It is kept after the footnote
	 * definitions, at the end of the note.
	 */
	backMatter?: (text: string) => number;
	/** Relabel reference footnotes 1, 2, 3 … in reading order. */
	renumber: boolean;
	/** Turn ^[inline] footnotes into reference footnotes. */
	convertInline: boolean;
}

export interface TidyResult {
	text: string;
	changed: boolean;
	/** Old label → new label. */
	relabelled: Map<string, string>;
	/** Set when the tidied text failed the safety check and the text was left as it was. */
	unsafe?: boolean;
}

/** What tidying must not change: the text outside footnotes, and the text of every footnote. */
function essentials(text: string): { body: string; notes: string[] } {
	const scan = scanFootnotes(text);
	const cuts = [
		...scan.defs.map((d) => ({ from: d.from, to: d.to, insert: ' ' })),
		...scan.refs.map((r) => ({ from: r.from, to: r.to, insert: '[^]' })),
		...scan.inlines.map((n) => ({ from: n.from, to: n.to, insert: '[^]' })),
	].sort((a, b) => b.from - a.from);
	let body = text;
	for (const c of cuts) body = body.slice(0, c.from) + c.insert + body.slice(c.to);
	const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
	const notes = [...scan.defs.map((d) => norm(dedent(d.content))), ...scan.inlines.map((n) => norm(n.content))].sort();
	return { body: norm(body), notes };
}

/**
 * True when `after` keeps everything in `before`: the same text outside footnotes (apart from footnote
 * labels and where the definitions are), and the text of every footnote. Checked before tidied text
 * replaces a note, so that a fault can never lose writing.
 */
export function preservesContent(before: string, after: string): boolean {
	const a = essentials(before);
	const b = essentials(after);
	if (a.notes.length !== b.notes.length || a.notes.some((n, i) => n !== b.notes[i])) return false;
	// The bibliography moves after the definitions; with them cut out, the order is unchanged.
	return a.body === b.body;
}

/** Remove the indentation of continuation lines in a definition's content. */
function dedent(content: string): string {
	return content.replace(/\n(?: {2,4}|\t)/g, '\n');
}

/** Indent continuation lines of footnote content for a definition. */
function indent(content: string): string {
	return content.split('\n').map((l, i) => (i === 0 || l.trim() === '' ? l : `    ${l}`)).join('\n');
}

/**
 * Move every footnote definition to the bottom of the note, in reading order, optionally renumbering
 * labels and converting inline footnotes. Unreferenced definitions are kept, after the referenced ones.
 * Text other than footnote markers and definitions is not changed.
 */
export function tidyFootnotes(text: string, opts: TidyOptions): TidyResult {
	const scan = scanFootnotes(text);
	const relabelled = new Map<string, string>();
	const used = new Set(scan.defs.map((d) => d.label));
	if (scan.defs.length === 0 && (!opts.convertInline || scan.inlines.length === 0)) {
		return { text, changed: false, relabelled };
	}

	// Decide each note's final label.
	let counter = 0;
	const finalLabel = new Map<Note, string>();
	for (const note of scan.notes) {
		if (note.inline && !opts.convertInline) continue;
		counter++;
		let label: string;
		if (opts.renumber) label = String(counter);
		else if (note.label) label = note.label;
		else {
			let n = counter;
			while (used.has(String(n))) n++;
			label = String(n);
			used.add(label);
		}
		finalLabel.set(note, label);
		if (note.label && note.label !== label) relabelled.set(note.label, label);
	}

	// Labels of unreferenced definitions must not collide with new labels.
	const finalSet = new Set(finalLabel.values());
	const orphans = scan.defs.filter((d) => !scan.notes.some((n) => n.def === d));
	const orphanLabel = new Map<FootnoteDef, string>();
	for (const d of orphans) {
		let label = d.label;
		if (finalSet.has(label)) {
			let k = 1;
			while (finalSet.has(`${d.label}-${k}`)) k++;
			label = `${d.label}-${k}`;
		}
		finalSet.add(label);
		orphanLabel.set(d, label);
	}

	// Rewrite the body: drop definitions, relabel refs, replace converted inline footnotes.
	type Edit = { from: number; to: number; insert: string };
	const edits: Edit[] = [];
	for (const d of scan.defs) {
		// Remove the definition and the newline after it.
		let to = d.to;
		if (text[to] === '\n') to++;
		edits.push({ from: d.from, to, insert: '' });
	}
	for (const note of scan.notes) {
		const label = finalLabel.get(note);
		if (!label) continue;
		if (note.inline) edits.push({ from: note.inline.from, to: note.inline.to, insert: `[^${label}]` });
		for (const r of note.refs) if (r.label !== label) edits.push({ from: r.from, to: r.to, insert: `[^${label}]` });
	}
	edits.sort((a, b) => b.from - a.from);
	let body = text;
	for (const e of edits) body = body.slice(0, e.from) + e.insert + body.slice(e.to);

	// Collapse the blank lines left behind and trim the end.
	body = body.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
	// A bibliography stays after the footnotes, at the end of the note.
	const bib = opts.backMatter?.(body) ?? -1;
	const back = bib >= 0 ? body.slice(bib) : '';
	if (bib >= 0) body = body.slice(0, bib).replace(/\s+$/, '');

	const defsOut: string[] = [];
	const emitted = new Set<string>();
	for (const note of scan.notes) {
		const label = finalLabel.get(note);
		if (!label || emitted.has(label)) continue;
		emitted.add(label);
		const content = note.inline ? note.inline.content : note.def?.content;
		if (content === undefined) continue;
		defsOut.push(`[^${label}]: ${indent(note.inline ? content : dedent(content))}`);
	}
	for (const d of orphans) defsOut.push(`[^${orphanLabel.get(d)!}]: ${indent(dedent(d.content))}`);

	let out = defsOut.length > 0 ? `${body}\n\n${defsOut.join('\n')}\n` : `${body}\n`;
	if (back) out = `${out.replace(/\s+$/, '')}\n\n${back}\n`;
	if (out !== text && !preservesContent(text, out)) return { text, changed: false, relabelled: new Map(), unsafe: true };
	return { text: out, changed: out !== text, relabelled };
}

// ---------------------------------------------------------------------------------------------------------
// Cross-references

export const CROSS_REF_RE = /\(n\s(\d+)\)/g;

/**
 * Keep "(n N)" cross-references pointing at the same footnotes after footnotes were added, removed or
 * moved. `before` lists, for each footnote number (index + 1), an identity key of the footnote as it was;
 * `after` the same for the current text. Only references whose target moved are rewritten.
 */
export function remapCrossReferences(text: string, before: string[], after: string[]): { text: string; changed: number } {
	const newNumber = new Map<string, number>();
	after.forEach((key, i) => { if (!newNumber.has(key)) newNumber.set(key, i + 1); });
	const scan = scanFootnotes(text);
	type Edit = { from: number; to: number; insert: string };
	const edits: Edit[] = [];
	for (const note of scan.notes) {
		if (note.contentFrom < 0) continue;
		CROSS_REF_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = CROSS_REF_RE.exec(note.content))) {
			const oldN = Number(m[1]);
			const key = before[oldN - 1];
			if (key === undefined) continue;
			const n = newNumber.get(key);
			if (n === undefined || n === oldN) continue;
			const at = note.contentFrom + m.index + 3;
			edits.push({ from: at, to: at + m[1]!.length, insert: String(n) });
		}
	}
	edits.sort((a, b) => b.from - a.from);
	let out = text;
	for (const e of edits) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
	return { text: out, changed: edits.length };
}

/** Identity keys for footnotes, stable across edits that do not touch the footnote itself. */
export function footnoteKeys(scan: FootnoteScan): string[] {
	return scan.notes.map((n) => (n.label !== null ? `label:${n.label}` : `inline:${n.content}`));
}

/**
 * Keys that survive relabelling: when tidying renames label "a" to "3", the key "label:a" in a snapshot
 * taken before should be read as "label:3".
 */
export function relabelKeys(keys: string[], relabelled: Map<string, string>): string[] {
	return keys.map((k) => (k.startsWith('label:') && relabelled.has(k.slice(6)) ? `label:${relabelled.get(k.slice(6))!}` : k));
}
