import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { Document, Packer, Paragraph } from 'docx';
import { strFromU8, unzipSync } from 'fflate';
import type { LegalExtension } from '@legal-core/api';
import { AuthorityStore, FileBackend, MemoryBackend, authorityId, type AuthorityFs } from '@legal-core/authority-store';
import { DEFAULT_EXPORT, type ExportOptions } from '@legal-core/aglc';
import { TransformOrderError, orderTransforms } from '@legal-core/md-pipeline';
import { TemplateError, mergeStyles, styleIds } from '@legal-core/docx-engine';
import { satisfies } from '../src/semver';
import { API_VERSION, createLegalCoreApi } from '../src/api';
import { outputs, prettyXml, stableIds } from './golden.test';

function core(files: Record<string, string> = {}) {
	let selected: string | null = null;
	const api = createLegalCoreApi(new AuthorityStore(new MemoryBackend()), {
		readFile: async (f) => files[f.path] ?? '',
		selectedTemplate: () => selected,
		saveSelectedTemplate: (id) => { selected = id; },
	});
	return api;
}

async function documentXml(bytes: Uint8Array): Promise<string> {
	return strFromU8(unzipSync(bytes)['word/document.xml']!);
}

describe('semver ranges', () => {
	const cases: [string, string, boolean][] = [
		['1.0.0', '^1.0', true], ['1.4.2', '^1.0', true], ['2.0.0', '^1.0', false], ['0.9.0', '^1.0', false],
		['1.2.3', '~1.2.0', true], ['1.3.0', '~1.2.0', false], ['1.9.0', '~1', true],
		['0.2.5', '^0.2.3', true], ['0.3.0', '^0.2.3', false], ['0.0.3', '^0.0.3', true], ['0.0.4', '^0.0.3', false],
		['1.1.0', '>=1.1.0 <2', true], ['2.0.0', '>=1.1.0 <2', false], ['1.0.9', '>1.0.8', true], ['1.0.8', '>1.0.8', false],
		['1.5.0', '1.x', true], ['2.0.0', '1.x', false], ['1.2.9', '1.2.*', true], ['1.3.0', '1.2', false], ['7.0.0', '*', true],
		['1.0.0', '1.0.0', true], ['1.0.1', '1.0.0', false], ['3.0.0', '^1.0 || ^3.0', true], ['2.0.0', '^1.0 || ^3.0', false],
		['1.0.0', 'nonsense', false], ['banana', '^1.0', false], ['1.0.0', '', false],
	];
	it.each(cases)('%s satisfies "%s": %s', (version, range, expected) => {
		expect(satisfies(version, range)).toBe(expected);
	});
	it('reports the API version', () => {
		const api = core();
		expect(api.version).toBe(API_VERSION);
		expect(api.satisfies('^1.0')).toBe(true);
		expect(api.satisfies('^2.0')).toBe(false);
	});
});

