/**
 * AGLC4 export: a note's Markdown, prepared the AGLC4 way (heading numbers, the bibliography, ordinal
 * suffixes and quotation marks) and written to Word or HTML by the document engine.
 */
import type { Block, Inline, MdDocument } from '@legal-core/ldm';
import { type Transform, parseInline, parseMarkdown, plainText, runTransforms, walkBlocks } from '@legal-core/md-pipeline';
import { type DocxResult, renderHtml, writeDocx } from '@legal-core/docx-engine';
import { BIBLIOGRAPHY_HEADING, type HeadingScheme, type TopLevel, applyHeadingScheme } from './headings';
import { buildBibliography } from './bibliography';
import { smartenQuotes, superscriptOrdinals } from './typography';
import { styles } from './styles';

export interface ExportOptions {
	font: string;
	/** Body text size in points. */
	fontSize: number;
	/** Footnote text size in points. */
	footnoteSize: number;
	/** Line spacing of body text: 1, 1.5 or 2. */
	lineSpacing: number;
	smartQuotes: boolean;
	pageNumbers: boolean;
	/** Use the note's file name as a title when it has no level-one heading. */
	title?: string;
	/** Heading style: as written, or numbered and formatted in the AGLC4 hierarchy. */
	headingScheme?: HeadingScheme;
	/** Which Markdown heading is AGLC4 level one. */
	aglcTopLevel?: TopLevel;
	/** Keep each footnote whole on one page (Word: "Keep lines together" on footnote text). */
	keepFootnotesTogether?: boolean;
	/** Add a bibliography of the sources cited in the footnotes, on a new page (AGLC4 r 1.13). */
	bibliography?: boolean;
}

export const DEFAULT_EXPORT: ExportOptions = {
	font: 'Times New Roman',
	fontSize: 12,
	footnoteSize: 10,
	lineSpacing: 1.5,
	smartQuotes: true,
	pageNumbers: true,
	headingScheme: 'plain',
	aglcTopLevel: 'auto',
	keepFootnotesTogether: true,
};

/**
 * The bibliography as blocks: a heading on a new page, a lettered heading per section, and entries with a
 * hanging indent. The headings are unnumbered and, with AGLC4 headings, styled as levels I and A, as in
 * the example in AGLC4 r 1.13.
 */
export function bibliographyBlocks(markdown: string, opts: ExportOptions): Block[] {
	const sections = buildBibliography(markdown);
	if (sections.length === 0) return [];
	const aglc = opts.headingScheme === 'aglc';
	const blocks: Block[] = [{ t: 'heading', level: 1, styleLevel: aglc ? 1 : undefined, c: [{ t: 'text', v: 'Bibliography' }], pageBreak: true }];
	for (const s of sections) {
		blocks.push({ t: 'heading', level: 2, styleLevel: aglc ? 2 : undefined, number: s.letter, c: [{ t: 'text', v: s.title }] });
		for (const e of s.entries) blocks.push({ t: 'para', c: parseInline(e), hanging: true });
	}
	return blocks;
}

interface PrepareContext {
	opts: ExportOptions;
	/** The note's Markdown, for the bibliography of its footnotes. */
	markdown?: string;
}

