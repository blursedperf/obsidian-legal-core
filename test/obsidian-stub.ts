/** A minimal stand-in for the parts of the Obsidian API used by code under test (the package has only types). */
export class TAbstractFile { constructor(public path: string) {} }
export class TFile extends TAbstractFile {
	get extension() { return this.path.split('.').pop()!; }
	get basename() { return this.path.split('/').pop()!.replace(/\.[^.]+$/, ''); }
}
export const notices: string[] = [];
export class Notice { constructor(public message: string) { notices.push(message); } }
export function normalizePath(p: string): string { return p.replace(/\/+/g, '/').replace(/^\/|\/$/g, ''); }
export type App = unknown;
export type Plugin = unknown;
export class PluginSettingTab { constructor(..._args: unknown[]) {} }
export class Setting { constructor(..._args: unknown[]) {} }
export type SettingDefinitionItem = unknown;
