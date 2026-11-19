/**
 * A small Markdown parser covering what Obsidian notes use in legal writing, producing a tree that the
 * Word and HTML exporters render. Footnotes (both [^label] and ^[inline]) are kept as nodes so that the
 * exporters can turn them into real footnotes.
 */

import type { Block, Inline, MdDocument } from '@legal-core/ldm';

export type { Block, Inline, MdDocument } from '@legal-core/ldm';

// ---------------------------------------------------------------------------------------------------------
// Inline

const ESCAPABLE = '\\`*_{}[]()#+-.!|~=<>^$%\'"';

function findClosing(s: string, delim: string, from: number): number {
	for (let j = from; j <= s.length - delim.length; j++) {
		const c = s[j];
		if (c === '\\') { j++; continue; }
		if (c === '`') {
			const end = s.indexOf('`', j + 1);
			if (end > 0) { j = end; continue; }
		}
		if (s.startsWith(delim, j) && j > from && !/\s/.test(s[j - 1]!)) {
			if (delim.length === 1 && (delim === '*' || delim === '_')) {
				// "*" must not be part of "**" unless it closes a "***" run.
				const doubled = s[j + 1] === delim && s[j - 1] !== delim;
				if (doubled) { j++; continue; }
				if (delim === '_' && /\w/.test(s[j + 1] ?? '')) continue;
			}
			return j;
		}
	}
	return -1;
}

function closeBracket(s: string, open: number): number {
	let depth = 0;
	for (let i = open; i < s.length; i++) {
		const c = s[i];
		if (c === '\\') { i++; continue; }
		if (c === '[') depth++;
		else if (c === ']' && --depth === 0) return i;
	}
	return -1;
}

