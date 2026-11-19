/**
 * Footnote tidying with AGLC4's back matter: a bibliography at the end of a note stays after the footnote
 * definitions (see bibliographyStart).
 */
import { type TidyOptions, type TidyResult, tidyFootnotes as tidy } from '@legal-core/md-pipeline';
import { bibliographyStart } from './headings';

export function tidyFootnotes(text: string, opts: TidyOptions): TidyResult {
	return tidy(text, { backMatter: (body) => bibliographyStart(body), ...opts });
}
