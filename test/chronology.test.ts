import { describe, expect, it, vi } from 'vitest';
import { EventIndex, type LegalEventSource, type IndexedNote, hashId, parseInlineEvents } from '@legal-core/chronology';
import { formatDate } from '@legal-core/precise-date';

describe('inline event syntax', () => {
	it('reads the example from the brief', () => {
		const { events, problems } = parseInlineEvents('- 2019-03-14 :: Demo recorded [[Song X]] {track=client conf=confirmed ref="CB 45"}');
		expect(problems).toEqual([]);
		expect(events).toHaveLength(1);
		const e = events[0]!;
		expect(formatDate(e.date)).toBe('14 Mar 2019');
		expect(e).toMatchObject({ line: 0, title: 'Demo recorded [[Song X]]', links: ['Song X'], track: 'client', confidence: 'confirmed', ref: 'CB 45' });
	});

	it('reads approximate dates, ranges, block ids, links in attributes and repeated keys', () => {
		const text = [
			'# Notes',
			'- ~2019-03 :: First draft shared with [[Jo Rivers|Jo]] {kind=creation}',
			'  * 2019-03..2019-05 :: Recording sessions {conf=probable work=[[Song X]] work="[[Song Y]]" party=[[Harbour Studio]]}',
			'- 2021-06-30 :: Option expires {kind=option-deadline matter="[[2026-014 Film option]]"} ^opt1',
			'1. 2020 :: Numbered list item',
			'- [ ] 2020-01-02 :: A task can be an event too',
		].join('\n');
		const { events, problems } = parseInlineEvents(text);
		expect(problems).toEqual([]);
		expect(events.map((e) => [e.line, formatDate(e.date), e.title])).toEqual([
			[1, 'Mar 2019 (approx.)', 'First draft shared with [[Jo Rivers|Jo]]'],
			[2, 'Mar–May 2019', 'Recording sessions'],
			[3, '30 Jun 2021', 'Option expires'],
			[4, '2020', 'Numbered list item'],
			[5, '2 Jan 2020', 'A task can be an event too'],
		]);
		expect(events[0]!.links).toEqual(['Jo Rivers']);
		expect(events[1]!).toMatchObject({ confidence: 'probable', works: ['Song X', 'Song Y'], parties: ['Harbour Studio'] });
		expect(events[2]!).toMatchObject({ blockId: 'opt1', kind: 'option-deadline', matter: '2026-014 Film option' });
		expect(events[4]!.confidence).toBe('unverified');
	});

	it('leaves ordinary notes alone', () => {
		const text = [
			'---',
			'note: - 2019-01-01 :: in frontmatter',
			'---',
			'- 2019-03-14 Demo recorded (no ::)',
			'2019-03-14 :: not a list item',
			'- Recorded :: 2019-03-14',
			'```',
			'- 2019-03-14 :: in a code block',
			'```',
			'%% - 2019-03-14 :: in a comment %%',
			'- key:: value (a Dataview field)',
		].join('\n');
		expect(parseInlineEvents(text)).toEqual({ events: [], problems: [] });
	});

	it('reports problems in lines that look like events, rather than guessing', () => {
		const { events, problems } = parseInlineEvents([
			'- 2019-02-30 :: Impossible date',
			'- 2019-03-14 :: {conf=confirmed}',
			'- 2019-03-14 :: Odd confidence {conf=certain}',
			'- 2019-03-14 :: Unknown attribute {colour=red}',
			'- 2019-03-14 :: Broken attributes {ref="unclosed}',
		].join('\n'));
		expect(problems.map((p) => [p.line, p.message])).toEqual([
			[0, 'Not an event: February 2019 has no day 30.'],
			[1, 'An event needs a title after " :: ".'],
			[2, 'conf=certain is not a confidence: use confirmed, probable or unverified.'],
			[3, 'Unknown attribute colour (kept, not used).'],
			[4, 'could not read the attributes "{ref="unclosed}": use key=value, with "quotes" around spaces'],
		]);
		expect(events.map((e) => e.title)).toEqual(['Odd confidence', 'Unknown attribute', 'Broken attributes {ref="unclosed}']);
		expect(events[0]!.confidence).toBe('unverified');
		expect(events[1]!.unknown).toEqual(['colour']);
	});
});

