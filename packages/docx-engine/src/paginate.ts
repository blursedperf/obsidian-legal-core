/**
 * Word-style pagination with footnotes at the bottom of each page.
 *
 * The rules, checked against PDFs saved from Word:
 * - a line goes on a page only if it fits completely, together with the footnote separator and the
 *   footnotes it cites (Word allows no overlap, unlike LibreOffice);
 * - the space between paragraphs is the larger of the first's space after and the second's space before;
 * - a footnote must start on the page of its reference; if it does not fit, as many of its lines as fit
 *   are placed and the rest continue at the top of the next page's footnotes, ahead of new footnotes
 *   (unless footnotes are kept together, when the citing line moves to the next page instead);
 * - widow and orphan control: a paragraph split across pages leaves at least two lines on each side;
 * - headings are kept with the next paragraph and not split.
 *
 * Space before a paragraph at the top of a page after an automatic break is suppressed, except on the
 * first page and after a page break before the paragraph.
 *
 * This module is pure so it can be tested without a browser: measured lines go in, page slices come out.
 */

export interface PBlock {
	lines: number;
	lineHeight: number;
	spaceBefore: number;
	spaceAfter: number;
	keepNext?: boolean;
	keepLines?: boolean;
	/** Start a new page before this block (Word: "Page break before"). */
	pageBreakBefore?: boolean;
	/** Footnotes cited, by the line they are cited on (0-based) and the footnote's index. */
	refs: { line: number; note: number }[];
}

export interface PNote {
	lines: number;
	lineHeight: number;
}

export interface Geometry {
	contentHeight: number;
	/** Height of the separator above the footnotes (also used for the continuation separator). */
	separator: number;
	widowControl?: boolean;
	/**
	 * Keep each footnote whole on one page: when it does not fit, the line citing it moves to the next
	 * page with it. A footnote too long for any page is still split.
	 */
	keepNotesTogether?: boolean;
}

export interface BodySlice {
	block: number;
	/** Lines [from, to) of the block. */
	from: number;
	to: number;
	/** Top of the first line, from the top of the content area. */
	y: number;
}

export interface NoteSlice {
	note: number;
	from: number;
	to: number;
	/** Top of the first line, from the top of the footnote text (below the separator). */
	y: number;
}

export interface Page {
	body: BodySlice[];
	notes: NoteSlice[];
	/** Height of the footnote area including the separator, 0 when the page has no footnotes. */
	notesHeight: number;
	/** True when the first footnote slice continues a footnote from the previous page. */
	continued: boolean;
}

const EPS = 0.01;

interface State {
	y: number;
	/** Space after the last block on the page, or null at the top of the page. */
	lastAfter: number | null;
	notesH: number;
	body: BodySlice[];
	notes: NoteSlice[];
	/** Footnote lines still to place, carried from earlier pages or a split on this page. */
	carry: { note: number; from: number }[];
	continued: boolean;
	/** Set when a footnote was split: nothing more fits on the page. */
	full: boolean;
	/** The page was started by a page break before its first block, which keeps its space before. */
	broken?: boolean;
}

function clone(s: State): State {
	return { ...s, body: s.body.map((b) => ({ ...b })), notes: s.notes.map((n) => ({ ...n })), carry: s.carry.map((c) => ({ ...c })) };
}

