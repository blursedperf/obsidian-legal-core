/**
 * Text-level AGLC4 style rules applied to the whole of a footnote, independent of citation type.
 */
import { MONTHS } from './data';
import type { Issue } from './types';

interface LintRule {
	rule: string;
	re: RegExp;
	severity: Issue['severity'];
	message: string | ((m: RegExpExecArray) => string);
	ref?: string;
	/** Replacement for the matched text (or the capture group named "target" when present). */
	fix?: (m: RegExpExecArray) => string;
	/** Return true to ignore a match (eg a span that is already as short as it can be). */
	skip?: (m: RegExpExecArray) => boolean;
	/** Ignore matches inside titles (quoted or italic), which are given as published. */
	outsideTitles?: boolean;
}

/**
 * A span's second number with only the digits needed (AGLC4 r 1.10.1, 1.1.7): 121–127 → 121–7,
 * 436–462 → 436–62; but the last two digits are kept when they are 10–19 (11–14, 215–19), and years keep
 * two digits (2001–08) or are given in full across centuries (1999–2010) (r 1.11.4). Null when the span is
 * already as short as it should be.
 */
export function shortenSpan(first: string, second: string): string | null {
	if (first.length !== second.length || Number(second) <= Number(first)) return null;
	const year = first.length === 4 && /^(?:1[5-9]|20)/.test(first);
	if (year && first.slice(0, 2) !== second.slice(0, 2)) return null;
	let keep = second.length;
	while (keep > 1 && first[second.length - keep] === second[second.length - keep]) keep--;
	// Teens: the last two digits stay together ("215–19", not "215–9").
	if (keep < 2 && second.length >= 2 && second[second.length - 2] === '1') keep = 2;
	if (year && keep < 2) keep = 2;
	return keep < second.length ? second.slice(second.length - keep) : null;
}

/** The full second number of a shortened span: 56–9 → 59, 121–7 → 127. */
function expandSpan(first: string, second: string): string {
	return second.length >= first.length ? second : first.slice(0, first.length - second.length) + second;
}

const MONTH = `(?:${MONTHS.join('|')})`;
const SHORT_MONTHS: Record<string, string> = Object.fromEntries(MONTHS.map((m) => [m.slice(0, 3), m]));
SHORT_MONTHS.Sept = 'September';

function latinFix(s: string): string {
	return s.startsWith('et') ? 'et al' : s.replace(/\./g, '');
}

