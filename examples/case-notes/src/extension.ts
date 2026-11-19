/**
 * The case-notes extension: what a case-notes plugin registers with Legal Core.
 *
 * - Syntax: a fenced block
 *       ```case-note
 *       case: *Mabo v Queensland [No 2]* (1992) 175 CLR 1
 *       facts: …
 *       held: …
 *       ```
 *   becomes a custom "case-note" node.
 * - Renderer: the node becomes a heading (the case) and a paragraph per part (Facts, Held, …).
 * - Transform: numbers the case notes ("Case note 1: …"), after they are rendered and before Legal
 *   Core's typography, so the quotation marks in them are curled like the rest of the document.
 *
 * This file has no Obsidian code, so it can be tested on its own.
 */
import type { Block, Inline, LegalExtension } from '@legal-core/api';

export const CASE_NOTE = 'case-note';

export interface CaseNote {
	case: string;
	/** Parts in the order written: facts, issues, held, reasoning … */
	parts: [string, string][];
}

/** The lines of a case-note block: "name: text". */
export function parseCaseNote(source: string): CaseNote {
	const note: CaseNote = { case: '', parts: [] };
	for (const line of source.split('\n')) {
		const m = /^\s*([A-Za-z][\w -]*):\s*(.*)$/.exec(line);
		if (!m) continue;
		const name = m[1]!.trim().toLowerCase();
		if (name === 'case') note.case = m[2]!.trim();
		else note.parts.push([name, m[2]!.trim()]);
	}
	return note;
}

/** Inline Markdown italics (`*…*`) in a line, as document nodes. */
function inline(text: string): Inline[] {
	const out: Inline[] = [];
	const re = /\*([^*]+)\*/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
		out.push({ t: 'em', c: [{ t: 'text', v: m[1]! }] });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
	return out;
}

function render(note: CaseNote): Block[] {
	const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
	return [
		{ t: 'heading', level: 3, c: inline(note.case) },
		...note.parts.map(([name, text]): Block => ({ t: 'para', c: [{ t: 'strong', c: [{ t: 'text', v: `${label(name)}: ` }] }, ...inline(text)] })),
	];
}

export const caseNotesExtension: LegalExtension = {
	id: 'case-notes',
	syntax: [{ type: 'fence', lang: CASE_NOTE, parse: (source) => [{ t: 'custom', kind: CASE_NOTE, data: parseCaseNote(source) }] }],
	renderers: [{ kind: CASE_NOTE, block: (data) => render(data as CaseNote) }],
	transforms: [{
		id: 'number',
		after: ['render'],
		before: ['aglc-quotes'],
		fn: (doc) => {
			let n = 0;
			for (const b of doc.blocks) {
				if (b.t === 'heading' && b.level === 3) b.c = [{ t: 'text', v: `Case note ${++n}: ` }, ...b.c];
			}
		},
	}],
};