export function parseInline(s: string): Inline[] {
	const out: Inline[] = [];
	let buf = '';
	const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
	let i = 0;
	while (i < s.length) {
		const c = s[i]!;
		const rest = s.slice(i);
		if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1]!)) {
			buf += s[i + 1];
			i += 2;
			continue;
		}
		if (c === '\n') {
			flush();
			out.push({ t: 'br' });
			i++;
			continue;
		}
		if (c === '`') {
			const run = /^`+/.exec(rest)![0];
			const end = s.indexOf(run, i + run.length);
			if (end > 0) {
				flush();
				out.push({ t: 'code', v: s.slice(i + run.length, end).trim() });
				i = end + run.length;
				continue;
			}
		}
		if (rest.startsWith('%%')) {
			const end = s.indexOf('%%', i + 2);
			i = end < 0 ? s.length : end + 2;
			continue;
		}
		let m: RegExpExecArray | null;
		if ((m = /^\[\^([^\]\s]+)\]/.exec(rest))) {
			flush();
			out.push({ t: 'fnref', label: m[1]! });
			i += m[0].length;
			continue;
		}
		if (rest.startsWith('^[')) {
			const end = closeBracket(s, i + 1);
			if (end > 0) {
				flush();
				out.push({ t: 'fninline', c: parseInline(s.slice(i + 2, end)) });
				i = end + 1;
				continue;
			}
		}
		if (rest.startsWith('![[')) {
			const end = s.indexOf(']]', i);
			if (end > 0) { i = end + 2; continue; }
		}
		if (rest.startsWith('[[')) {
			const end = s.indexOf(']]', i);
			if (end > 0) {
				const inner = s.slice(i + 2, end);
				const bar = inner.indexOf('|');
				buf += bar >= 0 ? inner.slice(bar + 1) : inner.replace(/#\^?/, ' › ');
				i = end + 2;
				continue;
			}
		}
		if ((m = /^!\[([^\]]*)\]\([^)]*\)/.exec(rest))) {
			buf += m[1];
			i += m[0].length;
			continue;
		}
		if (c === '[') {
			const end = closeBracket(s, i);
			if (end > 0 && s[end + 1] === '(') {
				const close = s.indexOf(')', end + 2);
				if (close > 0) {
					flush();
					const href = s.slice(end + 2, close).trim().replace(/^<|>$/g, '').split(/\s+"/)[0]!;
					out.push({ t: 'link', href, c: parseInline(s.slice(i + 1, end)) });
					i = close + 1;
					continue;
				}
			}
		}
		if ((m = /^<((?:https?|mailto):[^>\s]+)>/.exec(rest))) {
			flush();
			out.push({ t: 'url', href: m[1]! });
			i += m[0].length;
			continue;
		}
		if ((m = /^<br\s*\/?>/i.exec(rest))) {
			flush();
			out.push({ t: 'br' });
			i += m[0].length;
			continue;
		}
		const delims: [string, 'em' | 'strong' | 'strike' | 'mark' | 'both'][] = [
			['***', 'both'], ['___', 'both'], ['**', 'strong'], ['__', 'strong'], ['~~', 'strike'], ['==', 'mark'], ['*', 'em'], ['_', 'em'],
		];
		let matched = false;
		for (const [d, kind] of delims) {
			if (!rest.startsWith(d)) continue;
			if (d[0] === '_' && i > 0 && /\w/.test(s[i - 1]!)) continue;
			if (/\s/.test(s[i + d.length] ?? ' ')) continue;
			const end = findClosing(s, d, i + d.length);
			if (end < 0) continue;
			flush();
			const inner = parseInline(s.slice(i + d.length, end));
			out.push(kind === 'both' ? { t: 'strong', c: [{ t: 'em', c: inner }] } : { t: kind, c: inner });
			i = end + d.length;
			matched = true;
			break;
		}
		if (matched) continue;
		buf += c;
		i++;
	}
	flush();
	return out;
}

/** Plain text of inline content, for titles and tests. */
export function plainText(nodes: Inline[]): string {
	return nodes.map((n) => {
		switch (n.t) {
			case 'text': return n.v;
			case 'code': return n.v;
			case 'url': return `<${n.href}>`;
			case 'br': return '\n';
			case 'fnref': return '';
			case 'fninline': return '';
			case 'custom': return '';
			default: return plainText(n.c);
		}
	}).join('');
}

// ---------------------------------------------------------------------------------------------------------
// Blocks

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function indentWidth(s: string): number {
	let w = 0;
	for (const ch of s) w += ch === '\t' ? 4 : 1;
	return w;
}

/** Split a table row on unescaped pipes. */
function splitCells(row: string): string[] {
	const cells: string[] = [];
	let cur = '';
	for (let i = 0; i < row.length; i++) {
		if (row[i] === '\\' && row[i + 1] === '|') { cur += '|'; i++; }
		else if (row[i] === '|') { cells.push(cur); cur = ''; }
		else cur += row[i];
	}
	cells.push(cur);
	return cells;
}

function parseBlocks(lines: string[]): Block[] {
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		if (line.trim() === '') { i++; continue; }

		let m: RegExpExecArray | null;
		if ((m = /^(`{3,}|~{3,})\s*([^\s`]*)/.exec(line))) {
			const fence = m[1]!;
			const body: string[] = [];
			i++;
			while (i < lines.length && !lines[i]!.startsWith(fence)) body.push(lines[i++]!);
			i++;
			blocks.push({ t: 'code', lang: m[2] ?? '', v: body.join('\n') });
			continue;
		}
		if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
			blocks.push({ t: 'heading', level: m[1]!.length, c: parseInline(m[2]!) });
			i++;
			continue;
		}
		if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
			blocks.push({ t: 'hr' });
			i++;
			continue;
		}
		if (/^\s{0,3}>/.test(line)) {
			const body: string[] = [];
			while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ''));
			const callout = /^\[!([^\]]+)\][-+]?\s*(.*)$/.exec(body[0] ?? '');
			if (callout) {
				const title = callout[2] || callout[1]!.charAt(0).toUpperCase() + callout[1]!.slice(1);
				body[0] = `**${title}**`;
			}
			blocks.push({ t: 'quote', blocks: parseBlocks(body) });
			continue;
		}
		if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
			const cells = (l: string) => splitCells(l.trim().replace(/^\||\|$/g, '')).map((c) => parseInline(c.trim()));
			const header = cells(line);
			i += 2;
			const rows: Inline[][][] = [];
			while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
			blocks.push({ t: 'table', header, rows });
			continue;
		}
		if ((m = LIST_RE.exec(line))) {
			const base = indentWidth(m[1]!);
			const ordered = /\d/.test(m[2]!);
			const start = ordered ? parseInt(m[2]!, 10) : 1;
			const items: Block[][] = [];
			while (i < lines.length) {
				const lm = LIST_RE.exec(lines[i]!);
				if (!lm || indentWidth(lm[1]!) !== base || /\d/.test(lm[2]!) !== ordered) break;
				const itemLines = [lm[3]!.replace(/^\[[ xX]\]\s/, '')];
				i++;
				while (i < lines.length) {
					const next = lines[i]!;
					if (next.trim() === '') {
						if (i + 1 < lines.length && indentWidth(/^\s*/.exec(lines[i + 1]!)![0]) > base) { itemLines.push(''); i++; continue; }
						break;
					}
					const nm = LIST_RE.exec(next);
					if (nm && indentWidth(nm[1]!) <= base) break;
					if (!nm && indentWidth(/^\s*/.exec(next)![0]) <= base) {
						// lazy continuation of the item's paragraph
						itemLines[itemLines.length - 1] += `\n${next.trim()}`;
						i++;
						continue;
					}
					itemLines.push(next.slice(Math.min(indentWidth(/^\s*/.exec(next)![0]), base + 2)));
					i++;
				}
				items.push(parseBlocks(itemLines));
			}
			blocks.push({ t: 'list', ordered, start, items });
			continue;
		}
		const para: string[] = [];
		while (i < lines.length) {
			const l = lines[i]!;
			if (l.trim() === '' || /^(#{1,6}\s|```|~~~|\s{0,3}>)/.test(l) || (para.length > 0 && LIST_RE.test(l))) break;
			para.push(l.replace(/\s+$/, ''));
			i++;
		}
		blocks.push({ t: 'para', c: parseInline(para.join('\n')) });
	}
	return blocks;
}

