/**
 * Feeds the event index from the vault: a first full pass once the workspace is ready, then each change
 * as it happens. Notes are the only source of truth; the index lives in memory and is rebuilt each time
 * Obsidian starts, so there is nothing on disk to go stale.
 */
import { type App, type CachedMetadata, type Plugin, TFile } from 'obsidian';
import { EventIndex } from '@legal-core/chronology';

/** Notes read per step of the first pass, before yielding to the app. */
const CHUNK = 200;

/** Whether a note can contain inline events: only list items can. */
function mayHaveEvents(cache: CachedMetadata | null): boolean {
	return (cache?.listItems?.length ?? 0) > 0;
}

export class VaultIndexer {
	readonly index: EventIndex;
	private stopped = false;
	/** Notes changed during the first pass, indexed again when it ends. */
	private pending = new Set<string>();

	constructor(private app: App) {
		this.index = new EventIndex({
			resolve: (link, from) => this.app.metadataCache.getFirstLinkpathDest(link, from)?.path ?? null,
		});
	}

	/** Start indexing once the workspace is ready, and keep the index up to date. */
	start(plugin: Plugin) {
		const { metadataCache, vault, workspace } = this.app;
		plugin.registerEvent(metadataCache.on('changed', (file, data, cache) => {
			if (!this.index.ready()) { this.pending.add(file.path); return; }
			this.index.update({ path: file.path, frontmatter: cache.frontmatter, text: mayHaveEvents(cache) ? data : '' });
		}));
		plugin.registerEvent(metadataCache.on('deleted', (file) => { this.index.remove(file.path); }));
		plugin.registerEvent(vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md') this.index.rename(oldPath, file.path);
			this.index.relink();
		}));
		plugin.registerEvent(metadataCache.on('resolved', () => { this.index.relink(); }));
		workspace.onLayoutReady(() => { void this.fullPass(); });
	}

	stop() {
		this.stopped = true;
	}

	/** Index every note, in chunks, yielding between them so the app stays responsive. */
	private async fullPass() {
		const files = this.app.vault.getMarkdownFiles();
		for (let i = 0; i < files.length && !this.stopped; i += CHUNK) {
			const chunk = files.slice(i, i + CHUNK);
			const notes = await Promise.all(chunk.map(async (file) => {
				const cache = this.app.metadataCache.getFileCache(file);
				const text = mayHaveEvents(cache) ? await this.app.vault.cachedRead(file) : '';
				return { path: file.path, frontmatter: cache?.frontmatter, text };
			}));
			this.index.batch(() => { for (const n of notes) this.index.update(n); });
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		}
		// Notes changed while the pass was running: read them again, as they are now.
		const changed = [...this.pending].map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
		this.pending.clear();
		for (const file of changed) {
			if (this.stopped) return;
			const cache = this.app.metadataCache.getFileCache(file);
			this.index.update({ path: file.path, frontmatter: cache?.frontmatter, text: mayHaveEvents(cache) ? await this.app.vault.cachedRead(file) : '' });
		}
		if (!this.stopped) this.index.setReady();
	}
}
