/**
 * Standalone HTML export: the note with its footnotes numbered and listed at the bottom, styled for
 * print. Opening it in a browser and printing gives a PDF with the footnotes at the end of the document;
 * for footnotes at the bottom of each page use the Word export.
 */
import type { Block, Inline, MdDocument } from '@legal-core/ldm';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class HtmlBuilder {
	readonly notes: string[] = [];

	constructor(private doc: MdDocument) {}

	inline(nodes: Inline[], inFootnote = false): string {
		return nodes.map((n) => {
			switch (n.t) {
				case 'text': return esc(n.v);
				case 'br': return '<br>';
				case 'code': return `<code>${esc(n.v)}</code>`;
				case 'em': return `<em>${this.inline(n.c, inFootnote)}</em>`;
				case 'strong': return `<strong>${this.inline(n.c, inFootnote)}</strong>`;
				case 'strike': return `<s>${this.inline(n.c, inFootnote)}</s>`;
				case 'mark': return `<mark>${this.inline(n.c, inFootnote)}</mark>`;
				case 'sup': return `<sup>${this.inline(n.c, inFootnote)}</sup>`;
				case 'link': return `<a href="${esc(n.href)}">${this.inline(n.c, inFootnote)}</a>`;
				case 'url': return `&lt;<a href="${esc(n.href)}">${esc(n.href)}</a>&gt;`;
				case 'fnref': {
					if (inFootnote) return '';
					const content = this.doc.footnotes.get(n.label);
					return content ? this.ref(this.blocks(content, true)) : '';
				}
				case 'fninline':
					return inFootnote ? '' : this.ref(`<p>${this.inline(n.c, true)}</p>`);
			}
			return '';
		}).join('');
	}

	private ref(html: string): string {
		this.notes.push(html);
		const n = this.notes.length;
		return `<sup class="fnref"><a href="#fn${n}" id="fnref${n}">${n}</a></sup>`;
	}

	blocks(blocks: Block[], inFootnote = false): string {
		return blocks.map((b) => {
			switch (b.t) {
				case 'heading': {
					if (b.title) return `<h1 class="title">${this.inline(b.c, inFootnote)}</h1>`;
					const level = b.styleLevel ?? b.level;
					const num = b.number ? `<span class="hnum">${esc(b.number)}</span>&nbsp;` : '';
					const cls = b.styleLevel ? ` class="aglc aglc-${level}"` : '';
					const brk = b.pageBreak ? ' style="break-before: page"' : '';
					return `<h${Math.min(6, level)}${cls}${brk}>${num}${this.inline(b.c, inFootnote)}</h${Math.min(6, level)}>`;
				}
				case 'para': return `<p${b.hanging ? ' class="bib"' : ''}>${this.inline(b.c, inFootnote)}</p>`;
				case 'quote': return `<blockquote>${this.blocks(b.blocks, inFootnote)}</blockquote>`;
				case 'code': return `<pre><code>${esc(b.v)}</code></pre>`;
				case 'hr': return '<hr>';
				case 'ooxml': return this.blocks(b.fallback, inFootnote);
				case 'custom': return '';
				case 'list': {
					const tag = b.ordered ? 'ol' : 'ul';
					const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
					return `<${tag}${start}>${b.items.map((it) => `<li>${this.blocks(it, inFootnote)}</li>`).join('')}</${tag}>`;
				}
				case 'table':
					return `<table><thead><tr>${b.header.map((c) => `<th>${this.inline(c, inFootnote)}</th>`).join('')}</tr></thead><tbody>${
						b.rows.map((r) => `<tr>${r.map((c) => `<td>${this.inline(c, inFootnote)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
			}
			return '';
		}).join('\n');
	}
}

export interface HtmlOptions {
	/** The page title (escaped here). */
	title: string;
	/** The stylesheet. */
	css: string;
}

/** Write a prepared document as a standalone web page, with its footnotes listed at the end. */
export function renderHtml(doc: MdDocument, opts: HtmlOptions): { html: string; footnotes: number } {
	const b = new HtmlBuilder(doc);
	const body = b.blocks(doc.blocks);
	const notes = b.notes.map((n, i) => `<li id="fn${i + 1}">${n.replace(/<\/p>$/, ` <a class="back" href="#fnref${i + 1}">↩</a></p>`)}</li>`).join('\n');
	const title = esc(opts.title);
	const css = opts.css;
	const html = `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${css}
</style>
</head>
<body>
${body}
${b.notes.length > 0 ? `<section class="footnotes">\n<ol>\n${notes}\n</ol>\n</section>` : ''}
</body>
</html>
`;
	return { html, footnotes: b.notes.length };
}
