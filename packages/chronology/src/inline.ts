/**
 * The inline event syntax: a list item that starts with a date, then " :: ", then the title, with
 * optional attributes in braces at the end, and optionally a block id.
 *
 *   - 2019-03-14 :: Demo recorded [[Song X]] {track=client conf=confirmed ref="CB 45"}
 *   - ~2019-03 :: First draft shared with [[Jo Rivers]] {kind=creation}
 *   - 2021-06-30 :: Option to extend expires {kind=option-deadline matter="[[2026-014 Film option]]"} ^opt1
 *
 * It stays readable as plain Markdown, and a list item without " :: " after a date is never an event, so
 * ordinary notes are unaffected. Lines in code blocks, frontmatter and comments are skipped.
 */
import { excludedRanges } from '@legal-core/md-pipeline';
import { type PreciseDate, parseDate } from '@legal-core/precise-date';
import type { Confidence } from './types';

export interface InlineEventDraft {
	/** 0-based line of the list item. */
	line: number;
	date: PreciseDate;
	/** The title as written, links and all, without the attributes and block id. */
	title: string;
	/** Link targets in the title, then in link attributes (without aliases or headings). */
	links: string[];
	attrs: Record<string, string[]>;
	blockId?: string;
	track?: string;
	kind?: string;
	ref?: string;
	confidence: Confidence;
	/** Explicit links from attributes. */
	matter?: string;
	works: string[];
	parties: string[];
	/** Attributes the syntax does not know (kept, and reported). */
	unknown: string[];
}

export interface InlineProblem {
	line: number;
	message: string;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/-]\]\s+)?(~?\d{4}[0-9~.-]*)\s+::\s+(.+?)\s*$/;
const BLOCK_ID = /\s+\^([A-Za-z0-9-]+)$/;
const ATTRS = /\s*\{([^{}]*)\}$/;
const LINK = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const KNOWN = new Set(['track', 'conf', 'confidence', 'ref', 'kind', 'matter', 'work', 'party']);
const CONFIDENCE: Record<string, Confidence> = { confirmed: 'confirmed', probable: 'probable', unverified: 'unverified' };

/** Link targets in text: "[[Song X|the song]]" → "Song X". */
export function linkTargets(text: string): string[] {
	return [...text.matchAll(LINK)].map((m) => m[1]!.trim()).filter(Boolean);
}

/** `key=value key="quoted value" key=[[Link]]`, keys repeatable. */
function parseAttrs(body: string): { attrs: Record<string, string[]>; error?: string } {
	const attrs: Record<string, string[]> = {};
	const re = /\s*([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|(\[\[[^\]]*\]\])|([^\s"]+))/y;
	let pos = 0;
	while (pos < body.length) {
		if (/^\s*$/.test(body.slice(pos))) break;
		re.lastIndex = pos;
		const m = re.exec(body);
		if (!m) return { attrs, error: `could not read the attributes "{${body.trim()}}": use key=value, with "quotes" around spaces` };
		const key = m[1]!.toLowerCase();
		(attrs[key] ??= []).push(m[2] ?? m[3] ?? m[4] ?? '');
		pos = re.lastIndex;
	}
	return { attrs };
}

/** Every inline event in a note, with any problems found in lines that look like events. */
export function parseInlineEvents(text: string): { events: InlineEventDraft[]; problems: InlineProblem[] } {
	const events: InlineEventDraft[] = [];
	const problems: InlineProblem[] = [];
	if (!text.includes(' :: ')) return { events, problems };
	const excluded = excludedRanges(text);
	let offset = 0;
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!;
		const at = offset;
		offset += raw.length + 1;
		if (!raw.includes(' :: ')) continue;
		const m = LIST_ITEM.exec(raw);
		if (!m) continue;
		if (excluded.some(([a, b]) => at >= a && at < b)) continue;
		const parsed = parseDate(m[1]);
		if (!parsed.ok) {
			problems.push({ line: i, message: `Not an event: ${parsed.reason}.` });
			continue;
		}
		let rest = m[2]!;
		let blockId: string | undefined;
		const b = BLOCK_ID.exec(rest);
		if (b) { blockId = b[1]; rest = rest.slice(0, b.index); }
		let attrs: Record<string, string[]> = {};
		const a = ATTRS.exec(rest);
		if (a) {
			const r = parseAttrs(a[1]!);
			if (r.error) problems.push({ line: i, message: r.error });
			else { attrs = r.attrs; rest = rest.slice(0, a.index); }
		}
		const title = rest.trim();
		if (!title) {
			problems.push({ line: i, message: 'An event needs a title after " :: ".' });
			continue;
		}
		const first = (k: string) => attrs[k]?.[0];
		const confText = (first('conf') ?? first('confidence'))?.toLowerCase();
		const confidence = confText ? CONFIDENCE[confText] : 'unverified';
		if (confText && !confidence) problems.push({ line: i, message: `conf=${confText} is not a confidence: use confirmed, probable or unverified.` });
		const linksIn = (k: string) => (attrs[k] ?? []).flatMap((v) => { const l = linkTargets(v); return l.length > 0 ? l : [v.trim()]; }).filter(Boolean);
		const unknown = Object.keys(attrs).filter((k) => !KNOWN.has(k));
		events.push({
			line: i,
			date: parsed.date,
			title,
			links: [...linkTargets(title), ...linksIn('work'), ...linksIn('party'), ...linksIn('matter')],
			attrs,
			blockId,
			track: first('track'),
			kind: first('kind'),
			ref: first('ref'),
			confidence: confidence ?? 'unverified',
			matter: linksIn('matter')[0],
			works: linksIn('work'),
			parties: linksIn('party'),
			unknown,
		});
		if (unknown.length > 0) problems.push({ line: i, message: `Unknown attribute${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')} (kept, not used).` });
	}
	return { events, problems };
}
