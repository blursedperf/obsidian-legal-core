import type { Block, MdDocument } from '@legal-core/ldm';
import { excludedRanges, plainText } from '@legal-core/md-pipeline';

/**
 * The AGLC4 heading hierarchy (AGLC4 r 1.12.2):
 *
 *   I     Heading Level One     numeral upright; heading in large and small capitals; centred
 *   A     Heading Level Two     letter upright; heading italicised; centred
 *   1     Heading Level Three   numeral upright; heading italicised; left-aligned
 *   (a)   Heading Level Four    letter and heading italicised; left-aligned
 *   (i)   Heading Level Five    numeral and heading italicised; left-aligned
 *
 * Headings are numbered automatically from their Markdown level, so notes keep plain headings
 * ("## Introduction") and the numbers stay right as sections are added or moved.
 */

export type HeadingScheme = 'plain' | 'aglc';
/**
 * Which Markdown heading is AGLC4 level one. "auto": `##`, if the note opens with a single `#` heading
 * (taken as the title), otherwise `#`.
 */
export type TopLevel = 'auto' | 'h1' | 'h2';

export interface HeadingNumber {
	/** True for a `#` heading treated as the document title. */
	title: boolean;
	/** AGLC4 level (1–5), or null for the title and headings deeper than level five. */
	aglcLevel: number | null;
	/** The heading's number, eg "I", "A", "(a)", or null. */
	number: string | null;
}

export const AGLC_LEVELS = 5;

/**
 * A heading that starts the back matter: the bibliography (AGLC4 r 1.13). It and the headings after it
 * are not numbered as parts of the text.
 */
export const BIBLIOGRAPHY_HEADING = /^(?:bibliography|reference list|references)$/i;

/** Index of the heading that starts the back matter, or -1. */
export function backMatterIndex(texts: string[]): number {
	return texts.findIndex((t) => BIBLIOGRAPHY_HEADING.test(stripTypedNumber(t).trim()));
}

/** The Markdown level of AGLC4 level one for these headings (1 or 2), as in numberHeadings. */
export function topMarkdownLevel(levels: number[], top: TopLevel): number {
	const h1s = levels.filter((l) => l === 1).length;
	return top === 'h2' || (top === 'auto' && levels[0] === 1 && h1s === 1) ? 2 : 1;
}

export function toRoman(n: number, upper: boolean): string {
	const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
	let out = '';
	for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
	return upper ? out.toUpperCase() : out;
}

function toLetters(n: number, upper: boolean): string {
	let s = '';
	while (n > 0) {
		n--;
		s = String.fromCharCode(97 + (n % 26)) + s;
		n = Math.floor(n / 26);
	}
	return upper ? s.toUpperCase() : s;
}

/** The number of the n-th heading (from 1) at an AGLC4 level. */
export function aglcLabel(level: number, n: number): string {
	switch (level) {
		case 1: return toRoman(n, true);
		case 2: return toLetters(n, true);
		case 3: return String(n);
		case 4: return `(${toLetters(n, false)})`;
		default: return `(${toRoman(n, false)})`;
	}
}

/**
 * Number a document's headings, given their Markdown levels in order. From `back` (the bibliography
 * heading, see backMatterIndex) on, headings are styled from AGLC4 level one but not numbered.
 */
export function numberHeadings(levels: number[], top: TopLevel, back = -1): HeadingNumber[] {
	const base = topMarkdownLevel(back >= 0 ? levels.slice(0, back) : levels, top);
	const counters = new Array<number>(AGLC_LEVELS + 1).fill(0);
	return levels.map((l, i) => {
		if (back >= 0 && i >= back) {
			return { title: false, aglcLevel: Math.max(1, Math.min(AGLC_LEVELS, 1 + l - levels[back]!)), number: null };
		}
		if (base === 2 && l === 1) return { title: true, aglcLevel: null, number: null };
		const level = l - base + 1;
		if (level > AGLC_LEVELS) return { title: false, aglcLevel: null, number: null };
		counters[level]!++;
		for (let k = level + 1; k <= AGLC_LEVELS; k++) counters[k] = 0;
		return { title: false, aglcLevel: level, number: aglcLabel(level, counters[level]!) };
	});
}

/**
 * A heading number typed by hand, followed by a tab, two spaces or a non-breaking space (as in the
 * plugin's own Word export): "I\tIntroduction", "(a)  Scope". A single ordinary space is not enough:
 * "A New Approach" is a heading, not "A" + "New Approach".
 */
const TYPED_NUMBER = /^(?:[IVXLC]+|[A-Z]|\d+|\([a-z]{1,3}\)|\([ivxlc]+\))\.?(?:\t|\u00a0|\s{2,})/;

export function stripTypedNumber(text: string): string {
	return text.replace(TYPED_NUMBER, '');
}

export function hasTypedNumber(text: string): boolean {
	return TYPED_NUMBER.test(text);
}

/**
 * Number and style a parsed note's headings. With the plain scheme headings are left as they are. With
 * the AGLC4 scheme, numbers typed by hand are removed so they are not doubled.
 */
export function applyHeadingScheme(doc: MdDocument, scheme: HeadingScheme, top: TopLevel): MdDocument {
	if (scheme !== 'aglc') return doc;
	const headings = doc.blocks.filter((b): b is Extract<Block, { t: 'heading' }> => b.t === 'heading');
	const back = backMatterIndex(headings.map((h) => plainText(h.c)));
	const numbers = numberHeadings(headings.map((h) => h.level), top, back);
	headings.forEach((h, i) => {
		const n = numbers[i]!;
		const first = h.c[0];
		if (first && first.t === 'text') first.v = stripTypedNumber(first.v);
		// A bibliography section keeps its letter ("A Articles/Books/Reports"), set upright as a number.
		const letter = back >= 0 && i > back && first?.t === 'text' ? /^([A-Z])\s+(?=\S)/.exec(first.v) : null;
		if (letter && first?.t === 'text') {
			first.v = first.v.slice(letter[0].length);
			h.number = letter[1];
			h.title = false;
			h.styleLevel = n.aglcLevel ?? AGLC_LEVELS + 1;
			return;
		}
		h.title = n.title;
		h.number = n.number ?? undefined;
		h.styleLevel = n.aglcLevel ?? (n.title ? undefined : AGLC_LEVELS + 1);
	});
	return doc;
}

/**
 * Offset of the line of the note's bibliography heading (see BIBLIOGRAPHY_HEADING), or -1. The
 * bibliography is kept after the footnote definitions, at the very end of the note.
 */
export function bibliographyStart(text: string, excluded = excludedRanges(text)): number {
	const re = /^#{1,6}[ \t]+(.*)$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const at = m.index;
		if (excluded.some(([a, b]) => at >= a && at < b)) continue;
		if (BIBLIOGRAPHY_HEADING.test(stripTypedNumber(m[1]!.trim()))) return at;
	}
	return -1;
}
