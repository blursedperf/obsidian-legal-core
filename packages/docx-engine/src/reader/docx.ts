/**
 * Import a Word document as a note. Footnotes and endnotes become Markdown footnotes at the bottom of the
 * note, numbered in reading order. Italics and bold (direct or from character and paragraph styles),
 * strikethrough, highlights, headings, lists, block quotations, tables and links are kept. Fields
 * (Zotero/EndNote citations, cross-references) keep the text Word displays. Tracked insertions are
 * accepted and deletions dropped.
 */
import { strFromU8, unzipSync } from 'fflate';

/**
 * How a document's headings are numbered, so that numbers typed into headings can be recognised and
 * removed (the AGLC4 hierarchy is supplied by the aglc package).
 */
export interface HeadingNumbering {
	/** The number of each heading, given their levels, with `h2` when the first heading is the title. */
	numberHeadings(levels: number[], top: 'h1' | 'h2'): { number: string | null }[];
	/** True when the text starts with a number typed by hand, followed by a tab or two spaces. */
	hasTypedNumber(text: string): boolean;
	stripTypedNumber(text: string): string;
}

import { type XmlElement, find, findAll, isElement, kid, kids, parseXml } from './xml';

export interface ImportResult {
	markdown: string;
	footnotes: number;
	/** Things that were not imported, for the user. */
	warnings: string[];
	/** Headings whose typed or automatic numbers were removed. */
	numberedHeadings: number;
}

interface Fmt {
	i: boolean;
	b: boolean;
	strike: boolean;
	mark: boolean;
	smallCaps: boolean;
}

interface Seg {
	text: string;
	fmt: Fmt;
	link?: string;
}

type Piece = Seg | { fn: number };

interface StyleDef {
	type: string;
	name: string;
	basedOn?: string;
	rPr?: XmlElement;
	pPr?: XmlElement;
}

const W = (name: string) => `w:${name}`;
const val = (el: XmlElement | undefined) => el?.attrs['w:val'];

/** A toggle property (w:b, w:i …): present means on unless its value says off. */
function toggle(rPr: XmlElement | undefined, name: string): boolean | undefined {
	const el = kid(rPr, W(name));
	if (!el) return undefined;
	const v = val(el);
	return !(v === 'false' || v === '0' || v === 'off' || v === 'none');
}

class Converter {
	private styles = new Map<string, StyleDef>();
	private numFormats = new Map<string, Map<string, string>>();
	/** Link targets of each part (document, footnotes, endnotes): each part numbers its own. */
	private partRels = new Map<string, Map<string, string>>();
	/** Link targets of the part being converted. */
	private rels = new Map<string, string>();
	private notes = new Map<string, XmlElement>();
	private endnotes = new Map<string, XmlElement>();
	private noteOrder: { kind: 'footnote' | 'endnote'; id: string }[] = [];
	private hasTitle = false;
	readonly warnings = new Set<string>();
	numberedHeadings = 0;

	constructor(private files: Record<string, Uint8Array>, private headingNumbering: HeadingNumbering) {
		const xml = (path: string) => (files[path] ? parseXml(strFromU8(files[path])) : undefined);
		const styles = xml('word/styles.xml');
		for (const s of kids(kid(styles, W('styles')), W('style'))) {
			const id = s.attrs['w:styleId'];
			if (!id) continue;
			this.styles.set(id, {
				type: s.attrs['w:type'] ?? '',
				name: (val(kid(s, W('name'))) ?? id).toLowerCase(),
				basedOn: val(kid(s, W('basedOn'))),
				rPr: kid(s, W('rPr')),
				pPr: kid(s, W('pPr')),
			});
		}

		const numbering = kid(xml('word/numbering.xml'), W('numbering'));
		const abstract = new Map<string, Map<string, string>>();
		for (const a of kids(numbering, W('abstractNum'))) {
			const levels = new Map<string, string>();
			for (const l of kids(a, W('lvl'))) levels.set(l.attrs['w:ilvl'] ?? '0', val(kid(l, W('numFmt'))) ?? 'decimal');
			abstract.set(a.attrs['w:abstractNumId'] ?? '', levels);
		}
		for (const n of kids(numbering, W('num'))) {
			const levels = new Map(abstract.get(val(kid(n, W('abstractNumId'))) ?? '') ?? []);
			for (const o of kids(n, W('lvlOverride'))) {
				const fmt = val(kid(kid(o, W('lvl')), W('numFmt')));
				if (fmt) levels.set(o.attrs['w:ilvl'] ?? '0', fmt);
			}
			this.numFormats.set(n.attrs['w:numId'] ?? '', levels);
		}

		for (const part of ['document', 'footnotes', 'endnotes']) {
			const map = new Map<string, string>();
			for (const r of kids(kid(xml(`word/_rels/${part}.xml.rels`), 'Relationships'), 'Relationship')) {
				// Only links out of the document: other relationships point at the document's own parts.
				if (r.attrs.Id && r.attrs.Target && /\/hyperlink$/.test(r.attrs.Type ?? '')) map.set(r.attrs.Id, r.attrs.Target);
			}
			this.partRels.set(part, map);
		}
		this.rels = this.partRels.get('document')!;
		for (const [file, map, tag] of [['word/footnotes.xml', this.notes, 'footnote'], ['word/endnotes.xml', this.endnotes, 'endnote']] as const) {
			for (const n of kids(kid(xml(file), W(`${tag}s`)), W(tag))) {
				const type = n.attrs['w:type'];
				if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') continue;
				map.set(n.attrs['w:id'] ?? '', n);
			}
		}
	}

