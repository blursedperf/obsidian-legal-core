import { describe, expect, it } from 'vitest';
import { addDays, compareDates, containsDay, daysBetween, formatDate, intersection, mustParse, overlaps, parseDate, toInput, today } from '@legal-core/precise-date';

const d = (s: string) => mustParse(s);

describe('parsing', () => {
	it.each([
		['2019', { start: '2019-01-01', end: '2019-12-31', precision: 'year', endPrecision: 'year', approximate: false, range: false }],
		['2019-03', { start: '2019-03-01', end: '2019-03-31', precision: 'month', endPrecision: 'month', approximate: false, range: false }],
		['2019-02', { start: '2019-02-01', end: '2019-02-28', precision: 'month', endPrecision: 'month', approximate: false, range: false }],
		['2020-02', { start: '2020-02-01', end: '2020-02-29', precision: 'month', endPrecision: 'month', approximate: false, range: false }],
		['2019-03-14', { start: '2019-03-14', end: '2019-03-14', precision: 'day', endPrecision: 'day', approximate: false, range: false }],
		['~2019-03', { start: '2019-03-01', end: '2019-03-31', precision: 'month', endPrecision: 'month', approximate: true, range: false }],
		['2019-03..2019-05', { start: '2019-03-01', end: '2019-05-31', precision: 'month', endPrecision: 'month', approximate: false, range: true }],
		['2019-03-14..2019-04', { start: '2019-03-14', end: '2019-04-30', precision: 'day', endPrecision: 'month', approximate: false, range: true }],
		['2019..2021', { start: '2019-01-01', end: '2021-12-31', precision: 'year', endPrecision: 'year', approximate: false, range: true }],
		['~2019..~2020', { start: '2019-01-01', end: '2020-12-31', precision: 'year', endPrecision: 'year', approximate: true, range: true }],
		['2019-03..', { start: '2019-03-01', end: null, precision: 'month', endPrecision: 'month', approximate: false, range: true }],
		['..2020', { start: null, end: '2020-12-31', precision: 'year', endPrecision: 'year', approximate: false, range: true }],
		['  2019-03-14  ', { start: '2019-03-14', end: '2019-03-14', precision: 'day', endPrecision: 'day', approximate: false, range: false }],
		['2019-03-14..2019-03-14', { start: '2019-03-14', end: '2019-03-14', precision: 'day', endPrecision: 'day', approximate: false, range: true }],
	])('reads "%s"', (input, expected) => {
		expect(parseDate(input)).toEqual({ ok: true, date: expected });
	});

	it('reads numbers (a YAML year) and dates (YAML parses 2019-03-14 to a Date)', () => {
		expect(parseDate(2019)).toEqual(parseDate('2019'));
		expect(parseDate(new Date(Date.UTC(2019, 2, 14)))).toEqual(parseDate('2019-03-14'));
	});

	it.each([
		['', 'no date given'],
		['   ', 'no date given'],
		['2019-02-30', 'February 2019 has no day 30'],
		['2019-02-29', 'February 2019 has no day 29'],
		['2019-13', '13 is not a month'],
		['2019-00', '00 is not a month'],
		['2019-04-31', 'April 2019 has no day 31'],
		['2019-03-00', 'March 2019 has no day 0'],
		['0999', '0999 is not a valid year'],
		['19-03-14', 'is not a date'],
		['14/03/2019', 'is not a date'],
		['March 2019', 'is not a date'],
		['2019-3-14', 'is not a date'],
		['2019-05..2019-03', 'ends before it starts'],
		['..', 'at least one end'],
		['2019..2020..2021', 'more than one ".."'],
		['~', 'is not a date'],
		['2019-03-14T10:00', 'is not a date'],
	])('rejects "%s"', (input, reason) => {
		const r = parseDate(input);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toContain(reason);
	});

	it('rejects what is not a date, without throwing', () => {
		for (const v of [null, undefined, {}, [], 2019.5, NaN, new Date('nonsense')]) expect(parseDate(v).ok).toBe(false);
		expect(() => mustParse('2019-02-30')).toThrow('no day 30');
	});
});