/** Parse a whole note. Footnote definitions are removed from the body and returned separately. */
export function parseMarkdown(src: string): MdDocument {
	let text = src.replace(/\r\n?/g, '\n');
	const frontmatter: Record<string, string> = {};
	const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
	if (fm) {
		for (const line of fm[1]!.split('\n')) {
			const kv = /^([\w-]+):\s*(.*)$/.exec(line);
			if (kv) frontmatter[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '');
		}
		text = text.slice(fm[0].length);
	}
	text = text.replace(/%%[\s\S]*?%%/g, '');

	const footnotes = new Map<string, Block[]>();
	const lines = text.split('\n');
	const body: string[] = [];
	let inFence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const fence = /^(`{3,}|~{3,})/.exec(line);
		if (fence) {
			if (inFence === null) inFence = fence[1]!;
			else if (line.startsWith(inFence)) inFence = null;
		}
		const def = inFence === null ? /^\[\^([^\]\s]+)\]:\s?(.*)$/.exec(line) : null;
		if (!def) { body.push(line); continue; }
		const content = [def[2]!];
		while (i + 1 < lines.length) {
			const next = lines[i + 1]!;
			if (/^(?: {2,}|\t)\S/.test(next)) content.push(next.replace(/^(?: {2,4}|\t)/, ''));
			else if (next.trim() === '' && i + 2 < lines.length && /^(?: {4}|\t)\S/.test(lines[i + 2]!)) content.push('');
			else break;
			i++;
		}
		if (!footnotes.has(def[1]!)) footnotes.set(def[1]!, parseBlocks(content));
	}
	return { blocks: parseBlocks(body), footnotes, frontmatter };
}

/** Walk inline content, calling `fn` on every node (depth first). */
export function walkInline(nodes: Inline[], fn: (n: Inline) => void): void {
	for (const n of nodes) {
		fn(n);
		if ('c' in n) walkInline(n.c, fn);
	}
}

export function walkBlocks(blocks: Block[], fn: (nodes: Inline[]) => void): void {
	for (const b of blocks) {
		switch (b.t) {
			case 'heading':
			case 'para': fn(b.c); break;
			case 'quote': walkBlocks(b.blocks, fn); break;
			case 'list': for (const it of b.items) walkBlocks(it, fn); break;
			case 'table': b.header.forEach(fn); b.rows.forEach((r) => r.forEach(fn)); break;
			default: break;
		}
	}
}
