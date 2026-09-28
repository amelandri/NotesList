import { AbstractInputSuggest, App, TFile } from "obsidian";

export class TemplateSuggest extends AbstractInputSuggest<TFile> {
	constructor(app: App, private inputEl: HTMLInputElement) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFile[] {
		const lowerQuery = query.toLowerCase();
		return this.app.vault.getMarkdownFiles().filter((file) => file.path.toLowerCase().contains(lowerQuery));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.inputEl.value = file.path;
		this.inputEl.trigger("input");
		this.close();
	}
}
