/**
 * A bibliography of the sources cited in a note's footnotes, in the form of AGLC4 r 1.13:
 * - sections A Articles/Books/Reports, B Cases, C Legislation, D Treaties, E Other, omitting empty ones
 *   and relettering the rest;
 * - each source cited as in a footnote, but with the first author's name inverted ("Foster, Michelle"),
 *   no closing full stop, and nothing that points into the source (pinpoints, judges, short titles);
 * - sources in alphabetical order: by the first author's surname, then first name, then the second
 *   author's first name and surname and so on (a work with fewer authors first), then the title
 *   ignoring "The"; an institution by its name; a source with no author by its title.
 */
import { analyseDocument } from './document';
import { bibliographyStart } from './headings';
import { scanFootnotes } from '@legal-core/md-pipeline';
import { type TopLevel, topMarkdownLevel } from './headings';
import type { CitationAnalysis } from './citation';
import type { SourceKind } from './grammar';

export interface BibliographySection {
	letter: string;
	title: string;
	/** Entries in Markdown (italics as `*…*`), in order. */
	entries: string[];
}

type SectionId = 'A' | 'B' | 'C' | 'D' | 'E';

const SECTION_TITLES: Record<SectionId, string> = {
	A: 'Articles/Books/Reports',
	B: 'Cases',
	C: 'Legislation',
	D: 'Treaties',
	E: 'Other',
};

/** Elements that point into a source rather than identify it, left out of the bibliography. */
const OMIT = new Set(['pinpoint', 'pinpoint-more', 'judges', 'note', 'short', 'definition']);
/** Hansard is listed by debate, without the page or speaker (AGLC4 r 1.13 example). */
const OMIT_HANSARD = new Set(['page', 'speaker']);

/** Paper types that are reports or published papers (section A) rather than speeches and releases (E). */
const PAPER_A = /\b(?:Thesis|Paper|Report|Submission|Brief|Bulletin)\b/;

function sectionOf(kind: SourceKind, text: string): SectionId | null {
	switch (kind) {
		case 'legislation-short':
			// The Australian Constitution is cited in full without a year; other short titles point back.
			return /^\*[^*]*\bConstitution\*(?:\s|$)/.test(text) ? 'C' : null;
		case 'journal': case 'book': case 'chapter': case 'newspaper':
			return 'A';
		case 'paper':
			return PAPER_A.test(text) ? 'A' : 'E';
		case 'case-reported': case 'case-mnc': case 'case-unreported':
			return 'B';
		case 'legislation': case 'explanatory':
			return 'C';
		case 'treaty':
			return 'D';
		case 'internet': case 'hansard':
			return 'E';
		default:
			// Ibid and subsequent references point at a source already listed.
			return null;
	}
}

/** Words that mark an author as an institution, whose name is not inverted. */
const INSTITUTION = /\b(?:Department|Commission|Commissioner|Council|Committee|Office|Ministry|Institute|Association|Society|Authority|Agency|Bureau|Parliament|Government|University|Centre|Center|Foundation|Board|Tribunal|Court|Union|Organisation|Organization|Corporation|Group|Bank|Network|Services?|Trust|Fund|Secretariat|Nations|League|Federation|Alliance|Coalition|Project|Library|School|College|Academy|Party|Chamber|Inc|Ltd|Editorial)\b|\((?:Cth|NSW|Vic|Qld|WA|SA|Tas|ACT|NT)\)/;

/** Particles that belong with a surname ("van Gogh", "de Jersey"). */
const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'du', 'da', 'di', 'del', 'della', 'le', 'la', 'bin', 'binti', 'ten', 'ter']);

interface Person { given: string; surname: string }

function splitName(name: string): Person | null {
	const words = name.trim().split(/\s+/);
	if (words.length < 2) return null;
	let at = words.length - 1;
	while (at > 1 && PARTICLES.has(words[at - 1]!)) at--;
	return { given: words.slice(0, at).join(' '), surname: words.slice(at).join(' ') };
}

interface Authors {
	/** The author text with the first author's name inverted. */
	text: string;
	/** Sort keys for the authors, in the order r 1.13 compares them. */
	keys: string[];
}

function authors(text: string): Authors {
	const suffix = /(?:\s+et al)?(?:\s+\((?:ed|eds)\))?$/.exec(text)![0];
	const names = text.slice(0, text.length - suffix.length);
	if (INSTITUTION.test(names)) return { text, keys: [stripThe(names)] };
	const list = names.split(/,\s|\sand\s/).map((n) => n.trim()).filter(Boolean);
	const people = list.map(splitName);
	const first = people[0];
	if (!first || people.some((p) => !p)) return { text, keys: [names] };
	const keys = [first.surname, first.given];
	for (const p of people.slice(1)) keys.push(p!.given, p!.surname);
	if (/et al/.test(suffix)) keys.push('et al');
	return { text: `${first.surname}, ${first.given}${names.slice(list[0]!.length)}${suffix}`, keys };
}

