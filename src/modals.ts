import { AbstractInputSuggest, App, Modal, Setting, TFolder, ToggleComponent } from "obsidian";
import type { AddDomainInput, DomainEntry, EntityType } from "./domain";
import { i18n } from "./i18n";
import { capList } from "./incremental-sources";
import { isSelectableSourceFolder } from "./source-paths";

export class BusyCloseModal extends Modal {
  constructor(app: App, private onAbort: () => void) { super(app); }
  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.busyCloseTitle });
    contentEl.createEl("p", { text: T.busyCloseBody });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.busyCloseLeave).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(T.busyCloseAbort).setWarning().onClick(() => {
        this.close();
        this.onAbort();
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private lines: string[],
    private onConfirm: () => void | Promise<void>,
  ) {
    super(app);
  }
  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    for (const line of this.lines) {
      contentEl.createEl("p", { text: line });
    }
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(`▶ ${T.run}`).setCta().onClick(() => {
        this.close();
        void this.onConfirm();
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}

export class FormatVisionModal extends Modal {
  constructor(
    app: App,
    private onChoice: (choice: "with" | "without") => void,
  ) { super(app); }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.formatVisionTitle });
    contentEl.createEl("p", { text: T.formatVisionBody });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(T.formatVisionWithout).onClick(() => {
        this.close();
        this.onChoice("without");
      }))
      .addButton((b) => b.setButtonText(T.formatVisionWith).setCta().onClick(() => {
        this.close();
        this.onChoice("with");
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}

export class InfoModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private lines: string[],
    private closeLabel: string,
  ) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    for (const line of this.lines) contentEl.createEl("p", { text: line });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(this.closeLabel).setCta().onClick(() => this.close()));
  }

  onClose(): void { this.contentEl.empty(); }
}

export class QueryModal extends Modal {
  private question = "";
  constructor(app: App, private onSubmit: (q: string) => void) {
    super(app);
  }
  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.query });
    const ta = contentEl.createEl("textarea", {
      cls: "ai-wiki-modal-input",
      attr: { rows: "5" },
      placeholder: T.queryPlaceholder,
    });
    ta.addEventListener("input", () => { this.question = ta.value; });
    new Setting(contentEl).addButton((b) =>
      b.setButtonText(`▶ ${T.run}`).setCta().onClick(() => {
        const q = this.question.trim();
        if (!q) return;
        this.close();
        this.onSubmit(q);
      }),
    );
    window.setTimeout(() => ta.focus(), 0);
  }
  onClose(): void { this.contentEl.empty(); }
}

export class DomainModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private allowAll: boolean,
    private extra: { dryRun?: boolean } | null,
    private domains: DomainEntry[],
    private onSubmit: (domain: string, flags: { dryRun?: boolean }) => void,
  ) {
    super(app);
  }
  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    let domain: string = this.allowAll ? "all" : (this.domains[0]?.id ?? "");
    let dryRun = false;

    if (this.domains.length === 0) {
      new Setting(contentEl)
        .setName(T.domain_name)
        .setDesc(T.noDomains_desc)
        .addText((t) => t.setPlaceholder(T.domainIdPlaceholder).onChange((v) => { domain = v.trim(); }));
    } else {
      new Setting(contentEl)
        .setName(T.domain_name)
        .addDropdown((d) => {
          if (this.allowAll) d.addOption("all", T.allWiki);
          for (const entry of this.domains) {
            d.addOption(entry.id, entry.name || entry.id);
          }
          d.setValue(domain);
          d.onChange((v) => { domain = v; });
        });
    }

    if (this.extra && "dryRun" in this.extra) {
      new Setting(contentEl)
        .setName(T.dryRun_name)
        .addToggle((t) => t.onChange((v) => { dryRun = v; }));
    }
    new Setting(contentEl).addButton((b) =>
      b.setButtonText(`▶ ${T.run}`).setCta().onClick(() => {
        this.close();
        this.onSubmit(domain, { dryRun });
      }),
    );
  }
  onClose(): void { this.contentEl.empty(); }
}


class FolderInputSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, input: HTMLInputElement, onPick: (path: string) => void) {
    super(app, input);
    this.onSelect((folder) => {
      this.setValue(folder.path + "/");
      onPick(folder.path + "/");
    });
  }
  protected getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return this.app.vault.getAllFolders(true)
      .filter(f => isSelectableSourceFolder(f.path) && f.path.toLowerCase().includes(q))
      .slice(0, 20);
  }
  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path + "/");
  }
}