/** A small vault: notes by path, links resolved by name. */
function vault(notes: IndexedNote[] = []) {
	const paths = new Set<string>();
	const index = new EventIndex({
		resolve: (link) => {
			for (const p of paths) if (p === link || p === `${link}.md` || p.endsWith(`/${link}.md`)) return p;
			return null;
		},
	});
	const put = (n: IndexedNote) => { paths.add(n.path); index.update(n); };
	for (const n of notes) put(n);
	return { index, put, paths };
}

describe('event index', () => {
	it('works out works, parties and matters from the linked notes, whatever order they arrive in', () => {
		const { index, put } = vault();
		// The note with the event arrives first: the work, client and matter notes after it.
		put({ path: 'Matters/2026-001 Song X/Chronology.md', text: '- 2019-03-14 :: Demo of [[Song X]] sent to [[Jo Rivers]] {track=client}' });
		put({ path: 'Works/Song X.md', frontmatter: { type: 'work' } });
		put({ path: 'Clients/Jo Rivers.md', frontmatter: { type: 'client' } });
		put({ path: 'Matters/2026-001 Song X/2026-001 Song X.md', frontmatter: { type: 'matter' } });
		const [e] = index.query();
		expect(e).toMatchObject({
			works: ['Works/Song X.md'],
			parties: ['Clients/Jo Rivers.md'],
			matter: 'Matters/2026-001 Song X/2026-001 Song X.md',
			source: { file: 'Matters/2026-001 Song X/Chronology.md', line: 0 },
			contributedBy: 'inline',
			track: 'client',
		});
	});

	it('takes the matter from the attribute first, then a link, then the nearest folder', () => {
		const { index, put } = vault([
			{ path: 'M/A.md', frontmatter: { type: 'matter' } },
			{ path: 'M/Sub/B.md', frontmatter: { type: 'matter' } },
			{ path: 'Elsewhere/C.md', frontmatter: { type: 'matter' } },
		]);
		put({ path: 'M/Sub/Deep/notes.md', text: '- 2020 :: by folder\n- 2021 :: by link [[C]]\n- 2022 :: by attribute {matter=[[A]]}' });
		expect(index.query().map((e) => [e.title, e.matter])).toEqual([
			['by folder', 'M/Sub/B.md'],
			['by link [[C]]', 'Elsewhere/C.md'],
			['by attribute', 'M/A.md'],
		]);
	});

	it('keeps ids stable when other lines move, and numbers exact duplicates', () => {
		const { index, put } = vault();
		put({ path: 'n.md', text: '- 2020-01-01 :: Same\n- 2020-01-01 :: Same\n- 2020-02-02 :: Other ^b1' });
		const ids = index.query().map((e) => e.id);
		const base = `n.md#e-${hashId('2020-01-01|2020-01-01|Same')}`;
		expect(ids).toEqual([base, `${base}-2`, 'n.md#^b1']);
		put({ path: 'n.md', text: 'New first line\n\n- 2020-02-02 :: Other, edited ^b1\n- 2020-01-01 :: Same\n- 2020-01-01 :: Same' });
		expect(index.query().map((e) => e.id)).toEqual(ids);
		expect(index.get('n.md#^b1')!.source.line).toBe(2);
	});

	it('follows renames, and forgets deleted notes', () => {
		const { index, put } = vault();
		put({ path: 'a.md', text: '- 2020 :: Event ^x' });
		index.rename('a.md', 'folder/b.md');
		expect(index.query().map((e) => [e.id, e.source.file])).toEqual([['folder/b.md#^x', 'folder/b.md']]);
		index.remove('folder/b.md');
		expect(index.query()).toEqual([]);
	});

	it('keeps a note\'s inline events when it is updated without its text', () => {
		const { index, put } = vault();
		put({ path: 'a.md', text: '- 2020 :: Event' });
		put({ path: 'a.md', frontmatter: { type: 'work' } });
		expect(index.query()).toHaveLength(1);
		expect(index.typeOf('a.md')).toBe('work');
	});

	it('filters by matter, work, party, period, kind, track and confidence', () => {
		const { index } = vault([
			{ path: 'W.md', frontmatter: { type: 'work' } },
			{ path: 'P.md', frontmatter: { type: 'client' } },
			{ path: 'M/M.md', frontmatter: { type: 'matter' } },
			{ path: 'M/c.md', text: [
				'- 2019-03 :: March, client {track=client kind=creation conf=confirmed}',
				'- 2019-06-01 :: June, respondent [[W]] {track=respondent conf=probable}',
				'- 2020..2021 :: Long [[P]] {kind=access}',
			].join('\n') },
			{ path: 'other.md', text: '- 2019-03-15 :: Outside the matter' },
		]);
		const titles = (q: Parameters<EventIndex['query']>[0]) => index.query(q).map((e) => e.title);
		expect(titles({ matter: '[[M/M]]' })).toEqual(['March, client', 'June, respondent [[W]]', 'Long [[P]]']);
		expect(titles({ work: 'W.md' })).toEqual(['June, respondent [[W]]']);
		expect(titles({ party: '[[P]]' })).toEqual(['Long [[P]]']);
		expect(titles({ from: '2019-03-20', to: '2019-12' })).toEqual(['March, client', 'June, respondent [[W]]']);
		expect(titles({ from: '2021-06' })).toEqual(['Long [[P]]']);
		expect(titles({ kinds: ['creation', 'access'] })).toEqual(['March, client', 'Long [[P]]']);
		expect(titles({ tracks: ['respondent'] })).toEqual(['June, respondent [[W]]']);
		expect(titles({ confidence: ['unverified'] })).toEqual(['Outside the matter', 'Long [[P]]']);
		expect(() => index.query({ from: '2019-13' })).toThrow(/not valid/);
	});

	it('sorts by date at its precision: a month is not a day', () => {
		const { index } = vault([{ path: 'a.md', text: '- 2019-03-14 :: Day\n- 2019-03 :: Month\n- 2019 :: Year\n- 2019-03-01 :: First' }]);
		expect(index.query().map((e) => e.title)).toEqual(['Year', 'First', 'Month', 'Day']);
	});

	it('reports problems with the note and line', () => {
		const { index } = vault([{ path: 'a.md', text: 'x\n- 2019-02-30 :: Bad' }]);
		expect(index.problems('a.md')).toEqual([{ file: 'a.md', line: 1, message: 'Not an event: February 2019 has no day 30.' }]);
	});
});