/** AGLC4's preparation steps, in the order they run. */
export const AGLC_TRANSFORMS: readonly Transform<PrepareContext>[] = [
	{
		id: 'aglc-headings',
		run: (doc, { opts }) => { applyHeadingScheme(doc, opts.headingScheme ?? 'plain', opts.aglcTopLevel ?? 'auto'); },
	},
	{
		id: 'aglc-bibliography',
		after: ['aglc-headings'],
		run: (doc, { opts, markdown }) => {
			// A bibliography written in the note (or inserted by the command) starts on a new page and its
			// entries hang; when the note has one, none is generated.
			const own = doc.blocks.findIndex((b) => b.t === 'heading' && BIBLIOGRAPHY_HEADING.test(plainText(b.c).trim()));
			if (own >= 0) {
				const heading = doc.blocks[own]!;
				if (heading.t === 'heading') heading.pageBreak = true;
				for (const b of doc.blocks.slice(own + 1)) if (b.t === 'para') b.hanging = true;
			} else if (opts.bibliography && markdown !== undefined) {
				doc.blocks.push(...bibliographyBlocks(markdown, opts));
			}
		},
	},
	{
		id: 'aglc-ordinals',
		after: ['aglc-bibliography'],
		run: (doc) => {
			// Ordinal suffixes in superscript (r 1.10.1, 6.3.2), in the text and the footnotes.
			const sup = (nodes: Inline[]) => { nodes.splice(0, nodes.length, ...superscriptOrdinals(nodes)); };
			walkBlocks(doc.blocks, sup);
			for (const blocks of doc.footnotes.values()) walkBlocks(blocks, sup);
		},
	},
	{
		id: 'aglc-quotes',
		after: ['aglc-ordinals'],
		run: (doc, { opts }) => {
			if (!opts.smartQuotes) return;
			walkBlocks(doc.blocks, (nodes) => { smartenQuotes(nodes); });
			for (const blocks of doc.footnotes.values()) walkBlocks(blocks, (nodes) => { smartenQuotes(nodes); });
		},
	},
];

/**
 * Prepare a parsed note for export: heading numbers, the bibliography (given the note's Markdown), and
 * smart quotes everywhere, including footnotes.
 */
export function prepare(doc: MdDocument, opts: ExportOptions, markdown?: string): MdDocument {
	return runTransforms(doc, AGLC_TRANSFORMS, { opts, markdown });
}

export type { DocxResult };

/** Export a note to Word with real footnotes, in the AGLC4 style. */
export async function exportDocx(markdown: string, opts: ExportOptions): Promise<DocxResult> {
	const doc = prepare(parseMarkdown(markdown), opts, markdown);
	return writeDocx(doc, opts, styles(opts));
}

/** The stylesheet of the HTML export. */
function htmlCss(opts: ExportOptions): string {
	return `
body { font-family: "${opts.font}", serif; font-size: ${opts.fontSize}pt; line-height: ${opts.lineSpacing}; max-width: 42em; margin: 2em auto; padding: 0 1em; }
h1, h2, h3 { line-height: 1.2; }
blockquote { margin: 0 2.5em; font-size: ${opts.fontSize - 1}pt; }
p.bib { padding-left: 36pt; text-indent: -36pt; }
sup.fnref a { text-decoration: none; }
section.footnotes { font-size: ${opts.footnoteSize}pt; line-height: 1.2; border-top: 1px solid #999; margin-top: 3em; padding-top: 1em; }
section.footnotes p { margin: 0 0 .4em; }
a.back { text-decoration: none; font-size: .8em; }
h1.title { text-align: center; }
h1.aglc, h2.aglc, h3.aglc, h4.aglc, h5.aglc, h6.aglc { font-size: 1em; font-weight: normal; }
h1.aglc { font-variant: small-caps; text-align: center; }
h2.aglc { text-align: center; }
h2.aglc, h3.aglc, h4.aglc, h5.aglc, h6.aglc { font-style: italic; }
h2.aglc .hnum, h3.aglc .hnum { font-style: normal; }
table { border-collapse: collapse; } td, th { border: 1px solid #999; padding: .2em .5em; }
@media print { a { color: inherit; text-decoration: none; } a.back { display: none; } body { margin: 0; max-width: none; } }`;
}

/** Export a note to a standalone web page, in the AGLC4 style. */
export function exportHtml(markdown: string, opts: ExportOptions): { html: string; footnotes: number } {
	const doc = prepare(parseMarkdown(markdown), opts, markdown);
	return renderHtml(doc, { title: opts.title ?? 'Export', css: htmlCss(opts) });
}