export class AddDomainModal extends Modal {
  private input: AddDomainInput = { id: "", name: "", wikiFolder: "", sourcePaths: [] };
  private wikiFolderInput: { setValue: (v: string) => void } | null = null;
  private sourcePathsContainer: HTMLElement | null = null;

  constructor(
    app: App,
    private onSubmit: (input: AddDomainInput) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.addDomain });

    new Setting(contentEl)
      .setName(T.id_name)
      .setDesc(T.id_desc)
      .addText((t) =>
        t.setPlaceholder(T.idPlaceholder).onChange((v) => {
          this.input.id = v.trim();
          if (this.wikiFolderInput && !this.input.wikiFolder) {
            this.wikiFolderInput.setValue(this.input.id);
          }
        }),
      );

    new Setting(contentEl)
      .setName(T.displayName_name)
      .addText((t) => t.setPlaceholder(T.idPlaceholder).onChange((v) => { this.input.name = v.trim(); }));

    new Setting(contentEl)
      .setName(T.wikiFolder_name)
      .setDesc(T.wikiFolder_desc(""))
      .addText((t) => {
        t.setPlaceholder(T.wikiFolder_placeholder("")).onChange((v) => {
          this.input.wikiFolder = v.trim();
        });
        this.wikiFolderInput = t;
      });

    this.sourcePathsContainer = contentEl.createDiv();
    this.renderSourcePaths();

    new Setting(contentEl).addButton((b) =>
      b.setButtonText(T.add).setCta().onClick(() => {
        if (!this.input.id) return;
        this.close();
        this.onSubmit(this.input);
      }),
    );
  }

  private renderSourcePaths(): void {
    if (!this.sourcePathsContainer) return;
    this.sourcePathsContainer.empty();
    const T = i18n().modal;

    const header = this.sourcePathsContainer.createDiv({ cls: "ai-wiki-sp-header" });
    header.createEl("span", { text: T.addDomainSourcePathsLabel, cls: "ai-wiki-sp-label" });

    const listEl = this.sourcePathsContainer.createDiv({ cls: "ai-wiki-sp-list" });
    const rerender = () => {
      listEl.empty();
      this.input.sourcePaths.forEach((p, i) => {
        const row = listEl.createDiv({ cls: "ai-wiki-sp-row" });
        row.createEl("span", { text: p, cls: "ai-wiki-sp-path", attr: { title: p } });
        const removeBtn = row.createEl("button", { text: "×", cls: "ai-wiki-sp-remove" });
        removeBtn.addEventListener("click", () => {
          this.input.sourcePaths.splice(i, 1);
          rerender();
        });
      });
    };
    rerender();

    const addRow = this.sourcePathsContainer.createDiv({ cls: "ai-wiki-sp-add-row" });
    const inputEl = addRow.createEl("input", {
      cls: "ai-wiki-sp-input",
      attr: { type: "text", placeholder: T.addDomainSourcePathsPlaceholder },
    });
    const addPath = (val?: string) => {
      const v = val ?? inputEl.value.trim();
      if (!v || this.input.sourcePaths.includes(v)) return;
      this.input.sourcePaths.push(v);
      inputEl.value = "";
      rerender();
    };

    new FolderInputSuggest(this.app, inputEl, addPath);

    inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); addPath(); }
    });

  }

  onClose(): void { this.contentEl.empty(); }
}

export class FileErrorModal extends Modal {
  private resolve!: (choice: "skip" | "retry" | "stop") => void;
  readonly result: Promise<"skip" | "retry" | "stop">;
  private resolved = false;

  constructor(
    app: App,
    private file: string,
    private err: Error,
    private canRetry: boolean,
  ) {
    super(app);
    this.result = new Promise((res) => { this.resolve = res; });
  }

