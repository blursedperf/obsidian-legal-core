/**
 * The authority store: the cases, legislation and secondary sources a user's legal work relies on,
 * shared between the plugins of the suite. Each record has a stable id derived from what identifies the
 * source, so two plugins that see the same citation write to the same record.
 *
 * Records are kept in memory and saved through a back end: in memory (tests), or a JSON file in the vault,
 * written atomically (to "<file>.tmp", then renamed over the old file) and read back from the ".tmp" copy
 * if the main file is missing or damaged, so a crash part-way through a save loses nothing.
 */

export type AuthorityKind = 'case' | 'legislation' | 'secondary';

export interface AuthorityInput {
	kind: AuthorityKind;
	/** What the source is called: a case name, the title of an Act, the title of an article or book. */
	title: string;
	/** The full citation, in Markdown (italics as `*…*`), in the AGLC4 form. */
	citation: string;
	/**
	 * The parts that identify the source, which with its kind and title make up its id: for a reported
	 * case, the year, volume, report series and starting page (or, with a medium neutral citation, the
	 * year, court and judgment number); for legislation, the year and jurisdiction; for a secondary source,
	 * its authors and year. Write them the same way every time, so the same source gets the same id.
	 */
	key: Record<string, string>;
	/** Other details, which do not change the id and are merged with what is already stored. */
	fields?: Record<string, string>;
	/** The plugin writing the record (eg "aglc-citations"). */
	source: string;
	/** A note that cites it, if any. */
	notePath?: string;
}

export interface AuthorityRecord {
	id: string;
	kind: AuthorityKind;
	title: string;
	citation: string;
	key: Record<string, string>;
	fields: Record<string, string>;
	/** Plugins that have written the record. */
	sources: string[];
	/** Notes that cite it. */
	notes: string[];
	created: number;
	updated: number;
}

export interface AuthorityQuery {
	kind?: AuthorityKind;
	/** Words that must all appear in the title or citation (case-insensitive). */
	text?: string;
	/** Only records written by this plugin. */
	source?: string;
	/** Only records cited by this note. */
	notePath?: string;
}

export type AuthorityEvent =
	| { type: 'upsert'; record: AuthorityRecord }
	| { type: 'remove'; id: string };

/** Where records are saved. */
export interface AuthorityBackend {
	load(): Promise<AuthorityRecord[]>;
	save(records: AuthorityRecord[]): Promise<void>;
}

