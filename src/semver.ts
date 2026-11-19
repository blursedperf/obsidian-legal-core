/**
 * Semantic version ranges, enough for plugins to check the Legal Core API they need: caret (^1.2),
 * tilde (~1.2.0), comparisons (>=1.1.0 <2), x-ranges (1.x, 1.2.*, *), exact versions, and alternatives
 * joined by "||". Pre-release versions are not supported.
 */

type Version = [number, number, number];

function parse(v: string): Version | null {
	const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a: Version, b: Version): number {
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** A partial version ("1", "1.2", "1.x", "*"): the parts given, with x or * for any. */
function partial(v: string): (number | null)[] | null {
	const parts = v.trim().replace(/^v/, '').split('.');
	if (parts.length === 0 || parts.length > 3 || parts[0] === '') return null;
	const out: (number | null)[] = [];
	for (const p of parts) {
		if (p === 'x' || p === 'X' || p === '*') out.push(null);
		else if (/^\d+$/.test(p)) out.push(Number(p));
		else return null;
	}
	return out;
}

/** The range a comparator allows, as [lowest included, highest excluded] (either may be open). */
type Bound = { min?: Version; minIncl?: boolean; max?: Version; maxIncl?: boolean };

function comparator(c: string): Bound[] | null {
	const m = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(c.trim());
	if (!m) return null;
	const op = m[1] ?? '';
	const p = partial(m[2]!);
	if (!p) return null;
	const given = p.filter((x) => x !== null).length;
	const [maj = 0, min = 0, pat = 0] = p.map((x) => x ?? 0);
	const base: Version = [maj, min, pat];
	const wildcard = p.length < 3 || p.includes(null);
	switch (op) {
		case '^': {
			if (maj > 0 || given <= 1) return [{ min: base, minIncl: true, max: [maj + 1, 0, 0] }];
			if (min > 0 || given === 2) return [{ min: base, minIncl: true, max: [0, min + 1, 0] }];
			return [{ min: base, minIncl: true, max: [0, 0, pat + 1] }];
		}
		case '~':
			return [{ min: base, minIncl: true, max: given >= 2 ? [maj, min + 1, 0] : [maj + 1, 0, 0] }];
		case '>=': return [{ min: base, minIncl: true }];
		case '>': return [{ min: wildcard ? upper(p) : base, minIncl: wildcard }];
		case '<=': return [wildcard ? { max: upper(p) } : { max: base, maxIncl: true }];
		case '<': return [{ max: base }];
		default:
			if (!wildcard) return [{ min: base, minIncl: true, max: base, maxIncl: true }];
			if (given === 0) return [{}];
			return [{ min: base, minIncl: true, max: upper(p) }];
	}
}

/** The first version above an x-range ("1.x" → 2.0.0, "1.2" → 1.3.0). */
function upper(p: (number | null)[]): Version {
	const known = p.slice(0, p.findIndex((x) => x === null) === -1 ? p.length : p.findIndex((x) => x === null)) as number[];
	if (known.length === 0) return [Infinity, 0, 0];
	if (known.length === 1) return [known[0]! + 1, 0, 0];
	if (known.length === 2) return [known[0]!, known[1]! + 1, 0];
	return [known[0]!, known[1]!, known[2]! + 1];
}

function within(v: Version, b: Bound): boolean {
	if (b.min) {
		const c = compare(v, b.min);
		if (c < 0 || (c === 0 && !b.minIncl)) return false;
	}
	if (b.max) {
		const c = compare(v, b.max);
		if (c > 0 || (c === 0 && !b.maxIncl)) return false;
	}
	return true;
}

/** Whether `version` satisfies `range`. An invalid version or range satisfies nothing. */
export function satisfies(version: string, range: string): boolean {
	const v = parse(version);
	if (!v) return false;
	return range.split('||').some((alt) => {
		const parts = alt.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return false;
		return parts.every((c) => {
			const bounds = comparator(c);
			return bounds !== null && bounds.every((b) => within(v, b));
		});
	});
}