  private pick(choice: "skip" | "retry" | "stop"): void {
    if (this.resolved) return;
    this.resolved = true;
    this.close();
    this.resolve(choice);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.fileErrorTitle });
    contentEl.createEl("p", { text: this.file, cls: "ai-wiki-file-error-path" });
    contentEl.createEl("p", { text: this.err.message, cls: "ai-wiki-file-error-msg" });

    const setting = new Setting(contentEl);
    setting.addButton((b) =>
      b.setButtonText(T.fileErrorSkip).onClick(() => this.pick("skip")),
    );
    if (this.canRetry) {
      setting.addButton((b) =>
        b.setButtonText(T.fileErrorRetry).onClick(() => this.pick("retry")),
      );
    }
    setting.addButton((b) =>
      b.setButtonText(T.fileErrorStop).setWarning().onClick(() => this.pick("stop")),
    );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) { this.resolved = true; this.resolve("skip"); }
  }
}

export class EditDomainModal extends Modal {
  private nameVal: string;
  private wikiFolderVal: string;
  private entityTypesMode: "cards" | "json" = "cards";
  private entityTypesList: EntityType[];
  private entityTypesVal: string;
  private sourcePathsList: string[];
  private languageNotesVal: string;
  private errorEl: HTMLElement | null = null;