describe('authority store', () => {
	const mabo = (pinpointFree = true) => ({
		kind: 'case' as const,
		title: '*Mabo v Queensland [No 2]*',
		citation: pinpointFree ? '*Mabo v Queensland [No 2]* (1992) 175 CLR 1' : '*Mabo v Queensland [No 2]* (1992) 175 CLR 1, 42',
		key: { year: '1992', volume: '175', series: 'CLR', page: '1' },
		source: 'aglc-citations',
	});

	it('gives the same source the same id, however it is written', () => {
		expect(authorityId(mabo())).toBe(authorityId({ ...mabo(), title: 'Mabo  v Queensland [No 2]' }));
		expect(authorityId(mabo())).not.toBe(authorityId({ ...mabo(), key: { ...mabo().key, page: '2' } }));
	});

	it('merges what different plugins write, and never drops another plugin\'s data', async () => {
		let now = 1000;
		const store = new AuthorityStore(new MemoryBackend(), () => now);
		const a = await store.upsert({ ...mabo(), notePath: 'Essay.md' });
		now = 2000;
		const b = await store.upsert({ ...mabo(), source: 'case-notes', notePath: 'Case notes/Mabo.md', fields: { court: 'High Court of Australia' } });
		expect(b.id).toBe(a.id);
		expect(b.sources).toEqual(['aglc-citations', 'case-notes']);
		expect(b.notes).toEqual(['Essay.md', 'Case notes/Mabo.md']);
		expect(b.fields.court).toBe('High Court of Australia');
		expect([b.created, b.updated]).toEqual([1000, 2000]);
		expect(await store.query()).toHaveLength(1);
	});

	it('queries by kind, words, source and note', async () => {
		const store = new AuthorityStore(new MemoryBackend());
		await store.upsert({ ...mabo(), notePath: 'Essay.md' });
		await store.upsert({ kind: 'legislation', title: '*Native Title Act 1993*', citation: '*Native Title Act 1993* (Cth)', key: { jurisdiction: 'Cth' }, source: 'aglc-citations' });
		expect((await store.query({ kind: 'legislation' })).map((r) => r.title)).toEqual(['*Native Title Act 1993*']);
		expect((await store.query({ text: 'mabo queensland' })).length).toBe(1);
		expect((await store.query({ text: 'mabo wik' })).length).toBe(0);
		expect((await store.query({ source: 'case-notes' })).length).toBe(0);
		expect((await store.query({ notePath: 'Essay.md' })).length).toBe(1);
	});

	it('tells subscribers of changes, but not of an upsert that changes nothing', async () => {
		const store = new AuthorityStore(new MemoryBackend());
		const seen = vi.fn();
		const stop = store.subscribe(seen);
		const r = await store.upsert(mabo());
		await store.upsert(mabo());
		expect(seen).toHaveBeenCalledTimes(1);
		await store.remove(r.id);
		expect(seen).toHaveBeenLastCalledWith({ type: 'remove', id: r.id });
		stop();
		await store.upsert(mabo());
		expect(seen).toHaveBeenCalledTimes(2);
	});

	/** A file system in memory; `failRename` makes the next rename fail, like a crash part-way through a save. */
	class MemFs implements AuthorityFs {
		files = new Map<string, string>();
		folders = new Set<string>();
		failRename = false;
		async exists(p: string) { return this.files.has(p) || this.folders.has(p); }
		async read(p: string) { return this.files.get(p)!; }
		async write(p: string, d: string) { this.files.set(p, d); }
		async remove(p: string) { this.files.delete(p); }
		async rename(a: string, b: string) { if (this.failRename) { this.failRename = false; throw new Error('crash'); } this.files.set(b, this.files.get(a)!); this.files.delete(a); }
		async mkdir(p: string) { this.folders.add(p); }
	}

	it('saves to a vault file, and survives a crash part-way through a save', async () => {
		const fs = new MemFs();
		const path = '.legal-core/authorities.json';
		await new AuthorityStore(new FileBackend(fs, path)).upsert(mabo());
		expect(fs.folders.has('.legal-core')).toBe(true);
		expect(JSON.parse(fs.files.get(path)!).records).toHaveLength(1);
		// A crash after the old file is removed and before the new one is renamed into place.
		fs.failRename = true;
		await new AuthorityStore(new FileBackend(fs, path)).upsert({ ...mabo(), source: 'case-notes' }).catch(() => undefined);
		expect(fs.files.has(path)).toBe(false);
		const again = new AuthorityStore(new FileBackend(fs, path));
		const [r] = await again.query();
		expect(r!.sources).toEqual(['aglc-citations', 'case-notes']);
	});
});

