import { AbstractInputSuggest, App, Modal, Setting, TFolder } from "obsidian";
import type { AddDomainInput, DomainEntry, EntityType } from "./domain-map";
import { i18n } from "./i18n";

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
    private onConfirm: () => void,
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
        this.onConfirm();
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}

export class QueryModal extends Modal {
  private question = "";
  constructor(app: App, private save: boolean, private onSubmit: (q: string) => void) {
    super(app);
  }
  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.save ? T.queryAndSave : T.query });
    const ta = contentEl.createEl("textarea", {
      cls: "llm-wiki-modal-input",
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
    setTimeout(() => ta.focus(), 0);
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


class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, inputEl: HTMLInputElement, private onSelect: (path: string) => void) {
    super(app, inputEl);
  }

  getSuggestions(inputStr: string): TFolder[] {
    const lower = inputStr.toLowerCase();
    return this.app.vault.getAllFolders(true)
      .filter((f) => f.path.toLowerCase().includes(lower))
      .slice(0, 20);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path + "/");
  }

  selectSuggestion(folder: TFolder): void {
    this.inputEl.value = "";
    this.close();
    this.onSelect(folder.path + "/");
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

    const header = this.sourcePathsContainer.createDiv({ cls: "llm-wiki-sp-header" });
    header.createEl("span", { text: T.addDomainSourcePathsLabel, cls: "llm-wiki-sp-label" });

    const listEl = this.sourcePathsContainer.createDiv({ cls: "llm-wiki-sp-list" });
    const rerender = () => {
      listEl.empty();
      this.input.sourcePaths.forEach((p, i) => {
        const row = listEl.createDiv({ cls: "llm-wiki-sp-row" });
        row.createEl("span", { text: p, cls: "llm-wiki-sp-path", attr: { title: p } });
        const removeBtn = row.createEl("button", { text: "×", cls: "llm-wiki-sp-remove" });
        removeBtn.addEventListener("click", () => {
          this.input.sourcePaths.splice(i, 1);
          rerender();
        });
      });
    };
    rerender();

    const addRow = this.sourcePathsContainer.createDiv({ cls: "llm-wiki-sp-add-row" });
    const inputEl = addRow.createEl("input", {
      cls: "llm-wiki-sp-input",
      attr: { type: "text", placeholder: T.addDomainSourcePathsPlaceholder },
    });
    const addPath = (val = inputEl.value.trim()) => {
      if (!val || this.input.sourcePaths.includes(val)) return;
      this.input.sourcePaths.push(val);
      inputEl.value = "";
      rerender();
    };

    new FolderSuggest(this.app, inputEl, addPath);

    inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); addPath(); }
    });

    addRow.createEl("button", { text: T.addDomainSourcePathsAdd, cls: "mod-cta" })
      .addEventListener("click", addPath);
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
    contentEl.createEl("p", { text: this.file, cls: "llm-wiki-file-error-path" });
    contentEl.createEl("p", { text: this.err.message, cls: "llm-wiki-file-error-msg" });

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

    this.errorEl = contentEl.createEl("p", { cls: "mod-warning llm-wiki-hidden" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(T.save).setCta().onClick(() => this.handleSave()));
  }

  private renderEntityTypes(container: HTMLElement): void {
    container.empty();
    const T = i18n().modal;

    const header = container.createDiv({ cls: "llm-wiki-et-header" });
    header.createEl("span", { text: T.entityTypesLabel, cls: "llm-wiki-et-label" });
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
        cls: "llm-wiki-settings-textarea llm-wiki-monospace",
        attr: { rows: "10" },
      });
      ta.value = this.entityTypesVal;
      ta.addEventListener("input", () => { this.entityTypesVal = ta.value; });

      const jsonErrorEl = container.createEl("p", { cls: "mod-warning llm-wiki-hidden" });

      toggleBtn.addEventListener("click", () => {
        try {
          const parsed = JSON.parse(this.entityTypesVal.trim() || "[]");
          if (!Array.isArray(parsed)) throw new Error();
          if (!parsed.every((x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x))) {
            throw new Error();
          }
          this.entityTypesList = parsed as EntityType[];
          this.entityTypesMode = "cards";
          this.renderEntityTypes(container);
        } catch {
          jsonErrorEl.textContent = T.entityTypesError;
          jsonErrorEl.removeClass("llm-wiki-hidden");
        }
      });
    }
  }

  private renderSourcePaths(container: HTMLElement): void {
    container.empty();
    const T = i18n().modal;

    const header = container.createDiv({ cls: "llm-wiki-sp-header" });
    header.createEl("span", { text: T.sourcePathsLabel, cls: "llm-wiki-sp-label" });

    const listEl = container.createDiv({ cls: "llm-wiki-sp-list" });

    const rerender = () => {
      listEl.empty();
      this.sourcePathsList.forEach((p, i) => {
        const row = listEl.createDiv({ cls: "llm-wiki-sp-row" });
        row.createEl("span", { text: p, cls: "llm-wiki-sp-path", attr: { title: p } });
        const removeBtn = row.createEl("button", { text: "×", cls: "llm-wiki-sp-remove" });
        removeBtn.addEventListener("click", () => {
          this.sourcePathsList.splice(i, 1);
          rerender();
        });
      });
    };
    rerender();

    const addRow = container.createDiv({ cls: "llm-wiki-sp-add-row" });
    const input = addRow.createEl("input", {
      cls: "llm-wiki-sp-input",
      attr: { type: "text", placeholder: T.sourcePathsPlaceholder },
    });

    const addPath = (val = input.value.trim()) => {
      if (!val || this.sourcePathsList.includes(val)) return;
      this.sourcePathsList.push(val);
      input.value = "";
      rerender();
    };

    new FolderSuggest(this.app, input, addPath);

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); addPath(); }
    });

    const addBtn = addRow.createEl("button", { text: T.sourcePathsAdd, cls: "mod-cta" });
    addBtn.addEventListener("click", addPath);
  }

  private renderEntityTypeCard(container: HTMLElement, et: EntityType): void {
    const card = container.createDiv({ cls: "llm-wiki-et-card" });
    const head = card.createDiv({ cls: "llm-wiki-et-card-head" });
    head.createEl("span", { text: et.type, cls: "llm-wiki-et-card-type" });
    if (et.wiki_subfolder) {
      head.createEl("span", { text: et.wiki_subfolder + "/", cls: "llm-wiki-et-card-subfolder" });
    }
    const body = card.createDiv({ cls: "llm-wiki-et-card-body" });
    if (et.description) {
      body.createEl("p", { text: et.description, cls: "llm-wiki-et-card-desc" });
    }
    if (et.extraction_cues?.length) {
      const tags = body.createDiv({ cls: "llm-wiki-et-card-tags" });
      for (const cue of et.extraction_cues) {
        tags.createEl("span", { text: cue, cls: "llm-wiki-et-card-tag" });
      }
    }
    if (et.min_mentions_for_page != null) {
      body.createEl("small", { text: `min_mentions: ${et.min_mentions_for_page}`, cls: "llm-wiki-et-card-meta" });
    }
  }

  private handleSave(): void {
    this.errorEl?.addClass("llm-wiki-hidden");
    let entityTypes: EntityType[];
    if (this.entityTypesMode === "cards") {
      entityTypes = this.entityTypesList;
    } else {
      try {
        const parsed = JSON.parse(this.entityTypesVal.trim() || "[]");
        if (!Array.isArray(parsed)) throw new Error("not an array");
        if (!parsed.every((x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x))) {
          throw new Error("not an array of objects");
        }
        entityTypes = parsed as EntityType[];
      } catch {
        if (this.errorEl) {
          this.errorEl.textContent = i18n().modal.entityTypesError;
          this.errorEl.removeClass("llm-wiki-hidden");
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