  constructor(
    app: App,
    private domain: DomainEntry,
    private onSave: (updated: DomainEntry) => void,
  ) {
    super(app);
    this.nameVal = domain.name;
    this.wikiFolderVal = domain.wiki_folder;
    this.entityTypesList = [...(domain.entity_types ?? [])];
    this.entityTypesVal = JSON.stringify(domain.entity_types ?? [], null, 2);
    this.sourcePathsList = [...(domain.source_paths ?? [])];
    this.languageNotesVal = domain.language_notes ?? "";
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: T.editDomainTitle(this.domain.id) });

    new Setting(contentEl)
      .setName(T.displayName_name)
      .addText((t) => t.setValue(this.nameVal).onChange((v) => { this.nameVal = v; }));

    new Setting(contentEl)
      .setName(T.wikiFolder_name)
      .setDesc(T.wikiFolder_editDesc)
      .addText((t) => t.setValue(this.wikiFolderVal).onChange((v) => { this.wikiFolderVal = v; }));

    const entityTypesContainer = contentEl.createDiv();
    this.renderEntityTypes(entityTypesContainer);

    const sourcePathsContainer = contentEl.createDiv();
    this.renderSourcePaths(sourcePathsContainer);

    new Setting(contentEl)
      .setName(T.languageNotesLabel)
      .addTextArea((t) => {
        t.inputEl.rows = 4;
        t.setValue(this.languageNotesVal).onChange((v) => { this.languageNotesVal = v; });
      });

    this.errorEl = contentEl.createEl("p", { cls: "mod-warning ai-wiki-hidden" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(T.save).setCta().onClick(() => this.handleSave()));
  }

  private renderEntityTypes(container: HTMLElement): void {
    container.empty();
    const T = i18n().modal;

    const header = container.createDiv({ cls: "ai-wiki-et-header" });
    header.createEl("span", { text: T.entityTypesLabel, cls: "ai-wiki-et-label" });
    const toggleBtn = header.createEl("button", {
      text: this.entityTypesMode === "cards" ? T.entityTypesEditJson : T.entityTypesBackToCards,
    });

    if (this.entityTypesMode === "cards") {
      toggleBtn.addEventListener("click", () => {
        this.entityTypesVal = JSON.stringify(this.entityTypesList, null, 2);
        this.entityTypesMode = "json";
        this.renderEntityTypes(container);
      });
      if (this.entityTypesList.length === 0) {
        container.createEl("p", { text: T.entityTypesEmpty, cls: "setting-item-description" });
      } else {
        for (const et of this.entityTypesList) {
          this.renderEntityTypeCard(container, et);
        }
      }
    } else {
      const ta = container.createEl("textarea", {
        cls: "ai-wiki-settings-textarea ai-wiki-monospace",
        attr: { rows: "10" },
      });
      ta.value = this.entityTypesVal;
      ta.addEventListener("input", () => { this.entityTypesVal = ta.value; });

      const jsonErrorEl = container.createEl("p", { cls: "mod-warning ai-wiki-hidden" });

      toggleBtn.addEventListener("click", () => {
        try {
          const parsed: unknown = JSON.parse(this.entityTypesVal.trim() || "[]");
          if (!Array.isArray(parsed)) throw new Error();
          if (!parsed.every((x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x))) {
            throw new Error();
          }
          this.entityTypesList = parsed as EntityType[];
          this.entityTypesMode = "cards";
          this.renderEntityTypes(container);
        } catch {
          jsonErrorEl.textContent = T.entityTypesError;
          jsonErrorEl.removeClass("ai-wiki-hidden");
        }
      });
    }
  }

  private renderSourcePaths(container: HTMLElement): void {
    container.empty();
    const T = i18n().modal;

    const header = container.createDiv({ cls: "ai-wiki-sp-header" });
    header.createEl("span", { text: T.sourcePathsLabel, cls: "ai-wiki-sp-label" });

    const listEl = container.createDiv({ cls: "ai-wiki-sp-list" });

    const rerender = () => {
      listEl.empty();
      this.sourcePathsList.forEach((p, i) => {
        const row = listEl.createDiv({ cls: "ai-wiki-sp-row" });
        row.createEl("span", { text: p, cls: "ai-wiki-sp-path", attr: { title: p } });
        const removeBtn = row.createEl("button", { text: "×", cls: "ai-wiki-sp-remove" });
        removeBtn.addEventListener("click", () => {
          this.sourcePathsList.splice(i, 1);
          rerender();
        });
      });
    };
    rerender();

    const addRow = container.createDiv({ cls: "ai-wiki-sp-add-row" });
    const input = addRow.createEl("input", {
      cls: "ai-wiki-sp-input",
      attr: { type: "text", placeholder: T.sourcePathsPlaceholder },
    });

    const addPath = (val?: string) => {
      const v = val ?? input.value.trim();
      if (!v || this.sourcePathsList.includes(v)) return;
      this.sourcePathsList.push(v);
      input.value = "";
      rerender();
    };

    new FolderInputSuggest(this.app, input, addPath);

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); addPath(); }
    });

  }

  private renderEntityTypeCard(container: HTMLElement, et: EntityType): void {
    const card = container.createDiv({ cls: "ai-wiki-et-card" });
    const head = card.createDiv({ cls: "ai-wiki-et-card-head" });
    head.createEl("span", { text: et.type, cls: "ai-wiki-et-card-type" });
    if (et.wiki_subfolder) {
      head.createEl("span", { text: et.wiki_subfolder + "/", cls: "ai-wiki-et-card-subfolder" });
    }
    const body = card.createDiv({ cls: "ai-wiki-et-card-body" });
    if (et.description) {
      body.createEl("p", { text: et.description, cls: "ai-wiki-et-card-desc" });
    }
    if (et.extraction_cues?.length) {
      const tags = body.createDiv({ cls: "ai-wiki-et-card-tags" });
      for (const cue of et.extraction_cues) {
        tags.createEl("span", { text: cue, cls: "ai-wiki-et-card-tag" });
      }
    }
    if (et.min_mentions_for_page != null) {
      body.createEl("small", { text: `min_mentions: ${et.min_mentions_for_page}`, cls: "ai-wiki-et-card-meta" });
    }
  }

  private handleSave(): void {
    this.errorEl?.addClass("ai-wiki-hidden");
    let entityTypes: EntityType[];
    if (this.entityTypesMode === "cards") {
      entityTypes = this.entityTypesList;
    } else {
      try {
        const parsed: unknown = JSON.parse(this.entityTypesVal.trim() || "[]");
        if (!Array.isArray(parsed)) throw new Error("not an array");
        if (!parsed.every((x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x))) {
          throw new Error("not an array of objects");
        }
        entityTypes = parsed as EntityType[];
      } catch {
        if (this.errorEl) {
          this.errorEl.textContent = i18n().modal.entityTypesError;
          this.errorEl.removeClass("ai-wiki-hidden");
        }
        return;
      }
    }
    const updated: DomainEntry = {
      ...this.domain,
      name: this.nameVal.trim() || this.domain.name,
      wiki_folder: this.wikiFolderVal.trim() || this.domain.wiki_folder,
      source_paths: this.sourcePathsList.filter(Boolean),
      entity_types: entityTypes,
      language_notes: this.languageNotesVal.trim(),
    };
    this.close();
    this.onSave(updated);
  }

  onClose(): void { this.contentEl.empty(); }
}


export class ManageSourcesModal extends Modal {
  private sourcePathsList: string[];

