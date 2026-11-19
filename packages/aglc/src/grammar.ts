/**
 * The AGLC4 citation grammar: for every kind of source, the ordered elements of a full citation.
 *
 * Each element is a sticky regular expression that consumes the element *and the separator before it*,
 * so a citation can be matched left to right. Matching tells us how far a citation is complete, which
 * element is expected next, and where a finished citation stops conforming. Element checks then look at
 * what was matched for formatting errors (missing italics, wrong brackets, and so on).
 */
import { JURISDICTIONS, JURISDICTION_FIXES, LEG_PINPOINTS, MNC_COURTS, MONTHS, VOLUME_SERIES, YEAR_SERIES, escapeRe } from './data';
import type { Issue } from './types';

export type SourceKind =
	| 'legislation'
	| 'legislation-short'
	| 'explanatory'
	| 'case-mnc'
	| 'case-reported'
	| 'case-unreported'
	| 'hansard'
	| 'treaty'
	| 'journal'
	| 'chapter'
	| 'book'
	| 'newspaper'
	| 'internet'
	| 'paper'
	| 'ibid'
	| 'subsequent';

export interface ElementMatch {
	id: string;
	from: number;
	to: number;
	text: string;
	groups: RegExpExecArray;
}

export interface CheckContext {
	/** The citation text being matched (signal removed). */
	text: string;
	/** Elements matched so far, by id (the last match for repeatable elements). */
	matched: Record<string, ElementMatch>;
	/** True when an introductory signal precedes the citation. */
	hasSignal: boolean;
}

export interface ElementSpec {
	id: string;
	label: string;
	/** Short description shown with suggestions. */
	hint: string;
	/** Text inserted when the element is suggested. `${...}` marks a placeholder that will be selected. */
	insert: string;
	re: RegExp;
	optional?: boolean;
	repeat?: boolean;
	/** Return true when a regex match should not count as this element (eg a court identifier as a series). */
	reject?: (m: RegExpExecArray, ctx: CheckContext) => boolean;
	/** Formatting checks on the matched element. Offsets are relative to the citation text. */
	check?: (m: ElementMatch, ctx: CheckContext) => Issue[];
}

export interface SourceSpec {
	kind: SourceKind;
	label: string;
	ref: string;
	/** Once this element has matched, the text is treated as this kind of citation and errors are reported. */
	claimAfter: string;
	/** Example of a full citation, shown when choosing a source type. */
	example: string;
	/** Text inserted to start this kind of citation. */
	start: string;
	elements: ElementSpec[];
}

// ---------------------------------------------------------------------------------------------------------
// Regex fragments

const S = (src: string): RegExp => new RegExp(src, 'y');

const MONTH = `(?:${MONTHS.join('|')})`;
const DATE = `\\d{1,2}\\s${MONTH}\\s\\d{4}`;
const ITALIC = '(?:\\*[^*\\n]+\\*|_[^_\\n]+_)';
const OPEN_Q = '[\'‘]';
const CLOSE_Q = '[\'’]';
/** A footnote pinpoint within a page or paragraph: "n 6", "nn 7–8". */
const PIN_NOTE = '(?:\\snn?\\s\\d+(?:[–-]\\d+)?)?';
/** A page (with thousands separators, as in CCH reports: "91,970"), optionally with paragraphs: "6 [23]". */
const PIN_PAGE = `(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[–-]\\d+)?(?:\\s\\[[\\d.]+\\](?:[–-]\\[[\\d.]+\\])?)?${PIN_NOTE}`;
const PIN_PARA = `\\[[\\d.]+\\](?:[–-]\\[[\\d.]+\\])?${PIN_NOTE}`;
const PIN = `(?:${PIN_PARA}|${PIN_PAGE})`;
/** Book pinpoints (r 6.4–6.5): pages and paragraphs, or chapters and parts ("ch 5", "pt 1 ch 2"), volumes and books ("vol 16, 159"). */
const BOOK_PIN = `(?:(?:vol|bk)\\s\\d+(?:,\\s(?:${PIN_PARA}|${PIN_PAGE}))?|(?:chs?|pts?)\\s[\\dIVXLC]+(?:[–-][\\dIVXLC]+)?(?:\\s(?:chs?|pts?)\\s[\\dIVXLC]+)*|${PIN_PARA}|${PIN_PAGE})`;
const LEG_DESIGNATOR = `(?:${LEG_PINPOINTS.map(escapeRe).join('|')})`;
const LEG_UNIT = '(?:(?:\\d+(?:[.-]\\d+)*[A-Za-z]*|[IVXLC]+[A-Z]?|[A-Z]\\d*)(?:\\([0-9A-Za-z]+\\))*|(?:\\([0-9A-Za-z]+\\))+)';
const LEG_NUM = `${LEG_UNIT}(?:[–-]${LEG_UNIT})?`;
const LEG_ONE = `${LEG_DESIGNATOR}\\s${LEG_NUM}(?:(?:,\\s|\\sand\\s|\\sor\\s)${LEG_NUM})*`;
/** One or more designators, eg "s 5(1)", "ss 180–4", "pt 2 div 3", "sch 1 item 3". */
const LEG_PIN = `${LEG_ONE}(?:\\s${LEG_ONE})*`;
const JUR = `(?:${JURISDICTIONS.map(escapeRe).join('|')})`;
/** Judicial offices (AGLC4 r 2.4.1 table, and UK offices). */
const JUDGE_TITLES = '(?:CJ in Eq|CJ at CL|CJ Comm D|CJA|CJ|ACJ|AJJA|AJA|AJJ|AJ|AP|AsJ|AUJ|DCJ|FM|JJA|JJ|JA|JR|SJA|SJJ|SJ|SPJ|V-P|LJJ|LJ|MR|LC|JSC|PSC|DPSC|J|P|SM|DP|M|C)';
/** Titles written before a judicial officer's name (r 2.4.1), and peerage titles. */
const JUDGE_PREFIX = '(?:Commissioner|Judge|Magistrate|Master|Lord|Lady|Baroness|Baron|Viscount)';
/**
 * The judicial officers a pinpoint refers to (r 2.4): "(Brennan J)", "(Gummow and Hayne JJ)", "(Lord Atkin)",
 * "(Commissioner Buss)", "(Kirby J, dissenting)", "(Kitto J, Webb J agreeing at 591)",
 * "(Hudson AJ for the Court)": any parenthetical naming a judicial officer.
 */
const JUDGES = `\\s\\((?=[^()\\n]*(?:\\b${JUDGE_TITLES}\\b|\\b${JUDGE_PREFIX}\\s[A-Z]))(?:[^()\\n]|\\[[^\\]\\n]*\\])*\\)`;
/** Parenthetical notes after a pinpoint (r 1.5.7, 2.2.6, 2.4.4): "(emphasis added)", "(Court of Appeal)", "(during argument)". */
const NOTES = '\\s\\((?:emphasis added|emphasis in original|citations omitted|footnotes omitted|citations and footnotes omitted|during argument|(?=[^()\\n]*\\b(?:Court|Council|Tribunal|Commission)\\b)[A-Z][^()\\n]*)\\)';
/** A personal or organisational name: capitalised words, with the particles names and bodies use. */
const NAME = '\\p{Lu}[\\p{L}\\p{N}.\'’&-]*(?:\\s(?:\\p{Lu}[\\p{L}\\p{N}.\'’&-]*|of|the|for|on|and|in|de|van|von|der|den|di|da|le|la|du|bin|binti|et al\\.?|&))*';
/** Authors (r 4.1): names separated by commas, a body's jurisdiction ("Department for Women (NSW)"), editors. */
const AUTHOR_NAME = `${NAME}(?:\\s\\((?:Cth|NSW|Vic|Qld|WA|SA|Tas|ACT|NT)\\))?`;
const AUTHORS = `${AUTHOR_NAME}(?:,\\s${AUTHOR_NAME})*(?:\\s\\((?:ed|eds)\\))?`;
const SHORT_TITLE = `\\s\\((?:\\*${OPEN_Q}[^'’*\\n]+${CLOSE_Q}\\*|${OPEN_Q}\\*[^*\\n]+\\*${CLOSE_Q}|${OPEN_Q}[^'’\\n]+${CLOSE_Q})\\)`;

function isItalic(s: string): boolean {
	const t = s.trim();
	return (t.startsWith('*') && t.endsWith('*')) || (t.startsWith('_') && t.endsWith('_'));
}

function stripItalic(s: string): string {
	return s.trim().replace(/^[*_]|[*_]$/g, '');
}

