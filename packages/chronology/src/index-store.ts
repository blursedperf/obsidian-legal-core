/**
 * The event index: every event in the vault, from inline syntax and from event sources, kept up to date
 * note by note. It is derived from the notes alone and can always be rebuilt.
 *
 * Notes arrive in any order, so what a link means (a work, a matter, a party) and which matter an event
 * belongs to (by folder) depend on notes that may not have been seen yet. They are therefore worked out
 * when the index is queried, from what it knows then, and the result is cached until something changes.
 */
import { type PreciseDate, compareDates, overlaps, parseDate } from '@legal-core/precise-date';
import { parseInlineEvents } from './inline';
import type { EventChange, EventInput, EventProblem, EventQuery, LegalEventSource, LegalEvent } from './types';

/** How the index finds out about other notes. */
export interface Resolver {
	/** The path of the note a link points to, from a note, or null if there is none. */
	resolve(link: string, fromPath: string): string | null;
}

export interface IndexedNote {
	path: string;
	/** Frontmatter, for event sources and the note's `type`. */
	frontmatter?: Record<string, unknown>;
	/** The note's text, for inline events. Leave out for notes without list items. */
	text?: string;
}

/** An event as read from its note, before links and the matter are worked out. */
interface RawEvent {
	id: string;
	date: PreciseDate;
	title: string;
	links: string[];
	works: string[];
	parties: string[];
	matter?: string;
	file: string;
	line?: number;
	ref?: string;
	confidence: LegalEvent['confidence'];
	kind?: string;
	track?: string;
	contributedBy: string;
	sensitive?: boolean;
}

interface NoteEntry {
	type?: string;
	frontmatter?: Record<string, unknown>;
	inline: RawEvent[];
	/** Events from each source, by source id. */
	sourced: Map<string, RawEvent[]>;
	problems: EventProblem[];
}

/** A short, stable hash (FNV-1a, 32 bits) for event ids. */
export function hashId(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(36);
}

function typeOf(frontmatter: Record<string, unknown> | undefined): string | undefined {
	const t = frontmatter?.type;
	return typeof t === 'string' ? t.trim().toLowerCase() : undefined;
}

function folderOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