  constructor(
    app: App,
    private domain: DomainEntry,
    private onSave: (result: { sourcePaths: string[] }) => void,
  ) {
    super(app);
    this.sourcePathsList = [...(domain.source_paths ?? [])];
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.manageSourcesTitle(this.domain.id) });
    const container = contentEl.createDiv();
    this.renderSourcePaths(container);
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(T.save).setCta().onClick(() => this.handleSave()));
  }

  private handleSave(): void {
    this.close();
    this.onSave({ sourcePaths: this.sourcePathsList.filter(Boolean) });
  }

  private renderSourcePaths(container: HTMLElement): void {
    container.empty();
    const T = i18n().modal;

    const header = container.createDiv({ cls: "ai-wiki-sp-header" });
    header.createEl("span", { text: T.sourcePathsLabel, cls: "ai-wiki-sp-label" });

    const listEl = container.createDiv({ cls: "ai-wiki-sp-list" });
    const rerender = () => {
      listEl.empty();
      this.sourcePathsList.forEach((p, i) => {
        const row = listEl.createDiv({ cls: "ai-wiki-sp-row" });
        row.createEl("span", { text: p, cls: "ai-wiki-sp-path", attr: { title: p } });
        const removeBtn = row.createEl("button", { text: "×", cls: "ai-wiki-sp-remove" });
        removeBtn.addEventListener("click", () => {
          this.sourcePathsList.splice(i, 1);
          rerender();
        });
      });
    };
    rerender();

    const addRow = container.createDiv({ cls: "ai-wiki-sp-add-row" });
    const input = addRow.createEl("input", {
      cls: "ai-wiki-sp-input",
      attr: { type: "text", placeholder: T.sourcePathsPlaceholder },
    });

    const addPath = (val?: string) => {
      const v = val ?? input.value.trim();
      if (!v || this.sourcePathsList.includes(v)) return;
      this.sourcePathsList.push(v);
      input.value = "";
      rerender();
    };

    new FolderInputSuggest(this.app, input, addPath);

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); addPath(); }
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

export class IngestScopeModal extends Modal {
  constructor(
    app: App,
    private addedCount: number,
    private totalCount: number,
    private onChoice: (scope: "new" | "all" | "skip") => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.ingestScopeTitle });
    contentEl.createEl("p", { text: T.ingestScopeBody(this.addedCount, this.totalCount) });
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(T.ingestScopeNew(this.addedCount)).setCta().onClick(() => this.pick("new")),
      )
      .addButton((b) =>
        b.setButtonText(T.ingestScopeAll(this.totalCount)).onClick(() => this.pick("all")),
      )
      .addButton((b) =>
        b.setButtonText(T.ingestScopeSkip).onClick(() => this.pick("skip")),
      );
  }

  private pick(scope: "new" | "all" | "skip"): void {
    this.close();
    this.onChoice(scope);
  }

  onClose(): void { this.contentEl.empty(); }
}

export class ReinitModeModal extends Modal {
  constructor(
    app: App,
    private plan: { changed: string[]; totalSources: number; wikiFileCount: number },
    private onChoice: (mode: "full" | "incremental") => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.reinitModeTitle });
    contentEl.createEl("p", { text: T.reinitModeFullDesc(this.plan.wikiFileCount, this.plan.totalSources) });

    const n = this.plan.changed.length;
    if (n > 0) {
      contentEl.createEl("p", { text: T.reinitModeIncrementalDesc(n) });
      const { shown, overflow } = capList(this.plan.changed.map((p) => p.split("/").pop() ?? p), 20);
      const ul = contentEl.createEl("ul");
      for (const name of shown) ul.createEl("li", { text: name });
      if (overflow > 0) ul.createEl("li", { text: T.reinitModeMore(overflow) });
    } else {
      contentEl.createEl("p", { text: T.reinitModeNoneChanged });
    }

    const setting = new Setting(contentEl);
    setting.addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()));
    setting.addButton((b) =>
      b.setButtonText(T.reinitModeFull).setWarning().onClick(() => this.pick("full")),
    );
    setting.addButton((b) => {
      b.setButtonText(T.reinitModeIncremental(n)).setCta().onClick(() => this.pick("incremental"));
      if (n === 0) b.setDisabled(true);
    });
  }

  private pick(mode: "full" | "incremental"): void {
    this.close();
    this.onChoice(mode);
  }

  onClose(): void { this.contentEl.empty(); }
}