function issue(m: ElementMatch, rule: string, severity: Issue['severity'], message: string, ref?: string, fix?: Issue['fix'], from?: number, to?: number): Issue {
	return { rule, severity, message, ref, fix, from: from ?? m.from, to: to ?? m.to };
}

/** Skip a leading separator (comma/space) so an underline covers only the element itself. */
function bodyStart(m: ElementMatch): number {
	const lead = /^[,\s]*/.exec(m.text)?.[0].length ?? 0;
	return m.from + lead;
}

// ---------------------------------------------------------------------------------------------------------
// Shared elements

const caseName: ElementSpec = {
	id: 'name',
	label: 'Case name',
	hint: 'Party v Party, in italics (AGLC4 r 2.1)',
	insert: '*${Party v Party}*',
	re: S(`(?:${ITALIC}|(?:Re\\s|[A-Z][^;*_\\n]*?\\sv\\s)[^;*_\\n]*?(?=\\s[[(]\\d{4}[\\])]))`),
	// The name is omitted when it appears in the sentence (r 2.1.15): "(2007) 233 CLR 307".
	optional: true,
	check: (m) => {
		const out: Issue[] = [];
		if (!isItalic(m.text)) {
			out.push(issue(m, 'case-italics', 'error', 'Case names are italicised.', 'r 2.1.1', { from: m.from, to: m.to, insert: `*${m.text.trim()}*`, label: 'Italicise case name' }));
		}
		const name = stripItalic(m.text);
		const nameAt = m.from + m.text.indexOf(name);
		// Find-and-replace style rules for parties' names (r 2.1.1–2.1.8).
		const partyRules: [RegExp, (m: RegExpExecArray) => string, string, string, Issue['severity']][] = [
			[/\((No|Nos) (\d+(?: and \d+)?)\)/, (x) => `[${x[1]} ${x[2]}]`, 'case-number', 'The number of a decision goes in square brackets: "[No 2]".', 'error'],
			[/^(Regina|Rex)(?=\sv\s)|^(The Queen|The King)(?=\sv\s)/, () => 'R', 'case-crown', 'When the Crown is the first party, write "R".', 'error'],
			[/\s(?:&|and) (?:Anor|Ors|Another|Others)\b/, () => '', 'case-others', 'Cite only the first plaintiff and first defendant: omit "& Anor" and "& Ors".', 'error'],
			[/\bProprietary Limited\b|\bPty\.? Limited\b|\bProprietary Ltd\b/, () => 'Pty Ltd', 'case-company', 'Abbreviate corporate status: "Pty Ltd".', 'error'],
			[/\bLimited\b/, () => 'Ltd', 'case-company', 'Abbreviate "Limited" to "Ltd".', 'error'],
			[/\bIncorporated\b/, () => 'Inc', 'case-company', 'Abbreviate "Incorporated" to "Inc".', 'error'],
			[/\bCompany(?=\s(?:Pty|Ltd|Inc)\b|\sv\s|$)/, () => 'Co', 'case-company', 'Abbreviate "Company" to "Co".', 'error'],
			[/\(in (?:liquidation|provisional liquidation)\)/, (x) => (x[0].includes('provisional') ? '(in prov liq)' : '(in liq)'), 'case-company', 'Abbreviate "(in liquidation)" to "(in liq)".', 'error'],
			[/\b(?:The )?Commonwealth of Australia\b/, () => 'Commonwealth', 'case-state', 'Write the Commonwealth as "Commonwealth".', 'error'],
			[/\b(?:The )?State of (?=New South Wales|Victoria|Queensland|Western Australia|South Australia|Tasmania)/, () => '', 'case-state', 'Write only the name of the State: "New South Wales", not "State of New South Wales".', 'error'],
			[/\bAttorney-General\b/, () => 'A-G', 'case-officer', 'In citations an Attorney-General is "A-G", followed by the jurisdiction: "A-G (Cth)".', 'error'],
			[/\bDirector of Public Prosecutions\b/, () => 'DPP', 'case-officer', 'In citations a Director of Public Prosecutions is "DPP", followed by the jurisdiction: "DPP (Vic)".', 'error'],
			[/^In re\b|^In the matter of\b/, () => 'Re', 'case-re', 'Shorten "In re" and "In the matter of" to "Re".', 'error'],
			[/\bex parte\b|\bEx Parte\b|\bEx p\b/, () => 'Ex parte', 'case-ex-parte', 'Write "Ex parte" (not abbreviated; "parte" in lower case).', 'error'],
		];
		const reported = new Set<string>();
		for (const [re, replace, rule, message, severity] of partyRules) {
			// One issue per rule: "Proprietary Limited" is one fix, not "Pty Ltd" and "Ltd" overlapping.
			if (reported.has(rule)) continue;
			const x = re.exec(name);
			if (!x) continue;
			reported.add(rule);
			const at = nameAt + x.index;
			out.push(issue(m, rule, severity, message, PARTY_RULE_REFS[rule] ?? 'r 2.1', { from: at, to: at + x[0].length, insert: replace(x) }, at, at + x[0].length));
		}
		const vs = /\s(vs\.?|v\.|versus)\s/.exec(m.text);
		if (vs) {
			const at = m.from + vs.index + 1;
			out.push(issue(m, 'case-v', 'error', 'Separate the parties with "v" (no full stop).', 'r 2.1.11', { from: at, to: at + vs[1]!.length, insert: 'v' }, at, at + vs[1]!.length));
		}
		return out;
	},
};

/** The AGLC4 rule for each check on parties' names. */
const PARTY_RULE_REFS: Record<string, string> = {
	'case-number': 'r 2.1.13',
	'case-crown': 'r 2.1.4',
	'case-others': 'r 2.1.1',
	'case-company': 'r 2.1.2',
	'case-state': 'r 2.1.3',
	'case-officer': 'r 2.1.7',
	'case-re': 'r 2.1.8',
	'case-ex-parte': 'r 2.1.9',
};

const pinpoints: ElementSpec = {
	id: 'pinpoint',
	label: 'Pinpoint',
	hint: 'Page (", 23"), paragraph (", [23]") or both (", 6 [23]"), each optionally followed by its judge',
	insert: ', ${pinpoint}',
	// Pinpoints can alternate with judges: "509 [43], [45] (French J), 529–30 [137] (Stone J)" (r 2.4).
	re: S(`,\\s${PIN}(?:${JUDGES})?`),
	optional: true,
	repeat: true,
};

const notes: ElementSpec = {
	id: 'note',
	label: 'Note',
	hint: '(emphasis added), (citations omitted), the court, (during argument)',
	insert: ' (${emphasis added})',
	re: S(NOTES),
	optional: true,
	repeat: true,
};

const judges: ElementSpec = {
	id: 'judges',
	label: 'Judicial officer',
	hint: 'Judge(s) the pinpoint refers to, eg (Brennan J)',
	insert: ' (${Name J})',
	re: S(JUDGES),
	optional: true,
};