describe('sorting', () => {
	it('sorts by first day, then the shorter span first, never as a made-up day', () => {
		const items = ['2019-03-14', '2019', 'Mar', '2019-03-01', '~2019-03', '2018-12-31', '2019-03..2019-05', '2019-03..'];
		const dates = items.map((s) => (s === 'Mar' ? d('2019-03') : d(s)));
		const sorted = [...dates].sort(compareDates).map(toInput);
		expect(sorted).toEqual(['2018-12-31', '2019', '2019-03-01', '2019-03', '~2019-03', '2019-03..2019-05', '2019-03..', '2019-03-14']);
	});

	it('puts a year after the days and months it starts with, and an open start first', () => {
		expect([d('2019-06'), d('..2019'), d('2019')].sort(compareDates).map(toInput)).toEqual(['..2019', '2019', '2019-06']);
	});

	it('is deterministic: the same order whatever the input order', () => {
		const inputs = ['2019', '2019-01', '2019-01-01', '~2019-01-01', '2019-01..2019-02', '2019..', '..2019-01'];
		const reference = inputs.map(d).sort(compareDates).map(toInput);
		let seed = 11;
		for (let k = 0; k < 50; k++) {
			const shuffled = [...inputs].sort(() => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return (seed % 3) - 1; });
			expect(shuffled.map(d).sort(compareDates).map(toInput)).toEqual(reference);
		}
	});

	it('treats equal dates as equal, and is antisymmetric', () => {
		expect(compareDates(d('2019-03'), d('2019-03'))).toBe(0);
		const pairs: [string, string][] = [['2019', '2019-03'], ['2019-03-01', '2019-03'], ['2019-03', '~2019-03'], ['2019-03', '2019-03..2019-03']];
		for (const [a, b] of pairs) expect(Math.sign(compareDates(d(a), d(b)))).toBe(-Math.sign(compareDates(d(b), d(a))));
	});
});

describe('overlap', () => {
	it.each([
		['2019-03', '2019-03-14', true],
		['2019-03', '2019-04', false],
		['2019-03..2019-05', '2019-05-31', true],
		['2019-03..2019-05', '2019-06-01', false],
		['2019..', '2030-01-01', true],
		['..2019', '2019-12-31', true],
		['..2019', '2020', false],
		['2019..', '..2018', false],
		['2019..', '..2019-01', true],
		['..2019', '2018..', true],
	])('%s and %s: %s', (a, b, expected) => {
		expect(overlaps(d(a), d(b))).toBe(expected);
		expect(overlaps(d(b), d(a))).toBe(expected);
	});

	it('gives the shared days', () => {
		expect(intersection(d('2019-03..2019-06'), d('2019-05..'))).toEqual({ start: '2019-05-01', end: '2019-06-30' });
		expect(intersection(d('..2019'), d('2018..'))).toEqual({ start: '2018-01-01', end: '2019-12-31' });
		expect(intersection(d('2019'), d('2020'))).toBeNull();
		expect(containsDay(d('2019-03'), '2019-03-31')).toBe(true);
		expect(containsDay(d('2019-03'), '2019-04-01')).toBe(false);
	});
});

describe('display', () => {
	it.each([
		['2019', '2019'],
		['2019-03', 'Mar 2019'],
		['2019-03-14', '14 Mar 2019'],
		['~2019-03', 'Mar 2019 (approx.)'],
		['~2019', '2019 (approx.)'],
		['2019-03..2019-05', 'Mar–May 2019'],
		['2019-11..2020-02', 'Nov 2019 – Feb 2020'],
		['2019..2021', '2019–2021'],
		['2019-03-14..2019-03-20', '14–20 Mar 2019'],
		['2019-03-14..2019-04-02', '14 Mar – 2 Apr 2019'],
		['2019-12-30..2020-01-02', '30 Dec 2019 – 2 Jan 2020'],
		['2019-03-14..2019-04', '14 Mar 2019 – Apr 2019'],
		['2019-03..', 'from Mar 2019'],
		['..2020', 'until 2020'],
		['~2019..~2020', '2019–2020 (approx.)'],
		['2019-03..2019-03', 'Mar 2019'],
	])('shows "%s" as "%s"', (input, shown) => {
		expect(formatDate(d(input))).toBe(shown);
	});

	it('writes every date back as it was written', () => {
		for (const s of ['2019', '2019-03', '2019-03-14', '~2019-03', '2019-03..2019-05', '2019-03-14..2019-04', '2019..', '..2020', '~2019..2020']) {
			const back = toInput(d(s));
			expect(mustParse(back)).toEqual(d(s));
		}
	});
});

describe('days', () => {
	it('adds and counts days across months and leap years', () => {
		expect(addDays('2020-02-28', 1)).toBe('2020-02-29');
		expect(addDays('2019-12-31', 1)).toBe('2020-01-01');
		expect(addDays('2019-03-01', -1)).toBe('2019-02-28');
		expect(daysBetween('2019-01-01', '2020-01-01')).toBe(365);
		expect(daysBetween('2020-01-01', '2021-01-01')).toBe(366);
		expect(daysBetween('2019-03-14', '2019-03-01')).toBe(-13);
		expect(today(new Date(2026, 10, 19, 23, 59))).toBe('2026-11-19');
	});
});