export class ShellConsentModal extends Modal {
  constructor(
    app: App,
    private iclaudePath: string,
    private onEnable: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.shellConsentTitle });
    contentEl.createEl("p", { text: T.shellConsentBody(this.iclaudePath), cls: "ai-wiki-consent-body" });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.cancel()))
      .addButton((b) =>
        b.setButtonText(T.shellConsentEnable).setCta().onClick(() => void this.enable()),
      );
  }

  cancel(): void {
    this.close();
  }

  async enable(): Promise<void> {
    await this.onEnable();
    this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}

export class DeleteSourceModal extends Modal {
  constructor(
    app: App,
    private _domainId: string,
    private sourcePath: string,
    private plan: import("./source-deletion").DeletionPlan,
    private onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    const name = this.sourcePath.split("/").pop() ?? this.sourcePath;
    contentEl.createEl("h3", { text: T.deleteSourceTitle(name) });

    contentEl.createEl("p", { text: T.deleteSourceWarning, cls: "mod-warning" });

    if (this.plan.toDelete.length > 0) {
      contentEl.createEl("p", { text: T.deleteSourceDeleteCount(this.plan.toDelete.length) });
      const ul = contentEl.createEl("ul");
      for (const p of this.plan.toDelete) ul.createEl("li", { text: p.split("/").pop() ?? p });
    }
    if (this.plan.toRebuild.length > 0) {
      contentEl.createEl("p", { text: T.deleteSourceRebuildCount(this.plan.toRebuild.length) });
      const ul = contentEl.createEl("ul");
      for (const p of this.plan.toRebuild) ul.createEl("li", { text: p.split("/").pop() ?? p });
    }

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(T.deleteSourceConfirm).setWarning().onClick(() => {
          this.onConfirm();
          this.close();
        }),
      );
  }

  onClose(): void { this.contentEl.empty(); }
}

export class LintOptionsModal extends Modal {
  private useLlm: boolean;
  private entityTypeFilter: string[];

  constructor(
    app: App,
    private domain: DomainEntry,
    private defaultUseLlm: boolean,
    private articleCounts: Map<string, number>,
    private onSubmit: (opts: { useLlm: boolean; entityTypeFilter: string[] }) => void,
  ) {
    super(app);
    this.useLlm = defaultUseLlm;
    this.entityTypeFilter = (domain.entity_types ?? [])
      .filter(e => (articleCounts.get(e.type) ?? 0) > 0)
      .map(e => e.type);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.lint_title });

    // Use LLM toggle — top
    new Setting(contentEl)
      .setName("Use LLM")
      .addToggle(t => t.setValue(this.useLlm).onChange(v => { this.useLlm = v; }));

    // Entity types section
    const entityTypes = this.domain.entity_types ?? [];
    if (entityTypes.length) {
      contentEl.createEl("p", { text: "Entity types:" });

      const btnRow = contentEl.createDiv({ cls: "ai-wiki-lint-btn-row" });
      const toggles: ToggleComponent[] = [];

      const deselectBtn = btnRow.createEl("button", { text: T.lintDeselectAll });
      const selectBtn   = btnRow.createEl("button", { text: T.lintSelectAll });

      deselectBtn.addEventListener("click", () => {
        toggles.forEach(t => { t.setValue(false); });
        this.entityTypeFilter = [];
      });
      selectBtn.addEventListener("click", () => {
        toggles.forEach(t => { t.setValue(true); });
        this.entityTypeFilter = entityTypes.map(e => e.type);
      });

      for (const et of entityTypes) {
        const setting = new Setting(contentEl).setName(et.type);
        const countVal = this.articleCounts.get(et.type);
        if (countVal !== undefined) {
          setting.nameEl.createEl("span", {
            text: ` (${countVal})`,
            cls: "ai-wiki-count-muted",
          });
        }
        setting.addToggle(t => {
          t.setValue(this.entityTypeFilter.includes(et.type));
          t.onChange(checked => {
            if (checked) {
              if (!this.entityTypeFilter.includes(et.type)) this.entityTypeFilter.push(et.type);
            } else {
              this.entityTypeFilter = this.entityTypeFilter.filter(x => x !== et.type);
            }
          });
          toggles.push(t);
        });
      }
    }

    // Run button
    new Setting(contentEl)
      .addButton(b =>
        b.setButtonText(`▶ ${T.run}`)
          .setCta()
          .onClick(() => {
            this.close();
            this.submit();
          }),
      );
  }

  private submit(): void {
    this.onSubmit({
      useLlm: this.useLlm,
      entityTypeFilter: [...this.entityTypeFilter],
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
