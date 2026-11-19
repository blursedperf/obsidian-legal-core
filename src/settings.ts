import { type App, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import type LegalCorePlugin from './main';

export interface LegalCoreSettings {
	/** Vault file holding the shared authorities. */
	authorityFile: string;
	/** Id of the template used by default in exports, if any. */
	template: string | null;
}

export const DEFAULT_SETTINGS: LegalCoreSettings = {
	authorityFile: '.legal-core/authorities.json',
	template: null,
};

export class LegalCoreSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: LegalCorePlugin) {
		super(app, plugin);
	}

	private authorityFileDesc = 'Vault file holding the cases, legislation and sources shared between legal plugins. A name starting with "." keeps it out of the file list. Takes effect after Obsidian restarts.';

	private countAuthorities(setting: Setting) {
		setting.setDesc('Counting…');
		void this.plugin.api.authorities.query().then((records) => {
			const by = (k: string) => records.filter((r) => r.kind === k).length;
			setting.setDesc(`${records.length} in all: ${by('case')} cases, ${by('legislation')} legislation, ${by('secondary')} secondary sources.`);
		});
	}

	private extensionsDesc(): string {
		const ids = this.plugin.api.extensionIds();
		return ids.length > 0 ? ids.join(', ') : 'None. Legal plugins that build on Legal Core register here when they load.';
	}

	private templateDesc(): string {
		return this.plugin.api.templates.list().length > 0
			? 'The reference Word document whose styles exports use.'
			: 'No templates are registered. Legal plugins can register reference Word documents.';
	}

	private templateOptions(): Record<string, string> {
		const options: Record<string, string> = { '': 'None' };
		for (const t of this.plugin.api.templates.list()) options[t.id] = t.name;
		return options;
	}

	/** Declarative settings (Obsidian 1.13 and later), which appear in settings search. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Shared authorities',
				items: [
					{ name: 'Authorities file', desc: this.authorityFileDesc, control: { type: 'text', key: 'authorityFile', placeholder: DEFAULT_SETTINGS.authorityFile } },
					{ name: 'Stored authorities', render: (setting) => { this.countAuthorities(setting); } },
				],
			},
			{
				type: 'group',
				heading: 'Extensions',
				items: [{ name: 'Registered extensions', render: (setting) => { setting.setDesc(this.extensionsDesc()); } }],
			},
			{
				type: 'group',
				heading: 'Templates',
				items: [{ name: 'Default template', desc: this.templateDesc(), control: { type: 'dropdown', key: 'template', options: this.templateOptions() } }],
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === 'authorityFile') return this.plugin.settings.authorityFile;
		if (key === 'template') return this.plugin.api.templates.selected() ?? '';
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'authorityFile') {
			this.plugin.settings.authorityFile = String(value).trim().replace(/^\/+|\/+$/g, '') || DEFAULT_SETTINGS.authorityFile;
			await this.plugin.saveSettings();
		} else if (key === 'template') {
			this.plugin.api.templates.select(String(value) || null);
		}
	}

	/** Fallback for Obsidian before 1.13, which has no declarative settings. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const api = this.plugin.api;

		new Setting(containerEl).setName('Shared authorities').setHeading();
		new Setting(containerEl)
			.setName('Authorities file')
			.setDesc(this.authorityFileDesc)
			.addText((t) => t.setPlaceholder(DEFAULT_SETTINGS.authorityFile).setValue(this.plugin.settings.authorityFile).onChange((v) => { void this.setControlValue('authorityFile', v); }));
		this.countAuthorities(new Setting(containerEl).setName('Stored authorities'));

		new Setting(containerEl).setName('Extensions').setHeading();
		new Setting(containerEl).setName('Registered extensions').setDesc(this.extensionsDesc());

		new Setting(containerEl).setName('Templates').setHeading();
		new Setting(containerEl)
			.setName('Default template')
			.setDesc(this.templateDesc())
			.addDropdown((d) => {
				d.addOptions(this.templateOptions());
				d.setValue(api.templates.selected() ?? '').onChange((v) => { void this.setControlValue('template', v); });
			});
	}
}
