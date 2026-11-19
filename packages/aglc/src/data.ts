/**
 * Reference data used by the AGLC4 grammar and lint rules.
 *
 * The lists are deliberately conservative: an entry is only here when its AGLC4 treatment is settled,
 * so that the checker never flags a correct citation because a list guessed wrong.
 */

/** Australian and common foreign jurisdiction abbreviations used after statute titles (AGLC4 r 3.1.3). */
export const JURISDICTIONS = [
	'Cth', 'NSW', 'Vic', 'Qld', 'WA', 'SA', 'Tas', 'ACT', 'NT', 'Norfolk Island',
	'NZ', 'UK', 'Imp', 'Can', 'US', 'Ire', 'Sing', 'Malaysia', 'South Africa',
] as const;

/** Spelled-out or dotted jurisdictions that must be abbreviated. */
export const JURISDICTION_FIXES: Record<string, string> = {
	'Commonwealth': 'Cth',
	'Cwlth': 'Cth',
	'C\'th': 'Cth',
	'New South Wales': 'NSW',
	'N.S.W.': 'NSW',
	'Victoria': 'Vic',
	'Vict': 'Vic',
	'Queensland': 'Qld',
	'Qld.': 'Qld',
	'Western Australia': 'WA',
	'W.A.': 'WA',
	'South Australia': 'SA',
	'S.A.': 'SA',
	'Tasmania': 'Tas',
	'Australian Capital Territory': 'ACT',
	'A.C.T.': 'ACT',
	'Northern Territory': 'NT',
	'N.T.': 'NT',
	'New Zealand': 'NZ',
	'United Kingdom': 'UK',
};

/**
 * Medium neutral citation court identifiers (AGLC4 r 2.3.1). A citation whose "report series" is one of
 * these is a medium neutral citation, not a reported case.
 */
export const MNC_COURTS = new Set([
	// High Court and federal
	'HCA', 'HCASL', 'HCATrans', 'FCA', 'FCAFC', 'FamCA', 'FamCAFC', 'FCCA', 'FMCA', 'FedCFamC1A', 'FedCFamC1F',
	'FedCFamC2F', 'FedCFamC2G', 'AATA', 'ARTA', 'FWC', 'FWCFB', 'NNTTA', 'IRCA', 'ACompT', 'ACopyT', 'APO',
	// New South Wales
	'NSWSC', 'NSWCA', 'NSWCCA', 'NSWLEC', 'NSWIRComm', 'NSWDC', 'NSWLC', 'NSWCATAD', 'NSWCATAP', 'NSWCATCD',
	'NSWCATGD', 'NSWCATOD', 'NSWADT', 'NSWDDT', 'NSWWCCPD', 'NSWIC', 'NSWCIMC', 'NSWChC', 'NSWPC',
	// Victoria
	'VSC', 'VSCA', 'VCC', 'VMC', 'VCAT', 'VChC', 'VCrC', 'VLRC',
	// Queensland
	'QSC', 'QCA', 'QDC', 'QCAT', 'QCATA', 'QLC', 'QLAC', 'QMC', 'QPEC', 'QIRC', 'QChC', 'ICQ',
	// Western Australia
	'WASC', 'WASCA', 'WADC', 'WASAT', 'WAIRC', 'WACC',
	// South Australia
	'SASC', 'SASCFC', 'SASCA', 'SADC', 'SACAT', 'SAERDC', 'SAET', 'SAIRC', 'SAMC', 'SAYC', 'SACC',
	// Tasmania
	'TASSC', 'TASFC', 'TASCCA', 'TASMC', 'TASRMPAT', 'TASCAT',
	// Territories
	'ACTSC', 'ACTCA', 'ACTMC', 'ACAT', 'NTSC', 'NTCA', 'NTCCA', 'NTLC', 'NTCAT', 'NTMC',
	// New Zealand and the United Kingdom
	'NZSC', 'NZCA', 'NZHC', 'NZDC', 'NZEmpC', 'UKSC', 'UKPC', 'UKHL', 'EWCA Civ', 'EWCA Crim', 'EWHC',
	'CSIH', 'CSOH', 'NICA',
]);

/** Report series arranged by volume number: the year goes in round brackets (AGLC4 r 2.2.1). */
/**
 * Report series arranged by volume number: the year goes in round brackets (AGLC4 r 2.2.1). Only series
 * that have always been arranged this way are listed: some (eg NSWLR, VR, SASR, WAR) have changed, and the
 * arrangement of the volume cited decides ("[1976] 2 NSWLR 72" but "(2002) 6 VR 317").
 */
export const VOLUME_SERIES = new Set([
	'CLR', 'ALR', 'ALJR', 'FCR', 'FLR', 'A Crim R', 'IR', 'IPR', 'ACSR', 'ACLC', 'Fam LR',
	'LGERA', 'MVR', 'ALD', 'AAR', 'NTLR', 'Tas R', 'US', 'S Ct', 'F 2d', 'F 3d', 'F 4th', 'DLR', 'SCR',
]);

/** Report series arranged by year: the year goes in square brackets (AGLC4 r 2.2.1). */
export const YEAR_SERIES = new Set([
	'AC', 'QB', 'KB', 'Ch', 'Fam', 'WLR', 'All ER', 'Qd R', 'Tas SR', 'SR (NSW)', 'NZLR',
	'Lloyd\'s Rep', 'BCLC', 'ICR', 'IRLR', 'EMLR', 'RPC', 'FSR', 'Cr App R', 'P', 'CLC', 'VLR', 'St R Qd', 'QSR',
]);

export const MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];

/** Introductory signals in their AGLC4 form (AGLC4 r 1.2). Longest first so the regex prefers them. */
export const SIGNALS = [
	'See, eg,', 'See especially', 'See generally', 'See also', 'But see', 'Contra', 'Compare', 'Cf', 'See',
];

/** Pinpoint designators used with legislation and treaties (AGLC4 ch 3 and ch 8). */
export const LEG_PINPOINTS = [
	// Unabbreviated forms are accepted so the citation is recognised; a lint rule asks for "s"/"ss".
	'sections', 'section', 'secs.', 'sec.', 'secs', 'sec',
	// AGLC4 r 3.1.4 and 3.4 (longest first, so "sub-ss" is preferred to "s")
	'sub-paras', 'sub-para', 'sub-divs', 'sub-div', 'sub-cls', 'sub-cl', 'sub-regs', 'sub-reg', 'sub-rr', 'sub-r',
	'sub-ss', 'sub-s', 'ss', 's', 'pts', 'pt', 'divs', 'div', 'subdivs', 'subdiv', 'schs', 'sch', 'regs', 'reg',
	'rr', 'r', 'cls', 'cl', 'arts', 'art', 'items', 'item', 'paras', 'para', 'chs', 'ch', 'apps', 'app', 'ords', 'ord',
	'annex', 'O', 'form',
];

/** Escape a string for use inside a RegExp. */
export function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