describe('event sources', () => {
	const licences: LegalEventSource = {
		id: 'au-arts-rights',
		types: ['licence'],
		events: ({ frontmatter }) => [
			{ key: 'start', date: String(frontmatter?.start ?? ''), title: 'Licence starts', kind: 'licence-start', works: ['W'] },
			{ key: 'bad', date: '2019-02-30', title: 'Never shown' },
			{ key: 'icip', date: '2020', title: 'Consent given', sensitive: true },
		],
	};

	it('adds events from frontmatter, for notes of its types, and removes them again', () => {
		const { index, put } = vault([{ path: 'W.md', frontmatter: { type: 'work' } }]);
		put({ path: 'L.md', frontmatter: { type: 'licence', start: '2021-07-01' } });
		put({ path: 'X.md', frontmatter: { type: 'work', start: '2021-07-01' } });
		const off = index.registerSource(licences);
		expect(index.query().map((e) => [e.id, e.kind, e.works, e.contributedBy])).toEqual([
			['L.md#au-arts-rights:start', 'licence-start', ['W.md'], 'au-arts-rights'],
		]);
		// Notes added later get the source's events too.
		put({ path: 'L2.md', frontmatter: { type: 'licence', start: '2022' } });
		expect(index.query({ kinds: ['licence-start'] })).toHaveLength(2);
		off();
		expect(index.query()).toEqual([]);
	});

	it('leaves sensitive events out unless asked for', () => {
		const { index, put } = vault();
		put({ path: 'L.md', frontmatter: { type: 'licence', start: '2021' } });
		index.registerSource(licences);
		expect(index.query().some((e) => e.sensitive)).toBe(false);
		expect(index.query({ includeSensitive: true }).filter((e) => e.sensitive).map((e) => e.title)).toEqual(['Consent given']);
	});

	it('survives a failing source, and rejects a duplicate id', () => {
		const { index, put } = vault();
		put({ path: 'L.md', frontmatter: { type: 'licence' } });
		index.registerSource({ id: 'broken', events: () => { throw new Error('secret value'); } });
		expect(index.query()).toEqual([]);
		expect(() => index.registerSource({ id: 'broken', events: () => [] })).toThrow(/already registered/);
	});
});

