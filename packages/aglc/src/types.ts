export type Severity = 'error' | 'warning' | 'info';

/** A replacement that fixes an issue. Offsets use the same coordinate space as the issue. */
export interface Fix {
	from: number;
	to: number;
	insert: string;
	label?: string;
}

export interface Issue {
	/** Stable identifier of the rule, used to disable it in settings. */
	rule: string;
	severity: Severity;
	from: number;
	to: number;
	message: string;
	/** The AGLC4 rule or chapter the issue comes from, for display. */
	ref?: string;
	fix?: Fix;
}

/** Move an issue (and its fix) by `delta` characters. */
export function shiftIssue(issue: Issue, delta: number): Issue {
	return {
		...issue,
		from: issue.from + delta,
		to: issue.to + delta,
		fix: issue.fix ? { ...issue.fix, from: issue.fix.from + delta, to: issue.fix.to + delta } : undefined,
	};
}
