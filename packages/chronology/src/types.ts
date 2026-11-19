/**
 * The shared event model: dated events from any plugin, gathered in one index.
 */
import type { PreciseDate } from '@legal-core/precise-date';

export type Confidence = 'confirmed' | 'probable' | 'unverified';

export interface LegalEvent {
	/** Stable: "<path>#^<block id>", "<path>#e-<hash>" (inline), or "<path>#<source id>:<key>" (a source). */
	id: string;
	date: PreciseDate;
	/** As written, in Markdown (links kept). */
	title: string;
	/** Paths of the parties' notes (or the link text, if the note does not exist). */
	parties: string[];
	/** Paths of the works' notes. */
	works: string[];
	/** Path of the matter's note. */
	matter?: string;
	source: { file: string; line?: number; ref?: string };
	confidence: Confidence;
	kind?: string;
	track?: string;
	/** "inline" for the inline syntax, or the id of the event source. */
	contributedBy: string;
	/** Derived from sensitive data (ICIP): left out of queries unless asked for. */
	sensitive?: boolean;
}

/** What an event source gives for one note. */
export interface EventInput {
	/** Unique within the note and source, stable across edits (eg "option-1-deadline"). */
	key: string;
	/** A precise date, or the text of one ("2021-06-30", "~2019-03"). Invalid dates are skipped. */
	date: PreciseDate | string;
	title: string;
	/** Link targets or paths. */
	parties?: string[];
	works?: string[];
	matter?: string;
	kind?: string;
	track?: string;
	confidence?: Confidence;
	ref?: string;
	line?: number;
	sensitive?: boolean;
}

export interface NoteForSource {
	path: string;
	frontmatter: Record<string, unknown> | undefined;
}

export interface LegalEventSource {
	/** The extension's id, used in event ids and `contributedBy`. */
	id: string;
	/** Only notes whose frontmatter `type` is one of these are passed; none means every note. */
	types?: string[];
	events(note: NoteForSource): EventInput[];
}

export interface EventQuery {
	/** Path of a matter's note (or a link to it). */
	matter?: string;
	work?: string;
	party?: string;
	/** Events overlapping the period from `from` to `to` (YYYY, YYYY-MM or YYYY-MM-DD). */
	from?: string;
	to?: string;
	kinds?: string[];
	tracks?: string[];
	confidence?: Confidence[];
	/** Only events from this file. */
	file?: string;
	/** Include events derived from sensitive data (ICIP). Off unless asked for. */
	includeSensitive?: boolean;
}

export interface EventChange {
	added: LegalEvent[];
	removed: string[];
	/** Set when the whole index changed (the first full pass, a new source): query again. */
	reset?: boolean;
}

/** A problem in a line that looks like an event, for display next to the note. */
export interface EventProblem {
	file: string;
	line: number;
	message: string;
}
