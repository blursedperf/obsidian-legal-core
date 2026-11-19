/**
 * Golden export tests: each note in test/fixtures is exported to Word and HTML, and the result must match
 * the outputs stored in test/golden exactly. The goldens were generated from the export before the Legal
 * Core refactor, so any difference is a change in the output.
 *
 * Normalised by putting one element per line and numbering the hyperlink ids the Word library makes
 * random; nothing else is changed.
 *
 * Only when the output is meant to change: UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { DEFAULT_EXPORT, type ExportOptions, exportDocx, exportHtml } from '@legal-core/aglc';

const FIXTURES = new URL('fixtures/', import.meta.url);
const GOLDEN = new URL('golden/', import.meta.url);
const PARTS = ['word/document.xml', 'word/footnotes.xml', 'word/styles.xml', 'word/numbering.xml'];
const update = process.env.UPDATE_GOLDEN === '1';

/**
 * XML with one element per line, indented by depth. An element holding only text stays on one line.
 * Text is kept exactly, so the comparison is as strict as comparing the raw XML.
 */
export function prettyXml(xml: string): string {
	const tokens = xml.match(/<[^>]+>|[^<]+/g) ?? [];
	const out: string[] = [];
	let depth = 0;
	const pad = () => '  '.repeat(depth);
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i]!;
		const isOpen = t.startsWith('<') && !t.startsWith('</') && !t.startsWith('<?') && !t.endsWith('/>');
		const next = tokens[i + 1];
		const after = tokens[i + 2];
		if (isOpen && next && !next.startsWith('<') && after?.startsWith('</')) {
			out.push(`${pad()}${t}${next}${after}`);
			i += 2;
		} else if (t.startsWith('</')) {
			depth--;
			out.push(`${pad()}${t}`);
		} else {
			out.push(`${pad()}${t}`);
			if (isOpen) depth++;
		}
	}
	return `${out.join('\n')}\n`;
}

/**
 * The Word library gives each hyperlink a random relationship id ("rIdmerc0seglmh2xs6ltpkdu"), which
 * changes on every export. They are numbered in order of appearance instead. Fixed ids such as "rId1"
 * are left as they are.
 */
export function stableIds(xml: string): string {
	const seen = new Map<string, string>();
	return xml.replace(/r:id="(rId(?!\d+")[^"]+)"/g, (_m, id: string) => {
		if (!seen.has(id)) seen.set(id, `rId-link-${seen.size + 1}`);
		return `r:id="${seen.get(id)!}"`;
	});
}

function fixtures(): { name: string; markdown: string; options: ExportOptions }[] {
	return readdirSync(FIXTURES).filter((f) => f.endsWith('.md')).sort().map((f) => {
		const name = f.slice(0, -3);
		const optionsFile = new URL(`${name}.options.json`, FIXTURES);
		const extra = existsSync(optionsFile) ? JSON.parse(readFileSync(optionsFile, 'utf8')) as Partial<ExportOptions> : {};
		return { name, markdown: readFileSync(new URL(f, FIXTURES), 'utf8'), options: { ...DEFAULT_EXPORT, ...extra } };
	});
}

/** The normalised outputs of one fixture, by golden file name. */
export async function outputs(markdown: string, options: ExportOptions): Promise<Record<string, string>> {
	const docx = await exportDocx(markdown, options);
	const files = unzipSync(new Uint8Array(docx.data));
	const out: Record<string, string> = {};
	for (const part of PARTS) out[part.split('/').pop()!] = prettyXml(stableIds(strFromU8(files[part]!)));
	out['export.html'] = exportHtml(markdown, { ...options, title: options.title ?? 'Fixture' }).html;
	return out;
}

describe('golden exports', () => {
	const all = fixtures();

	it('has the fixtures the refactor needs', () => {
		expect(all.map((f) => f.name)).toEqual(expect.arrayContaining(['cases', 'legislation', 'secondary', 'subsequent', 'bibliography-generated', 'bibliography-own']));
	});

	for (const f of all) {
		it(`${f.name} exports exactly as before`, async () => {
			const out = await outputs(f.markdown, f.options);
			const dir = new URL(`${f.name}/`, GOLDEN);
			if (update) {
				mkdirSync(dir, { recursive: true });
				for (const [file, text] of Object.entries(out)) writeFileSync(new URL(file, dir), text);
				return;
			}
			for (const [file, text] of Object.entries(out)) {
				const golden = new URL(file, dir);
				expect(existsSync(golden), `missing golden ${f.name}/${file}: generate with UPDATE_GOLDEN=1`).toBe(true);
				expect(text, `${f.name}/${file}`).toBe(readFileSync(golden, 'utf8'));
			}
		});
	}
});
