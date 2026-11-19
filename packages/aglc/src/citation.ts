/**
 * Analysis of a single footnote: split into citations, identify each citation's kind, report grammar
 * issues and work out what element should come next.
 */
import { SIGNALS, escapeRe } from './data';
import { type ElementSpec, type MatchResult, type SourceKind, type SourceSpec, SPECS, matchSpec } from './grammar';
import { type Issue, shiftIssue } from './types';

export interface Segment {
	/** Offsets of the citation within the footnote text, excluding the separating "; " and closing stop. */
	from: number;
	to: number;
	text: string;
	signal: string | null;
	/** Offset (within the footnote) where the citation proper starts, after any signal. */
	bodyFrom: number;
	body: string;
	/** What separated this citation from the one before: a semicolon, a full stop (a new sentence), or nothing. */
	sep: ';' | '.' | null;
	/** False for the last citation of a footnote that has not been closed with a full stop yet. */
	finished: boolean;
}

export interface CitationAnalysis {
	segment: Segment;
	/** Best match, or null when the segment reads as prose rather than a citation. */
	best: MatchResult | null;
	kind: SourceKind | null;
	issues: Issue[];
}

const SIGNAL_RE = new RegExp(`^(?:${SIGNALS.map(escapeRe).join('|')})\\s`, 'i');
/** Signals written in a non-AGLC way, mapped to the correct form. */
const SIGNAL_FIXES: [RegExp, string][] = [
	[/^See,?\s(?:e\.g\.|eg\.?|for example),?\s/i, 'See, eg, '],
	[/^(?:E\.g\.|e\.g\.),?\s/, 'Eg, '],
	[/^Cf\.\s/i, 'Cf '],
	[/^Compare\swith\s/i, 'Compare '],
];
const COMMENTARY_RE = /^(?:,\s(?=[a-z])|\s[—–]\s|:\s|\s\((?:emphasis|citations?|footnotes?|alterations?)\s[a-z ]+\))/;

/**
 * Split footnote text into citations separated by top-level semicolons. Semicolons inside brackets,
 * quotation marks, italics or URLs do not split.
 */
