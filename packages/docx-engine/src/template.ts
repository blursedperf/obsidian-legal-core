/**
 * Templates: a reference Word document whose styles an export takes on.
 *
 * The template's styles.xml replaces the export's, so its fonts, sizes, spacing, document defaults and
 * the look of every style it defines win. Styles the export uses that the template does not define (the
 * footnote, long-quotation and heading styles, say) are kept from the export, so nothing is left unstyled.
 *
 * Version 1 merges styles. The template's numbering, headers and footers are not merged yet.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const STYLE_RE = /<w:style\b[^>]*?w:styleId="([^"]+)"[^>]*>[\s\S]*?<\/w:style>/g;

export class TemplateError extends Error {}

/** The template's styles.xml, or an error saying why it cannot be used. */
export function templateStyles(template: Uint8Array): string {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(template, { filter: (f) => f.name === 'word/styles.xml' });
	} catch {
		throw new TemplateError('The template is not a Word document (.docx), or it is damaged.');
	}
	const styles = files['word/styles.xml'];
	if (!styles) throw new TemplateError('The template has no styles (word/styles.xml).');
	return strFromU8(styles);
}

/** The ids of the styles a styles.xml defines. */
export function styleIds(stylesXml: string): Set<string> {
	return new Set([...stylesXml.matchAll(STYLE_RE)].map((m) => m[1]!));
}

/** The template's styles, with the export's styles that the template does not define added. */
export function mergeStyles(exportStyles: string, templateStylesXml: string): string {
	const have = styleIds(templateStylesXml);
	const missing = [...exportStyles.matchAll(STYLE_RE)].filter((m) => !have.has(m[1]!)).map((m) => m[0]);
	if (missing.length === 0) return templateStylesXml;
	const end = templateStylesXml.lastIndexOf('</w:styles>');
	if (end < 0) throw new TemplateError('The template\'s styles are not valid (no closing </w:styles>).');
	return templateStylesXml.slice(0, end) + missing.join('') + templateStylesXml.slice(end);
}

/** A Word document with the template's styles applied. */
export function applyTemplate(docx: Uint8Array, template: Uint8Array): Uint8Array {
	const tpl = templateStyles(template);
	const files = unzipSync(docx);
	const own = files['word/styles.xml'];
	if (!own) throw new TemplateError('The export has no styles to merge.');
	files['word/styles.xml'] = strToU8(mergeStyles(strFromU8(own), tpl));
	return zipSync(files);
}