	/** Follow a style and the styles it is based on. */
	private chain(id: string | undefined): StyleDef[] {
		const out: StyleDef[] = [];
		const seen = new Set<string>();
		while (id && !seen.has(id)) {
			seen.add(id);
			const s = this.styles.get(id);
			if (!s) break;
			out.push(s);
			id = s.basedOn;
		}
		return out;
	}

	private styleToggle(id: string | undefined, name: string): boolean | undefined {
		for (const s of this.chain(id)) {
			const t = toggle(s.rPr, name);
			if (t !== undefined) return t;
		}
		return undefined;
	}

	private fmt(rPr: XmlElement | undefined, paraStyle: string | undefined, usePara: boolean): Fmt {
		const charStyle = val(kid(rPr, W('rStyle')));
		const get = (name: string) => toggle(rPr, name) ?? this.styleToggle(charStyle, name) ?? (usePara ? this.styleToggle(paraStyle, name) : undefined) ?? false;
		const highlight = val(kid(rPr, W('highlight')));
		const charName = this.styles.get(charStyle ?? '')?.name ?? '';
		return {
			i: get('i') || charName === 'emphasis',
			b: get('b') || charName === 'strong',
			strike: get('strike') || get('dstrike'),
			mark: !!highlight && highlight !== 'none',
			smallCaps: get('smallCaps'),
		};
	}

	/** Heading level of a paragraph style (1–6), 0 for the title style, or null. */
	private headingLevel(styleId: string | undefined, pPr: XmlElement | undefined): number | null {
		// The nearest style whose name gives a level wins: a custom "Law H1 rome" based on "Law H3 num" is
		// level one.
		for (const s of this.chain(styleId)) {
			const level = levelFromStyleName(s.name);
			if (level !== null) return level;
		}
		const outline = val(kid(pPr, W('outlineLvl'))) ?? this.chain(styleId).map((s) => val(kid(s.pPr, W('outlineLvl')))).find((v) => v !== undefined);
		if (outline !== undefined && Number(outline) < 6) return Number(outline) + 1;
		return null;
	}

	private paraProp(pPr: XmlElement | undefined, styleId: string | undefined, name: string): XmlElement | undefined {
		const direct = kid(pPr, W(name));
		if (direct) return direct;
		for (const s of this.chain(styleId)) {
			const el = kid(s.pPr, W(name));
			if (el) return el;
		}
		return undefined;
	}

	/** Collect the runs of a paragraph (or hyperlink, insertion …) as text pieces and footnote markers. */
	private inline(el: XmlElement, paraStyle: string | undefined, usePara: boolean, inNote: boolean, out: Piece[], field: { depth: number; skip: boolean[] }, link?: string): void {
		for (const c of el.children) {
			if (!isElement(c)) continue;
			switch (c.name) {
				case 'w:r':
					this.run(c, paraStyle, usePara, inNote, out, field, link);
					break;
				case 'w:hyperlink': {
					const id = c.attrs['r:id'];
					const target = id ? this.rels.get(id) : undefined;
					this.inline(c, paraStyle, usePara, inNote, out, field, target ?? link);
					break;
				}
				case 'w:ins':
				case 'w:smartTag':
				case 'w:customXml':
				case 'w:fldSimple':
				case 'w:sdtContent':
					this.inline(c, paraStyle, usePara, inNote, out, field, link);
					break;
				case 'w:sdt':
					this.inline(kid(c, W('sdtContent')) ?? c, paraStyle, usePara, inNote, out, field, link);
					break;
				case 'w:del':
					this.warnings.add('Tracked deletions were left out and insertions accepted.');
					break;
				case 'm:oMath':
				case 'm:oMathPara':
					this.warnings.add('Equations were left out.');
					break;
				default:
					break;
			}
		}
	}

