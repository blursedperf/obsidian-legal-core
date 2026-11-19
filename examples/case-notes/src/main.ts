/**
 * Example: a case-notes plugin built on Legal Core.
 *
 * It shows the pattern every plugin of the suite follows:
 * 1. Find Legal Core when the workspace is ready (plugins load in any order), and again whenever it
 *    announces itself; check the API version it needs.
 * 2. Register its extension, and stop using the API when Legal Core unloads.
 * 3. Keep working without Legal Core, here by telling the user what needs it.
 *
 * It uses only the API's types (`import type`), so it has no run-time dependency on Legal Core.
 */
import { type App, type EventRef, type Events, Notice, Plugin, TFile } from 'obsidian';
import type { LegalCoreApi } from '@legal-core/api';
import { caseNotesExtension } from './extension';

const CORE_ID = 'au-legal-core';
const API_RANGE = '^1.0';

/** Legal Core's API, if it is installed, enabled and compatible. */
function findLegalCore(app: App): LegalCoreApi | null {
	// app.plugins is not in Obsidian's public typings: it is read here, in one place, defensively.
	const plugins = (app as unknown as { plugins?: { getPlugin(id: string): { api?: LegalCoreApi } | null } }).plugins;
	const api = plugins?.getPlugin(CORE_ID)?.api;
	return api && typeof api.satisfies === 'function' && api.satisfies(API_RANGE) ? api : null;
}

/**
 * Listen for one of Legal Core's workspace events. Obsidian's typings list only the workspace's own
 * events, so the call goes through the general Events interface the workspace inherits.
 */
function onLegalCore(app: App, name: 'legal-core:ready' | 'legal-core:unload', fn: (...data: unknown[]) => void): EventRef {
	return (app.workspace as unknown as Events).on(name, fn);
}

export default class CaseNotesPlugin extends Plugin {
	private core: LegalCoreApi | null = null;
	private unregister: (() => void) | null = null;

	onload() {
		this.app.workspace.onLayoutReady(() => { this.connect(findLegalCore(this.app)); });
		// Legal Core enabled (or reloaded) while this plugin is running.
		this.registerEvent(onLegalCore(this.app, 'legal-core:ready', (api) => {
			const core = api as LegalCoreApi;
			this.connect(core && core.satisfies(API_RANGE) ? core : null);
		}));
		// Legal Core disabled: stop using it. Its registry goes with it, so there is nothing to unregister.
		this.registerEvent(onLegalCore(this.app, 'legal-core:unload', () => {
			this.core = null;
			this.unregister = null;
		}));

		this.addCommand({
			id: 'export-case-note',
			name: 'Export case note to Word',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!(file instanceof TFile) || file.extension !== 'md') return false;
				if (!checking) void this.exportNote(file);
				return true;
			},
		});
	}

	onunload() {
		this.unregister?.();
	}

	private connect(core: LegalCoreApi | null) {
		if (!core || core === this.core) return;
		this.unregister?.();
		this.core = core;
		this.unregister = core.registerExtension(caseNotesExtension);
	}

	private async exportNote(file: TFile) {
		if (!this.core) {
			new Notice('Exporting case notes needs the Legal Core (Australia) plugin.');
			return;
		}
		const bytes = await this.core.exportDocx(file);
		const path = `${file.parent?.path ? `${file.parent.path}/` : ''}${file.basename}.docx`;
		const existing = this.app.vault.getAbstractFileByPath(path);
		const data = bytes.slice().buffer;
		if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, data);
		else await this.app.vault.createBinary(path, data);
		new Notice(`Exported ${path}.`);
	}
}
