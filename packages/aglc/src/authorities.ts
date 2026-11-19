/**
 * The authorities a note cites, as records for the shared authority store: every source cited in full and
 * correctly in its footnotes (not Ibid or later references), with its citation as AGLC4 gives it but
 * without pinpoints, and the parts that identify it, so the same source cited anywhere gets the same record.
 */
import type { AuthorityInput, AuthorityKind } from '@legal-core/authority-store';
import { analyseDocument } from './document';
import type { CitationAnalysis } from './citation';

/** The plugin id AGLC4 Citations writes records as. */
export const AGLC4_SOURCE = 'aglc-citations';

/** Elements that point into a source rather than identify it. */
const OMIT = new Set(['pinpoint', 'pinpoint-more', 'judges', 'note', 'short', 'definition']);

/** An element's text without the punctuation that joins it to the rest of the citation. */
function clean(text: string | undefined): string {
	return (text ?? '').trim().replace(/^[,(\s]+|[),\s]+$/g, '');
}

function firstYear(text: string): string {
	return /\b(?:1[5-9]|20)\d\d\b/.exec(text)?.[0] ?? '';
}

/**
 * The record for one citation, or null if it is not a full citation of a source, or it has an AGLC4
 * error (it is shared once corrected, under the same id).
 */
export function authorityFor(c: CitationAnalysis, notePath?: string): AuthorityInput | null {
	const best = c.best;
	if (!c.kind || !best?.complete) return null;
	if (c.issues.some((i) => i.severity === 'error')) return null;
	const el = (id: string) => clean(best.elements.find((e) => e.id === id)?.text);
	const omitted = (id: string) => OMIT.has(id) || (c.kind === 'hansard' && (id === 'page' || id === 'speaker'));
	const citation = best.elements.filter((e) => !omitted(e.id)).map((e) => e.text).join('').replace(/^[\s,]+|[\s,.]+$/g, '');
	if (!citation) return null;

	const record = (kind: AuthorityKind, title: string, key: Record<string, string>): AuthorityInput | null => (title
		? { kind, title, citation, key, fields: { type: c.kind! }, source: AGLC4_SOURCE, ...(notePath ? { notePath } : {}) }
		: null);

	switch (c.kind) {
		case 'case-reported':
			return record('case', el('name'), { year: firstYear(el('year')), volume: el('volume'), series: el('series'), page: el('page') });
		case 'case-mnc':
			return record('case', el('name'), { year: firstYear(el('year')), court: el('court'), number: el('number') });
		case 'case-unreported':
			return record('case', el('name'), { court: el('court'), date: el('date') });
		case 'legislation':
			return record('legislation', el('title'), { jurisdiction: el('jurisdiction') });
		case 'legislation-short':
			// A later reference by short title points back to a full citation; only the Constitution is cited in full this way.
			return /\bConstitution\*?$/.test(el('title')) ? record('legislation', el('title'), {}) : null;
		case 'explanatory':
			return record('legislation', `${el('type')}, ${el('bill')}`, { jurisdiction: el('jurisdiction') });
		case 'treaty':
			return record('secondary', el('title'), { series: el('series') });
		case 'hansard':
			return record('secondary', `${el('jurisdiction')}, ${el('title')}`, { chamber: el('chamber'), date: el('date') });
		case 'journal': case 'book': case 'chapter': case 'newspaper': case 'internet': case 'paper':
			return record('secondary', el('title'), { authors: el('author'), year: firstYear(citation) });
		default:
			return null;
	}
}

/** Every source a note cites in full, once each. */
export function noteAuthorities(markdown: string, notePath?: string): AuthorityInput[] {
	const seen = new Set<string>();
	const out: AuthorityInput[] = [];
	for (const n of analyseDocument(markdown, { showInfo: false }).notes) {
		for (const c of n.analysis?.segments ?? []) {
			const a = authorityFor(c, notePath);
			if (!a) continue;
			const id = `${a.kind}|${a.title}|${JSON.stringify(a.key)}`;
			if (seen.has(id)) continue;
			seen.add(id);
			out.push(a);
		}
	}
	return out;
}
