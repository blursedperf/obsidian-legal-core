/**
 * AGLC4 typography applied on export: typographic quotation marks, and ordinal suffixes in superscript.
 */
import type { Inline } from '@legal-core/ldm';

/**
 * Typographic quotation marks, as AGLC4 documents use them. Works across node boundaries so that
 * '*Title*' gets an opening quote before the italics and a closing one after.
 */
export function smartenQuotes(nodes: Inline[], state = { prev: ' ' }): Inline[] {
	for (const n of nodes) {
		if (n.t === 'text') {
			let out = '';
			for (const ch of n.v) {
				const opening = /[\s([{\u2014\u2013‘“/-]/.test(state.prev);
				if (ch === '\'') out += opening ? '‘' : '’';
				else if (ch === '"') out += opening ? '“' : '”';
				else out += ch;
				state.prev = ch;
			}
			n.v = out;
		} else if (n.t === 'code') {
			state.prev = 'x';
		} else if (n.t === 'url') {
			state.prev = '>';
		} else if (n.t === 'br') {
			state.prev = ' ';
		} else if (n.t === 'fnref') {
			// a footnote marker does not change quote context
		} else if (n.t === 'fninline') {
			smartenQuotes(n.c, { prev: ' ' });
		} else if (n.t === 'custom') {
			// an extension's node is rendered later, by its extension
		} else {
			smartenQuotes(n.c, state);
		}
	}
	return nodes;
}

/**
 * Set the suffixes of ordinal numbers in superscript, as AGLC4 does for editions and ordinals over nine
 * (r 6.3.2, 1.10.1): "3rd ed" → 3<sup>rd</sup> ed. Code and URLs are left alone.
 */
export function superscriptOrdinals(nodes: Inline[]): Inline[] {
	const out: Inline[] = [];
	for (const n of nodes) {
		if (n.t === 'text') {
			const re = /(\d)(st|nd|rd|th)\b/g;
			let last = 0;
			let m: RegExpExecArray | null;
			while ((m = re.exec(n.v))) {
				const cut = m.index + 1;
				if (cut > last) out.push({ t: 'text', v: n.v.slice(last, cut) });
				out.push({ t: 'sup', c: [{ t: 'text', v: m[2]! }] });
				last = cut + m[2]!.length;
			}
			if (last < n.v.length) out.push({ t: 'text', v: n.v.slice(last) });
		} else if ('c' in n && n.t !== 'link') {
			out.push({ ...n, c: superscriptOrdinals(n.c) });
		} else {
			out.push(n);
		}
	}
	return out;
}