export function paginate(blocks: PBlock[], notes: PNote[], geo: Geometry): Page[] {
	const H = geo.contentHeight;
	const sep = geo.separator;
	const widow = geo.widowControl !== false;
	const keepNotes = geo.keepNotesTogether === true;
	/** A footnote that cannot fit on a page even with only its citing line above it. */
	const tooLong = (n: number, lineHeight: number) => notes[n]!.lines * notes[n]!.lineHeight > H - sep - lineHeight + EPS;
	const pages: Page[] = [];

	const fresh = (carry: State['carry']): State => ({ y: 0, lastAfter: null, notesH: 0, body: [], notes: [], carry, continued: false, full: false });
	const area = (notesH: number) => (notesH > EPS ? sep + notesH : 0);
	const fits = (s: State, extraBody: number, extraNotes: number) => s.y + extraBody + area(s.notesH + extraNotes) <= H + EPS;

	/** Add `count` lines of footnote `note` from line `from` to the page. */
	const addNote = (s: State, note: number, from: number, count: number) => {
		const n = notes[note]!;
		const last = s.notes[s.notes.length - 1];
		if (last && last.note === note && last.to === from) last.to += count;
		else s.notes.push({ note, from, to: from + count, y: s.notesH });
		s.notesH += count * n.lineHeight;
	};

	/** Place carried-over footnote lines at the top of a new page's footnotes. */
	const placeCarry = (s: State) => {
		const carry = s.carry;
		s.carry = [];
		for (let i = 0; i < carry.length; i++) {
			const c = carry[i]!;
			const n = notes[c.note]!;
			const remaining = n.lines - c.from;
			const room = Math.floor((H - s.y - area(s.notesH) - (s.notesH > EPS ? 0 : sep) + EPS) / n.lineHeight);
			const count = Math.max(Math.min(remaining, room), s.notes.length === 0 ? 1 : 0);
			if (count > 0) {
				if (s.notes.length === 0 && c.from > 0) s.continued = true;
				addNote(s, c.note, c.from, count);
			}
			if (count < remaining) {
				s.carry = [{ note: c.note, from: c.from + count }, ...carry.slice(i + 1)];
				s.full = true;
				return;
			}
		}
	};

	let state = fresh([]);
	let first = true;
	const newPage = () => {
		pages.push({ body: state.body, notes: state.notes, notesHeight: area(state.notesH), continued: state.continued });
		state = fresh(state.carry);
		first = false;
		placeCarry(state);
	};

	/**
	 * Try to place one line of a block. Returns false if it does not fit; on success the state is updated.
	 * `gap` is the space above the line (only for the first line of a block on the page).
	 */
	const placeLine = (s: State, b: PBlock, blockIndex: number, line: number, gap: number, force: boolean): boolean => {
		if (s.full && !force) return false;
		const cited = b.refs.filter((r) => r.line === line).map((r) => r.note);
		const full = cited.reduce((h, n) => h + notes[n]!.lines * notes[n]!.lineHeight, 0);
		const cost = gap + b.lineHeight;
		const commit = () => {
			const last = s.body[s.body.length - 1];
			if (last && last.block === blockIndex && last.to === line) last.to++;
			else s.body.push({ block: blockIndex, from: line, to: line + 1, y: s.y + gap });
			s.y += cost;
		};
		if (s.carry.length === 0 && fits(s, cost, full)) {
			commit();
			for (const n of cited) addNote(s, n, 0, notes[n]!.lines);
			return true;
		}
		// Split the footnotes: everything that fits, then as much of the next one as fits.
		const firstLine = cited.length > 0 ? notes[cited[0]!]!.lineHeight : 0;
		const maySplit = !keepNotes || cited.some((n) => tooLong(n, b.lineHeight));
		if (maySplit && cited.length > 0 && s.carry.length === 0 && fits(s, cost, firstLine)) {
			commit();
			for (let i = 0; i < cited.length; i++) {
				const n = notes[cited[i]!]!;
				const room = Math.floor((H - s.y - area(s.notesH) - (s.notesH > EPS ? 0 : sep) + EPS) / n.lineHeight);
				const count = Math.max(0, Math.min(n.lines, room));
				if (count > 0) addNote(s, cited[i]!, 0, count);
				if (count < n.lines) {
					s.carry = [{ note: cited[i]!, from: count }, ...cited.slice(i + 1).map((note) => ({ note, from: 0 }))];
					s.full = true;
					break;
				}
			}
			return true;
		}
		if (force) {
			commit();
			for (const n of cited) {
				const note = notes[n]!;
				const room = Math.max(1, Math.floor((H - s.y - area(s.notesH) - (s.notesH > EPS ? 0 : sep) + EPS) / note.lineHeight));
				const count = Math.min(note.lines, room);
				addNote(s, n, 0, count);
				if (count < note.lines) { s.carry.push({ note: n, from: count }); s.full = true; }
			}
			return true;
		}
		return false;
	};

	const gapFor = (s: State, b: PBlock) => (s.lastAfter === null ? ((first || s.broken) && s.body.length === 0 ? b.spaceBefore : 0) : Math.max(s.lastAfter, b.spaceBefore));

	/** Whether the next `minLines` lines of blocks starting at `i` (following keep-with-next) fit. */
	const keepFits = (s: State, i: number): boolean => {
		const t = clone(s);
		let j = i;
		for (;;) {
			const b = blocks[j];
			if (!b) return true;
			const need = b.keepNext || b.keepLines ? b.lines : Math.min(b.lines, widow ? 2 : 1);
			const gap = gapFor(t, b);
			for (let l = 0; l < need; l++) {
				if (!placeLine(t, b, j, l, l === 0 ? gap : 0, false)) return false;
			}
			t.lastAfter = b.spaceAfter;
			if (!b.keepNext) return true;
			j++;
		}
	};

	for (let i = 0; i < blocks.length; i++) {
		const b = blocks[i]!;
		if (b.pageBreakBefore && (state.body.length > 0 || state.notes.length > 0)) {
			newPage();
			state.broken = true;
		}
		let line = 0;
		while (line < b.lines) {
			const atTop = state.body.length === 0;
			// Keep-with-next and keep-lines: move the whole block to a new page if it cannot stay together.
			if (line === 0 && !atTop && (b.keepNext || b.keepLines)) {
				if (!keepFits(state, i)) { newPage(); continue; }
			}
			const snapshots: State[] = [clone(state)];
			const start = line;
			let gap = gapFor(state, b);
			while (line < b.lines) {
				const force = state.body.length === 0 && line === start;
				if (!placeLine(state, b, i, line, line === start ? gap : 0, force)) break;
				gap = 0;
				line++;
				snapshots.push(clone(state));
				if (state.full) break;
			}
			if (line === b.lines) {
				state.lastAfter = b.spaceAfter;
				break;
			}
			// The block breaks here. Apply widow and orphan control.
			let k = line;
			if (widow && b.lines > 1 && !(b.keepLines && start === 0)) {
				if (b.lines - k === 1 && k - start >= 2) k--;
				if (start === 0 && k - start === 1) k = start;
			}
			if (k === start && !snapshots[0]!.body.length) k = line; // nothing else on the page: keep what fits
			state = snapshots[k - start]!;
			line = k;
			newPage();
		}
	}
	const push = () => pages.push({ body: state.body, notes: state.notes, notesHeight: area(state.notesH), continued: state.continued });
	if (state.body.length > 0 || state.notes.length > 0 || pages.length === 0) push();
	// A document can end in the middle of a footnote: its remaining lines get pages of their own.
	while (state.carry.length > 0) {
		state = fresh(state.carry);
		placeCarry(state);
		push();
	}
	return pages;
}