	private run(r: XmlElement, paraStyle: string | undefined, usePara: boolean, inNote: boolean, out: Piece[], field: { depth: number; skip: boolean[] }, link?: string): void {
		const rPr = kid(r, W('rPr'));
		const fmt = this.fmt(rPr, paraStyle, usePara);
		const push = (text: string) => {
			if (field.skip.some(Boolean)) return;
			out.push({ text, fmt, link });
		};
		for (const c of r.children) {
			if (!isElement(c)) continue;
			switch (c.name) {
				case 'w:fldChar': {
					const t = c.attrs['w:fldCharType'];
					if (t === 'begin') { field.skip.push(true); field.depth++; }
					else if (t === 'separate') { field.skip[field.skip.length - 1] = false; }
					else if (t === 'end') { field.skip.pop(); field.depth--; }
					break;
				}
				case 'w:t': push(c.children.filter((x): x is string => !isElement(x)).join('')); break;
				case 'w:tab': push('\t'); break;
				case 'w:br': if (c.attrs['w:type'] !== 'page' && c.attrs['w:type'] !== 'column') push('\n'); break;
				case 'w:cr': push('\n'); break;
				case 'w:noBreakHyphen': push('-'); break;
				case 'w:sym': {
					const code = c.attrs['w:char'];
					if (code) push(String.fromCodePoint(parseInt(code, 16) & 0xffff || 0x20));
					break;
				}
				case 'w:footnoteReference':
				case 'w:endnoteReference': {
					if (inNote || field.skip.some(Boolean)) break;
					const kind = c.name === 'w:footnoteReference' ? 'footnote' : 'endnote';
					this.noteOrder.push({ kind, id: c.attrs['w:id'] ?? '' });
					out.push({ fn: this.noteOrder.length });
					break;
				}
				case 'w:drawing':
				case 'w:pict':
				case 'w:object':
					this.warnings.add('Images and embedded objects were left out.');
					break;
				default:
					break;
			}
		}
	}

	/** Pieces to Markdown inline text. */
	private markdown(pieces: Piece[]): string {
		// Merge neighbouring text with the same formatting and link.
		const merged: Piece[] = [];
		for (const p of pieces) {
			const last = merged[merged.length - 1];
			if ('text' in p && last && 'text' in last && sameFmt(last.fmt, p.fmt) && last.link === p.link) last.text += p.text;
			else merged.push('fn' in p ? p : { ...p });
		}
		let out = '';
		for (const p of merged) {
			if ('fn' in p) { out += `[^${p.fn}]`; continue; }
			out += this.formatSeg(p, out);
		}
		return out;
	}

	private formatSeg(s: Seg, before: string): string {
		let text = s.text;
		const link = s.link ? cleanTarget(s.link) : null;
		if (link) {
			const shown = text.trim();
			const bare = shown.replace(/^<|>$/g, '');
			if (bare === link || bare === link.replace(/^mailto:/, '') || bare.replace(/\/$/, '') === link.replace(/\/$/, '')) {
				// A URL shown as itself: keep it as text, so AGLC4 "<https://…>" survives (including a ">"
				// that Word made part of the link).
				text = shown;
			} else {
				return wrap(`[${escapeMd(text).replace(/[[\]]/g, '\\$&')}](${link.replace(/[()]/g, encodeURIComponent)})`, s.fmt);
			}
		}
		const lead = /^\s*/.exec(text)![0];
		const trail = /\s*$/.exec(text.slice(lead.length))![0];
		const core = text.slice(lead.length, text.length - trail.length);
		if (!core) return text;
		// Escaping depends on what precedes the text (eg a "[" before "^").
		const escaped = escapeMd(core, before + lead);
		return lead + wrap(escaped, s.fmt) + trail;
	}

