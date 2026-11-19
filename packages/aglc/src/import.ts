/**
 * Word import with the AGLC4 heading hierarchy: numbers typed into headings in the AGLC4 sequence
 * (I, A, 1, (a), (i)) are recognised and removed, so the headings stay plain.
 */
import { type ImportResult, importDocx as read } from '@legal-core/docx-engine';
import { hasTypedNumber, numberHeadings, stripTypedNumber } from './headings';

export type { ImportResult };

export function importDocx(data: Uint8Array): ImportResult {
	return read(data, { numberHeadings, hasTypedNumber, stripTypedNumber });
}