const RULES: LintRule[] = [
	{
		rule: 'double-quotes',
		re: /["“”]/g,
		severity: 'warning',
		message: 'Use single quotation marks; double quotation marks are only for quotes within quotes.',
		ref: 'r 1.5.1',
		fix: (m) => (m[0] === '“' ? '‘' : m[0] === '”' ? '’' : '\''),
	},
	{
		rule: 'en-dash',
		re: /(?:\d|\])(?<target>-|—)(?=\d|\[)/g,
		severity: 'warning',
		message: 'Spans of numbers take an en dash (–), not a hyphen.',
		ref: 'r 1.6.3',
		fix: () => '–',
		// A hyphen is right in tax-style section numbers ("s 20-110", r 3.1.4) and CCH references ("¶41-703").
		skip: (m) => /(?:\b(?:ss?|regs?|rr?)\s|¶)\d+$/.test(m.input.slice(0, m.index + 1)),
	},
	{
		rule: 'span-digits',
		re: /(?:^|[^\d.[\]\w/])(?<target>(\d+)–(\d+))(?![\d\]])/g,
		severity: 'warning',
		message: (m) => `Give only the digits needed in the second number of a span: "${m[2]}–${shortenSpan(m[2]!, m[3]!)}".`,
		ref: 'r 1.1.7',
		fix: (m) => `${m[2]}–${shortenSpan(m[2]!, m[3]!)}`,
		// Dates in the same month are given in full: "21–22 September" (r 1.11.4).
		skip: (m) => shortenSpan(m[2]!, m[3]!) === null || new RegExp(`^\\s${MONTH}`).test(m.input.slice(m.index + m[0].length)),
		outsideTitles: true,
	},
	{
		rule: 'para-span',
		re: /\[(?<target>(\d+)–(\d+))\]/g,
		severity: 'error',
		message: (m) => `Give each paragraph of a span in its own brackets: "[${m[2]}]–[${expandSpan(m[2]!, m[3]!)}]".`,
		ref: 'r 1.1.7',
		fix: (m) => `${m[2]}]–[${expandSpan(m[2]!, m[3]!)}`,
	},
	{
		rule: 'signal-unknown',
		re: /^(?<target>Contra|Compare)\b/g,
		severity: 'warning',
		message: (m) => `"${m.groups!.target!}" is not an AGLC4 introductory signal: use ${m.groups!.target === 'Compare' ? '"Cf"' : '"But see"'}.`,
		ref: 'r 1.2',
		fix: (m) => (m.groups!.target === 'Compare' ? 'Cf' : 'But see'),
	},
	{
		rule: 'initials',
		// "H. L. A. Hart", "Ralph H. Folsom", "D. Appleton": initials take no full stops or spaces (r 1.6.1, 4.1.1).
		re: /(?:^|[\s(,])(?<target>[A-Z]\.(?:\s?[A-Z]\.)*)\s(?=[A-Z][a-z])/g,
		severity: 'warning',
		message: 'Initials take no full stops or spaces ("HLA Hart").',
		ref: 'r 1.6.1',
		fix: (m) => m.groups!.target!.replace(/[.\s]/g, ''),
	},
	{
		rule: 'per-judge',
		re: /\((?<target>per\s)(?=[A-Z])/g,
		severity: 'error',
		message: '"Per" is not used before a judicial officer\'s name.',
		ref: 'r 2.4.1',
		fix: () => '',
	},
	{
		rule: 'weekday-comma',
		re: new RegExp(`\\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?<target>,)\\s(?=\\d{1,2}\\s${MONTH})`, 'g'),
		severity: 'warning',
		message: 'No comma between the day of the week and the date.',
		ref: 'r 1.11.1',
		fix: () => '',
	},
	{
		rule: 'pinpoint-space',
		// "s5(1)" → "s 5(1)" (r 3.1.4)
		re: /(?:^|[\s(])(?<target>(?:ss?|regs?|rr?|cls?|pts?|divs?|schs?|arts?)(?=\d))/g,
		severity: 'warning',
		message: 'Separate the pinpoint designation and number with a space: "s 5".',
		ref: 'r 3.1.4',
		fix: (m) => `${m.groups!.target!} `,
	},
	{
		rule: 'subsection-space',
		// "s 2 (3)" → "s 2(3)" (r 3.1.4)
		re: /\b(?:ss?|regs?|rr?|cls?)\s\d+[A-Z]*(?<target>\s)(?=\([0-9a-z]{1,4}\))/g,
		severity: 'warning',
		message: 'No space between a section number and its subsection: "s 2(3)".',
		ref: 'r 3.1.4',
		fix: () => '',
	},
	{
		rule: 'ellipsis-dots',
		re: /(?<target>\.\s?\.\s?\.)/g,
		severity: 'warning',
		message: 'Use an ellipsis character (…), with a space either side.',
		ref: 'r 1.5.3',
		fix: () => '…',
	},
	{
		rule: 'ellipsis-leader',
		re: /['‘"“](?<target>…\s?)/g,
		severity: 'warning',
		message: 'Do not start a quotation with an ellipsis.',
		ref: 'r 1.5.3',
		fix: () => '',
	},
	{
		rule: 'ellipsis-stop',
		re: /…(?<target>\s?\.)/g,
		severity: 'warning',
		message: 'No full stop after an ellipsis.',
		ref: 'r 1.5.3',
		fix: () => '',
	},
	{
		rule: 'ellipsis-space',
		re: /(?:[\p{L}\p{N}](?<before>…)|…(?<target>)(?=[\p{L}\p{N}]))/gu,
		severity: 'warning',
		message: 'Put a space on each side of an ellipsis.',
		ref: 'r 1.5.3',
		fix: (m) => (m.groups!.before ? ' …' : ' '),
	},
	{
		rule: 'latin-not-italic',
		// Words in the Macquarie Dictionary are not italicised (r 1.8.3).
		re: /(?<target>[*_](?:et al|inter alia|prima facie|bona fide|ab initio|ad hoc|ad idem|amicus curiae|caveat emptor|de facto|de jure|ex gratia|ex parte|ex post facto|habeas corpus|laissez-faire|non est factum|obiter dictum|per se|quid pro quo|raison d’être|ratio decidendi|res ipsa loquitur|sui generis|terra nullius|ultra vires|vice versa|vis-a-vis)[*_])/g,
		severity: 'warning',
		message: (m) => `"${m.groups!.target!.slice(1, -1)}" is not italicised.`,
		ref: 'r 1.8.3',
		fix: (m) => m.groups!.target!.slice(1, -1),
	},
	{
		rule: 'latin-italic',
		re: /(?:^|[^*_\w])(?<target>contra proferentem|ex ante|jus ad bellum|lex fori|ne bis in idem|quantum meruit|stare decisis)(?![*_\w])/g,
		severity: 'warning',
		message: (m) => `"${m.groups!.target!}" is italicised.`,
		ref: 'r 1.8.3',
		fix: (m) => `*${m.groups!.target!}*`,
		outsideTitles: true,
	},
	{
		rule: 'signal-comma',
		re: /^(?:See(?: also| especially| generally)?|Cf|But see|Contra)(?<target>,)\s(?!eg,)/g,
		severity: 'warning',
		message: 'An introductory signal is not followed by a comma (except "See, eg,").',
		ref: 'r 1.2',
		fix: () => '',
	},
	{
		rule: 'page-abbrev',
		re: /\s(?<target>pp?\.?\s)(?=\d)/g,
		severity: 'error',
		message: 'Page pinpoints are not preceded by "p" or "pp".',
		ref: 'ch 2',
		fix: () => '',
	},
	{
		rule: 'at-pinpoint',
		re: /[\d\])*_'’](?<target>,?\sat\s)(?=\d|\[)/g,
		severity: 'error',
		message: 'AGLC4 pinpoints follow a comma; "at" is not used.',
		ref: 'ch 2',
		fix: () => ', ',
	},
	{
		rule: 'para-pinpoint',
		re: /\s(?<target>(?:paras?|¶)\.?\s(\d+)(?:[–-](\d+))?)/g,
		severity: 'warning',
		message: 'Pinpoint paragraphs of judgments as [23], not "para 23".',
		ref: 'ch 2',
		fix: (m) => (m[3] ? `[${m[2]}]–[${m[3]}]` : `[${m[2]}]`),
	},
	{
		rule: 'section-symbol',
		re: /§§?\s?/g,
		severity: 'error',
		message: 'Use "s" (or "ss"), not "§".',
		ref: 'r 3.1.4',
		fix: (m) => (m[0].startsWith('§§') ? 'ss ' : 's '),
	},
	{
		rule: 'section-word',
		// Not at the start of a sentence, where AGLC4 writes "Section" in full.
		re: /(?:[^.!?\s]\s|[(])(?<target>(?:[Ss]ections?|[Ss]ecs?\.?|s\.|ss\.)\s?)(?=\d)/g,
		severity: 'warning',
		message: 'Abbreviate sections as "s" (one) or "ss" (several), without a full stop.',
		ref: 'r 3.1.4',
		fix: (m) => (/s(?:ections|s\.)/.test(m.groups!.target!) ? 'ss ' : 's '),
	},
	{
		rule: 'abbrev-stops',
		re: /\b(?<target>(?:Pty|Ltd|Co|Inc|No|Nos|eg|ie|cf|vol|Vol|ch|pt|div|sch|reg|cl|art|ed|eds|edn|trans|Dr|Mr|Mrs|Ms|Messrs|Prof|Jr|Sr|Snr|Jnr)\.)(?=[\s,;)])/g,
		severity: 'warning',
		message: (m) => `"${m.groups!.target!.slice(0, -1)}" takes no full stop (AGLC4 abbreviations are unpunctuated).`,
		ref: 'Part I',
		fix: (m) => m.groups!.target!.slice(0, -1),
	},
	{
		rule: 'latin-abbrev',
		re: /\b(?<target>e\.g\.|i\.e\.|viz\.|et\. al\.?)/g,
		severity: 'error',
		message: (m) => `Write "${latinFix(m.groups!.target!)}" without full stops.`,
		ref: 'Part I',
		fix: (m) => latinFix(m.groups!.target!),
	},
	{
		rule: 'not-aglc',
		re: /\b(?<target>supra|infra|op\.? cit\.?|loc\.? cit\.?|[Ii]d\.)(?=[\s,.]|$)/g,
		severity: 'error',
		message: (m) => `"${m.groups!.target!}" is not used in AGLC4. Use "Ibid" for the preceding footnote, or a short reference with "(n X)".`,
		ref: 'r 1.4',
	},
	{
		rule: 'date-ordinal',
		re: new RegExp(`\\b(?<target>(\\d{1,2})(?:st|nd|rd|th))(?=\\s(?:of\\s)?${MONTH})`, 'g'),
		severity: 'error',
		message: 'Dates are written "1 January 2020", without ordinals.',
		ref: 'Part I',
		fix: (m) => m[2]!,
	},
	{
		rule: 'date-order',
		re: new RegExp(`\\b(?<target>(${MONTH})\\s(\\d{1,2}),?\\s(\\d{4}))\\b`, 'g'),
		severity: 'error',
		message: 'Dates are written day month year: "1 January 2020".',
		ref: 'Part I',
		fix: (m) => `${m[3]} ${m[2]} ${m[4]}`,
	},
	{
		rule: 'month-abbrev',
		re: /\b\d{1,2}\s(?<target>(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?)(?=\s\d{4})/g,
		severity: 'error',
		message: 'Write months in full.',
		ref: 'Part I',
		fix: (m) => SHORT_MONTHS[m[2]!] ?? m[2]!,
	},
	{
		rule: 'bare-url',
		re: /(?:^|[^<(\w])(?<target>https?:\/\/[^\s<>]+?)(?=[.,;]?(?:\s|$))/g,
		severity: 'error',
		message: 'Put URLs in angle brackets: <https://…>.',
		ref: 'ch 7',
		fix: (m) => `<${m.groups!.target!}>`,
	},
	{
		rule: 'double-space',
		re: /\S(?<target> {2,})(?=\S)/g,
		severity: 'warning',
		message: 'Use a single space.',
		fix: () => ' ',
	},
	{
		rule: 'space-before-punct',
		// Not the spaces of a spaced ellipsis (". . .").
		re: /[^\s.](?<target> +)(?=[,;.](?:\s|$))(?![,;.]\s\.)/g,
		severity: 'warning',
		message: 'No space before punctuation.',
		fix: () => '',
	},
	{
		rule: 'jurisdiction-dots',
		re: /\((?<target>N\.S\.W\.|W\.A\.|S\.A\.|N\.T\.|A\.C\.T\.|Qld\.|Vic\.|Tas\.|C'th|Cwlth)\)/g,
		severity: 'error',
		message: 'Abbreviate jurisdictions without full stops: (NSW), (Cth), (Vic) ….',
		ref: 'r 3.1.3',
		fix: (m) => ({ 'C\'th': 'Cth', 'Cwlth': 'Cth' } as Record<string, string>)[m.groups!.target!] ?? m.groups!.target!.replace(/\./g, ''),
	},
];

/** Ranges of URLs in angle brackets, which the text rules leave alone. */
function protectedRanges(text: string): [number, number][] {
	const out: [number, number][] = [];
	const re = /<https?:\/\/[^>\s]*>?|`[^`]*`/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
	return out;
}

/**
 * Ranges inside single-quoted titles and quotations ('…', ‘…’), where double quotation marks are correct
 * for a quotation within the quotation.
 */
function singleQuoted(text: string): [number, number][] {
	const out: [number, number][] = [];
	const re = /(^|[\s(])['‘](.+?)['’](?=[\s,.;:)?!]|$)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) out.push([m.index + m[1]!.length, m.index + m[0].length]);
	return out;
}

/** Ranges of italic text (*…* or _…_). */
function italicSpans(text: string): [number, number][] {
	const out: [number, number][] = [];
	const re = /\*[^*\n]+\*|(?:^|[^\w])_[^_\n]+_(?!\w)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const lead = m[0].startsWith('*') || m[0].startsWith('_') ? 0 : 1;
		out.push([m.index + lead, m.index + m[0].length]);
	}
	return out;
}

/** Apply the text-level rules to footnote text. Offsets are relative to `text`. */
export function lintFootnote(text: string, disabled: ReadonlySet<string> = new Set()): Issue[] {
	const out: Issue[] = [];
	const prot = protectedRanges(text);
	const quoted = singleQuoted(text);
	const titles = [...quoted, ...italicSpans(text)];
	const trimmedLength = text.replace(/\s+$/, '').length;
	for (const r of RULES) {
		if (disabled.has(r.rule)) continue;
		r.re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = r.re.exec(text))) {
			if (m[0].length === 0) { r.re.lastIndex++; continue; }
			const target = m.groups?.target;
			const from = target !== undefined ? m.index + m[0].lastIndexOf(target) : m.index;
			const to = from + (target ?? m[0]).length;
			if (prot.some(([a, b]) => from >= a && from < b)) continue;
			if (r.rule === 'double-quotes' && quoted.some(([a, b]) => from > a && from < b - 1)) continue;
			if (r.skip?.(m)) continue;
			if (r.outsideTitles && titles.some(([a, b]) => from > a && from < b)) continue;
			// A full stop that closes the footnote is not an abbreviation stop.
			if (r.rule === 'abbrev-stops' && to >= trimmedLength) continue;
			out.push({
				rule: r.rule,
				severity: r.severity,
				from,
				to,
				message: typeof r.message === 'function' ? r.message(m) : r.message,
				ref: r.ref,
				fix: r.fix ? { from, to, insert: r.fix(m) } : undefined,
			});
		}
	}
	return out;
}