	/** Convert a paragraph to a Markdown block. */
	private paragraph(p: XmlElement, inNote: boolean): { kind: 'heading' | 'list' | 'quote' | 'para'; text: string; level: number; ordered?: boolean } | null {
		const pPr = kid(p, W('pPr'));
		const styleId = val(kid(pPr, W('pStyle')));
		let heading = inNote ? null : this.headingLevel(styleId, pPr);
		let pieces: Piece[] = [];
		this.inline(p, styleId, heading === null, inNote, pieces, { depth: 0, skip: [] });
		if (heading === null && !inNote) {
			heading = manualAglcHeading(pieces, this.paraProp(pPr, styleId, 'jc'));
			if (heading !== null) {
				// Re-read without the paragraph's own formatting: heading formatting comes from the level.
				pieces = [];
				this.inline(p, styleId, false, inNote, pieces, { depth: 0, skip: [] });
			}
		}
		if (heading !== null) pieces = withoutWholeFormatting(pieces);
		let text = this.markdown(pieces);

		if (heading !== null) {
			const numPr = this.paraProp(pPr, styleId, 'numPr');
			if (numPr && val(kid(numPr, W('numId'))) !== '0') this.numberedHeadings++;
			// Typed numbers are removed once all the headings are known (see numberHeadings in convert).
			text = text.replace(/\n/g, ' ').trim();
			if (!text) return null;
			const level = heading === 0 ? 1 : Math.min(6, heading + (this.hasTitle ? 1 : 0));
			return { kind: 'heading', text, level };
		}
		text = text.replace(/\t/g, ' ').replace(/[ \u00a0]+$/g, '');
		if (!text.trim()) return null;

		const numPr = inNote ? undefined : this.paraProp(pPr, styleId, 'numPr');
		const numId = val(kid(numPr, W('numId')));
		if (numPr && numId && numId !== '0') {
			const ilvl = val(kid(numPr, W('ilvl'))) ?? '0';
			const fmt = this.numFormats.get(numId)?.get(ilvl) ?? 'bullet';
			return { kind: 'list', text: text.trim(), level: Number(ilvl), ordered: fmt !== 'bullet' && fmt !== 'none' };
		}
		if (!inNote) {
			const name = this.chain(styleId).map((s) => s.name).join(' ');
			const ind = this.paraProp(pPr, styleId, 'ind');
			const left = Number(ind?.attrs['w:left'] ?? ind?.attrs['w:start'] ?? 0);
			if (/quote|block text|extract/.test(name) || left >= 567) return { kind: 'quote', text: text.trim(), level: 0 };
		}
		return { kind: 'para', text: text.trim(), level: 0 };
	}

