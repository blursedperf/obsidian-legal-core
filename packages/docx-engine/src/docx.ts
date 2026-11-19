/**
 * Word export with real footnotes. Each footnote marker in the note becomes a Word footnote at the bottom
 * of its page, numbered by Word, with italics, quotation marks and URLs exactly as written.
 */
import {
	AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, FootnoteReferenceRun, HeadingLevel, ImportedXmlComponent, LevelFormat,
	type IParagraphOptions, Packer, PageNumber, Paragraph, type ParagraphChild, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import type { Block, Inline, MdDocument } from '@legal-core/ldm';
import { NUMBER_SPACE, PAGE, type ParaStyle, type Styles, twips } from './metrics';

/** What the Word writer needs besides the document and its styles. */
export interface DocxWriterOptions {
	font: string;
	pageNumbers: boolean;
	/** A title for the document, used when it has no level-one heading. */
	title?: string;
	/** Keep each footnote whole on one page (Word: "Keep lines together" on footnote text). */
	keepFootnotesTogether?: boolean;
}

interface Style {
	italic?: boolean;
	heavy?: boolean;
	struck?: boolean;
	marked?: boolean;
	sup?: boolean;
	code?: boolean;
}

/** Hanging indent of a bibliography entry, in twips (1.27 cm, Word's default). */
const HANGING = 720;

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

/** Footnote content starting with the space that follows the footnote number, as Word inserts it. */
export function footnoteWithSpace(blocks: Block[]): Block[] {
	const [first, ...rest] = blocks;
	if (!first || first.t !== 'para') return blocks;
	const lead = first.c[0];
	if (lead && lead.t === 'text' && lead.v.startsWith(' ')) return blocks;
	return [{ ...first, c: [{ t: 'text', v: ' ' }, ...first.c] }, ...rest];
}

class DocxBuilder {
	private footnotes: Record<number, { children: Paragraph[] }> = {};

	get footnoteCount(): number {
		return this.nextId - 1;
	}
	private nextId = 1;
	private listInstance = 0;
	readonly warnings: string[] = [];

	private readonly st: Styles;

	constructor(private doc: MdDocument, private opts: DocxWriterOptions, st: Styles) {
		this.st = st;
	}

	runs(nodes: Inline[], style: Style = {}, inFootnote = false): ParagraphChild[] {
		const out: ParagraphChild[] = [];
		for (const n of nodes) {
			switch (n.t) {
				case 'text':
					out.push(this.text(n.v, style));
					break;
				case 'br':
					out.push(new TextRun({ text: '', break: 1 }));
					break;
				case 'code':
					out.push(this.text(n.v, { ...style, code: true }));
					break;
				case 'em':
					out.push(...this.runs(n.c, { ...style, italic: !style.italic }, inFootnote));
					break;
				case 'strong':
					out.push(...this.runs(n.c, { ...style, heavy: true }, inFootnote));
					break;
				case 'strike':
					out.push(...this.runs(n.c, { ...style, struck: true }, inFootnote));
					break;
				case 'mark':
					out.push(...this.runs(n.c, { ...style, marked: true }, inFootnote));
					break;
				case 'sup':
					out.push(...this.runs(n.c, { ...style, sup: true }, inFootnote));
					break;
				case 'link':
					out.push(new ExternalHyperlink({ link: n.href, children: this.runs(n.c, style, inFootnote).filter((r): r is TextRun => r instanceof TextRun) }));
					break;
				case 'url':
					// AGLC4 keeps the angle brackets around URLs.
					out.push(this.text('<', style));
					out.push(new ExternalHyperlink({ link: n.href, children: [this.text(n.href, style)] }));
					out.push(this.text('>', style));
					break;
				case 'fnref': {
					if (inFootnote) break;
					const content = this.doc.footnotes.get(n.label);
					if (!content) {
						this.warnings.push(`Footnote [^${n.label}] has no text.`);
						break;
					}
					out.push(this.footnote(content));
					break;
				}
				case 'fninline':
					if (inFootnote) break;
					out.push(this.footnote([{ t: 'para', c: n.c }]));
					break;
			}
		}
		return out;
	}

	private text(v: string, s: Style): TextRun {
		return new TextRun({
			text: v,
			italics: s.italic || undefined,
			bold: s.heavy || undefined,
			strike: s.struck || undefined,
			highlight: s.marked ? 'yellow' : undefined,
			superScript: s.sup || undefined,
			font: s.code ? 'Courier New' : undefined,
		});
	}

	private footnote(content: Block[]): FootnoteReferenceRun {
		const id = this.nextId++;
		// Word follows the footnote number with a space; Word adds the number itself before the text.
		const blocks = footnoteWithSpace(content);
		// To keep a footnote of several paragraphs together, each but the last is kept with the next. The
		// last is not, or every footnote would be chained to the one after it.
		const keep = this.opts.keepFootnotesTogether === true;
		const head = keep ? blocks.slice(0, -1) : blocks;
		this.keepNext = keep;
		const children = this.paragraphs(head, true);
		this.keepNext = false;
		if (keep && blocks.length > 0) children.push(...this.paragraphs(blocks.slice(-1), true));
		this.footnotes[id] = { children: children.filter((p): p is Paragraph => p instanceof Paragraph) };
		return new FootnoteReferenceRun(id);
	}

	/** Depth of block quotations being built. */
	private quoteDepth = 0;

	/** Set while building footnote paragraphs that must stay with the next one. */
	private keepNext = false;

	/** A paragraph with widow and orphan control, which Word leaves off unless asked. */
	private para(opts: IParagraphOptions): Paragraph {
		return new Paragraph({ widowControl: true, ...(this.keepNext ? { keepNext: true } : {}), ...opts });
	}

	paragraphs(blocks: Block[], inFootnote = false, indent = 0): (Paragraph | Table)[] {
		const out: (Paragraph | Table)[] = [];
		for (const b of blocks) {
			switch (b.t) {
				case 'heading': {
					const children = this.runs(b.c, {}, inFootnote);
					const level = b.styleLevel ?? b.level;
					if (b.number) {
						const upright = this.st.headings[level - 1]?.uprightNumber;
						children.unshift(new TextRun({ text: b.number + NUMBER_SPACE, italics: upright ? false : undefined }));
					}
					out.push(this.para({ heading: b.title ? HeadingLevel.TITLE : HEADINGS[level - 1], children, pageBreakBefore: b.pageBreak || undefined }));
					break;
				}
				case 'para':
					out.push(this.para({
						// Footnote paragraphs must name the footnote style, or Word gives them the body style.
						style: inFootnote ? 'FootnoteText' : this.quoteDepth > 0 ? 'AglcQuote' : undefined,
						children: this.runs(b.c, {}, inFootnote),
						// A bibliography entry's lines after the first are indented (hanging indent).
						indent: b.hanging ? { left: indent + HANGING, hanging: HANGING } : indent ? { left: indent } : undefined,
					}));
					break;
				case 'quote': {
					// AGLC4: long quotations are indented, in a smaller font, without quotation marks.
					this.quoteDepth++;
					for (const p of this.paragraphs(b.blocks, inFootnote, indent + 720)) out.push(p);
					this.quoteDepth--;
					break;
				}
				case 'code':
					out.push(this.para({
						indent: { left: indent + 360 },
						children: b.v.split('\n').flatMap((l, i) => [
							...(i > 0 ? [new TextRun({ text: '', break: 1 })] : []),
							new TextRun({ text: l, font: 'Courier New' }),
						]),
					}));
					break;
				case 'ooxml':
					// Raw Word XML, written as it is. Only in the body: footnotes take ordinary paragraphs.
					if (!inFootnote) out.push(ImportedXmlComponent.fromXmlString(b.xml) as unknown as Paragraph);
					else out.push(...this.paragraphs(b.fallback, inFootnote, indent));
					break;
				case 'custom':
					// Turned into ordinary blocks by its extension's renderer before writing; never written itself.
					break;
				case 'hr':
					out.push(this.para({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'auto', space: 1 } }, children: [] }));
					break;
				case 'list': {
					const instance = ++this.listInstance;
					const level = Math.min(8, Math.round(indent / 720));
					b.items.forEach((item) => {
						item.forEach((blk, k) => {
							if (k === 0 && blk.t === 'para') {
								out.push(this.para({
									children: this.runs(blk.c, {}, inFootnote),
									...(b.ordered ? { numbering: { reference: 'aglc-ordered', level, instance } } : { bullet: { level } }),
								}));
							} else {
								for (const p of this.paragraphs([blk], inFootnote, indent + 720)) out.push(p);
							}
						});
					});
					break;
				}
				case 'table':
					out.push(new Table({
						width: { size: 100, type: WidthType.PERCENTAGE },
						rows: [b.header, ...b.rows].map((row, r) => new TableRow({
							tableHeader: r === 0,
							children: row.map((cell) => new TableCell({ children: [this.para({ children: this.runs(cell, r === 0 ? { heavy: true } : {}, inFootnote) })] })),
						})),
					}));
					break;
			}
		}
		return out;
	}

	build(): Document {
		const pt = (n: number) => Math.round(n * 2);
		const st = this.st;
		// One definition of each paragraph style, shared with the page preview.
		const style = (p: ParaStyle) => ({
			run: { font: this.opts.font, size: pt(p.size), bold: p.bold || undefined, italics: p.italic || undefined, smallCaps: p.smallCaps || undefined },
			paragraph: {
				spacing: { before: twips(p.before), after: twips(p.after), line: Math.round(240 * p.multiple) },
				alignment: p.center ? AlignmentType.CENTER : undefined,
				keepNext: p.keepNext || undefined,
				keepLines: p.keepLines || undefined,
			},
		});
		const [h1, h2, h3, h4, h5, h6] = st.headings.map(style);
		const body = this.paragraphs(this.doc.blocks);
		if (this.opts.title && !this.doc.blocks.some((b) => b.t === 'heading' && b.level === 1)) {
			body.unshift(this.para({ heading: HeadingLevel.TITLE, children: [new TextRun(this.opts.title)] }));
		}
		return new Document({
			creator: 'AGLC4 Citations for Obsidian',
			title: this.opts.title,
			styles: {
				default: {
					document: {
						run: { font: this.opts.font, size: pt(st.body.size) },
						paragraph: { spacing: { line: Math.round(240 * st.body.multiple), after: twips(st.body.after) } },
					},
					footnoteText: {
						run: { font: this.opts.font, size: pt(st.footnote.size) },
						paragraph: {
							spacing: { line: Math.round(240 * st.footnote.multiple), after: twips(st.footnote.after) },
							keepLines: st.footnote.keepLines || undefined,
						},
					},
					heading1: h1, heading2: h2, heading3: h3, heading4: h4, heading5: h5, heading6: h6,
					title: style(st.title),
				},
				paragraphStyles: [{
					id: 'AglcQuote',
					name: 'Quote (AGLC4)',
					basedOn: 'Normal',
					next: 'Normal',
					run: { font: this.opts.font, size: pt(st.quote.size) },
					paragraph: { spacing: { line: Math.round(240 * st.quote.multiple), after: twips(st.quote.after) } },
				}],
			},
			numbering: {
				config: [{
					reference: 'aglc-ordered',
					levels: Array.from({ length: 9 }, (_, level) => ({
						level,
						format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3]!,
						text: `%${level + 1}.`,
						alignment: AlignmentType.START,
						style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
					})),
				}],
			},
			footnotes: this.footnotes,
			sections: [{
				properties: {
					page: {
						size: { width: twips(PAGE.width), height: twips(PAGE.height) },
						margin: { top: twips(PAGE.margin), bottom: twips(PAGE.margin), left: twips(PAGE.margin), right: twips(PAGE.margin) },
					},
				},
				children: body,
				footers: this.opts.pageNumbers
					? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) }
					: undefined,
			}],
		});
	}
}

export interface DocxResult {
	data: ArrayBuffer;
	footnotes: number;
	warnings: string[];
}

/** Write a prepared document as a Word file, with its footnotes as real Word footnotes. */
export async function writeDocx(doc: MdDocument, opts: DocxWriterOptions, st: Styles): Promise<DocxResult> {
	const builder = new DocxBuilder(doc, opts, st);
	// Footnotes are collected while the body is built, so build the body first.
	const document = builder.build();
	const data = await Packer.toArrayBuffer(document);
	return { data, footnotes: builder.footnoteCount, warnings: builder.warnings };
}
