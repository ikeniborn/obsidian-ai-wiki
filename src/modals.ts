import { App, Modal, Setting } from "obsidian";
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


export class AddDomainModal extends Modal {
  private input: AddDomainInput = { id: "", name: "", wikiFolder: "" };
  private wikiFolderInput: { setValue: (v: string) => void } | null = null;

  constructor(
    app: App,
    private wikiRoot: string,
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
            this.wikiFolderInput.setValue(`${this.wikiRoot}/${this.input.id}`);
          }
        }),
      );

    new Setting(contentEl)
      .setName(T.displayName_name)
      .addText((t) => t.setPlaceholder(T.idPlaceholder).onChange((v) => { this.input.name = v.trim(); }));

    new Setting(contentEl)
      .setName(T.wikiFolder_name)
      .setDesc(T.wikiFolder_desc(this.wikiRoot))
      .addText((t) => {
        t.setPlaceholder(T.wikiFolder_placeholder(this.wikiRoot)).onChange((v) => {
          this.input.wikiFolder = v.trim();
        });
        this.wikiFolderInput = t;
      });

    contentEl.createEl("p", { text: T.addDomainNote, cls: "muted" });

    new Setting(contentEl).addButton((b) =>
      b.setButtonText(T.add).setCta().onClick(() => {
        if (!this.input.id) return;
        this.close();
        this.onSubmit(this.input);
      }),
    );
  }

  onClose(): void { this.contentEl.empty(); }
}

export class EditDomainModal extends Modal {
  private nameVal: string;
  private wikiFolderVal: string;
  private sourcePathsVal: string;
  private entityTypesVal: string;
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
    this.sourcePathsVal = (domain.source_paths ?? []).join("\n");
    this.entityTypesVal = JSON.stringify(domain.entity_types ?? [], null, 2);
    this.languageNotesVal = domain.language_notes ?? "";
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.editDomainTitle(this.domain.id) });

    new Setting(contentEl)
      .setName(T.displayName_name)
      .addText((t) => t.setValue(this.nameVal).onChange((v) => { this.nameVal = v; }));

    new Setting(contentEl)
      .setName(T.wikiFolder_name)
      .addText((t) => t.setValue(this.wikiFolderVal).onChange((v) => { this.wikiFolderVal = v; }));

    new Setting(contentEl)
      .setName(T.sourcePathsLabel)
      .addTextArea((t) => {
        t.inputEl.rows = 4;
        t.inputEl.addClass("llm-wiki-settings-textarea");
        t.setValue(this.sourcePathsVal).onChange((v) => { this.sourcePathsVal = v; });
      });

    new Setting(contentEl)
      .setName(T.entityTypesLabel)
      .addTextArea((t) => {
        t.inputEl.rows = 10;
        t.inputEl.addClass("llm-wiki-settings-textarea");
        t.inputEl.addClass("llm-wiki-monospace");
        t.setValue(this.entityTypesVal).onChange((v) => { this.entityTypesVal = v; });
      });

    new Setting(contentEl)
      .setName(T.languageNotesLabel)
      .addText((t) => t.setValue(this.languageNotesVal).onChange((v) => { this.languageNotesVal = v; }));

    this.errorEl = contentEl.createEl("p", { cls: "mod-warning llm-wiki-hidden" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(T.save).setCta().onClick(() => this.handleSave()));
  }

  private handleSave(): void {
    this.errorEl?.addClass("llm-wiki-hidden");
    let entityTypes: EntityType[];
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
    const updated: DomainEntry = {
      ...this.domain,
      name: this.nameVal.trim() || this.domain.name,
      wiki_folder: this.wikiFolderVal.trim() || this.domain.wiki_folder,
      source_paths: this.sourcePathsVal.split("\n").map((s) => s.trim()).filter(Boolean),
      entity_types: entityTypes,
      language_notes: this.languageNotesVal.trim(),
    };
    this.close();
    this.onSave(updated);
  }

  onClose(): void { this.contentEl.empty(); }
}

