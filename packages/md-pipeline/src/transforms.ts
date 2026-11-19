/**
 * Ordered transforms: steps that change a parsed document before it is rendered. Each names the steps it
 * must run after; they run in an order that respects those dependencies, and otherwise in the order given.
 */
import type { MdDocument } from '@legal-core/ldm';

export interface Transform<C = unknown> {
	/** Unique among the transforms run together. */
	id: string;
	/** Ids of transforms that must run before this one. */
	after?: string[];
	/** Ids of transforms that must run after this one. */
	before?: string[];
	run(doc: MdDocument, ctx: C): void;
}

export class TransformOrderError extends Error {}

export interface OrderOptions {
	/**
	 * Treat a dependency on a transform that is not present as met, rather than an error: "run after it,
	 * if it is there". For extensions, which may load in any order or not at all.
	 */
	optionalDependencies?: boolean;
}

/**
 * The transforms in an order that respects their dependencies, keeping the given order where it is free
 * (a stable topological sort). Throws on a duplicate id, a cycle, or (unless dependencies are optional) a
 * dependency on an unknown transform, naming the transforms involved.
 */
export function orderTransforms<C>(transforms: readonly Transform<C>[], options: OrderOptions = {}): Transform<C>[] {
	const byId = new Map<string, Transform<C>>();
	for (const t of transforms) {
		if (byId.has(t.id)) throw new TransformOrderError(`Two transforms have the id "${t.id}".`);
		byId.set(t.id, t);
	}
	if (!options.optionalDependencies) {
		for (const t of transforms) {
			for (const dep of t.after ?? []) {
				if (!byId.has(dep)) throw new TransformOrderError(`Transform "${t.id}" runs after "${dep}", which is not registered.`);
			}
		}
	}
	// "a before b" is "b after a": every constraint becomes a dependency of the later transform.
	const deps = new Map<string, string[]>(transforms.map((t) => [t.id, [...(t.after ?? [])]]));
	for (const t of transforms) {
		for (const later of t.before ?? []) {
			if (byId.has(later)) deps.get(later)!.push(t.id);
			else if (!options.optionalDependencies) throw new TransformOrderError(`Transform "${t.id}" runs before "${later}", which is not registered.`);
		}
	}
	const out: Transform<C>[] = [];
	const done = new Set<string>();
	const visiting: string[] = [];
	const visit = (t: Transform<C>) => {
		if (done.has(t.id)) return;
		const at = visiting.indexOf(t.id);
		if (at >= 0) throw new TransformOrderError(`Transforms depend on each other in a cycle: ${[...visiting.slice(at), t.id].join(' → ')}.`);
		visiting.push(t.id);
		for (const dep of deps.get(t.id)!) {
			const d = byId.get(dep);
			if (d) visit(d);
		}
		visiting.pop();
		done.add(t.id);
		out.push(t);
	};
	for (const t of transforms) visit(t);
	return out;
}

/** Run the transforms on the document, in dependency order. */
export function runTransforms<C>(doc: MdDocument, transforms: readonly Transform<C>[], ctx: C, options: OrderOptions = {}): MdDocument {
	for (const t of orderTransforms(transforms, options)) t.run(doc, ctx);
	return doc;
}