describe('change notifications', () => {
	it('tells subscribers what was added and removed, and once for a batch', () => {
		const { index, put } = vault();
		const seen = vi.fn();
		index.subscribe(seen);
		put({ path: 'a.md', text: '- 2020 :: One ^one' });
		expect(seen).toHaveBeenLastCalledWith({ added: [expect.objectContaining({ id: 'a.md#^one' })], removed: [] });
		put({ path: 'a.md', text: '- 2020 :: Two ^two' });
		expect(seen).toHaveBeenLastCalledWith({ added: [expect.objectContaining({ id: 'a.md#^two' })], removed: ['a.md#^one'] });
		index.remove('a.md');
		expect(seen).toHaveBeenLastCalledWith({ added: [], removed: ['a.md#^two'] });
		seen.mockClear();
		index.batch(() => { for (let i = 0; i < 50; i++) put({ path: `n${i}.md`, text: '- 2020 :: x' }); });
		expect(seen).toHaveBeenCalledTimes(1);
		expect(seen).toHaveBeenCalledWith({ added: [], removed: [], reset: true });
	});
});

describe('performance', () => {
	it('indexes 5,000 work and licence notes and 5,000 inline events, and answers queries quickly', () => {
		const { index, put } = vault();
		const t0 = performance.now();
		index.batch(() => {
			for (let i = 0; i < 2500; i++) put({ path: `Works/W${i}.md`, frontmatter: { type: 'work', created: '2019' } });
			for (let i = 0; i < 2500; i++) put({ path: `Licences/L${i}.md`, frontmatter: { type: 'licence', start: `20${10 + (i % 15)}-0${1 + (i % 9)}` } });
			for (let m = 0; m < 50; m++) {
				put({ path: `Matters/M${m}/M${m}.md`, frontmatter: { type: 'matter' } });
				put({ path: `Matters/M${m}/Chronology.md`, text: Array.from({ length: 100 }, (_, k) => `- 20${10 + (k % 15)}-0${1 + (k % 9)}-1${k % 9} :: Event ${k} [[W${k}]] {track=${k % 2 ? 'client' : 'respondent'}}`).join('\n') });
			}
		});
		index.registerSource({ id: 'rights', types: ['licence'], events: ({ frontmatter }) => [{ key: 'start', date: String(frontmatter?.start), title: 'Starts', kind: 'licence-start' }] });
		const indexed = performance.now() - t0;
		const t1 = performance.now();
		const all = index.query();
		const first = performance.now() - t1;
		const t2 = performance.now();
		const matter = index.query({ matter: 'Matters/M7/M7.md' });
		const upcoming = index.query({ from: '2020', to: '2021', kinds: ['licence-start'] });
		const again = performance.now() - t2;
		expect(all).toHaveLength(7500);
		expect(matter).toHaveLength(100);
		expect(upcoming.length).toBeGreaterThan(0);
		console.log(`PERF indexed ${(indexed).toFixed(0)} ms; first query (resolves and sorts 7,500 events) ${first.toFixed(0)} ms; two filtered queries ${again.toFixed(1)} ms`);
		expect(first).toBeLessThan(500);
		expect(again).toBeLessThan(50);
	});
});