describe('extensions', () => {
	const caseNotes: LegalExtension = {
		id: 'case-notes',
		syntax: [
			{ type: 'fence', lang: 'case-note', parse: (src) => [{ t: 'custom', kind: 'case-note', data: Object.fromEntries(src.trim().split('\n').map((l) => l.split(': ') as [string, string])) }] },
			{ type: 'inline', pattern: /\{\{held\}\}/g, parse: () => [{ t: 'strong', c: [{ t: 'text', v: 'Held:' }] }] },
		],
		renderers: [{
			kind: 'case-note',
			block: (data) => {
				const d = data as Record<string, string>;
				return [{ t: 'heading', level: 3, c: [{ t: 'em', c: [{ t: 'text', v: d.case ?? '' }] }] }, { t: 'para', c: [{ t: 'text', v: `Facts: ${d.facts ?? ''}` }] }];
			},
		}],
		transforms: [{ id: 'stamp', fn: (doc) => { doc.blocks.push({ t: 'para', c: [{ t: 'text', v: 'Case note ends.' }] }); } }],
	};
	const note = 'Intro paragraph.\n\n```case-note\ncase: Mabo v Queensland [No 2]\nfacts: The Meriam people\'s claim.\n```\n\n{{held}} native title survives.\n';

	it('reads syntax, renders custom nodes and runs transforms in an export', async () => {
		const api = core();
		api.registerExtension(caseNotes);
		const xml = await documentXml(await api.exportDocx(note));
		expect(xml).toContain('Mabo v Queensland [No 2]');
		expect(xml).toContain('Facts: The Meriam people’s claim.');
		expect(xml).toMatch(/<w:b\/>[\s\S]*?Held:/);
		expect(xml.indexOf('Intro paragraph.')).toBeLessThan(xml.indexOf('Case note ends.'));
		expect(xml).not.toContain('case-note');
	});

	it('reads a note given as a file', async () => {
		const api = core({ 'Notes/Mabo.md': note });
		api.registerExtension(caseNotes);
		expect(await documentXml(await api.exportDocx({ path: 'Notes/Mabo.md' }))).toContain('Facts: The Meriam');
	});

	it('orders transforms by their dependencies across extensions, whatever order they register in', async () => {
		const api = core();
		const order: string[] = [];
		const quotes: Record<string, string> = {};
		const text = (doc: { blocks: { t: string; c?: { t: string; v?: string }[] }[] }) => doc.blocks[0]!.c![0]!.v!;
		// "b" registers first, though its "second" step depends on a step of "a".
		api.registerExtension({ id: 'b', transforms: [
			{ id: 'second', after: ['a:first'], fn: () => { order.push('b:second'); } },
			{ id: 'early', after: ['aglc-headings'], before: ['aglc-ordinals'], fn: (doc) => { order.push('b:early'); quotes.early = text(doc as never); } },
		] });
		api.registerExtension({ id: 'a', transforms: [{ id: 'first', fn: (doc) => { order.push('a:first'); quotes.late = text(doc as never); } }] });
		await api.exportDocx("It's.");
		expect(order.indexOf('a:first')).toBeLessThan(order.indexOf('b:second'));
		expect(order).toHaveLength(3);
		// A step placed before the typography sees straight quotes; one with no placement runs after it.
		expect(quotes).toEqual({ early: "It's.", late: 'It’s.' });
	});

	it('rejects a duplicate id, a cycle or a missing dependency when it is registered', () => {
		const api = core();
		api.registerExtension({ id: 'x' });
		expect(() => api.registerExtension({ id: 'x' })).toThrow(/already registered/);
		expect(() => api.registerExtension({ id: 'loop', transforms: [{ id: 'p', after: ['loop:q'], fn: () => {} }, { id: 'q', after: ['loop:p'], fn: () => {} }] })).toThrow(TransformOrderError);
		// A rejected extension leaves nothing behind.
		expect(api.extensionIds()).toEqual(['x']);
	});

	it('allows a dependency on an extension that is not installed', async () => {
		const api = core();
		const ran = vi.fn();
		api.registerExtension({ id: 'lonely', transforms: [{ id: 'p', after: ['not-installed:step'], fn: ran }] });
		await api.exportDocx('Text.');
		expect(ran).toHaveBeenCalledTimes(1);
	});

	it('stops applying an extension once it is removed', async () => {
		const api = core();
		const remove = api.registerExtension(caseNotes);
		remove();
		const xml = await documentXml(await api.exportDocx(note));
		expect(xml).not.toContain('Facts:');
		expect(api.extensionIds()).toEqual([]);
	});

	it('writes raw Word XML as it is, and its fallback in footnotes', async () => {
		const api = core();
		api.registerExtension({
			id: 'raw',
			syntax: [{ type: 'fence', lang: 'ooxml', parse: (src) => [{ t: 'ooxml', xml: src.trim(), fallback: [{ t: 'para', c: [{ t: 'text', v: 'Fallback' }] }] }] }],
		});
		const xml = await documentXml(await api.exportDocx('```ooxml\n<w:p><w:r><w:t>Raw text</w:t></w:r></w:p>\n```\n'));
		expect(xml).toContain('<w:p><w:r><w:t>Raw text</w:t></w:r></w:p>');
		expect(xml).not.toContain('Fallback');
	});

	it('orders transforms stably and reports cycles by name', () => {
		const t = (id: string, after?: string[], before?: string[]) => ({ id, after, before, run: () => {} });
		expect(orderTransforms([t('a'), t('b'), t('c', ['a'])]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
		expect(orderTransforms([t('a'), t('b'), t('c', [], ['a'])]).map((x) => x.id)).toEqual(['c', 'a', 'b']);
		expect(() => orderTransforms([t('a', [], ['b']), t('b', [], ['a'])])).toThrow(/cycle/);
		expect(orderTransforms([t('c', ['b']), t('b'), t('a')]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
		expect(() => orderTransforms([t('a', ['b']), t('b', ['a'])])).toThrow(/a → b → a/);
		expect(() => orderTransforms([t('a'), t('a')])).toThrow(/Two transforms/);
	});
});

describe('Legal Core export without extensions', () => {
	// The core's engine and AGLC4's must agree: with no extensions, the core exports exactly what AGLC4 does.
	const fixtures = new URL('fixtures/', import.meta.url);
	for (const f of readdirSync(fixtures).filter((x) => x.endsWith('.md'))) {
		it(`matches the AGLC4 golden export of ${f}`, async () => {
			const name = f.slice(0, -3);
			const optionsFile = new URL(`${name}.options.json`, fixtures);
			const opts: ExportOptions = { ...DEFAULT_EXPORT, ...(existsSync(optionsFile) ? JSON.parse(readFileSync(optionsFile, 'utf8')) : {}) };
			const markdown = readFileSync(new URL(f, fixtures), 'utf8');
			const files = unzipSync(await core().exportDocx(markdown, opts));
			const golden = await outputs(markdown, opts);
			for (const part of ['document', 'footnotes', 'styles', 'numbering']) {
				expect(prettyXml(stableIds(strFromU8(files[`word/${part}.xml`]!))), `${name}/${part}.xml`).toBe(golden[`${part}.xml`]);
				expect(golden[`${part}.xml`]).toBe(readFileSync(new URL(`golden/${name}/${part}.xml`, import.meta.url), 'utf8'));
			}
		});
	}
});

describe('templates', () => {
	async function template(): Promise<Uint8Array> {
		const doc = new Document({
			styles: { paragraphStyles: [{ id: 'Normal', name: 'Normal', run: { font: 'Arial', size: 22 } }, { id: 'FirmLetterhead', name: 'Firm Letterhead', run: { bold: true } }] },
			sections: [{ children: [new Paragraph('Template')] }],
		});
		return new Uint8Array(await Packer.toArrayBuffer(doc));
	}

	it('uses the template\'s styles, keeping the export\'s styles it lacks', async () => {
		const api = core();
		api.templates.register('firm', 'Firm style', await template());
		expect(api.templates.list()).toEqual([{ id: 'firm', name: 'Firm style' }]);
		api.templates.select('firm');
		expect(api.templates.selected()).toBe('firm');
		const bytes = await api.exportDocx('> A long quotation.[^1]\n\n[^1]: *Mabo v Queensland [No 2]* (1992) 175 CLR 1.\n');
		const styles = strFromU8(unzipSync(bytes)['word/styles.xml']!);
		const ids = styleIds(styles);
		expect(ids.has('FirmLetterhead')).toBe(true);
		expect(ids.has('AglcQuote')).toBe(true);
		// The template's Normal style wins.
		expect(/<w:style [^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/.exec(styles)![0]).toContain('Arial');
		// Choosing no template for one export.
		const plain = strFromU8(unzipSync(await api.exportDocx('Text.', { template: null }))['word/styles.xml']!);
		expect(styleIds(plain).has('FirmLetterhead')).toBe(false);
	});

	it('rejects a file that is not a Word document, and an unknown template', () => {
		const api = core();
		expect(() => api.templates.register('bad', 'Bad', new Uint8Array([1, 2, 3]))).toThrow(TemplateError);
		expect(() => api.templates.select('missing')).toThrow(/no template/);
		expect(() => mergeStyles('<w:style w:styleId="A"></w:style>', '<w:styles>')).toThrow(TemplateError);
	});
});

describe('example extension: case notes', async () => {
	const { caseNotesExtension, parseCaseNote } = await import('../examples/case-notes/src/extension');

	it('reads a case-note block', () => {
		expect(parseCaseNote('case: *Mabo v Queensland [No 2]* (1992) 175 CLR 1\nfacts: A claim.\nheld: It succeeded.')).toEqual({
			case: '*Mabo v Queensland [No 2]* (1992) 175 CLR 1',
			parts: [['facts', 'A claim.'], ['held', 'It succeeded.']],
		});
	});

	it('exports case notes, numbered, with their quotation marks curled', async () => {
		const api = core();
		api.registerExtension(caseNotesExtension);
		const note = '# Case notes\n\n```case-note\ncase: *Mabo v Queensland [No 2]* (1992) 175 CLR 1\nfacts: The Meriam people\'s claim.\nheld: Native title survived.\n```\n\n```case-note\ncase: *Wik Peoples v Queensland* (1996) 187 CLR 1\nheld: Pastoral leases did not necessarily extinguish it.\n```\n';
		const xml = await documentXml(await api.exportDocx(note));
		expect(xml).toContain('Case note 1: ');
		expect(xml).toContain('Case note 2: ');
		expect(xml).toMatch(/<w:i\/>[\s\S]*?Mabo v Queensland \[No 2\]/);
		expect(xml).toContain('The Meriam people’s claim.');
		expect(xml).toMatch(/<w:b\/>[\s\S]*?Held: /);
	});
});