function plain(s: string): string {
	return s.replace(/[*_‘’'“”"]/g, '').replace(/\s+/g, ' ').replace(/^[\s,]+/, '').trim();
}

function stripThe(s: string): string {
	return plain(s).replace(/^the\s+/i, '');
}

function words(s: string): string[] {
	return stripThe(s).split(' ').filter(Boolean);
}

interface Entry {
	section: SectionId;
	text: string;
	key: string[];
}

/** The bibliography entry for one citation, or null if it is not a full citation of a source. */
function entryFor(c: CitationAnalysis): Entry | null {
	const best = c.best;
	if (!c.kind || !best?.complete) return null;
	const section = sectionOf(c.kind, c.segment.body);
	if (!section) return null;
	const isCase = c.kind.startsWith('case');
	if (isCase && !best.elements.some((e) => e.id === 'name')) return null;

	const kept = best.elements.filter((e) => !OMIT.has(e.id) && !(c.kind === 'hansard' && OMIT_HANSARD.has(e.id)));
	let authorKeys: string[] | null = null;
	const parts = kept.map((e) => {
		if (e.id !== 'author' || isCase) return e.text;
		const a = authors(e.text.trim());
		authorKeys = a.keys;
		return e.text.replace(e.text.trim(), a.text);
	});
	const text = parts.join('').replace(/^[\s,]+/, '').replace(/[\s,]+$/, '').replace(/\.$/, '');
	if (!text) return null;

	const title = best.elements.find((e) => e.id === 'title' || e.id === 'name')?.text ?? text;
	const key = authorKeys
		? [...(authorKeys as string[]).map(plain), '', ...words(title)]
		: words(text);
	return { section, text, key };
}

const collator = new Intl.Collator('en', { sensitivity: 'base', ignorePunctuation: true, numeric: true });

function compareKeys(a: string[], b: string[]): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		const c = collator.compare(a[i]!, b[i]!);
		if (c !== 0) return c;
	}
	return a.length - b.length;
}

/** The bibliography of every source cited in the note's footnotes, by section. */
export function buildBibliography(markdown: string): BibliographySection[] {
	const analysis = analyseDocument(markdown, { showInfo: false });
	const seen = new Set<string>();
	const bySection = new Map<SectionId, Entry[]>();
	for (const n of analysis.notes) {
		for (const c of n.analysis?.segments ?? []) {
			const e = entryFor(c);
			if (!e) continue;
			const id = plain(e.text).toLowerCase();
			if (seen.has(id)) continue;
			seen.add(id);
			bySection.set(e.section, [...(bySection.get(e.section) ?? []), e]);
		}
	}
	const out: BibliographySection[] = [];
	for (const id of ['A', 'B', 'C', 'D', 'E'] as SectionId[]) {
		const list = bySection.get(id);
		if (!list?.length) continue;
		list.sort((a, b) => compareKeys(a.key, b.key) || collator.compare(a.text, b.text));
		out.push({ letter: String.fromCharCode(65 + out.length), title: SECTION_TITLES[id], entries: list.map((e) => e.text) });
	}
	return out;
}

/** The bibliography as Markdown, with its heading at Markdown level `level`. */
export function bibliographyMarkdown(sections: BibliographySection[], level: number): string {
	const h = '#'.repeat(level);
	const parts = [`${h} Bibliography`];
	for (const s of sections) parts.push(`${h}# ${s.letter} ${s.title}`, ...s.entries);
	return parts.join('\n\n');
}

export interface InsertResult {
	text: string;
	/** Number of sources listed. */
	sources: number;
	/** True when an existing bibliography was replaced. */
	replaced: boolean;
}

/**
 * The note with a bibliography of its cited sources at the very end, after the footnote definitions,
 * replacing the note's bibliography if it has one (wherever it is). Null when no source is cited in full.
 */
export function withBibliography(text: string, top: TopLevel): InsertResult | null {
	const sections = buildBibliography(text);
	if (sections.length === 0) return null;
	const scan = scanFootnotes(text);
	const start = bibliographyStart(text, scan.excluded);

	// Headings of the text before the bibliography.
	const levels: number[] = [];
	const re = /^(#{1,6})[ \t]/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) && (start < 0 || m.index < start)) {
		const at = m.index;
		if (!scan.excluded.some(([a, b]) => at >= a && at < b)) levels.push(m[1]!.length);
	}

	let rest = text;
	let level = topMarkdownLevel(levels, top);
	if (start >= 0) {
		// The existing bibliography runs to the footnote definitions after it, or to the end.
		level = /^#+/.exec(text.slice(start))![0].length;
		const next = scan.defs.map((d) => d.from).filter((f) => f > start).sort((a, b) => a - b)[0] ?? text.length;
		rest = `${text.slice(0, start).replace(/\s+$/, '')}\n\n${text.slice(next)}`;
	}
	const before = rest.replace(/\s+$/, '');
	return {
		text: `${before}${before ? '\n\n' : ''}${bibliographyMarkdown(sections, level)}\n`,
		sources: sections.reduce((n, s) => n + s.entries.length, 0),
		replaced: start >= 0,
	};
}
