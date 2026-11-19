/**
 * Legal Core API 1.1: the shared chronology (events, event sources), exportDocument, and the indexer that
 * feeds the chronology from the vault. API 1.0 callers (asking for ^1.0) are unaffected.
 */
import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { MdDocument } from '@legal-core/api';
import { AuthorityStore, MemoryBackend } from '@legal-core/authority-store';
import { EventIndex } from '@legal-core/chronology';
import { createLegalCoreApi } from '../src/api';
import { VaultIndexer } from '../src/events';
import * as obsidian from './obsidian-stub';

(globalThis as { window?: unknown }).window ??= globalThis;

function core(index?: EventIndex) {
	return createLegalCoreApi(new AuthorityStore(new MemoryBackend()), { readFile: async () => '', selectedTemplate: () => null, saveSelectedTemplate: () => {} }, index);
}

describe('API version', () => {
	it('is 1.1.0, and still satisfies the ranges 1.0 callers ask for', () => {
		const api = core();
		expect(api.version).toBe('1.1.0');
		expect(api.satisfies('^1.0')).toBe(true);
		expect(api.satisfies('^1.1')).toBe(true);
		expect(api.satisfies('^1.2')).toBe(false);
	});
});

describe('events through the API', () => {
	it('queries the index, and adds and removes event sources', () => {
		const index = new EventIndex({ resolve: () => null });
		const api = core(index);
		index.update({ path: 'c.md', text: '- 2019-03-14 :: Demo recorded {track=client conf=confirmed}' });
		index.update({ path: 'L.md', frontmatter: { type: 'licence', end: '2024-06-30' } });
		const off = api.registerEventSource({ id: 'rights', types: ['licence'], events: ({ frontmatter }) => [{ key: 'end', date: String(frontmatter?.end), title: 'Licence ends', kind: 'licence-end' }] });
		expect(api.events.query().map((e) => e.title)).toEqual(['Demo recorded', 'Licence ends']);
		expect(api.events.query({ tracks: ['client'] })).toHaveLength(1);
		expect(api.events.get('L.md#rights:end')!.kind).toBe('licence-end');
		const seen = vi.fn();
		api.events.subscribe(seen);
		off();
		expect(seen).toHaveBeenCalledWith({ added: [], removed: [], reset: true });
		expect(api.events.query()).toHaveLength(1);
	});

	it('reports problems and readiness', () => {
		const index = new EventIndex({ resolve: () => null });
		const api = core(index);
		index.update({ path: 'a.md', text: '- 2019-02-30 :: Bad' });
		expect(api.events.problems('a.md')[0]!.message).toContain('no day 30');
		expect(api.events.ready()).toBe(false);
		index.setReady();
		expect(api.events.ready()).toBe(true);
	});
});

describe('exportDocument', () => {
	const doc = (): MdDocument => ({
		blocks: [
			{ t: 'heading', level: 1, c: [{ t: 'text', v: 'Chronology' }] },
			{ t: 'table', header: [[{ t: 'text', v: 'Date' }], [{ t: 'text', v: 'Event' }]], rows: [[[{ t: 'text', v: '14 Mar 2019' }], [{ t: 'text', v: "The artist's 2nd demo" }]]] },
		],
		footnotes: new Map(),
		frontmatter: {},
	});

	it('writes a document built in the model, with Legal Core\'s typography, leaving it unchanged', async () => {
		const input = doc();
		const bytes = await core().exportDocument(input);
		const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
		expect(xml).toContain('<w:tbl>');
		expect(xml).toContain('The artist’s 2');
		expect(xml).toMatch(/<w:vertAlign w:val="superscript"\/>[\s\S]*?nd/);
		expect(input).toEqual(doc());
	});
});