/** Plain text for comparison: no Markdown emphasis, typographic quotes as straight ones, single spaces. */
function normalise(s: string): string {
	return s.replace(/[*_]/g, '').replace(/[‘’]/g, '\'').replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The stable id of a source: its kind, title and identifying parts, normalised, so the same source cited
 * by different plugins (or with different pinpoints, or more details) gets the same id.
 */
export function authorityId(input: Pick<AuthorityInput, 'kind' | 'title' | 'key'>): string {
	const key = Object.keys(input.key).sort().map((k) => `${k}=${normalise(input.key[k]!)}`);
	return [input.kind, normalise(input.title), ...key].join('|');
}

export class AuthorityStore {
	private records = new Map<string, AuthorityRecord>();
	private listeners = new Set<(e: AuthorityEvent) => void>();
	private loaded: Promise<void> | null = null;
	private saving: Promise<void> = Promise.resolve();

	constructor(private backend: AuthorityBackend, private now: () => number = () => Date.now()) {}

	/** Load the saved records (once; later calls wait for the first). */
	load(): Promise<void> {
		this.loaded ??= this.backend.load().then((records) => {
			for (const r of records) this.records.set(r.id, r);
		});
		return this.loaded;
	}

	async get(id: string): Promise<AuthorityRecord | null> {
		await this.load();
		return this.records.get(id) ?? null;
	}

	async query(q: AuthorityQuery = {}): Promise<AuthorityRecord[]> {
		await this.load();
		const words = q.text ? normalise(q.text).split(' ').filter(Boolean) : [];
		return [...this.records.values()].filter((r) => {
			if (q.kind && r.kind !== q.kind) return false;
			if (q.source && !r.sources.includes(q.source)) return false;
			if (q.notePath && !r.notes.includes(q.notePath)) return false;
			if (words.length > 0) {
				const hay = `${normalise(r.title)} ${normalise(r.citation)}`;
				if (!words.every((w) => hay.includes(w))) return false;
			}
			return true;
		}).sort((a, b) => a.title.localeCompare(b.title));
	}

	/**
	 * Add a source, or update the record that already has its id: the citation and title are replaced, the
	 * fields merged, and the writing plugin and the note added. Never removes what other plugins wrote.
	 */
	async upsert(input: AuthorityInput): Promise<AuthorityRecord> {
		await this.load();
		const id = authorityId(input);
		const now = this.now();
		const old = this.records.get(id);
		const record: AuthorityRecord = {
			id,
			kind: input.kind,
			title: input.title,
			citation: input.citation,
			key: input.key,
			fields: { ...old?.fields, ...input.fields },
			sources: old?.sources.includes(input.source) ? old.sources : [...(old?.sources ?? []), input.source],
			notes: !input.notePath || old?.notes.includes(input.notePath) ? old?.notes ?? [] : [...(old?.notes ?? []), input.notePath],
			created: old?.created ?? now,
			updated: now,
		};
		const changed = !old || JSON.stringify({ ...old, updated: 0 }) !== JSON.stringify({ ...record, updated: 0 });
		if (!changed) return old;
		this.records.set(id, record);
		await this.persist();
		this.emit({ type: 'upsert', record });
		return record;
	}

	/** Remove a record. Only the plugin that wrote a record should remove it. */
	async remove(id: string): Promise<boolean> {
		await this.load();
		if (!this.records.delete(id)) return false;
		await this.persist();
		this.emit({ type: 'remove', id });
		return true;
	}

	/** Be told of every change. Returns a function that stops it. */
	subscribe(fn: (e: AuthorityEvent) => void): () => void {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	}

	private emit(e: AuthorityEvent) {
		for (const fn of [...this.listeners]) {
			try {
				fn(e);
			} catch (err) {
				console.error('Legal Core: an authority listener failed', err);
			}
		}
	}

	/** Saves run one at a time, each with every record. */
	private persist(): Promise<void> {
		const run = () => this.backend.save([...this.records.values()]);
		this.saving = this.saving.then(run, run);
		return this.saving;
	}
}

/** Records kept in memory only. */
export class MemoryBackend implements AuthorityBackend {
	constructor(private records: AuthorityRecord[] = []) {}
	load(): Promise<AuthorityRecord[]> { return Promise.resolve(this.records.map((r) => ({ ...r }))); }
	save(records: AuthorityRecord[]): Promise<void> { this.records = records.map((r) => ({ ...r })); return Promise.resolve(); }
}

/** The file operations the file back end needs: a subset of Obsidian's DataAdapter. */
export interface AuthorityFs {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

interface FileContents {
	version: 1;
	records: AuthorityRecord[];
}

/** Records saved as JSON in a file of the vault, written atomically. */
export class FileBackend implements AuthorityBackend {
	constructor(private fs: AuthorityFs, readonly path: string) {}

	async load(): Promise<AuthorityRecord[]> {
		for (const p of [this.path, `${this.path}.tmp`]) {
			try {
				if (!(await this.fs.exists(p))) continue;
				const data = JSON.parse(await this.fs.read(p)) as FileContents;
				if (data && Array.isArray(data.records)) return data.records;
			} catch {
				// unreadable: try the other copy
			}
		}
		return [];
	}

	async save(records: AuthorityRecord[]): Promise<void> {
		const dir = this.path.includes('/') ? this.path.slice(0, this.path.lastIndexOf('/')) : '';
		if (dir) {
			const parts = dir.split('/');
			for (let i = 1; i <= parts.length; i++) {
				const p = parts.slice(0, i).join('/');
				if (!(await this.fs.exists(p))) await this.fs.mkdir(p);
			}
		}
		const tmp = `${this.path}.tmp`;
		const contents: FileContents = { version: 1, records };
		await this.fs.write(tmp, JSON.stringify(contents, null, '\t'));
		if (await this.fs.exists(this.path)) await this.fs.remove(this.path);
		await this.fs.rename(tmp, this.path);
	}
}