export function compareEvents(a: LegalEvent, b: LegalEvent): number {
	return compareDates(a.date, b.date) || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export class EventIndex {
	private notes = new Map<string, NoteEntry>();
	private sources = new Map<string, LegalEventSource>();
	private listeners = new Set<(c: EventChange) => void>();
	private cache: LegalEvent[] | null = null;
	private byId: Map<string, LegalEvent> | null = null;
	private batching = 0;
	private isReady = false;

	constructor(private resolver: Resolver) {}

	// --- notes ---------------------------------------------------------------------------------------

	/** Add or replace a note's events. */
	update(note: IndexedNote): void {
		const before = this.idsOf(note.path);
		const entry: NoteEntry = { type: typeOf(note.frontmatter), frontmatter: note.frontmatter, inline: [], sourced: new Map(), problems: [] };
		if (note.text !== undefined) this.readInline(note.path, note.text, entry);
		else {
			// No text given (the note has no list items): keep the inline events it had, if any.
			const old = this.notes.get(note.path);
			if (old) { entry.inline = old.inline; entry.problems = old.problems; }
		}
		for (const s of this.sources.values()) entry.sourced.set(s.id, this.runSource(s, note.path, entry));
		this.notes.set(note.path, entry);
		this.changed(note.path, before);
	}

	remove(path: string): void {
		if (!this.notes.has(path)) return;
		const before = this.idsOf(path);
		this.notes.delete(path);
		this.changed(null, before);
	}

	/** A note was renamed or moved: its events keep their place, under ids with the new path. */
	rename(oldPath: string, newPath: string): void {
		const entry = this.notes.get(oldPath);
		if (!entry) return;
		const before = this.idsOf(oldPath);
		this.notes.delete(oldPath);
		const rekey = (e: RawEvent): RawEvent => ({ ...e, id: newPath + e.id.slice(oldPath.length), file: newPath });
		entry.inline = entry.inline.map(rekey);
		for (const [k, list] of entry.sourced) entry.sourced.set(k, list.map(rekey));
		entry.problems = entry.problems.map((p) => ({ ...p, file: newPath }));
		this.notes.set(newPath, entry);
		this.changed(newPath, before);
	}

	/** Apply many changes and notify once (the first full pass). */
	batch(fn: () => void): void {
		this.batching++;
		try {
			fn();
		} finally {
			this.batching--;
		}
		if (this.batching === 0) this.emit({ added: [], removed: [], reset: true });
	}

	/** Links may now point elsewhere (notes created or renamed): work them out again on the next query. */
	relink(): void {
		this.invalidate();
	}

	setReady(ready = true): void {
		this.isReady = ready;
		if (ready) this.emit({ added: [], removed: [], reset: true });
	}

	ready(): boolean {
		return this.isReady;
	}

	// --- sources -------------------------------------------------------------------------------------

	/** Add an event source; its events are worked out for every note now. Returns a function that removes it. */
	registerSource(source: LegalEventSource): () => void {
		if (!source || typeof source.id !== 'string' || !source.id.trim() || typeof source.events !== 'function') throw new Error('An event source needs an id and an events() function.');
		if (this.sources.has(source.id)) throw new Error(`An event source with the id "${source.id}" is already registered.`);
		this.sources.set(source.id, source);
		for (const [path, entry] of this.notes) entry.sourced.set(source.id, this.runSource(source, path, entry));
		this.invalidate();
		this.emit({ added: [], removed: [], reset: true });
		return () => {
			if (this.sources.get(source.id) !== source) return;
			this.sources.delete(source.id);
			for (const entry of this.notes.values()) entry.sourced.delete(source.id);
			this.invalidate();
			this.emit({ added: [], removed: [], reset: true });
		};
	}

	// --- queries -------------------------------------------------------------------------------------

	/** Events matching the query, in date order (see compareDates), then by title. */
	query(q: EventQuery = {}): LegalEvent[] {
		const all = this.all();
		const matter = q.matter ? this.target(q.matter) : undefined;
		const work = q.work ? this.target(q.work) : undefined;
		const party = q.party ? this.target(q.party) : undefined;
		const period = q.from || q.to ? parseDate(`${q.from ?? ''}..${q.to ?? ''}`) : null;
		if (period && !period.ok) throw new Error(`The period ${q.from ?? ''}..${q.to ?? ''} is not valid: ${period.reason}.`);
		const kinds = q.kinds ? new Set(q.kinds) : null;
		const tracks = q.tracks ? new Set(q.tracks) : null;
		const conf = q.confidence ? new Set(q.confidence) : null;
		return all.filter((e) => {
			if (e.sensitive && !q.includeSensitive) return false;
			if (q.file && e.source.file !== q.file) return false;
			if (matter && e.matter !== matter) return false;
			if (work && !e.works.includes(work)) return false;
			if (party && !e.parties.includes(party)) return false;
			if (kinds && (!e.kind || !kinds.has(e.kind))) return false;
			if (tracks && (!e.track || !tracks.has(e.track))) return false;
			if (conf && !conf.has(e.confidence)) return false;
			if (period && period.ok && !overlaps(e.date, period.date)) return false;
			return true;
		});
	}

	get(id: string): LegalEvent | null {
		this.all();
		return this.byId!.get(id) ?? null;
	}

	/** Problems found in lines that look like events. */
	problems(path?: string): EventProblem[] {
		if (path) return [...(this.notes.get(path)?.problems ?? [])];
		return [...this.notes.values()].flatMap((n) => n.problems);
	}

	/** The `type` of an indexed note, from its frontmatter. */
	typeOf(path: string): string | undefined {
		return this.notes.get(path)?.type;
	}

	/** Paths of indexed notes with this `type`. */
	notesOfType(type: string): string[] {
		return [...this.notes].filter(([, n]) => n.type === type).map(([p]) => p);
	}

	subscribe(fn: (c: EventChange) => void): () => void {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	}

	// --- internals -----------------------------------------------------------------------------------

	private readInline(path: string, text: string, entry: NoteEntry) {
		const { events, problems } = parseInlineEvents(text);
		const seen = new Map<string, number>();
		for (const d of events) {
			let id: string;
			if (d.blockId) id = `${path}#^${d.blockId}`;
			else {
				const base = `${path}#e-${hashId(`${d.date.start ?? ''}|${d.date.end ?? ''}|${d.title}`)}`;
				const n = (seen.get(base) ?? 0) + 1;
				seen.set(base, n);
				id = n === 1 ? base : `${base}-${n}`;
			}
			entry.inline.push({
				id, date: d.date, title: d.title, links: d.links, works: d.works, parties: d.parties, matter: d.matter,
				file: path, line: d.line, ref: d.ref, confidence: d.confidence, kind: d.kind, track: d.track, contributedBy: 'inline',
			});
		}
		entry.problems = problems.map((p) => ({ file: path, line: p.line, message: p.message }));
	}

	private runSource(source: LegalEventSource, path: string, entry: NoteEntry): RawEvent[] {
		if (source.types && (!entry.type || !source.types.includes(entry.type))) return [];
		let inputs: EventInput[];
		try {
			inputs = source.events({ path, frontmatter: entry.frontmatter });
		} catch {
			// A failing source never breaks the index (and its error may describe the note: not logged).
			return [];
		}
		const out: RawEvent[] = [];
		for (const input of inputs ?? []) {
			const date = typeof input.date === 'string' ? parseDate(input.date) : { ok: true as const, date: input.date };
			if (!date.ok || !input.title || !input.key) continue;
			out.push({
				id: `${path}#${source.id}:${input.key}`,
				date: date.date,
				title: input.title,
				links: [],
				works: input.works ?? [],
				parties: input.parties ?? [],
				matter: input.matter,
				file: path,
				line: input.line,
				ref: input.ref,
				confidence: input.confidence ?? 'confirmed',
				kind: input.kind,
				track: input.track,
				contributedBy: source.id,
				...(input.sensitive ? { sensitive: true } : {}),
			});
		}
		return out;
	}

	private idsOf(path: string): string[] {
		const entry = this.notes.get(path);
		if (!entry) return [];
		return [...entry.inline, ...[...entry.sourced.values()].flat()].map((e) => e.id);
	}

	private changed(path: string | null, before: string[]) {
		this.invalidate();
		if (this.batching > 0 || this.listeners.size === 0) return;
		const added = path ? this.query({ file: path, includeSensitive: true }) : [];
		const now = new Set(added.map((e) => e.id));
		this.emit({ added, removed: before.filter((id) => !now.has(id)) });
	}

	private emit(change: EventChange) {
		for (const fn of [...this.listeners]) {
			try {
				fn(change);
			} catch {
				// A listener's failure is its own.
			}
		}
	}

	private invalidate() {
		this.cache = null;
		this.byId = null;
	}

	/** A link or path, as the path of a note if it can be resolved. */
	private target(link: string): string {
		const inner = /^\[\[([^\]|#^]+)/.exec(link.trim())?.[1] ?? link.trim();
		if (this.notes.has(inner)) return inner;
		return this.resolver.resolve(inner, '') ?? inner;
	}

	/** Every event, with its links and matter worked out, sorted; cached until something changes. */
	private all(): LegalEvent[] {
		if (this.cache) return this.cache;
		// Matters by folder: an event belongs to the matter whose note is in the nearest folder above it.
		const matterByFolder = new Map<string, string>();
		for (const [p, n] of this.notes) if (n.type === 'matter') matterByFolder.set(folderOf(p), p);
		const folderMatter = (file: string): string | undefined => {
			let dir = folderOf(file);
			for (;;) {
				const m = matterByFolder.get(dir);
				if (m) return m;
				if (!dir) return undefined;
				dir = folderOf(dir);
			}
		};
		const resolve = (link: string, from: string) => this.resolver.resolve(link, from) ?? link;
		const out: LegalEvent[] = [];
		for (const [path, entry] of this.notes) {
			for (const raw of [...entry.inline, ...[...entry.sourced.values()].flat()]) {
				const works = new Set(raw.works.map((w) => resolve(w, path)));
				const parties = new Set(raw.parties.map((p) => resolve(p, path)));
				let matter = raw.matter ? resolve(raw.matter, path) : undefined;
				for (const link of raw.links) {
					const target = resolve(link, path);
					const type = this.notes.get(target)?.type;
					if (type === 'work') works.add(target);
					else if (type === 'matter') matter ??= target;
					else if (type !== 'licence' && !works.has(target) && target !== matter) parties.add(target);
				}
				matter ??= folderMatter(path);
				out.push({
					id: raw.id,
					date: raw.date,
					title: raw.title,
					parties: [...parties].filter((p) => !works.has(p) && p !== matter),
					works: [...works],
					...(matter ? { matter } : {}),
					source: { file: raw.file, ...(raw.line !== undefined ? { line: raw.line } : {}), ...(raw.ref ? { ref: raw.ref } : {}) },
					confidence: raw.confidence,
					...(raw.kind ? { kind: raw.kind } : {}),
					...(raw.track ? { track: raw.track } : {}),
					contributedBy: raw.contributedBy,
					...(raw.sensitive ? { sensitive: true } : {}),
				});
			}
		}
		out.sort(compareEvents);
		this.cache = out;
		this.byId = new Map(out.map((e) => [e.id, e]));
		return out;
	}
}