export function splitSegments(text: string): Segment[] {
	const trimmedEnd = text.replace(/\s+$/, '');
	// A footnote ending in a quotation that ends with a full stop ("… the law.'") counts as closed.
	const closing = /[.?!](?:['’"”])?$/.exec(trimmedEnd);
	const closed = closing !== null;
	const body = closed && closing[0].length === 1 ? trimmedEnd.slice(0, -1) : trimmedEnd;
	const parts: { from: number; to: number; sep: ';' | '.' | null }[] = [];
	const quoted = quotedRanges(body);
	let depth = 0;
	let inAngle = false;
	let italic: string | null = null;
	let start = 0;
	let sep: ';' | '.' | null = null;
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (c === '<' && /^<https?:/.test(body.slice(i, i + 7))) inAngle = true;
		else if (c === '>' && inAngle) inAngle = false;
		else if (inAngle) continue;
		// A semicolon in italics belongs to a title ("*Re Wakim; Ex parte McNally*"), not between sources.
		else if ((c === '*' || c === '_') && body[i + 1] !== c && body[i - 1] !== c) italic = italic === c ? null : italic ?? c;
		else if (c === '(' || c === '[') depth++;
		else if ((c === ')' || c === ']') && depth > 0) depth--;
		else if (c === ';' && depth === 0 && italic === null) {
			parts.push({ from: start, to: i, sep });
			start = i + 1;
			sep = ';';
		} else if (c === '.' && depth === 0 && italic === null && sentenceBreak(body, i, quoted)) {
			// A new sentence, eg one starting with a different signal (r 1.1.3): "… 190 CLR 1. Cf R v …".
			parts.push({ from: start, to: i, sep });
			start = i + 1;
			sep = '.';
		}
	}
	parts.push({ from: start, to: body.length, sep });
	return parts.map((p, idx) => {
		let from = p.from;
		while (from < p.to && /\s/.test(body[from]!)) from++;
		const segText = body.slice(from, p.to);
		const sig = SIGNAL_RE.exec(segText);
		const signal = sig ? sig[0].trimEnd() : null;
		const bodyFrom = from + (sig ? sig[0].length : 0);
		return {
			from,
			to: p.to,
			text: segText,
			signal,
			bodyFrom,
			body: body.slice(bodyFrom, p.to),
			sep: p.sep,
			finished: idx < parts.length - 1 || closed,
		};
	});
}

/** Ranges inside quotation marks, where a full stop does not end the footnote's sentence. */
function quotedRanges(text: string): [number, number][] {
	const out: [number, number][] = [];
	const re = /(^|[\s(])['‘“"](.+?)['’”"](?=[\s,.;:)?!]|$)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) out.push([m.index + m[1]!.length, m.index + m[0].length]);
	return out;
}

/** Abbreviations and initials after which a full stop does not end a sentence (should AGLC4's rule against them be broken). */
const NO_BREAK_BEFORE = /(?:^|\s)(?:[A-Z]|Pty|Co|Inc|No|Nos|Dr|Mr|Mrs|Ms|Prof|Jr|Sr|St|vol|Vol|ch|pt|ed|eds|v|cf|eg|ie|al|e\.g|i\.e|op cit|loc cit)$/;

/** Whether the full stop at `i` ends a sentence: followed by a space and a capital, outside quotations. */
function sentenceBreak(text: string, i: number, quoted: [number, number][]): boolean {
	if (!/^\.\s+(?:[*_]?[A-Z‘'(])/.test(text.slice(i))) return false;
	if (NO_BREAK_BEFORE.test(text.slice(0, i))) return false;
	return !quoted.some(([a, b]) => i > a && i < b);
}

/** All matches for a citation body, best first. */
export function rankMatches(body: string, hasSignal: boolean): MatchResult[] {
	const results = SPECS.map((spec) => matchSpec(spec, body, hasSignal));
	const score = (r: MatchResult): number => {
		const remainder = body.slice(r.pos);
		const fullyConsumed = remainder.length === 0 || COMMENTARY_RE.test(remainder);
		if (r.complete && fullyConsumed) return 4_000_000 + r.pos;
		if (r.claimed) return 2_000_000 + r.pos * 100 + r.elements.length;
		return r.pos * 100 + r.elements.length;
	};
	return results
		.map((r, i) => ({ r, s: score(r), i }))
		.sort((a, b) => b.s - a.s || a.i - b.i)
		.map((x) => x.r);
}

/** The label of the last element matched, eg "pinpoint", "law report series". */
function lastLabel(r: MatchResult): string {
	const id = r.elements[r.elements.length - 1]?.id;
	return r.spec.elements.find((e) => e.id === id)?.label.toLowerCase() ?? 'citation';
}

function describeNext(spec: SourceSpec, next: number): ElementSpec | undefined {
	return spec.elements.slice(next).find((e) => !e.optional) ?? spec.elements[next];
}

/** Analyse one citation (segment). Offsets in the returned issues are relative to the footnote text. */
export function analyseSegment(seg: Segment, opts: { showInfo?: boolean } = {}): CitationAnalysis {
	const issues: Issue[] = [];
	const hasSignal = seg.signal !== null;

	for (const [re, fixed] of SIGNAL_FIXES) {
		const m = re.exec(seg.text);
		if (m && m[0] !== fixed) {
			issues.push({
				rule: 'signal-form', severity: 'error', from: seg.from, to: seg.from + m[0].trimEnd().length,
				message: `Write the signal as "${fixed.trim()}".`, ref: 'r 1.2',
				fix: { from: seg.from, to: seg.from + m[0].length, insert: fixed },
			});
		}
	}
	if (seg.signal && /^\*|^_/.test(seg.text)) {
		issues.push({ rule: 'signal-italics', severity: 'error', from: seg.from, to: seg.bodyFrom, message: 'Introductory signals are not italicised.', ref: 'r 1.2' });
	}
	const italicSignal = /^[*_]((?:See|Cf|Compare|Contra|But see)[^*_]*)[*_]\s/.exec(seg.text);
	if (italicSignal) {
		issues.push({
			rule: 'signal-italics', severity: 'error', from: seg.from, to: seg.from + italicSignal[0].length - 1,
			message: 'Introductory signals are not italicised.', ref: 'r 1.2',
			fix: { from: seg.from, to: seg.from + italicSignal[0].length, insert: `${italicSignal[1]!} ` },
		});
	}

	if (seg.body.length === 0) return { segment: seg, best: null, kind: null, issues };

	const ranked = rankMatches(seg.body, hasSignal);
	const best = ranked[0]!;
	const remainder = seg.body.slice(best.pos);
	const consumed = remainder.length === 0 || COMMENTARY_RE.test(remainder);
	const isCitation = best.claimed || (best.complete && consumed && best.elements.length >= 2);

	if (!isCitation) {
		// Reads as prose. Flag a likely citation that stopped early, but quietly.
		if (seg.finished && opts.showInfo && best.elements.length >= 2 && best.spec.kind !== 'subsequent') {
			const nextEl = describeNext(best.spec, best.next);
			issues.push({
				rule: 'possibly-incomplete', severity: 'info', from: seg.bodyFrom, to: seg.bodyFrom + best.pos,
				message: `Possibly an incomplete ${best.spec.label.toLowerCase()} citation${nextEl ? `: expected ${nextEl.label.toLowerCase()} next` : ''}.`,
				ref: best.spec.ref,
			});
		}
		return { segment: seg, best: null, kind: null, issues };
	}

	issues.push(...best.issues.map((i) => shiftIssue(i, seg.bodyFrom)));

	if (seg.finished) {
		if (!best.complete) {
			const missing = describeNext(best.spec, best.next);
			const last = best.elements[best.elements.length - 1];
			const from = seg.bodyFrom + (remainder.length > 0 ? best.pos : Math.max(0, (last?.from ?? best.pos)));
			const to = seg.bodyFrom + (remainder.length > 0 ? seg.body.length : best.pos);
			issues.push({
				rule: 'incomplete', severity: 'error', from: Math.min(from, to - 1), to,
				message: `Incomplete ${best.spec.label.toLowerCase()} citation: missing ${missing?.label.toLowerCase() ?? 'element'}${missing ? ` — ${missing.hint}` : ''}.`,
				ref: best.spec.ref,
			});
		} else if (!consumed) {
			const nextEl = best.spec.elements[best.next];
			issues.push({
				rule: 'unexpected', severity: 'warning', from: seg.bodyFrom + best.pos, to: seg.bodyFrom + seg.body.length,
				message: `Unexpected text after the ${lastLabel(best)} of this ${best.spec.label.toLowerCase()} citation${nextEl ? `: expected ${nextEl.label.toLowerCase()} or the end of the citation` : ''}.`,
				ref: best.spec.ref,
			});
		}
	}

	return { segment: seg, best, kind: best.spec.kind, issues };
}

export interface FootnoteAnalysis {
	text: string;
	segments: CitationAnalysis[];
	issues: Issue[];
	closed: boolean;
}

/** Analyse the text of one footnote. Issue offsets are relative to `text`. */
export function analyseFootnote(text: string, opts: { showInfo?: boolean; inProgress?: boolean } = {}): FootnoteAnalysis {
	const segs = splitSegments(text);
	const trimmed = text.replace(/\s+$/, '');
	// Closing italics do not hide the full stop: "*Ibid.*" ends with one.
	const closed = /[.?!](?:['’"”])?$/.test(trimmed.replace(/[*_]+$/, ''));
	const segments = segs.map((s) => analyseSegment(s, opts));
	const issues = segments.flatMap((s) => s.issues);
	issues.push(...acrossSegments(text, segments));
	if (!closed && trimmed.length > 0 && !opts.inProgress) {
		issues.push({
			rule: 'closing-stop', severity: 'error', from: Math.max(0, trimmed.length - 1), to: trimmed.length,
			message: 'Footnotes end with a full stop.', ref: 'r 1.1.4',
			fix: { from: trimmed.length, to: trimmed.length, insert: '.' },
		});
	}
	return { text, segments, issues, closed };
}

const JUR_ORDER = ['Cth', 'ACT', 'NSW', 'NT', 'Qld', 'SA', 'Tas', 'Vic', 'WA'];

/** Rules about how the citations of one footnote relate to each other. */
function acrossSegments(text: string, segments: CitationAnalysis[]): Issue[] {
	const out: Issue[] = [];
	segments.forEach((c, i) => {
		const seg = c.segment;
		const prev = segments[i - 1];
		// A different signal starts a new sentence, not a semicolon (r 1.1.3, 1.2).
		if (seg.signal && seg.sep === ';') {
			const semi = text.lastIndexOf(';', seg.from);
			const signal = seg.signal.charAt(0).toUpperCase() + seg.signal.slice(1);
			out.push({
				rule: 'signal-new-sentence', severity: 'error', from: semi, to: seg.from + seg.signal.length,
				message: 'A source with a different introductory signal starts a new sentence, not after a semicolon.', ref: 'r 1.1.3',
				fix: { from: semi, to: seg.from + seg.signal.length, insert: `. ${signal}` },
			});
		} else if (seg.signal && /^[a-z]/.test(seg.signal) && (seg.sep === '.' || (seg.sep === null && !/:\s*$/.test(text.slice(0, seg.from))))) {
			// At the start of a sentence a signal is capitalised ("See", "Cf"); after a colon it is not.
			out.push({
				rule: 'signal-case', severity: 'error', from: seg.from, to: seg.from + seg.signal.length,
				message: 'An introductory signal starting a sentence is capitalised.', ref: 'r 1.2',
				fix: { from: seg.from, to: seg.from + 1, insert: seg.signal.charAt(0).toUpperCase() },
			});
		}
		// Parallel citations are not used (r 2.2.7): "(1999) 198 CLR 180; 164 ALR 606; [1999] HCA 36". A
		// parallel report may have no year ("164 ALR 606"), so it is not recognised as a case on its own.
		const reportOnly = c.kind === null && /^\d+\s[A-Z][A-Za-z ]*\s\d+$/.test(seg.body);
		const nameless = c.kind?.startsWith('case') && !c.best?.elements.some((e) => e.id === 'name');
		const afterCase = segments.slice(0, i).some((p) => p.kind?.startsWith('case'));
		if (prev && seg.sep === ';' && afterCase && (nameless || reportOnly)) {
			out.push({
				rule: 'parallel-citation', severity: 'error', from: seg.from, to: seg.to,
				message: 'Do not give parallel citations: cite only the most authoritative report.', ref: 'r 2.2.7',
			});
		}
		// Parallel statutes: the Commonwealth first, then the states and territories alphabetically (r 3.3).
		if (prev && c.kind === 'legislation' && prev.kind === 'legislation') {
			const jur = (a: CitationAnalysis) => {
				const el = a.best?.elements.find((e) => e.id === 'jurisdiction');
				return el ? JUR_ORDER.indexOf(el.text.trim().slice(1, -1)) : -1;
			};
			const a = jur(prev);
			const b = jur(c);
			if (a >= 0 && b >= 0 && b < a) {
				out.push({
					rule: 'leg-order', severity: 'warning', from: seg.from, to: seg.to,
					message: 'Cite parallel Acts with the Commonwealth first, then the states and territories in alphabetical order.', ref: 'r 3.3',
				});
			}
		}
	});
	return out;
}

// ---------------------------------------------------------------------------------------------------------
// Suggestions

export interface Suggestion {
	/** Element label, eg "Year". */
	label: string;
	hint: string;
	/** Source type the suggestion belongs to. */
	source: string;
	/** Text to insert at the cursor (after removing `replaceLength` characters before it). */
	insert: string;
	required: boolean;
	/** Number of characters before the cursor that the suggestion replaces (a partly typed element). */
	replaceLength: number;
}

const FINISH: Suggestion = { label: 'End footnote', hint: 'Close the footnote with a full stop (AGLC4 r 1.1.4)', source: '', insert: '.', required: false, replaceLength: 0 };
const ANOTHER: Suggestion = { label: 'Another source', hint: 'Separate sources with a semicolon (AGLC4 r 1.1.3)', source: '', insert: '; ', required: false, replaceLength: 0 };

/** Starting points offered on an empty citation. */
export function startSuggestions(hasSignal: boolean): Suggestion[] {
	return SPECS.filter((s) => s.kind !== 'legislation-short').map((s) => ({
		label: s.label,
		hint: s.example,
		source: s.label,
		insert: s.kind === 'ibid' && hasSignal ? 'ibid' : s.start,
		required: false,
		replaceLength: 0,
	}));
}

/**
 * Suggest what comes next in the citation being typed. `before` is the footnote text up to the cursor.
 * Returns an empty list when the text does not look like a citation in progress.
 */
export function suggestNext(before: string): Suggestion[] {
	const lastSemi = before.lastIndexOf(';');
	const segStart = lastSemi >= 0 ? lastSemi + 1 : 0;
	const raw = before.slice(segStart).replace(/^\s+/, '');
	const sig = SIGNAL_RE.exec(raw);
	const body = sig ? raw.slice(sig[0].length) : raw;
	if (body.trim().length === 0) {
		if (sig || raw.length === 0) return startSuggestions(!!sig);
		return [];
	}
	if (/[.]$/.test(body) && !/\b(?:Ibid|ibid)\.$/.test(body)) return [];

	const ranked = rankMatches(body, !!sig);
	const viable = ranked.filter((r) => {
		const remainder = body.slice(r.pos);
		if (r.elements.length === 0) return false;
		return remainder.length === 0 || (remainder.length <= 30 && !/[;]/.test(remainder));
	});
	if (viable.length === 0) return [];
	const exact = viable.filter((r) => r.pos === body.length);
	const pool = exact.length > 0 ? exact : viable;
	const top = Math.max(...pool.map((r) => r.elements.length));
	// Every kind of citation the text so far fits completely, most complete first; otherwise the best partial.
	const chosen = (exact.length > 0 ? exact : pool.filter((r) => r.claimed || r.elements.length === top)).slice(0, 6);

	const out: Suggestion[] = [];
	const seen = new Set<string>();
	for (const r of chosen) {
		const replaceLength = body.length - r.pos;
		const lastId = r.elements[r.elements.length - 1]?.id;
		for (let i = r.next; i < r.spec.elements.length; i++) {
			const el = r.spec.elements[i]!;
			if (el.id === lastId && !el.repeat) continue;
			const key = `${el.insert}|${replaceLength}`;
			if (!seen.has(key)) {
				seen.add(key);
				out.push({ label: el.label, hint: el.hint, source: r.spec.label, insert: el.insert, required: !el.optional, replaceLength });
			}
			if (!el.optional) break;
		}
		if (r.complete && replaceLength === 0) {
			for (const s of [FINISH, ANOTHER]) {
				if (!seen.has(s.insert)) {
					seen.add(s.insert);
					out.push({ ...s, source: r.spec.label });
				}
			}
		}
	}
	// Required elements first, so the "next required element" leads.
	return out.sort((a, b) => Number(b.required) - Number(a.required));
}

/** The single next required element for the citation being typed, for inline hints. */
export function nextRequired(before: string): Suggestion | null {
	const s = suggestNext(before);
	return s.find((x) => x.required && x.replaceLength === 0) ?? null;
}