describe('vault indexer', () => {
	/** A vault and metadata cache in memory, with Obsidian's events. */
	function fakeApp(files: Record<string, { text: string; frontmatter?: Record<string, unknown> }>) {
		const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
		const on = (name: string) => (fn: (...a: unknown[]) => void) => { handlers.set(name, [...(handlers.get(name) ?? []), fn]); return {}; };
		const tfiles = new Map<string, obsidian.TFile>();
		for (const p of Object.keys(files)) tfiles.set(p, new obsidian.TFile(p));
		const cacheOf = (p: string) => {
			const f = files[p];
			if (!f) return null;
			return { frontmatter: f.frontmatter, listItems: f.text.includes('- ') ? [{}] : undefined };
		};
		let layoutReady: (() => void) | null = null;
		const reads: string[] = [];
		const app = {
			vault: {
				getMarkdownFiles: () => [...tfiles.values()],
				cachedRead: async (f: obsidian.TFile) => { reads.push(f.path); return files[f.path]!.text; },
				getAbstractFileByPath: (p: string) => tfiles.get(p) ?? null,
				on: (name: string, fn: (...a: unknown[]) => void) => on(`vault:${name}`)(fn),
			},
			metadataCache: {
				getFileCache: (f: obsidian.TFile) => cacheOf(f.path),
				getFirstLinkpathDest: (link: string) => { for (const p of tfiles.keys()) if (p.endsWith(`${link}.md`)) return { path: p }; return null; },
				on: (name: string, fn: (...a: unknown[]) => void) => on(`cache:${name}`)(fn),
			},
			workspace: { onLayoutReady: (fn: () => void) => { layoutReady = fn; } },
		};
		const emit = (name: string, ...args: unknown[]) => { for (const h of handlers.get(name) ?? []) h(...args); };
		const change = (p: string, text: string, frontmatter?: Record<string, unknown>) => {
			files[p] = { text, frontmatter };
			if (!tfiles.has(p)) tfiles.set(p, new obsidian.TFile(p));
			emit('cache:changed', tfiles.get(p), text, cacheOf(p));
		};
		return { app: app as never, emit, change, tfiles, reads, ready: () => layoutReady!() };
	}

	const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };

	it('indexes the vault once the workspace is ready, reading only notes with list items', async () => {
		const v = fakeApp({
			'Works/Song X.md': { text: 'No list here.', frontmatter: { type: 'work' } },
			'Matters/M/M.md': { text: 'Matter note', frontmatter: { type: 'matter' } },
			'Matters/M/Chronology.md': { text: '- 2019-03-14 :: Demo of [[Song X]] {track=client}' },
		});
		const ix = new VaultIndexer(v.app);
		ix.start({ registerEvent: () => undefined } as never);
		expect(ix.index.ready()).toBe(false);
		v.ready();
		await settle();
		expect(ix.index.ready()).toBe(true);
		expect(v.reads).toEqual(['Matters/M/Chronology.md']);
		expect(ix.index.query()).toEqual([expect.objectContaining({ works: ['Works/Song X.md'], matter: 'Matters/M/M.md' })]);
	});

	it('keeps up with changes (including during the first pass), renames and deletes', async () => {
		const v = fakeApp({ 'a.md': { text: '- 2020 :: Before ^a' } });
		const ix = new VaultIndexer(v.app);
		ix.start({ registerEvent: () => undefined } as never);
		// A change while the first pass has not finished is not lost.
		v.change('b.md', '- 2021 :: Written during the first pass ^b');
		v.ready();
		await settle();
		expect(ix.index.query().map((e) => e.title)).toEqual(['Before', 'Written during the first pass']);
		v.change('a.md', '- 2020 :: After ^a');
		expect(ix.index.get('a.md#^a')!.title).toBe('After');
		const renamed = v.tfiles.get('a.md')!;
		renamed.path = 'folder/a.md';
		v.emit('vault:rename', renamed, 'a.md');
		expect(ix.index.get('folder/a.md#^a')).not.toBeNull();
		v.emit('cache:deleted', renamed);
		expect(ix.index.get('folder/a.md#^a')).toBeNull();
		// A note whose list items are removed loses its events.
		v.change('b.md', 'No list now.');
		expect(ix.index.query()).toEqual([]);
	});
});