const shortTitle = (id = 'short'): ElementSpec => ({
	id,
	label: 'Short title',
	hint: 'Only if the source is cited again: (\'*Short*\') (AGLC4 r 1.4.4)',
	insert: ' (\'*${Short Title}*\')',
	re: S(SHORT_TITLE),
	optional: true,
	check: (m) => {
		// The inverted commas are not italic: ('*Mabo*'), not (*'Mabo'*).
		const x = /^\s\(\*(['‘])([^'’*]+)(['’])\*\)$/.exec(m.text);
		return x
			? [issue(m, 'short-title-quotes', 'warning', 'Put the inverted commas of a short title outside the italics: (\'*Short Title*\').', 'r 1.4.4', { from: m.from + 2, to: m.to - 1, insert: `${x[1]}*${x[2]}*${x[3]}` }, m.from + 1, m.to)]
			: [];
	},
});

const author = (optional = false): ElementSpec => ({
	id: 'author',
	label: 'Author',
	hint: 'Name as it appears on the source, eg Jane Smith and Ali Khan (AGLC4 r 4.1)',
	insert: '${Author Name}',
	re: new RegExp(`${AUTHORS}(?=,\\s*(?:['‘"“*_]|$)|$)`, 'yu'),
	optional,
	check: (m) => {
		const out: Issue[] = [];
		const amp = m.text.indexOf(' & ');
		if (amp >= 0) {
			const at = m.from + amp + 1;
			out.push(issue(m, 'author-and', 'warning', 'Join authors with "and", not "&".', 'r 4.1', { from: at, to: at + 1, insert: 'and' }, at, at + 1));
		}
		const names = m.text.replace(/\s\((?:ed|eds)\)$/, '').split(/,\s|\sand\s/).filter((n) => n.trim());
		// Organisations can have commas in their names ("Department of Infrastructure, Transport, …"): only
		// count authors when every part reads as a personal name of two or more words.
		const people = names.every((n) => n.trim().split(/\s+/).length >= 2)
			&& !/^(?:Department|Commission|Council|Committee|Office|Ministry|Institute|Association|Society|Authority|Agency|Bureau|Parliament|Government|University|Centre|Center|Foundation|Board|Tribunal|Court)\b/.test(names[0]!.trim());
		if (names.length >= 4 && people && !/\bet al\b/.test(m.text)) {
			out.push(issue(m, 'et-al-four', 'warning', 'With four or more authors, give the first author followed by "et al".', 'r 4.1', { from: m.from, to: m.to, insert: `${names[0]!.trim()} et al` }));
		}
		const etal = /\bet al\./.exec(m.text);
		if (etal) {
			const at = m.from + etal.index;
			out.push(issue(m, 'et-al', 'error', '"et al" takes no full stop.', 'r 4.1', { from: at, to: at + 7, insert: 'et al' }, at, at + 7));
		}
		return out;
	},
});

/** Words AGLC4 leaves in lower case within a title: articles, conjunctions, prepositions, particles. */
const MINOR_WORDS = new Set([
	'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of', 'off', 'on',
	'onto', 'per', 'to', 'up', 'via', 'with', 'from', 'into', 'over', 'than', 'upon', 'out', 'v', 'vs',
	// Longer prepositions and conjunctions
	'about', 'above', 'across', 'after', 'against', 'along', 'amid', 'among', 'around', 'before', 'behind',
	'below', 'beneath', 'beside', 'besides', 'between', 'beyond', 'despite', 'down', 'during', 'except',
	'inside', 'like', 'near', 'outside', 'past', 'since', 'through', 'throughout', 'till', 'toward', 'towards',
	'under', 'underneath', 'unlike', 'until', 'within', 'without', 'although', 'because', 'if', 'though',
	'unless', 'whereas', 'whether', 'while', 'once',
	'de', 'del', 'der', 'des', 'di', 'du', 'la', 'le', 'les', 'van', 'von', 'et', 'al', 'und', 'y', 'e',
]);

/**
 * The title with each word capitalised as AGLC4 requires: every word except articles, conjunctions and
 * prepositions, which are capitalised only first and after a colon. Words with capitals or digits in
 * them ("iPhone", "eSafety", "COVID-19") are left alone. Returns null if nothing needs to change.
 */
export function titleCase(title: string): string | null {
	let first = true;
	let changed = false;
	// Each part of a hyphenated word is capitalised ("Self-Help"), so hyphens separate words here.
	const out = title.replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*|[:?!—–]/gu, (w) => {
		if (/^[:?!—–]$/.test(w)) { first = true; return w; }
		const lower = /^[\p{Ll}][\p{Ll}'’]*$/u.test(w);
		const wasFirst = first;
		first = false;
		if (!lower || (!wasFirst && MINOR_WORDS.has(w))) return w;
		changed = true;
		return w.charAt(0).toUpperCase() + w.slice(1);
	});
	return changed ? out : null;
}

/** A warning when a title, given as the element's text between `inner` offsets, is not in title case. */
function titleCaseIssue(m: ElementMatch, from: number, to: number, ctx: CheckContext): Issue[] {
	const title = ctx.text.slice(from, to);
	if (/https?:|<|\d{4}/.test(title)) return [];
	const fixed = titleCase(title);
	return fixed ? [issue(m, 'title-case', 'warning', `Capitalise the title: "${fixed.replace(/[*_]/g, '')}".`, 'r 1.7', { from, to, insert: fixed }, from, to)] : [];
}

const quotedTitle = (id: string, label: string, follow: string, leadingOptional = false): ElementSpec => ({
	id,
	label,
	hint: 'Title in single quotation marks, capitalised (AGLC4 r 4.2)',
	insert: leadingOptional ? '\'${Title}\'' : ', \'${Title}\'',
	re: S(`${leadingOptional ? '(?:^|,\\s)' : ',\\s'}["“'‘].*?["”'’](?=${follow}|$)`),
	check: (m, ctx) => {
		const at = bodyStart(m);
		const body = m.text.slice(at - m.from);
		if (/^["“]/.test(body) || /["”]$/.test(body)) {
			const inner = body.slice(1, -1);
			return [issue(m, 'title-quotes', 'error', 'Titles of articles and chapters take single quotation marks.', 'r 1.5.1', { from: at, to: m.to, insert: `'${inner}'` }, at, m.to)];
		}
		return titleCaseIssue(m, at + 1, m.to - 1, ctx);
	},
});

const italicTitle = (id: string, label: string, hint: string): ElementSpec => ({
	id,
	label,
	hint,
	insert: ', *${Title}*',
	re: S(`,\\s${ITALIC}`),
	check: (m, ctx) => titleCaseIssue(m, bodyStart(m) + 1, m.to - 1, ctx),
});

const yearBracket: ElementSpec = {
	id: 'year',
	label: 'Year',
	hint: '(Year) for volume-numbered series, [Year] for year-organised series (AGLC4 r 2.2.1)',
	insert: ' (${Year})',
	// At the very start when the case name is omitted (r 2.1.15).
	re: S('(?:^|\\s)(?:\\(\\d{4}\\)|\\[\\d{4}\\])'),
};

const pageStart: ElementSpec = {
	id: 'page',
	label: 'Starting page',
	hint: 'First page of the source',
	insert: ' ${1}',
	re: S('\\s\\d+'),
};

// ---------------------------------------------------------------------------------------------------------
// Source specifications, in priority order: when two kinds match equally well the earlier one wins.

const LEGISLATION: SourceSpec = {
	kind: 'legislation',
	label: 'Legislation',
	ref: 'ch 3',
	claimAfter: 'jurisdiction',
	example: '*Native Title Act 1993* (Cth) s 223',
	start: '*${Title Year}* (${Cth})',
	elements: [
		{
			id: 'title',
			label: 'Title and year',
			hint: 'Short title including the year, in italics (AGLC4 r 3.1.1)',
			insert: '*${Title Year}*',
			re: S(`(?:\\*[^*\\n]+?\\s\\d{4}\\*|_[^_\\n]+?\\s\\d{4}_|\\*[^*\\n]+\\*\\s\\d{4}|[A-Z][A-Za-z0-9 ,'’()&-]*?\\s\\d{4}(?=\\s?\\((?:${JUR}|[A-Z][A-Za-z.' ]*)\\)))`),
			check: (m) => {
				if (/^\*[^*]+\*\s\d{4}$/.test(m.text)) {
					const title = stripItalic(m.text.replace(/\s\d{4}$/, ''));
					const year = m.text.slice(-4);
					return [issue(m, 'leg-year-italics', 'error', 'The year is part of the title and is italicised.', 'r 3.1.2', { from: m.from, to: m.to, insert: `*${title} ${year}*` })];
				}
				// Bills are cited like Acts, except that the title and year are not italicised (r 3.2).
				const bill = /\bBill(?:\s\(No\s\d+\))?\s\d{4}[*_]?$/.test(m.text.trim());
				if (bill) {
					return isItalic(m.text)
						? [issue(m, 'bill-italics', 'error', 'The title and year of a Bill are not italicised.', 'r 3.2', { from: m.from, to: m.to, insert: stripItalic(m.text) })]
						: [];
				}
				if (!isItalic(m.text)) {
					return [issue(m, 'leg-italics', 'error', 'Titles of legislation are italicised.', 'r 3.1.1', { from: m.from, to: m.to, insert: `*${m.text.trim()}*` })];
				}
				return [];
			},
		},
		{
			id: 'jurisdiction',
			label: 'Jurisdiction',
			hint: 'Abbreviated, in round brackets: (Cth), (NSW), (Vic) … (AGLC4 r 3.1.3)',
			insert: ' (${Cth})',
			re: S('\\s?\\([A-Z][A-Za-z.\' ]*\\)'),
			check: (m) => {
				const out: Issue[] = [];
				const name = m.text.trim().slice(1, -1);
				if (!/^\s/.test(m.text)) {
					out.push(issue(m, 'leg-jurisdiction-space', 'warning', 'Put a space before the jurisdiction.', 'r 3.1.3', { from: m.from, to: m.from, insert: ' ' }));
				}
				const fixed = JURISDICTION_FIXES[name];
				if (fixed) {
					const at = bodyStart(m);
					out.push(issue(m, 'leg-jurisdiction', 'error', `Abbreviate the jurisdiction as "${fixed}".`, 'r 3.1.3', { from: at + 1, to: m.to - 1, insert: fixed }, at, m.to));
				} else if (!(JURISDICTIONS as readonly string[]).includes(name)) {
					out.push(issue(m, 'leg-jurisdiction-unknown', 'warning', `"${name}" is not a recognised AGLC4 jurisdiction abbreviation.`, 'r 3.1.3', undefined, bodyStart(m), m.to));
				}
				return out;
			},
		},
		{
			id: 'pinpoint',
			label: 'Pinpoint',
			hint: 'Section, part, schedule …: s 5, ss 5–7, pt 2, sch 1 (AGLC4 r 3.1.4)',
			insert: ' s ${1}',
			re: S(`\\s${LEG_PIN}`),
			optional: true,
			check: (m) => legAndCheck(m),
		},
		{
			id: 'definition',
			label: 'Definition',
			hint: '(definition of \'term\'), after the section containing it (AGLC4 r 3.1.6)',
			insert: ' (definition of \'${term}\')',
			re: S(`\\s\\(definition of ${OPEN_Q}[^'’\\n]+${CLOSE_Q}(?:\\spara\\s(?:\\([^()]+\\))+)?\\)`),
			optional: true,
		},
		{
			id: 'pinpoint-more',
			label: 'Further pinpoint',
			hint: 'Another designator, eg ", sch 2"',
			insert: ', ${s 1}',
			re: S(`,\\s${LEG_PIN}`),
			optional: true,
			repeat: true,
			check: (m) => legAndCheck(m),
		},
		shortTitle(),
	],
};

/** "ss 5, 7 and 9": AGLC4 separates the last two pinpoints with a comma, not "and" (r 3.1.5). */
function legAndCheck(m: ElementMatch): Issue[] {
	const x = /\s(and|or)\s(?=[\d(])/.exec(m.text);
	if (!x) return [];
	const at = m.from + x.index;
	return [issue(m, 'leg-and', 'warning', 'Separate pinpoints with commas, not "and".', 'r 3.1.5', { from: at, to: at + x[0].length, insert: ', ' }, at + 1, at + 1 + x[1]!.length)];
}

const LEGISLATION_SHORT: SourceSpec = {
	kind: 'legislation-short',
	label: 'Legislation (short title)',
	ref: 'r 3.5',
	claimAfter: 'pinpoint',
	example: '*Native Title Act* s 223',
	start: '*${Short Title}* s ${1}',
	elements: [
		{
			id: 'title',
			label: 'Short title',
			hint: 'The Australian Constitution, or the short title defined when the Act was first cited',
			insert: '*${Short Title}*',
			re: S(ITALIC),
			check: (m) => (/^[*_](?:Australian |Commonwealth )?Constitution[*_]$/.test(m.text)
				? []
				: [issue(m, 'leg-short-n', 'error', 'A later reference to legislation by its short title needs the footnote of the full citation: "*Short Title* (n X) s 5".', 'r 3.5', undefined)]),
		},
		{
			id: 'pinpoint',
			label: 'Pinpoint',
			hint: 's 5, pt 2, sch 1',
			insert: ' s ${1}',
			re: S(`\\s${LEG_PIN}`),
		},
		{
			id: 'pinpoint-more',
			label: 'Further pinpoint',
			hint: 'Another designator, eg ", sch 2"',
			insert: ', ${s 1}',
			re: S(`,\\s${LEG_PIN}`),
			optional: true,
			repeat: true,
		},
	],
};

const CASE_MNC: SourceSpec = {
	kind: 'case-mnc',
	label: 'Case (medium neutral citation)',
	ref: 'r 2.3',
	claimAfter: 'court',
	example: '*Love v Commonwealth* [2020] HCA 3, [81]',
	start: '*${Party v Party}* [${Year}] ${HCA} ${1}',
	elements: [
		caseName,
		{
			...yearBracket,
			hint: 'Year of judgment in square brackets (AGLC4 r 2.3.1)',
			insert: ' [${Year}]',
			check: (m) => (m.text.includes('(')
				? [issue(m, 'mnc-brackets', 'error', 'The year of a medium neutral citation goes in square brackets.', 'r 2.3.1', { from: bodyStart(m), to: m.to, insert: `[${m.text.trim().slice(1, -1)}]` }, bodyStart(m), m.to)]
				: []),
		},
		{
			id: 'court',
			label: 'Court identifier',
			hint: 'eg HCA, FCAFC, NSWCA, VSCA, QCA (AGLC4 r 2.3.1)',
			insert: ' ${HCA}',
			re: S('\\s[A-Z][A-Za-z]*(?:\\s(?:Civ|Crim|Admin|Ch|Fam|QB|KB|Comm|Pat|TCC))?'),
			reject: (m) => !MNC_COURTS.has(m[0].trim()),
		},
		{
			id: 'number',
			label: 'Judgment number',
			hint: 'Number of the judgment',
			insert: ' ${1}',
			re: S('\\s\\d+'),
		},
		{
			...pinpoints,
			hint: 'Paragraph in square brackets, eg ", [23]"',
			insert: ', [${1}]',
			check: (m) => (/^,\s\d/.test(m.text)
				? [issue(m, 'mnc-pinpoint', 'warning', 'Pinpoints to a medium neutral citation are paragraph numbers in square brackets.', 'r 2.3.1', { from: m.from + 2, to: m.to, insert: `[${m.text.slice(2)}]` }, m.from + 2, m.to)]
				: []),
		},
		judges,
		notes,
		shortTitle(),
	],
};

const CASE_REPORTED: SourceSpec = {
	kind: 'case-reported',
	label: 'Case (reported)',
	ref: 'r 2.2',
	claimAfter: 'year',
	example: '*Mabo v Queensland [No 2]* (1992) 175 CLR 1, 30',
	start: '*${Party v Party}* (${Year}) ${Volume} ${CLR} ${1}',
	elements: [
		caseName,
		yearBracket,
		{
			id: 'volume',
			label: 'Volume',
			hint: 'Volume number (omit for year-organised series without volumes)',
			insert: ' ${Volume}',
			re: S('\\s\\d+(?=\\s[A-Z]|$)'),
			optional: true,
		},
		{
			id: 'series',
			label: 'Law report series',
			hint: 'Abbreviation of the report series, eg CLR, ALR, NSWLR, VR (AGLC4 r 2.2.2)',
			insert: ' ${CLR}',
			re: S('\\s[A-Z][A-Za-z\'’]*\\.?(?:\\s(?:\\([A-Z][A-Za-z]*\\)|[A-Z][A-Za-z\'’]*\\.?|\\d[a-z]{1,2}))*?(?=\\s\\d|\\s¶|$)'),
			reject: (m) => MNC_COURTS.has(m[0].trim()),
			check: (m, ctx) => {
				const out: Issue[] = [];
				const series = m.text.trim();
				const year = ctx.matched.year;
				if (year) {
					const round = year.text.includes('(');
					const y = year.text.trim().slice(1, -1);
					const yFrom = bodyStart(year);
					if (round && YEAR_SERIES.has(series)) {
						out.push(issue(m, 'year-brackets', 'error', `${series} is organised by year: put the year in square brackets.`, 'r 2.2.1', { from: yFrom, to: year.to, insert: `[${y}]` }, yFrom, year.to));
					} else if (!round && VOLUME_SERIES.has(series)) {
						out.push(issue(m, 'year-brackets', 'error', `${series} is organised by volume: put the year in round brackets.`, 'r 2.2.1', { from: yFrom, to: year.to, insert: `(${y})` }, yFrom, year.to));
					}

				}
				if (/\./.test(series)) {
					out.push(issue(m, 'series-full-stops', 'warning', 'Report series abbreviations take no full stops.', 'Part I', { from: bodyStart(m), to: m.to, insert: series.replace(/\./g, '') }, bodyStart(m), m.to));
				}
				return out;
			},
		},
		{
			...pageStart,
			hint: 'First page, or the report\'s unique reference (eg ¶93-198)',
			re: S('\\s(?:\\d+|¶\\d+-\\d+)'),
			check: (m, ctx) => {
				// A series arranged by volume needs a volume, except one cited by unique reference (r 2.2.1, 2.2.4).
				const year = ctx.matched.year;
				if (!year || !year.text.includes('(') || ctx.matched.volume || m.text.includes('¶')) return [];
				return [issue(m, 'volume-missing', 'error', 'A year in round brackets must be followed by a volume number.', 'r 2.2.1', undefined, bodyStart(year), ctx.matched.series?.to ?? m.to)];
			},
		},
		pinpoints,
		judges,
		notes,
		shortTitle(),
	],
};

const CASE_UNREPORTED: SourceSpec = {
	kind: 'case-unreported',
	label: 'Case (unreported, no medium neutral citation)',
	ref: 'r 2.3',
	claimAfter: 'court',
	example: '*R v Smith* (Supreme Court of Victoria, Smith J, 12 March 1990)',
	start: '*${Party v Party}* (${Court}, ${Judge J}, ${1 January 2000})',
	elements: [
		caseName,
		{
			id: 'court',
			label: 'Court',
			hint: 'Full name of the court, eg (Supreme Court of Victoria',
			insert: ' (${Court}',
			re: S('\\s\\((?!\\d)[A-Z][^,()\\n]*(?=,)'),
		},
		{
			id: 'judge',
			label: 'Judicial officer',
			hint: 'eg Smith J; for a proceeding with no judgment, the proceeding number (eg VID725/2014)',
			insert: ', ${Name J}',
			// Judges may include commas ("Charles, Callaway JJA and Vincent AJA"); a proceeding has a number (r 2.3.3).
			re: S(`,\\s(?:[^()\\n]*?\\b(?:${JUDGE_TITLES}|${JUDGE_PREFIX}\\s[A-Z][a-z]+)|[A-Z]{1,5}\\d+\\/\\d{4})(?=,\\s(?:commenced\\s)?\\d)`),
		},
		{
			id: 'date',
			label: 'Date of judgment',
			hint: 'Day Month Year',
			insert: ', ${1 January 2000}',
			re: S(`,\\s(?:commenced\\s)?${DATE}`),
		},
		{
			id: 'close',
			label: 'Closing bracket',
			hint: ')',
			insert: ')',
			re: S('\\)'),
		},
		{ ...pinpoints, re: S(`\\s${PIN}`), insert: ' ${pinpoint}', hint: 'Page or [paragraph] after a space' },
	],
};

const HANSARD: SourceSpec = {
	kind: 'hansard',
	label: 'Parliamentary debates (Hansard)',
	ref: 'ch 7',
	claimAfter: 'title',
	example: 'Commonwealth, *Parliamentary Debates*, House of Representatives, 4 June 2020, 4250 (Scott Morrison)',
	start: '${Commonwealth}, *Parliamentary Debates*, ${Senate}, ${1 January 2000}, ${1}',
	elements: [
		{
			id: 'jurisdiction',
			label: 'Jurisdiction',
			hint: 'Commonwealth, New South Wales, Victoria …',
			insert: '${Commonwealth}',
			re: S('(?:Commonwealth|New South Wales|Victoria|Queensland|Western Australia|South Australia|Tasmania|Australian Capital Territory|Northern Territory)(?=,)'),
		},
		{
			id: 'title',
			label: 'Parliamentary Debates',
			hint: '*Parliamentary Debates* in italics',
			insert: ', *Parliamentary Debates*',
			re: S(',\\s(?:\\*Parliamentary Debates\\*|_Parliamentary Debates_|Parliamentary Debates)'),
			check: (m) => (isItalic(m.text.slice(2))
				? []
				: [issue(m, 'hansard-italics', 'error', '"Parliamentary Debates" is italicised.', 'ch 7', { from: m.from + 2, to: m.to, insert: '*Parliamentary Debates*' }, m.from + 2, m.to)]),
		},
		{
			id: 'chamber',
			label: 'Chamber',
			hint: 'Senate, House of Representatives, Legislative Assembly …',
			insert: ', ${Senate}',
			re: S(',\\s(?:House of Representatives|Senate|Legislative Assembly|Legislative Council|House of Assembly)'),
		},
		{ id: 'date', label: 'Date', hint: 'Day Month Year', insert: ', ${1 January 2000}', re: S(`,\\s${DATE}`) },
		{ id: 'page', label: 'Page', hint: 'Page number of the Hansard', insert: ', ${1}', re: S(',\\s\\d+(?:[–-]\\d+)?') },
		{
			id: 'speaker',
			label: 'Speaker',
			hint: 'First and last name of the speaker, and position if relevant (AGLC4 r 7.5.1)',
			insert: ' (${Speaker Name})',
			re: S('\\s\\([^()\\n]+\\)'),
			optional: true,
			check: (m) => {
				const re = /\s?\b(?:Senator|the Hon|The Hon|Hon|MP|MLC|MLA|MHR|QC|SC|KC)\b/g;
				const found = m.text.match(re);
				if (!found) return [];
				const cleaned = m.text.replace(re, '').replace(/\(\s+/, '(');
				const words = found.map((f) => f.trim()).join('", "');
				return [issue(m, 'hansard-speaker', 'warning', `Leave out "${words}": give the speaker's first and last names only.`, 'r 7.5.1', { from: m.from, to: m.to, insert: cleaned }, m.from + 1, m.to)];
			},
		},
	],
};

const TREATY: SourceSpec = {
	kind: 'treaty',
	label: 'Treaty',
	ref: 'ch 8',
	claimAfter: 'series',
	example: '*Convention on the Rights of the Child*, opened for signature 20 November 1989, 1577 UNTS 3 (entered into force 2 September 1990) art 3',
	start: '*${Treaty Title}*, opened for signature ${1 January 2000}, ${1} UNTS ${1} (entered into force ${1 January 2000})',
	elements: [
		{ id: 'title', label: 'Treaty title', hint: 'Title in italics', insert: '*${Treaty Title}*', re: S(ITALIC) },
		{
			id: 'opened',
			label: 'Opened for signature',
			hint: 'opened for signature / signed Day Month Year',
			insert: ', opened for signature ${1 January 2000}',
			re: S(`,\\s(?:opened for signature|signed|adopted|concluded|done)\\s${DATE}`),
			// Omitted when signed and entered into force on the same day (r 8.3.2).
			optional: true,
		},
		{
			id: 'series',
			label: 'Treaty series',
			hint: 'Volume, series and page, eg 1577 UNTS 3 or [1991] ATS 4',
			insert: ', ${1} UNTS ${1}',
			// "1577 UNTS 3", "[2010] ATS 5", "CETS No 207" (r 8.4)
			re: S(',\\s(?:(?:\\[\\d{4}\\]\\s|\\d+\\s)[A-Z][A-Za-z .]*?\\s\\d+|[A-Z]{2,}\\sNo\\s\\d+)'),
		},
		{
			id: 'force',
			label: 'Entry into force',
			hint: '(entered into force Day Month Year) or (not yet in force)',
			insert: ' (entered into force ${1 January 2000})',
			re: S(`\\s\\((?:entered into force\\s${DATE}|signed and entered into force\\s${DATE}|not yet in force)[^()\\n]*\\)`),
		},
		{
			id: 'pinpoint',
			label: 'Pinpoint',
			hint: 'Article, eg art 3',
			insert: ' art ${1}',
			// "art 3", "arts 2, 26", "art III s 9" (r 8.7)
			re: S(`\\s${LEG_PIN}`),
			optional: true,
		},
		shortTitle(),
	],
};

/** Abbreviated words in a journal title: "L", "J", "Rev", "Univ" … ("Australian L J", "Melb U L Rev"). */
const JOURNAL_ABBREVIATION = /(?:^|\s)(?:[A-Z]{1,2}|Rev|Jnl|Jrnl|Univ|Aust|Austl|Int'?l|Comp|Crim|Const|Envtl?|Fam|Hum|Admin|Prop|Tech|Qtly|Bull|Ann|Soc|Pol|Stud)\.?(?=\s|$)/;

/**
 * AGLC4 journal titles: the full title in italics, without a leading "The", with "and" rather than "&",
 * not abbreviated, and without a subtitle unless it is needed to identify the journal.
 */
function journalChecks(m: ElementMatch, ctx: CheckContext): Issue[] {
	const out: Issue[] = [];
	const at = bodyStart(m);
	const raw = m.text.slice(at - m.from);
	const italic = isItalic(raw);
	const from = italic ? at + 1 : at;
	const to = italic ? m.to - 1 : m.to;
	const name = ctx.text.slice(from, to);
	if (!italic) {
		out.push(issue(m, 'journal-italics', 'error', 'Journal titles are italicised.', 'r 5.5', { from: at, to: m.to, insert: `*${raw}*` }, at, m.to));
	}
	if (!/[a-z]/.test(name) || JOURNAL_ABBREVIATION.test(name)) {
		out.push(issue(m, 'journal-abbreviation', 'warning', 'Give the journal\'s full title, not an abbreviation.', 'r 5.5', undefined, from, to));
		return out;
	}
	if (/^The\s/.test(name)) {
		out.push(issue(m, 'journal-the', 'error', 'Leave out "The" at the start of a journal title.', 'r 5.5', { from, to: from + 4, insert: '' }, from, from + 3));
	}
	const amp = name.indexOf('&');
	if (amp >= 0) {
		out.push(issue(m, 'journal-ampersand', 'warning', 'Write "and", not "&", in a journal title.', 'r 5.5', { from: from + amp, to: from + amp + 1, insert: 'and' }, from + amp, from + amp + 1));
	}
	const colon = name.indexOf(':');
	if (colon > 0) {
		out.push(issue(m, 'journal-subtitle', 'info', 'Omit the journal\'s subtitle, unless it is needed to identify the journal.', 'r 5.5', { from: from + colon, to, insert: '' }, from + colon, to));
	}
	if (out.length === 0) out.push(...titleCaseIssue(m, from, to, ctx));
	return out;
}

const JOURNAL: SourceSpec = {
	kind: 'journal',
	label: 'Journal article',
	ref: 'ch 5',
	claimAfter: 'year',
	example: 'Jane Smith, \'The Title of the Article\' (2004) 28(1) *Melbourne University Law Review* 1, 12',
	start: '${Author}, \'${Title}\' (${Year}) ${Volume}(${Issue}) *${Journal Title}* ${1}',
	elements: [
		author(),
		quotedTitle('title', 'Article title', '\\s[[(]\\d'),
		{
			...yearBracket,
			hint: '(Year) if the journal has volume numbers, [Year] otherwise (AGLC4 r 5.3)',
			// A volume spanning years is given as a span: "[1992–93]".
			re: S('\\s(?:\\(\\d{4}\\)|\\[\\d{4}(?:–\\d{2,4})?\\])'),
		},
		{
			id: 'volume',
			label: 'Volume (issue)',
			hint: 'Volume and issue, eg 28(1); issue only for year-organised journals, eg [2000] (1) (AGLC4 r 5.4)',
			insert: ' ${Volume}(${Issue})',
			// "28(1)", "66(1–2)", "133 (January)", "31 (Winter)", or an issue alone: "(1)", "(Winter)".
			re: S(`\\s(?:\\d+(?:\\(\\d+(?:[–-]\\d+)?\\))?(?:\\s\\((?:${MONTH}|Spring|Summer|Autumn|Winter|Fall)\\))?|\\((?:\\d+(?:[–-]\\d+)?|${MONTH}|Spring|Summer|Autumn|Winter|Fall)\\))(?=\\s|$)`),
			optional: true,
			check: (m, ctx) => (/^\s\d+$/.test(m.text) && ctx.matched.year?.text.includes('(')
				? [issue(m, 'journal-issue', 'info', 'Include the issue number after the volume, eg "40(1)", if the journal has issues.', 'r 5.4')]
				: []),
		},
		{
			id: 'journal',
			label: 'Journal',
			hint: 'Full title of the journal, in italics, without a leading "The" (AGLC4 ch 5)',
			insert: ' *${Journal Title}*',
			re: S('\\s(?:\\*[^*\\n]+\\*|_[^_\\n]+_|[A-Z][A-Za-z&\'’ .:()-]*?)(?=\\s\\d|\\s\\((?:forthcoming|advance)\\)|$)'),
			check: (m, ctx) => journalChecks(m, ctx),
		},
		{
			...pageStart,
			hint: 'First page of the article; (forthcoming) or (advance); for online journals the article number and page range, eg 416:1–19',
			re: S('\\s(?:\\d+:\\d+(?:–\\d+)?|\\d+|\\(forthcoming\\)|\\(advance\\))'),
		},
		pinpoints,
		shortTitle(),
	],
};

const CHAPTER: SourceSpec = {
	kind: 'chapter',
	label: 'Chapter in an edited book',
	ref: 'ch 6',
	claimAfter: 'editors',
	example: 'Jane Smith, \'Chapter Title\' in Ali Khan (ed), *Book Title* (Federation Press, 2nd ed, 2015) 10, 15',
	start: '${Author}, \'${Chapter Title}\' in ${Editor} (ed), *${Book Title}* (${Publisher}, ${Year}) ${1}',
	elements: [
		author(),
		quotedTitle('title', 'Chapter title', '\\sin\\s'),
		{
			id: 'editors',
			label: 'Editor(s)',
			hint: 'in Name (ed) / in Name and Name (eds)',
			insert: ' in ${Editor Name} (ed)',
			re: S('\\sin\\s[^,()\\n]+?\\s\\((?:[Ee]ds?\\.?)\\)'),
			check: (m) => {
				const br = /\(([Ee]ds?\.?)\)$/.exec(m.text);
				if (br && /[E.]/.test(br[1]!)) {
					const fixed = br[1]!.replace('.', '').toLowerCase();
					const at = m.to - br[1]!.length - 1;
					return [issue(m, 'editor-abbrev', 'error', `Write "(${fixed})": lower case, no full stop.`, 'ch 6', { from: at, to: m.to - 1, insert: fixed }, at, m.to - 1)];
				}
				return [];
			},
		},
		italicTitle('book', 'Book title', 'Title of the edited book, in italics'),
		{
			id: 'publication',
			label: 'Publication details',
			hint: '(Publisher, edition, Year)',
			insert: ' (${Publisher}, ${Year})',
			re: S('\\s\\((?:[^()\\n]|\\([^()\\n]*\\))*?\\d{4}\\)'),
			check: (m) => publicationChecks(m),
		},
		pageStart,
		pinpoints,
		shortTitle(),
	],
};

/** Theses and dissertations take their title in single quotation marks, not italics (r 7.2.5). */
function thesisCheck(m: ElementMatch, ctx: CheckContext): Issue[] {
	const title = ctx.matched.title;
	if (!title || !/\b(?:Thesis|Dissertation)\b/.test(m.text)) return [];
	const at = bodyStart(title);
	const text = ctx.text.slice(at, title.to);
	return [issue(m, 'thesis-title', 'error', 'The title of a thesis goes in single quotation marks, not italics.', 'r 7.2.5', { from: at, to: title.to, insert: `'${stripItalic(text)}'` }, at, title.to)];
}

function publicationChecks(m: ElementMatch): Issue[] {
	const out: Issue[] = [];
	// Publisher (r 6.3.1): no leading "The", no corporate status ("Lawbook", not "Lawbook Co").
	const publisher = /^\s\(([^,()]+),/.exec(m.text);
	if (publisher && !/\b(?:Report|Paper|Thesis|Dissertation|Inquiry|Submission|No)\b/.test(publisher[1]!)) {
		const at = m.from + 2;
		if (/^The\s/.test(publisher[1]!)) {
			out.push(issue(m, 'publisher-the', 'warning', 'Leave out "The" at the start of a publisher\'s name.', 'r 6.3.1', { from: at, to: at + 4, insert: '' }, at, at + 3));
		}
		const corp = /\s(?:Pty|Ltd|Co|Inc|Limited|Company|Pty Ltd)$/.exec(publisher[1]!);
		if (corp) {
			const cAt = at + corp.index;
			out.push(issue(m, 'publisher-corporate', 'warning', 'Leave out corporate status in a publisher\'s name ("Lawbook", not "Lawbook Co").', 'r 6.3.1', { from: cAt, to: cAt + corp[0].length, insert: '' }, cAt + 1, cAt + corp[0].length));
		}
	}
	const ed = /\b(\d+(?:st|nd|rd|th))\s(edition|[Ee]dn?\.?|Ed\.?)(?=[,)])/.exec(m.text);
	if (ed && ed[2] !== 'ed') {
		const at = m.from + ed.index + ed[1]!.length + 1;
		out.push(issue(m, 'edition', 'error', 'Write the edition as "2nd ed".', 'ch 6', { from: at, to: at + ed[2]!.length, insert: 'ed' }, at, at + ed[2]!.length));
	}
	if (/[^,]\s\d{4}\)$/.test(m.text) && !/\(\d{4}\)$/.test(m.text.trim()) && !/\d{1,2}\s\w+\s\d{4}\)$/.test(m.text) && !/\b[A-Z][a-z]+\s\d{4}\)$/.test(m.text)) {
		out.push(issue(m, 'publication-comma', 'warning', 'Separate the publisher and year with a comma.', 'ch 6', undefined));
	}
	return out;
}

/** A URL in angle brackets, for material accessed online (AGLC4 ch 7). */
const urlElement = (optional: boolean): ElementSpec => ({
	id: 'url',
	label: 'URL',
	hint: 'In angle brackets: <https://…>',
	insert: ' <${https://}>',
	re: S('\\s(?:<[^>\\s]+>|https?:\\/\\/[^\\s;]+?)(?=[.;]?$|;|\\s\\()'),
	optional,
	check: (m) => (m.text.trim().startsWith('<')
		? []
		: [issue(m, 'url-brackets', 'error', 'URLs go in angle brackets.', 'ch 7', { from: bodyStart(m), to: m.to, insert: `<${m.text.trim()}>` }, bodyStart(m), m.to)]),
});

const BOOK: SourceSpec = {
	kind: 'book',
	label: 'Book or report',
	ref: 'ch 6 / ch 7',
	claimAfter: 'publication',
	example: 'Jane Smith, *Principles of Australian Law* (Federation Press, 3rd ed, 2018) 45',
	start: '${Author}, *${Title}* (${Publisher}, ${Year})',
	elements: [
		// A report may have no author (r 4.1.4, 7.1.1): "*Review of the Law of Negligence* (Final Report, September 2002)".
		author(true),
		{ ...italicTitle('title', 'Title', 'Title in italics (AGLC4 r 6.2)'), insert: '*${Title}*', re: S(`(?:^|,\\s)${ITALIC}`) },
		{
			id: 'publication',
			label: 'Publication details',
			hint: 'Book: (Publisher, edition, Year). Report: (Report No 1, Month Year)',
			insert: ' (${Publisher}, ${Year})',
			re: S('\\s\\((?:[^()\\n]|\\([^()\\n]*\\))*?\\d{4}\\)'),
			// Without an author, "(1992)" after an italic title is a case, not a book.
			reject: (m, ctx) => !ctx.matched.author && !/[A-Za-z]/.test(m[0]),
			check: (m, ctx) => [...publicationChecks(m), ...thesisCheck(m, ctx)],
		},
		{
			...pinpoints,
			id: 'pinpoint',
			repeat: false,
			insert: ' ${pinpoint}',
			re: S(`\\s${BOOK_PIN}`),
			hint: 'Page (" 45") or paragraph (" [4.12]") after a space',
		},
		{
			...pinpoints,
			id: 'pinpoint-more',
			insert: ', ${pinpoint}',
			re: S(`,\\s${BOOK_PIN}`),
			label: 'Further pinpoint',
			hint: 'Another page or paragraph',
			// The first pinpoint follows the publication details without a comma (r 6.4).
			check: (m, ctx) => (ctx.matched.pinpoint || /^,\s(?:vol|bk)\b/.test(m.text)
				? []
				: [issue(m, 'book-pinpoint-comma', 'error', 'A pinpoint follows the publication details without a comma.', 'r 6.4', { from: m.from, to: m.from + 1, insert: '' }, m.from, m.from + 1)]),
		},
		urlElement(true),
		shortTitle(),
	],
};

const NEWSPAPER: SourceSpec = {
	kind: 'newspaper',
	label: 'Newspaper article',
	ref: 'ch 7',
	claimAfter: 'paper',
	example: 'Jane Smith, \'Headline of Article\', *The Age* (Melbourne, 5 May 2020) 3',
	start: '${Author}, \'${Headline}\', *${Newspaper}* (${Place}, ${1 January 2000}) ${1}',
	elements: [
		author(true),
		quotedTitle('title', 'Headline', ',\\s', true),
		{
			id: 'section',
			label: 'Section',
			hint: 'Named section, if the newspaper is not consecutively paginated (AGLC4 r 7.11.1)',
			insert: ', ${Section}',
			re: S('(?:^|,\\s)[A-Z][\\w ]*?(?=,\\s[*_])'),
			optional: true,
		},
		{ ...italicTitle('paper', 'Newspaper', 'Name of the newspaper, in italics, including "The" from the masthead'), check: undefined },
		{
			id: 'details',
			label: 'Place and date',
			hint: '(Place, Day Month Year), or (online, Day Month Year)',
			insert: ' (${Place}, ${1 January 2000})',
			re: S(`\\s\\((?:[^(),\\n]+,\\s)?${DATE}\\)`),
		},
		{ id: 'page', label: 'Page', hint: 'Page number (print editions)', insert: ' ${1}', re: S('\\s\\d+'), optional: true },
		{ ...urlElement(true), hint: 'For online articles: <https://…>' },
		shortTitle(),
	],
};

const INTERNET: SourceSpec = {
	kind: 'internet',
	label: 'Internet material',
	ref: 'ch 7',
	claimAfter: 'details',
	example: 'Jane Smith, \'Title of Page\' (Web Page, 1 May 2020) <https://example.org/page>',
	start: '${Author}, \'${Title}\' (${Web Page}, ${1 January 2000}) <${https://}>',
	elements: [
		author(true),
		quotedTitle('title', 'Document title', '\\s\\(|,\\s', true),
		{
			id: 'site',
			label: 'Website',
			hint: 'Title of the website, in italics, if it differs from the author: , *Website Title*',
			insert: ', *${Website Title}*',
			re: S(`,\\s(?:${ITALIC}|[A-Z][^,()<>\\n]*?)(?=\\s\\()`),
			optional: true,
			check: (m) => (isItalic(m.text.slice(2))
				? []
				: [issue(m, 'site-italics', 'warning', 'The title of a website is italicised, like a book title.', 'r 7.15', { from: m.from + 2, to: m.to, insert: `*${m.text.slice(2)}*` }, m.from + 2, m.to)]),
		},
		{
			id: 'details',
			label: 'Document type and date',
			hint: '(Web Page, Day Month Year), (Blog Post, Day Month Year) …',
			insert: ' (${Web Page}, ${1 January 2000})',
			re: S('\\s\\([A-Z][^()\\n]*\\)'),
			// Other kinds of document (speeches, papers, releases) are cited the same way but need no URL.
			reject: (m) => !WEB_TYPES.test(m[0]),
		},
		{
			id: 'pinpoint',
			label: 'Pinpoint',
			hint: 'Page or paragraph, if the material has them',
			insert: ' ${pinpoint}',
			re: S(`\\s${PIN}(?=\\s<)`),
			optional: true,
		},
		urlElement(false),
		shortTitle(),
	],
};

/** Document types that are web material, which must be cited with a URL. */
const WEB_TYPES = /^\s\((?:Web Page|Webpage|Blog Post|Blog|Online|Website|Podcast|Video|YouTube|Facebook|Twitter|X|Instagram|LinkedIn|Online Forum)\b/i;

const PAPER: SourceSpec = {
	kind: 'paper',
	label: 'Speech, paper or release',
	ref: 'ch 7',
	claimAfter: 'details',
	example: 'Jane Smith, \'Title of Speech\' (Speech, Law Council Conference, 1 May 2020) 4',
	start: '${Author}, \'${Title}\' (${Speech}, ${Event}, ${1 January 2000})',
	elements: [
		author(true),
		quotedTitle('title', 'Title', '\\s\\(', true),
		{
			id: 'details',
			label: 'Document type and date',
			hint: '(Speech, Event, Day Month Year), (Conference Paper, …), (Media Release, …), (Working Paper No 1, …)',
			insert: ' (${Speech}, ${Event}, ${1 January 2000})',
			// "(Speech, Inner Temple, 23 January 2012)", or for an undated-type document a date alone: "(4 March 2015)".
			re: S(`\\s\\((?:[A-Z][^()\\n]*\\d{4}|${DATE}|\\d{4})\\)`),
			reject: (m) => WEB_TYPES.test(m[0]),
			check: (m) => {
				// Conferences and named lectures are given without ordinal numbers (r 7.2.4, 7.3).
				const ord = /\b\d+(?:st|nd|rd|th)\s(?=[A-Z])/.exec(m.text);
				if (!ord) return [];
				const at = m.from + ord.index;
				return [issue(m, 'conference-ordinal', 'warning', 'Leave out the ordinal number of a conference or lecture.', 'r 7.2.4', { from: at, to: at + ord[0].length, insert: '' }, at, at + ord[0].length - 1)];
			},
		},
		{ ...pinpoints, repeat: false, insert: ' ${pinpoint}', re: S(`\\s${PIN}`), hint: 'Page or paragraph after a space' },
		urlElement(true),
		shortTitle(),
	],
};

const EXPLANATORY: SourceSpec = {
	kind: 'explanatory',
	label: 'Explanatory memorandum',
	ref: 'ch 3',
	claimAfter: 'bill',
	example: 'Explanatory Memorandum, Online Safety Bill 2021 (Cth) 12 [45]',
	start: 'Explanatory Memorandum, ${Bill Title Year} (${Cth})',
	elements: [
		{
			id: 'type',
			label: 'Document',
			hint: 'Explanatory Memorandum, Revised Explanatory Memorandum, Explanatory Statement …',
			insert: 'Explanatory Memorandum',
			re: S('(?:(?:Revised|Supplementary|Replacement|Correction to the)\\s)?Explanatory\\s(?:Memorandum|Statement|Notes)'),
		},
		{
			id: 'bill',
			label: 'Bill',
			hint: 'Title and year of the Bill, not italicised',
			insert: ', ${Bill Title Year}',
			re: S(`,\\s(?:${ITALIC}|[A-Z][^,;()*_\\n]*?\\s\\d{4})`),
			check: (m) => {
				const at = bodyStart(m);
				const bill = m.text.slice(at - m.from);
				return isItalic(bill)
					? [issue(m, 'explanatory-italics', 'warning', 'In a citation of explanatory material the Bill\'s title is not italicised.', 'ch 3', { from: at, to: m.to, insert: stripItalic(bill) }, at, m.to)]
					: [];
			},
		},
		{ id: 'jurisdiction', label: 'Jurisdiction', hint: '(Cth), (NSW) …', insert: ' (${Cth})', re: S(`\\s\\(${JUR}\\)`) },
		{
			id: 'pinpoint',
			label: 'Pinpoint',
			hint: 'Page, paragraph, or both: "12", "[45]", "12 [45]"; several separated by commas',
			insert: ' ${1}',
			re: S(`\\s(?:${PIN_PARA}|${PIN_PAGE})(?:,\\s(?:${PIN_PARA}|${PIN_PAGE}))*`),
			optional: true,
		},
		shortTitle(),
	],
};

const IBID: SourceSpec = {
	kind: 'ibid',
	label: 'Ibid',
	ref: 'r 1.4.3',
	claimAfter: 'ibid',
	example: 'Ibid 45',
	start: 'Ibid',
	elements: [
		{
			id: 'ibid',
			label: 'Ibid',
			hint: '"Ibid" (capitalised unless it follows a signal)',
			insert: 'Ibid',
			// Italicised ("*Ibid*") is matched so it can be flagged: it is set in roman (r 1.8.3).
			re: S('[*_][Ii]bid\\.?[*_]|[Ii]bid\\.?'),
			check: (m, ctx) => {
				const out: Issue[] = [];
				if (/^[*_]/.test(m.text)) {
					// One fix for everything, so it cannot overlap a fix to the case or the full stop.
					let word = m.text.slice(1, -1);
					word = (ctx.hasSignal ? 'ibid' : 'Ibid') + word.slice(4);
					if (word.endsWith('.') && m.to < ctx.text.length) word = word.slice(0, -1);
					out.push(issue(m, 'ibid-italics', 'error', '"Ibid" is not italicised.', 'r 1.4.3, 1.8.3', { from: m.from, to: m.to, insert: word }));
					return out;
				}
				const word = m.text.slice(0, 4);
				if (ctx.hasSignal && word === 'Ibid') {
					out.push(issue(m, 'ibid-case', 'error', '"ibid" is lower case after an introductory signal.', 'r 1.4.3', { from: m.from, to: m.from + 4, insert: 'ibid' }));
				} else if (!ctx.hasSignal && word === 'ibid') {
					out.push(issue(m, 'ibid-case', 'error', '"Ibid" is capitalised at the start of a footnote.', 'r 1.4.3', { from: m.from, to: m.from + 4, insert: 'Ibid' }));
				}
				if (m.text.endsWith('.') && m.to < ctx.text.length) {
					out.push(issue(m, 'ibid-stop', 'error', '"Ibid" takes no full stop.', 'r 1.4.3', { from: m.to - 1, to: m.to, insert: '' }, m.to - 1, m.to));
				}
				return out;
			},
		},
		{
			id: 'pinpoint',
			label: 'Pinpoint',
			hint: 'New pinpoint after a space, eg "Ibid 45", "Ibid [12]", "Ibid s 5", "Ibid 222, 239"',
			insert: ' ${pinpoint}',
			re: S(`,?\\s(?:${LEG_PIN}|${PIN}(?:,\\s${PIN})*)`),
			optional: true,
			check: (m) => (m.text.startsWith(',')
				? [issue(m, 'ibid-comma', 'error', 'No comma between "Ibid" and the pinpoint.', 'r 1.4.3', { from: m.from, to: m.from + 1, insert: '' }, m.from, m.from + 1)]
				: []),
		},
		judges,
	],
};

const SUBSEQUENT: SourceSpec = {
	kind: 'subsequent',
	label: 'Subsequent reference',
	ref: 'r 1.4.1',
	claimAfter: 'n',
	example: '*Mabo* (n 3) 30',
	start: '${Short Title or Author Surname} (n ${1})',
	elements: [
		{
			id: 'short',
			label: 'Short title or author',
			hint: 'Case short title in italics, or author surname (and short title, for an author of several works)',
			insert: '${Short title}',
			// "*Mabo*", "Smith", or for an author of several works "Smith, *Principles*" / "Smith, 'Title'".
			re: new RegExp(`(?:\\*[^*\\n]+\\*|_[^_\\n]+_|${NAME}(?:\\s\\((?:ed|eds)\\))?(?:,\\s(?:\\*[^*\\n]+\\*|_[^_\\n]+_|['‘][^'’\\n]+['’]))?)(?=\\s\\((?:n|fn|note|supra n)\\.?\\s?\\d|\\s?$)`, 'yu'),
		},
		{
			id: 'n',
			label: 'Footnote cross-reference',
			hint: '(n X), where X is the footnote with the full citation',
			insert: ' (n ${1})',
			re: S('\\s\\((?:n|fn|note|supra n)\\.?\\s?\\d+\\)'),
			check: (m) => (/^\s\(n\s\d/.test(m.text)
				? []
				: [issue(m, 'n-format', 'error', 'Cross-references are written "(n X)".', 'r 1.4.1', { from: m.from + 1, to: m.to, insert: `(n ${/\d+/.exec(m.text)![0]})` }, m.from + 1, m.to)]),
		},
		{
			id: 'pinpoint',
			label: 'Pinpoint',
			hint: 'After a space, no comma: "(n 3) 30" or "(n 3) [12]"',
			insert: ' ${pinpoint}',
			re: S(`,?\\s(?:${LEG_PIN}|${PIN})(?:,\\s${PIN})*`),
			optional: true,
			check: (m) => (m.text.startsWith(',')
				? [issue(m, 'n-comma', 'error', 'No comma between "(n X)" and the pinpoint.', 'r 1.4.1', { from: m.from, to: m.from + 1, insert: '' }, m.from, m.from + 1)]
				: []),
		},
		judges,
	],
};

export const SPECS: SourceSpec[] = [
	IBID,
	HANSARD,
	EXPLANATORY,
	LEGISLATION,
	CASE_MNC,
	CASE_REPORTED,
	CASE_UNREPORTED,
	TREATY,
	JOURNAL,
	CHAPTER,
	NEWSPAPER,
	INTERNET,
	PAPER,
	BOOK,
	SUBSEQUENT,
	LEGISLATION_SHORT,
];

// ---------------------------------------------------------------------------------------------------------
// Matching

export interface MatchResult {
	spec: SourceSpec;
	elements: ElementMatch[];
	/** Characters consumed. */
	pos: number;
	/** Index into spec.elements of the first element that did not match (elements.length if all were tried). */
	next: number;
	/** True when every required element matched. */
	complete: boolean;
	/** True when the claimAfter element matched. */
	claimed: boolean;
	issues: Issue[];
}

export function matchSpec(spec: SourceSpec, text: string, hasSignal: boolean): MatchResult {
	const ctx: CheckContext = { text, matched: {}, hasSignal };
	const elements: ElementMatch[] = [];
	const issues: Issue[] = [];
	let pos = 0;
	let next = spec.elements.length;
	let complete = true;
	for (let i = 0; i < spec.elements.length; i++) {
		const el = spec.elements[i]!;
		let count = 0;
		for (;;) {
			if (pos >= text.length) break;
			el.re.lastIndex = pos;
			const m = el.re.exec(text);
			if (!m || m[0].length === 0 || (el.reject && el.reject(m, ctx))) break;
			const match: ElementMatch = { id: el.id, from: pos, to: pos + m[0].length, text: m[0], groups: m };
			elements.push(match);
			ctx.matched[el.id] = match;
			if (el.check) issues.push(...el.check(match, ctx));
			pos = match.to;
			count++;
			if (!el.repeat) break;
		}
		if (count === 0 && !el.optional) {
			next = i;
			complete = false;
			break;
		}
	}
	if (complete) {
		// Everything required matched; the first optional element still unmatched is "next".
		next = spec.elements.length;
		for (let i = spec.elements.length - 1; i >= 0; i--) {
			const el = spec.elements[i]!;
			if (ctx.matched[el.id] && !el.repeat) break;
			next = i;
		}
	}
	return { spec, elements, pos, next, complete, claimed: !!ctx.matched[spec.claimAfter], issues };
}
