/**
 * Dates with precision: "2019", "2019-03", "2019-03-14", ranges "2019-03..2019-05", approximate dates
 * "~2019-03", and open-ended ranges "2019-03.." and "..2020".
 *
 * A date covers every day it could mean: "2019-03" is 1 to 31 March 2019. Sorting and overlap use those
 * days, so a month is never treated as a made-up particular day. Nothing here guesses: text that is not a
 * date (or an impossible one, such as 30 February) is rejected with the reason.
 */

export type Precision = 'year' | 'month' | 'day';

export interface PreciseDate {
	/** First day covered, YYYY-MM-DD; null for an open start ("..2020"). */
	start: string | null;
	/** Last day covered, inclusive, YYYY-MM-DD; null for an open end ("2019-03.."). */
	end: string | null;
	/** Precision of the start as written (for an open start, that of the end). */
	precision: Precision;
	/** Precision of the end as written (for an open end, that of the start). */
	endPrecision: Precision;
	/** True when either end is approximate ("~2019-03"). */
	approximate: boolean;
	/** True when written as a range ("a..b", "a..", "..b"). */
	range: boolean;
}

export type ParseResult = { ok: true; date: PreciseDate } | { ok: false; reason: string };

const PRECISION_RANK: Record<Precision, number> = { day: 0, month: 1, year: 2 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pad(n: number, width = 2): string {
	return String(n).padStart(width, '0');
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

interface Point {
	first: string;
	last: string;
	precision: Precision;
	approximate: boolean;
	year: number;
	month?: number;
	day?: number;
}

/** One end of a date: "2019", "2019-03", "2019-03-14", each optionally with a leading "~". */
function parsePoint(raw: string): Point | string {
	const text = raw.trim();
	const approximate = text.startsWith('~');
	const body = approximate ? text.slice(1).trim() : text;
	const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(body);
	if (!m) return `"${raw.trim()}" is not a date (use YYYY, YYYY-MM or YYYY-MM-DD)`;
	const year = Number(m[1]);
	if (year < 1000) return `${m[1]} is not a valid year`;
	if (m[2] === undefined) return { first: `${m[1]}-01-01`, last: `${m[1]}-12-31`, precision: 'year', approximate, year };
	const month = Number(m[2]);
	if (month < 1 || month > 12) return `${m[2]} is not a month`;
	const dim = daysInMonth(year, month);
	if (m[3] === undefined) return { first: `${m[1]}-${m[2]}-01`, last: `${m[1]}-${m[2]}-${pad(dim)}`, precision: 'month', approximate, year, month };
	const day = Number(m[3]);
	if (day < 1 || day > dim) return `${MONTHS_FULL[month - 1]} ${year} has no day ${day}`;
	const iso = `${m[1]}-${m[2]}-${m[3]}`;
	return { first: iso, last: iso, precision: 'day', approximate, year, month, day };
}

/** Parse a date with precision. Never throws, and never guesses. */
export function parseDate(input: unknown): ParseResult {
	if (input instanceof Date) {
		if (Number.isNaN(input.getTime())) return { ok: false, reason: 'not a valid date' };
		const iso = `${input.getUTCFullYear()}-${pad(input.getUTCMonth() + 1)}-${pad(input.getUTCDate())}`;
		return parseDate(iso);
	}
	if (typeof input === 'number' && Number.isInteger(input)) return parseDate(String(input));
	if (typeof input !== 'string') return { ok: false, reason: 'no date given' };
	const text = input.trim();
	if (!text) return { ok: false, reason: 'no date given' };

	const parts = text.split('..');
	if (parts.length > 2) return { ok: false, reason: `"${text}" has more than one ".."` };
	if (parts.length === 1) {
		const p = parsePoint(text);
		if (typeof p === 'string') return { ok: false, reason: p };
		return { ok: true, date: { start: p.first, end: p.last, precision: p.precision, endPrecision: p.precision, approximate: p.approximate, range: false } };
	}

	const [a, b] = parts as [string, string];
	if (!a.trim() && !b.trim()) return { ok: false, reason: 'a range needs at least one end' };
	const from = a.trim() ? parsePoint(a) : null;
	const to = b.trim() ? parsePoint(b) : null;
	if (typeof from === 'string') return { ok: false, reason: from };
	if (typeof to === 'string') return { ok: false, reason: to };
	if (from && to && from.first > to.last) return { ok: false, reason: `the range "${text}" ends before it starts` };
	const precision = (from ?? to)!.precision;
	const endPrecision = (to ?? from)!.precision;
	return {
		ok: true,
		date: {
			start: from ? from.first : null,
			end: to ? to.last : null,
			precision,
			endPrecision,
			approximate: !!from?.approximate || !!to?.approximate,
			range: true,
		},
	};
}

/** Parse a date, or throw an error with the reason (for code that has already validated its input). */
export function mustParse(input: unknown): PreciseDate {
	const r = parseDate(input);
	if (!r.ok) throw new Error(r.reason);
	return r.date;
}

function cmpStart(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return -1; // an open start comes first
	if (b === null) return 1;
	return a < b ? -1 : 1;
}

function cmpEnd(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return 1; // an open end comes last
	if (b === null) return -1;
	return a < b ? -1 : 1;
}

/**
 * Order two dates: by first day, then by last day (the shorter span first), then by precision (day
 * before month before year), then exact before approximate. Two dates that compare equal cover the same
 * days at the same precision.
 */
export function compareDates(a: PreciseDate, b: PreciseDate): number {
	return cmpStart(a.start, b.start)
		|| cmpEnd(a.end, b.end)
		|| PRECISION_RANK[a.precision] - PRECISION_RANK[b.precision]
		|| PRECISION_RANK[a.endPrecision] - PRECISION_RANK[b.endPrecision]
		|| Number(a.approximate) - Number(b.approximate)
		|| Number(a.range) - Number(b.range);
}

/** Whether two dates share at least one day (open ends run indefinitely). */
export function overlaps(a: PreciseDate, b: PreciseDate): boolean {
	const aStartsAfterBEnds = a.start !== null && b.end !== null && a.start > b.end;
	const bStartsAfterAEnds = b.start !== null && a.end !== null && b.start > a.end;
	return !aStartsAfterBEnds && !bStartsAfterAEnds;
}

/** The days two dates share, or null if none. */
export function intersection(a: PreciseDate, b: PreciseDate): { start: string | null; end: string | null } | null {
	if (!overlaps(a, b)) return null;
	const start = a.start === null ? b.start : b.start === null ? a.start : (a.start > b.start ? a.start : b.start);
	const end = a.end === null ? b.end : b.end === null ? a.end : (a.end < b.end ? a.end : b.end);
	return { start, end };
}

/** Whether a day (YYYY-MM-DD) falls within the date. */
export function containsDay(d: PreciseDate, day: string): boolean {
	return (d.start === null || d.start <= day) && (d.end === null || day <= d.end);
}

function partsOf(iso: string): { y: number; m: number; d: number } {
	return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

function formatPoint(iso: string, precision: Precision): string {
	const { y, m, d } = partsOf(iso);
	if (precision === 'year') return String(y);
	if (precision === 'month') return `${MONTHS[m - 1]} ${y}`;
	return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * The date as people write it, at its precision: "14 Mar 2019", "Mar 2019", "2019", "Mar–May 2019",
 * "14 Mar – 2 Apr 2019", "from Mar 2019", "until 2020", and "(approx.)" when approximate.
 */
export function formatDate(d: PreciseDate): string {
	const approx = d.approximate ? ' (approx.)' : '';
	if (!d.range) return formatPoint(d.start!, d.precision) + approx;
	if (d.start === null) return `until ${formatPoint(d.end!, d.endPrecision)}${approx}`;
	if (d.end === null) return `from ${formatPoint(d.start, d.precision)}${approx}`;
	const s = partsOf(d.start);
	const e = partsOf(d.end);
	let text: string;
	if (d.precision === 'year' && d.endPrecision === 'year') {
		text = s.y === e.y ? String(s.y) : `${s.y}–${e.y}`;
	} else if (d.precision === 'month' && d.endPrecision === 'month') {
		text = s.y === e.y
			? (s.m === e.m ? `${MONTHS[s.m - 1]} ${s.y}` : `${MONTHS[s.m - 1]}–${MONTHS[e.m - 1]} ${s.y}`)
			: `${MONTHS[s.m - 1]} ${s.y} – ${MONTHS[e.m - 1]} ${e.y}`;
	} else if (d.precision === 'day' && d.endPrecision === 'day') {
		if (s.y === e.y && s.m === e.m) text = s.d === e.d ? `${s.d} ${MONTHS[s.m - 1]} ${s.y}` : `${s.d}–${e.d} ${MONTHS[s.m - 1]} ${s.y}`;
		else if (s.y === e.y) text = `${s.d} ${MONTHS[s.m - 1]} – ${e.d} ${MONTHS[e.m - 1]} ${s.y}`;
		else text = `${s.d} ${MONTHS[s.m - 1]} ${s.y} – ${e.d} ${MONTHS[e.m - 1]} ${e.y}`;
	} else {
		text = `${formatPoint(d.start, d.precision)} – ${formatPoint(d.end, d.endPrecision)}`;
	}
	return text + approx;
}

/** The date in the form it is written in notes ("2019-03", "~2019-03-14..2019-05"). */
export function toInput(d: PreciseDate): string {
	const point = (iso: string, p: Precision) => (p === 'year' ? iso.slice(0, 4) : p === 'month' ? iso.slice(0, 7) : iso);
	const tilde = d.approximate ? '~' : '';
	if (!d.range) return tilde + point(d.start!, d.precision);
	const a = d.start === null ? '' : tilde + point(d.start, d.precision);
	const b = d.end === null ? '' : (d.approximate && d.start === null ? '~' : '') + point(d.end, d.endPrecision);
	return `${a}..${b}`;
}

/** Today, YYYY-MM-DD, in local time. */
export function today(now: Date = new Date()): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A day plus a number of days, YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
	const { y, m, d } = partsOf(day);
	const t = new Date(Date.UTC(y, m - 1, d + n));
	return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
	const pa = partsOf(a);
	const pb = partsOf(b);
	return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}
