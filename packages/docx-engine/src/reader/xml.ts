/**
 * A minimal XML parser for the parts of a .docx file. Word's XML is machine-written and well formed, so
 * this handles elements, attributes, text and the predefined and numeric entities; comments, processing
 * instructions and CDATA are skipped.
 */

export interface XmlElement {
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
}

export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

function decode(s: string): string {
	return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
		if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
		if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
		return ENTITIES[e] ?? m;
	});
}

export function parseXml(xml: string): XmlElement {
	const root: XmlElement = { name: '#root', attrs: {}, children: [] };
	const stack: XmlElement[] = [root];
	const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) {
		const top = stack[stack.length - 1]!;
		if (m[1] !== undefined) {
			top.children.push(m[1]);
		} else if (m[2] !== undefined) {
			if (stack.length > 1) stack.pop();
		} else if (m[3] !== undefined) {
			const attrs: Record<string, string> = {};
			for (const a of m[4]!.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = decode(a[2] ?? a[3] ?? '');
			const el: XmlElement = { name: m[3], attrs, children: [] };
			top.children.push(el);
			if (m[5] !== '/') stack.push(el);
		} else if (m[6] !== undefined) {
			top.children.push(decode(m[6]));
		}
	}
	return root;
}

export function isElement(n: XmlNode | undefined): n is XmlElement {
	return typeof n === 'object' && n !== null;
}

/** Direct children with the given name. */
export function kids(el: XmlElement | undefined, name?: string): XmlElement[] {
	if (!el) return [];
	return el.children.filter((c): c is XmlElement => isElement(c) && (name === undefined || c.name === name));
}

export function kid(el: XmlElement | undefined, name: string): XmlElement | undefined {
	return el?.children.find((c): c is XmlElement => isElement(c) && c.name === name);
}

/** First descendant with the given name, depth first. */
export function find(el: XmlElement | undefined, name: string): XmlElement | undefined {
	if (!el) return undefined;
	for (const c of el.children) {
		if (!isElement(c)) continue;
		if (c.name === name) return c;
		const f = find(c, name);
		if (f) return f;
	}
	return undefined;
}

export function findAll(el: XmlElement | undefined, name: string, out: XmlElement[] = []): XmlElement[] {
	if (!el) return out;
	for (const c of el.children) {
		if (!isElement(c)) continue;
		if (c.name === name) out.push(c);
		findAll(c, name, out);
	}
	return out;
}

export function textOf(el: XmlElement): string {
	return el.children.map((c) => (isElement(c) ? textOf(c) : c)).join('');
}
