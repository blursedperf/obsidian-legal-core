/**
 * The Legal Document Model: the tree a Markdown note is parsed into, transformed, and rendered from
 * (Word, HTML, the page preview). Types only.
 */

export type Inline =
	| { t: 'text'; v: string }
	| { t: 'em'; c: Inline[] }
	| { t: 'strong'; c: Inline[] }
	| { t: 'strike'; c: Inline[] }
	| { t: 'mark'; c: Inline[] }
	/** Superscript, used for ordinal suffixes ("15th") as AGLC4 sets them (r 1.10.1, 6.3.2). */
	| { t: 'sup'; c: Inline[] }
	| { t: 'code'; v: string }
	| { t: 'link'; href: string; c: Inline[] }
	/** An AGLC URL in angle brackets: the brackets are part of the citation and are kept. */
	| { t: 'url'; href: string }
	| { t: 'fnref'; label: string }
	| { t: 'fninline'; c: Inline[] }
	| { t: 'br' }
	/** A node added by an extension, turned into ordinary nodes by its renderer before writing. */
	| { t: 'custom'; kind: string; data: unknown };

export type Block =
	/**
	 * A heading. With AGLC4 headings, `number` is its number ("I", "(a)"), `styleLevel` the heading style to
	 * use (its AGLC4 level), and `title` marks a top heading used as the document title.
	 */
	| { t: 'heading'; level: number; c: Inline[]; number?: string; styleLevel?: number; title?: boolean; pageBreak?: boolean }
	/** A paragraph; `hanging` for a bibliography entry, its lines after the first indented. */
	| { t: 'para'; c: Inline[]; hanging?: boolean }
	| { t: 'quote'; blocks: Block[] }
	| { t: 'list'; ordered: boolean; start: number; items: Block[][] }
	| { t: 'code'; lang: string; v: string }
	| { t: 'hr' }
	| { t: 'table'; header: Inline[][]; rows: Inline[][][] }
	/** A node added by an extension, turned into ordinary blocks by its renderer before writing. */
	| { t: 'custom'; kind: string; data: unknown }
	/**
	 * Raw Word XML (one or more <w:p> or <w:tbl> elements), written into a Word document as it is: the
	 * escape hatch for what the model cannot express. Other outputs (HTML, the page preview) show
	 * `fallback` instead.
	 */
	| { t: 'ooxml'; xml: string; fallback: Block[] };

export interface MdDocument {
	blocks: Block[];
	footnotes: Map<string, Block[]>;
	frontmatter: Record<string, string>;
}