	private table(tbl: XmlElement): string {
		const rows = kids(tbl, W('tr')).map((tr) => kids(tr, W('tc')).map((tc) =>
			kids(tc, W('p')).map((p) => this.paragraph(p, false)?.text ?? '').filter(Boolean).join('<br>').replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
		if (rows.length === 0) return '';
		const width = Math.max(...rows.map((r) => r.length));
		const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
		return [line(rows[0]!), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
	}

	convert(body: XmlElement): string {
		// Word defines a Title style whether or not it is used: what matters is a paragraph using it.
		this.hasTitle = findAll(body, W('pStyle')).some((ps) => this.headingLevel(val(ps), undefined) === 0);
		const blocks: { kind: string; text: string; level?: number }[] = [];
		const walk = (el: XmlElement) => {
			for (const c of kids(el)) {
				if (c.name === 'w:p') {
					const b = this.paragraph(c, false);
					if (!b) continue;
					if (b.kind === 'heading') blocks.push({ kind: 'heading', text: b.text, level: b.level });
					else if (b.kind === 'list') blocks.push({ kind: 'list', text: `${'    '.repeat(b.level)}${b.ordered ? '1.' : '-'} ${b.text.replace(/\n/g, `\n${'    '.repeat(b.level + 1)}`)}` });
					else if (b.kind === 'quote') blocks.push({ kind: 'quote', text: `> ${b.text.replace(/\n/g, '\n> ')}` });
					else blocks.push({ kind: 'para', text: b.text });
				} else if (c.name === 'w:tbl') {
					const t = this.table(c);
					if (t) blocks.push({ kind: 'table', text: t });
				} else if (c.name === 'w:sdt') {
					walk(kid(c, W('sdtContent')) ?? c);
				}
			}
		};
		walk(body);

		this.removeHeadingNumbers(blocks.filter((b) => b.kind === 'heading'));

		// Lists stay together; consecutive quotation paragraphs stay in one quotation.
		let md = '';
		blocks.forEach((b, i) => {
			const prev = blocks[i - 1];
			if (prev) md += prev.kind === b.kind && (b.kind === 'list') ? '\n' : prev.kind === 'quote' && b.kind === 'quote' ? '\n>\n' : '\n\n';
			md += b.text;
		});

		const defs = this.noteOrder.map((ref, i) => {
			const note = (ref.kind === 'footnote' ? this.notes : this.endnotes).get(ref.id);
			this.rels = this.partRels.get(`${ref.kind}s`) ?? new Map<string, string>();
			if (!note) return `[^${i + 1}]: `;
			const paras = kids(note, W('p'))
				.map((p) => this.paragraph(p, true)?.text ?? '')
				.filter((t) => t.length > 0);
			const text = paras.join('\n\n').replace(/^\s+/, '').replace(/\n/g, '\n    ').replace(/\n {4}\n/g, '\n\n');
			return `[^${i + 1}]: ${text}`;
		});
		if (this.endnotes.size > 0 && this.noteOrder.some((r) => r.kind === 'endnote')) this.warnings.add('Endnotes were converted to footnotes.');
		return `${md.trim()}\n${defs.length > 0 ? `\n${defs.join('\n')}\n` : ''}`;
	}

	/**
	 * Remove heading numbers typed as text. A number followed by a tab, two spaces or a non-breaking space is
	 * always removed. One followed by a single space ("I Introduction") is removed only when the document's
	 * headings follow the AGLC4 sequence (I, II …; A, B …), so "A New Approach" in an unnumbered document
	 * keeps its "A".
	 */
	private removeHeadingNumbers(headings: { text: string; level?: number }[]) {
		const expected = this.headingNumbering.numberHeadings(headings.map((h) => h.level ?? 1), this.hasTitle ? 'h2' : 'h1');
		const typed = (text: string, n: string | null) => !!n && text.startsWith(n) && /^[ \t\u00a0]+\S/.test(text.slice(n.length));
		const numbered = expected.filter((e) => e.number).length;
		const matches = headings.filter((h, i) => typed(h.text, expected[i]!.number)).length;
		const sequence = matches >= 2 && matches * 2 >= numbered;
		headings.forEach((h, i) => {
			const n = expected[i]!.number;
			if (sequence && n && typed(h.text, n)) {
				h.text = h.text.slice(n.length).replace(/^[ \t\u00a0]+/, '');
				this.numberedHeadings++;
			} else if (this.headingNumbering.hasTypedNumber(h.text)) {
				h.text = this.headingNumbering.stripTypedNumber(h.text);
				this.numberedHeadings++;
			}
			h.text = `${'#'.repeat(h.level ?? 1)} ${h.text.replace(/\t/g, ' ').trim()}`;
		});
	}

	get footnoteCount(): number {
		return this.noteOrder.length;
	}
}

/**
 * Heading level from a style name: Word's "heading 2", custom styles that name a level ("AGLC Heading 2",
 * "Law H2 let"), or 0 for a title style ("Title", "Law Title"; not "Subtitle").
 */
export function levelFromStyleName(name: string): number | null {
	const n = name.toLowerCase();
	if (/(?:^|[^a-z])title(?:[^a-z]|$)/.test(n)) return 0;
	const m = /heading\s*([1-6])(?![0-9])/.exec(n) ?? /(?:^|[^a-z0-9])h([1-6])(?![0-9])/.exec(n);
	return m ? Number(m[1]) : null;
}

/**
 * Recognise a heading formatted by hand in AGLC4 style, from its number and formatting:
 *   I     large and small capitals (or centred, upright)   → level 1
 *   A     centred italics                                  → level 2
 *   1     italics                                          → level 3
 *   (a)   italics                                          → level 4
 *   (i)   italics                                          → level 5
 * Only short, single-line paragraphs that do not end like a sentence are considered.
 */
function manualAglcHeading(pieces: Piece[], jc: XmlElement | undefined): number | null {
	const segs = pieces.filter((p): p is Seg => 'text' in p);
	const plain = segs.map((p) => p.text).join('');
	const m = /^(\([ivxlc]+\)|\([a-z]{1,2}\)|[IVXLC]+|[A-Z]|\d{1,2})[ \t\u00a0]+(?=\S)/.exec(plain);
	if (!m || plain.length > 150 || plain.includes('\n') || /[.:;,]\s*$/.test(plain)) return null;
	// Share of the heading's text (after the number) in italics or small capitals.
	let total = 0, italic = 0, small = 0, seen = 0;
	for (const p of segs) {
		for (const ch of p.text) {
			seen++;
			if (seen <= m[0].length || /\s/.test(ch)) continue;
			total++;
			if (p.fmt.i) italic++;
			if (p.fmt.smallCaps) small++;
		}
	}
	if (total === 0) return null;
	const isItalic = italic / total >= 0.7;
	const isSmallCaps = small / total >= 0.7;
	const centred = jc !== undefined && ['center', 'centre'].includes(jc.attrs['w:val'] ?? '');
	const num = m[1]!;
	if (/^[IVXLC]+$/.test(num) && (isSmallCaps || (centred && !isItalic && (num.length > 1 || !isItalic)))) return 1;
	if (/^[A-Z]$/.test(num) && centred && isItalic) return 2;
	if (/^\d{1,2}$/.test(num) && isItalic) return 3;
	if (/^\([ivxlc]+\)$/.test(num) && isItalic) return 5;
	if (/^\([a-z]{1,2}\)$/.test(num) && isItalic) return 4;
	return null;
}

/**
 * Formatting that covers the whole of a heading is the heading's own style (eg italics for AGLC4 level
 * two), not emphasis: remove it. Formatting of part of a heading, such as an italic case name, is kept.
 */
function withoutWholeFormatting(pieces: Piece[]): Piece[] {
	const segs = pieces.filter((p): p is Seg => 'text' in p && p.text.trim() !== '');
	if (segs.length === 0) return pieces;
	const keys: (keyof Fmt)[] = ['i', 'b', 'strike', 'mark', 'smallCaps'];
	const whole = keys.filter((k) => segs.every((p) => p.fmt[k]));
	if (whole.length === 0) return pieces;
	return pieces.map((p) => ('text' in p ? { ...p, fmt: { ...p.fmt, ...Object.fromEntries(whole.map((k) => [k, false])) } } : p));
}

/**
 * A link target as a usable address: web and email links only, without angle brackets that Word took
 * into the link from AGLC4 "<https://…>". Null for anything else (internal parts, bookmarks).
 */
export function cleanTarget(target: string): string | null {
	let t = target.trim().replace(/^(?:<|%3c)/i, '').replace(/(?:>|%3e)$/i, '');
	if (!/^(?:https?:|mailto:)/i.test(t)) return null;
	t = t.replace(/\s+/g, '');
	return t;
}

function sameFmt(a: Fmt, b: Fmt): boolean {
	return a.i === b.i && a.b === b.b && a.strike === b.strike && a.mark === b.mark && a.smallCaps === b.smallCaps;
}

function wrap(s: string, f: Fmt): string {
	let out = s;
	if (f.i && f.b) out = `***${out}***`;
	else if (f.i) out = `*${out}*`;
	else if (f.b) out = `**${out}**`;
	if (f.strike) out = `~~${out}~~`;
	if (f.mark) out = `==${out}==`;
	return out;
}

/**
 * Escape characters Markdown would read as formatting. Brackets are left alone so citations such as
 * "[2020] HCA 3" stay readable; only "[^", which would start a footnote, is escaped.
 */
function escapeMd(s: string, before = ''): string {
	let out = s
		.replace(/\\/g, '\\\\')
		.replace(/([*`$])/g, '\\$1')
		.replace(/(^|[^\w])_|_(?=[^\w]|$)/g, (m) => m.replace('_', '\\_'))
		.replace(/~~/g, '\\~~')
		.replace(/==/g, '\\==')
		.replace(/\[\^/g, '\\[^')
		.replace(/%%/g, '\\%%');
	// URLs keep their underscores.
	out = out.replace(/https?:\/\/\S+/g, (u) => u.replace(/\\_/g, '_'));
	if (/(^|\n)$/.test(before)) out = out.replace(/^(#{1,6}\s|>|[-+]\s|\d+[.)]\s)/, '\\$1');
	if (before.endsWith('[') && out.startsWith('^')) out = `\\${out}`;
	return out;
}

/** Convert a .docx file. */
export function importDocx(data: Uint8Array, headingNumbering: HeadingNumbering): ImportResult {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(data, { filter: (f) => f.name.startsWith('word/') || f.name === '_rels/.rels' });
	} catch {
		throw new Error('This is not a Word document (.docx), or it is damaged.');
	}
	const main = files['word/document.xml'];
	if (!main) throw new Error('This file has no Word document inside it.');
	const conv = new Converter(files, headingNumbering);
	const body = find(parseXml(strFromU8(main)), W('body'));
	if (!body) throw new Error('The Word document has no body.');
	const markdown = conv.convert(body);
	return { markdown, footnotes: conv.footnoteCount, warnings: [...conv.warnings], numberedHeadings: conv.numberedHeadings };
}
