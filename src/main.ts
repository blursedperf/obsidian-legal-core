/**
 * Legal Core (Australia): the shared foundation of the legal-writing plugins. It hosts the shared
 * authority store and the export engine, and exposes them to other plugins as `api` (see API.md).
 *
 * Other plugins find it with `app.plugins.getPlugin('au-legal-core')?.api`, or by listening for the
 * workspace events "legal-core:ready" (with the API) and "legal-core:unload". Every plugin of the suite
 * must also work without it.
 */
import { Plugin, TFile, normalizePath } from 'obsidian';
import type { LegalCoreApi } from '@legal-core/api';
import { AuthorityStore, FileBackend } from '@legal-core/authority-store';
import { createLegalCoreApi } from './api';
import { DEFAULT_SETTINGS, type LegalCoreSettings, LegalCoreSettingTab } from './settings';

export const READY_EVENT = 'legal-core:ready';
export const UNLOAD_EVENT = 'legal-core:unload';

export default class LegalCorePlugin extends Plugin {
	settings: LegalCoreSettings = DEFAULT_SETTINGS;
	store!: AuthorityStore;
	api!: LegalCoreApi & { extensionIds(): string[] };

	async onload() {
		await this.loadSettings();
		this.store = new AuthorityStore(new FileBackend(this.app.vault.adapter, normalizePath(this.settings.authorityFile)));
		this.api = createLegalCoreApi(this.store, {
			readFile: async (file) => {
				const f = this.app.vault.getAbstractFileByPath(file.path);
				return f instanceof TFile ? this.app.vault.read(f) : this.app.vault.adapter.read(normalizePath(file.path));
			},
			selectedTemplate: () => this.settings.template,
			saveSelectedTemplate: (id) => {
				this.settings.template = id;
				void this.saveSettings();
			},
		});
		this.addSettingTab(new LegalCoreSettingTab(this.app, this));
		// Tell plugins that are already running; plugins loaded later find the API through getPlugin.
		this.app.workspace.onLayoutReady(() => { this.app.workspace.trigger(READY_EVENT, this.api); });
	}

	onunload() {
		this.app.workspace.trigger(UNLOAD_EVENT);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<LegalCoreSettings> | null);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
