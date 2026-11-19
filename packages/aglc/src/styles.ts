/**
 * AGLC4's paragraph styles for the Word export and the page preview: body, footnotes, long quotations,
 * and headings as written or in the AGLC4 hierarchy (r 1.12.2).
 */
import { type ParaStyle, type Styles, lineFactor } from '@legal-core/docx-engine';
import type { HeadingScheme } from './headings';

export interface LayoutOptions {
	font: string;
	fontSize: number;
	footnoteSize: number;
	lineSpacing: number;
	headingScheme?: HeadingScheme;
	/** Keep each footnote whole on one page rather than continuing it on the next. */
	keepFootnotesTogether?: boolean;
}

export function styles(o: LayoutOptions): Styles {
	const heading = (size: number, before: number, after: number, extra: Partial<ParaStyle>): ParaStyle => ({
		size, multiple: o.lineSpacing, before, after, keepNext: true, keepLines: true, ...extra,
	});
	return {
		body: { size: o.fontSize, multiple: o.lineSpacing, before: 0, after: 6 },
		quote: { size: o.fontSize - 1, multiple: o.lineSpacing, before: 0, after: 6 },
		footnote: { size: o.footnoteSize, multiple: 1, before: 0, after: 0, keepLines: o.keepFootnotesTogether === true },
		headings: o.headingScheme === 'aglc' ? [
			// AGLC4, at body size:
			// I    numeral upright; heading in large and small capitals; centred
			heading(o.fontSize, 12, 6, { smallCaps: true, center: true }),
			// A    letter upright; heading italic; centred
			heading(o.fontSize, 12, 6, { italic: true, uprightNumber: true, center: true }),
			// 1    numeral upright; heading italic; left-aligned
			heading(o.fontSize, 12, 6, { italic: true, uprightNumber: true }),
			// (a)  letter and heading italic; left-aligned
			heading(o.fontSize, 12, 6, { italic: true }),
			// (i)  numeral and heading italic; left-aligned
			heading(o.fontSize, 12, 6, { italic: true }),
			// Below level five: unnumbered, italic, left-aligned
			heading(o.fontSize, 12, 6, { italic: true }),
		] : [
			heading(o.fontSize + 4, 12, 6, { bold: true }),
			heading(o.fontSize + 2, 12, 6, { bold: true }),
			heading(o.fontSize, 10, 5, { bold: true, italic: true }),
			heading(o.fontSize, 10, 5, { italic: true }),
			heading(o.fontSize, 10, 5, { italic: true }),
			heading(o.fontSize, 10, 5, { italic: true }),
		],
		title: { size: o.fontSize + 6, multiple: o.lineSpacing, before: 0, after: 12, bold: true, center: true, keepNext: true, keepLines: true },
		separator: o.fontSize * lineFactor(o.font),
		indent: 36,
		hanging: 18,
	};
}
