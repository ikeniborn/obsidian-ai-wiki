import { App, ItemView, Modal, WorkspaceLeaf, MarkdownRenderer, Component, Notice, Platform, setIcon } from "obsidian";
import { AddDomainModal, BusyCloseModal, ConfirmModal, ManageSourcesModal, IngestScopeModal } from "./modals";
import type LlmWikiPlugin from "./main";
import type { ChatMessage, RunEvent, RunHistoryEntry, WikiOperation } from "./types";
import type { DomainEntry } from "./domain";
import { i18n } from "./i18n";
import { domainWikiFolder } from "./wiki-path";

import { collectMdInPaths, walkFolder } from "./utils/vault-walk";
export { collectMdInPaths, walkFolder };

export const AI_WIKI_VIEW_TYPE = "ai-wiki-view";

type ViewState = "idle" | "running" | "done" | "error" | "cancelled";

function registerLinkHandler(el: HTMLElement, app: App): void {
    el.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement).closest("a.internal-link");
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
        if (href) void app.workspace.openLinkText(href, "", false);
    });
}

const PREVIEW_INLINE = 140;

export class LlmWikiView extends ItemView {
  private state: ViewState = "idle";
  private stepsEl!: HTMLElement;
  private finalEl!: HTMLElement;
  private resultSection!: HTMLElement;
  private resultToggle!: HTMLElement;
  private resultOpen = false;
  private historyEl!: HTMLElement;
  private historySection!: HTMLElement;
  private historyToggle!: HTMLElement;
  private historyOpen = false;
  private statusEl!: HTMLElement;
  private progressToggle!: HTMLElement;
  private progressCount!: HTMLElement;
  private stepsOpen = true;
  private cancelBtn!: HTMLButtonElement;
  private queryInput!: HTMLTextAreaElement;
  private askBtn!: HTMLButtonElement;
  private askSaveBtn!: HTMLButtonElement;
  private domainSelect?: HTMLSelectElement;
  private initBtn?: HTMLButtonElement;
  private ingestBtn?: HTMLButtonElement;
  private lintBtn?: HTMLButtonElement;
  private formatBtn?: HTMLButtonElement;
  private reinitBtn?: HTMLButtonElement;
  private addSourceBtn?: HTMLButtonElement;
  private formatPreviewSection: HTMLElement | null = null;
  private lastContext: { operation: WikiOperation; domainId: string | undefined; report: string } | null = null;
  // Chat state
  private chatSection: HTMLElement | null = null;
  private chatMessagesEl: HTMLElement | null = null;
  private chatInputEl: HTMLTextAreaElement | null = null;
  private chatSendBtn: HTMLButtonElement | null = null;
  private chatHistory: ChatMessage[] = [];
  private chatToggle: HTMLElement | null = null;
  private chatOpen = true;
  private chatBodyEl: HTMLElement | null = null;
  private currentChatBubble: HTMLElement | null = null;
  private currentChatBuffer = "";
  private chatTickHandle: ReturnType<typeof window.setTimeout> | null = null;
  private chatStartTs = 0;
  private lastUserMessage = "";
  private startTs = 0;
  private lastTokPerSec: number | undefined;
  private resultSpeedEl: HTMLElement | null = null;
  private toolCount = 0;
  private stepCount = 0;
  private progressEl: HTMLElement | null = null;
  private mobileWaitingEl: HTMLElement | null = null;
  private progressTotal = 0;
  private progressDone = 0;
  private progressPhaseEl: HTMLElement | null = null;
  private tickHandle: ReturnType<typeof window.setTimeout> | null = null;
  private currentToolStep: HTMLElement | null = null;
  private currentToolStartedAt = 0;
  private reasoningBlock: HTMLElement | null = null;
  private reasoningBuffer = "";
  private reasoningRafHandle: number | null = null;
  private waitingStep: HTMLElement | null = null;
  private waitingTickHandle: ReturnType<typeof window.setTimeout> | null = null;
  private waitingStartedAt = 0;
  private liveStatusSection: HTMLElement | null = null;
  private liveStatusIconEl: HTMLElement | null = null;
  private liveStatusTextEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: LlmWikiPlugin) {
    super(leaf);
  }

  getViewType(): string { return AI_WIKI_VIEW_TYPE; }
  getDisplayText(): string { return "AIWiki"; }
  getIcon(): string { return "brain-circuit"; }

  onOpen(): void {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("ai-wiki-view");

    const T = i18n();
    const isMobile = Platform.isMobile;

    const header = root.createDiv("ai-wiki-header");
    header.createEl("h3", { text: "AI wiki" });
    this.statusEl = header.createDiv("ai-wiki-status");

    // На mobile доступна только query-операция (см. types.ts/main.ts gating).
    // Скрываем секции "Создание домена" и "Наполнение/Актуализация" целиком —
    // их кнопки (init/ingest/lint/format) не работают.
    if (!isMobile) {
      // 1. Создание нового домена
      root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionCreate });
      const createRow = root.createDiv("ai-wiki-create-row");
      this.initBtn = createRow.createEl("button", { text: T.view.init, cls: "ai-wiki-init-btn" });
      this.initBtn.addEventListener("click", () => this.openAddDomain());

      // 2+3. Наполнение / Актуализация
      root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomain });
      this.buildDomainRow(root as HTMLElement, { withActions: true });
    } else {
      root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomainMobile });
      this.buildDomainRow(root as HTMLElement, { withActions: false });
    }

    // 4. Запрос
    root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionQuery });
    const ask = root.createDiv("ai-wiki-ask");
    this.queryInput = ask.createEl("textarea", {
      cls: "ai-wiki-query-input",
      attr: { placeholder: "Question…", rows: "3" },
    });
    const askRow = ask.createDiv("ai-wiki-ask-row");
    this.askBtn = askRow.createEl("button", { text: T.view.ask });
    this.askSaveBtn = askRow.createEl("button", { text: T.view.askAndSave });
    this.cancelBtn = askRow.createEl("button", { text: T.view.cancel, cls: "mod-warning" });
    this.cancelBtn.disabled = true;
    this.askBtn.addEventListener("click", () => this.submitQuery(false));
    this.askSaveBtn.addEventListener("click", () => this.submitQuery(true));
    this.cancelBtn.addEventListener("click", () => this.plugin.controller.cancelCurrent());

    const progressHeader = root.createDiv("ai-wiki-progress-header");
    const progressH4 = progressHeader.createEl("h4", { cls: "ai-wiki-progress-title" });
    this.progressToggle = progressH4.createSpan({ cls: "ai-wiki-progress-arrow", text: "▶" });
    progressH4.appendText(" Progress ");
    this.progressCount = progressH4.createSpan({ cls: "ai-wiki-progress-count muted", text: "" });
    progressHeader.addEventListener("click", () => this.toggleSteps());

    this.stepsEl = root.createDiv("ai-wiki-steps");
    this.stepsEl.addClass("ai-wiki-hidden");

    this.liveStatusSection = root.createDiv("ai-wiki-live-status ai-wiki-hidden");
    this.liveStatusIconEl = this.liveStatusSection.createSpan("ai-wiki-live-status-icon");
    this.liveStatusTextEl = this.liveStatusSection.createSpan("ai-wiki-live-status-text");

    this.resultSection = root.createDiv("ai-wiki-result-section ai-wiki-hidden");
    const resultHeader = this.resultSection.createDiv("ai-wiki-progress-header");
    const resultH4 = resultHeader.createEl("h4", { cls: "ai-wiki-progress-title" });
    this.resultToggle = resultH4.createSpan({ cls: "ai-wiki-progress-arrow", text: "▶" });
    resultH4.appendText(` ${T.view.result}`);
    this.resultSpeedEl = resultH4.createSpan({ cls: "muted ai-wiki-result-speed" });
    resultHeader.addEventListener("click", () => this.toggleResult());
    this.finalEl = this.resultSection.createDiv("ai-wiki-final ai-wiki-hidden");
    registerLinkHandler(this.finalEl, this.app);

    this.historySection = root.createDiv("ai-wiki-history-section ai-wiki-hidden");
    const historyHeader = this.historySection.createDiv("ai-wiki-progress-header");
    const historyH4 = historyHeader.createEl("h4", { cls: "ai-wiki-progress-title" });
    this.historyToggle = historyH4.createSpan({ cls: "ai-wiki-progress-arrow", text: "▶" });
    historyH4.appendText(` ${T.view.history}`);
    historyHeader.addEventListener("click", () => this.toggleHistory());
    this.historyEl = this.historySection.createDiv("ai-wiki-history ai-wiki-hidden");
    this.renderHistory();

    const ongoing = this.plugin.controller.currentOp;
    if (ongoing) {
      this.setRunning(ongoing.op, ongoing.args);
    }
  }

  onClose(): void {
    if (this.tickHandle !== null) window.clearTimeout(this.tickHandle);
    if (this.chatTickHandle !== null) window.clearTimeout(this.chatTickHandle);
    this.stopWaiting();
    if (this.reasoningRafHandle !== null) {
      window.cancelAnimationFrame(this.reasoningRafHandle);
      this.reasoningRafHandle = null;
    }
    this.liveStatusSection = null;
    this.liveStatusIconEl = null;
    this.liveStatusTextEl = null;
    if (this.plugin.controller.isBusy()) {
      new BusyCloseModal(this.app, () => this.plugin.controller.cancelCurrent()).open();
    }
  }

  private buildDomainRow(parent: HTMLElement, opts: { withActions: boolean }): void {
    const T = i18n();
    const domainBox = parent.createDiv("ai-wiki-domain");
    const domainRow = domainBox.createDiv("ai-wiki-domain-row");
    domainRow.createSpan({ cls: "muted", text: "Domain:" });
    this.domainSelect = domainRow.createEl("select", { cls: "ai-wiki-domain-select" });
    const refreshBtn = domainRow.createEl("button", { text: "↻", attr: { title: T.view.refreshTitle } });
    refreshBtn.addEventListener("click", () => void this.refreshDomains());

    if (opts.withActions) {
      this.addSourceBtn = domainRow.createEl("button", { attr: { title: T.view.addSourceTitle } });
      setIcon(this.addSourceBtn, "folder-plus");
      this.addSourceBtn.disabled = true;
      this.addSourceBtn.addEventListener("click", () => void this.openManageSources());
      this.reinitBtn = domainRow.createEl("button", { attr: { title: T.view.reinitTitle } });
      setIcon(this.reinitBtn, "recycle");
      this.reinitBtn.disabled = true;
      this.reinitBtn.addEventListener("click", () => void this.runReinit());
      this.domainSelect.addEventListener("change", () => {
        if (this.reinitBtn) this.reinitBtn.disabled = !this.domainSelect!.value;
        if (this.addSourceBtn) this.addSourceBtn.disabled = !this.domainSelect!.value;
      });

      const actionRow = domainBox.createDiv("ai-wiki-domain-actions");
      this.ingestBtn = actionRow.createEl("button", { text: T.view.ingest });
      this.lintBtn = actionRow.createEl("button", { text: T.view.lint });
      this.formatBtn = actionRow.createEl("button", { text: T.view.format });
      this.formatBtn.addEventListener("click", () => void this.plugin.controller.format());
      this.ingestBtn.addEventListener("click", () => {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!file) { new Notice(i18n().view.noActiveFile); return; }
        const domainId = this.domainSelect!.value || undefined;
        new ConfirmModal(this.plugin.app, "Ingest — confirm", [
          `File: ${file.name}`,
          "Claude will read the file, extract entities and update domain wiki pages.",
        ], () => void this.plugin.controller.ingestActive(domainId)).open();
      });
      this.lintBtn.addEventListener("click", () => {
        const d = this.domainSelect!.value;
        const domainLabel = d ? `«${d}»` : "all wiki";
        new ConfirmModal(this.plugin.app, "Lint — confirm", [
          `Domain: ${domainLabel}`,
          "Claude will check wiki pages for quality and update entity_types.",
        ], () => void this.plugin.controller.lint(d || "all")).open();
      });
    }

    void this.refreshDomains();
  }

  private async refreshDomains(): Promise<void> {
    if (!this.domainSelect) return;
    let domains: DomainEntry[];
    try { domains = await this.plugin.controller.loadDomains(); } catch { return; }
    const previous = this.domainSelect.value;
    this.domainSelect.empty();
    const allOpt = this.domainSelect.createEl("option", { value: "", text: i18n().view.allDomains });
    void allOpt;
    for (const d of domains) {
      this.domainSelect.createEl("option", { value: d.id, text: d.name || d.id });
    }
    if (previous && Array.from(this.domainSelect.options).some((o) => o.value === previous)) {
      this.domainSelect.value = previous;
    }
    if (this.reinitBtn) this.reinitBtn.disabled = !this.domainSelect.value;
    if (this.addSourceBtn) this.addSourceBtn.disabled = !this.domainSelect.value;
  }

  private openAddDomain(): void {
    const cwd = this.plugin.controller.cwdOrEmpty();
    if (!cwd) { new Notice(i18n().view.cwdNotSet); return; }
    new AddDomainModal(this.app, (input) => {
      void (async () => {
        const r = await this.plugin.controller.registerDomain(input);
        if (!r.ok) return;
        await this.refreshDomains();
        if (this.domainSelect) {
          this.domainSelect.value = input.id;
          this.domainSelect.dispatchEvent(new Event("change"));
        }

        if (!input.sourcePaths.length) {
          void this.plugin.controller.init(input.id, false);
          return;
        }

        const T = i18n().modal;
        const mdFiles = collectMdInPaths(this.app.vault, input.sourcePaths);

        if (!mdFiles.length) {
          void this.plugin.controller.init(input.id, false);
          return;
        }

        new ConfirmModal(
          this.app,
          T.initConfirmTitle,
          [T.initConfirmBody(mdFiles.length, input.sourcePaths.length)],
          () => void this.plugin.controller.init(input.id, false, input.sourcePaths),
        ).open();
      })();
    }).open();
  }

  private async runReinit(): Promise<void> {
    if (!this.domainSelect) return;
    const domainId = this.domainSelect.value;
    if (!domainId) return;

    let entry: DomainEntry | undefined;
    try {
      const domains = await this.plugin.controller.loadDomains();
      entry = domains.find((d) => d.id === domainId);
    } catch {
      return;
    }
    if (!entry) return;

    const sourcePaths = entry.source_paths ?? [];
    if (sourcePaths.length === 0) {
      new Notice(i18n().view.reinitNoSources);
      return;
    }

    const T = i18n().modal;
    const mdFiles = collectMdInPaths(this.app.vault, sourcePaths);
    const wikiFiles = collectMdInPaths(this.app.vault, [domainWikiFolder(entry.wiki_folder)]);
    const body = T.reinitConfirmBody(entry.id, wikiFiles.length, mdFiles.length, sourcePaths.length);

    new ConfirmModal(
      this.app,
      T.reinitConfirmTitle,
      [body],
      () => void this.plugin.controller.init(entry!.id, false, sourcePaths, true),
    ).open();
  }

  private async openManageSources(): Promise<void> {
    const domainId = this.domainSelect!.value;
    if (!domainId) return;
    const domains = await this.plugin.controller.loadDomains();
    const entry = domains.find((d) => d.id === domainId);
    if (!entry) return;
    new ManageSourcesModal(this.app, entry, (result) => {
      void this.handleManageSourcesResult(entry, result);
    }).open();
  }

  private async handleManageSourcesResult(
    original: DomainEntry,
    result: { sourcePaths: string[] },
  ): Promise<void> {
    const oldPaths = original.source_paths ?? [];
    const newPaths = result.sourcePaths;
    const added = newPaths.filter((p) => !oldPaths.includes(p));
    const removed = oldPaths.filter((p) => !newPaths.includes(p));

    await this.plugin.controller.updateDomainSources(original.id, newPaths);

    if (removed.length > 0) {
      const deleted = await this.plugin.controller.cleanupRemovedSources(original.id, removed);
      if (deleted > 0) new Notice(`Удалено статей: ${deleted}`);
    }

    if (added.length > 0) {
      new IngestScopeModal(this.app, added.length, newPaths.length, (scope) => {
        if (scope === "skip") return;
        const paths = scope === "new" ? added : newPaths;
        void this.plugin.controller.init(original.id, false, paths);
      }).open();
    }
  }

  private submitQuery(save: boolean): void {
    const q = this.queryInput.value.trim();
    if (!q) { new Notice(i18n().view.enterQuestion); return; }
    if (this.state === "running") { new Notice(i18n().view.operationInProgress); return; }
    void this.plugin.controller.query(q, save, this.domainSelect?.value || undefined);
    this.queryInput.value = "";
  }

  setRunning(operation: WikiOperation, args: string[]): void {
    this.state = "running";
    this.stepsEl.empty();
    this.finalEl.empty();
    this.statusEl.setText(`▶ ${operation} ${args.join(" ")}`);
    this.cancelBtn.disabled = false;
    this.askBtn.disabled = true;
    this.askSaveBtn.disabled = true;
    if (this.initBtn) this.initBtn.disabled = true;
    if (this.ingestBtn) this.ingestBtn.disabled = true;
    if (this.lintBtn) this.lintBtn.disabled = true;
    if (this.formatBtn) this.formatBtn.disabled = true;
    if (this.reinitBtn) this.reinitBtn.disabled = true;
    if (this.addSourceBtn) this.addSourceBtn.disabled = true;
    this.chatSection?.remove();
    this.chatSection = null;
    this.lastContext = null;
    this.chatHistory = [];

    this.resultSection.addClass("ai-wiki-hidden");
    this.finalEl.empty();
    this.resultOpen = false;

    this.startTs = Date.now();
    this.toolCount = 0;
    this.stepCount = 0;
    this.progressEl = null;
    this.mobileWaitingEl = null;
    this.progressPhaseEl = null;
    this.progressTotal = 0;
    this.progressDone = 0;
    this.currentToolStep = null;
    this.reasoningBlock = null;
    this.reasoningBuffer = "";
    if (this.reasoningRafHandle !== null) {
      window.cancelAnimationFrame(this.reasoningRafHandle);
      this.reasoningRafHandle = null;
    }
    this.lastTokPerSec = undefined;
    this.resultSpeedEl?.setText("");
    this.stepsOpen = true;
    this.stepsEl.removeClass("ai-wiki-hidden");
    this.progressToggle.setText("▼");
    this.updateMetrics();
    if (this.tickHandle !== null) { window.clearTimeout(this.tickHandle); this.tickHandle = null; }
    this.stopWaiting();
    this.liveStatusSection?.removeClass("ai-wiki-hidden");
    this.liveStatusIconEl?.setText("");
    this.liveStatusTextEl?.setText("");
    this.scheduleMetricsTick();
    if (Platform.isMobile) {
      // Streaming недоступен на mobile — показываем спиннер, чтобы UI не выглядел замёрзшим.
      const placeholder = this.stepsEl.createDiv("ai-wiki-step ai-wiki-step-pending");
      placeholder.setText(i18n().view.mobileWaiting);
      this.mobileWaitingEl = placeholder;
    }
  }

  appendEvent(ev: RunEvent): void {
    if (this.mobileWaitingEl) {
      this.mobileWaitingEl.remove();
      this.mobileWaitingEl = null;
    }
    if (ev.kind === "format_preview") {
      this.renderFormatPreview(ev.tempPath, ev.report, ev.missingTokens);
      return;
    }
    if (ev.kind === "format_applied" || ev.kind === "format_cancelled") {
      this.formatPreviewSection?.remove();
      this.formatPreviewSection = null;
      return;
    }
    if (ev.kind === "init_start") {
      this.progressTotal = ev.totalFiles;
      this.progressDone = 0;
      if (this.progressEl) {
        // Second init_start (Phase 2) — reset existing elements in place
        this.progressEl.setText(`0 / ${ev.totalFiles} файлов`);
        if (this.progressPhaseEl) {
          const label = ev.phase === "ingest" ? "Ingesting files…" : "Analysing files…";
          this.progressPhaseEl.setText(label);
        }
      } else {
        const step = this.stepsEl.createDiv("ai-wiki-step ai-wiki-progress");
        step.createSpan({ cls: "ai-wiki-step-icon" }).setText("📂");
        const label = ev.phase === "ingest" ? "Ingesting files…" : "Analysing files…";
        this.progressPhaseEl = step.createSpan({ cls: "ai-wiki-progress-phase" });
        this.progressPhaseEl.setText(label);
        this.progressEl = step.createSpan({ cls: "ai-wiki-progress-text" });
        this.progressEl.setText(`0 / ${ev.totalFiles} файлов`);
      }
      this.scrollSteps();
      return;
    }
    if (ev.kind === "file_start") {
      if (this.progressEl) {
        this.progressEl.setText(`${ev.index} / ${ev.total} файлов → ${ev.file.split("/").pop()}`);
      }
      this.scrollSteps();
      return;
    }
    if (ev.kind === "file_done") {
      this.progressDone++;
      if (this.progressEl) {
        this.progressEl.setText(`${this.progressDone} / ${this.progressTotal} файлов`);
      }
      this.scrollSteps();
      return;
    }
    if (ev.kind === "graph_stats") {
      const cacheHint = ev.fromCache ? " (cache hit)" : "";
      const preview = ev.seeds.slice(0, 3).join(", ");
      const extra = ev.seeds.length > 3 ? `, …+${ev.seeds.length - 3}` : "";
      const step = this.stepsEl.createDiv("ai-wiki-step");
      step.createSpan({ cls: "ai-wiki-step-icon" }).setText("🌐");
      step.createSpan({ cls: "ai-wiki-step-name" })
        .setText(`Граф: ${ev.seeds.length} seeds [${preview}${extra}] → ${ev.expanded} / ${ev.total} страниц${cacheHint}`);
      this.scrollSteps();
      return;
    }
    if (ev.kind === "domain_created") {
      void this.refreshDomains();
      return;
    }
    if (ev.kind === "source_path_added") return;
    if (ev.kind === "domain_updated") { void this.refreshDomains(); return; }
    if (ev.kind !== "assistant_text") this.stepCount++;
    if (ev.kind === "tool_use") {
      this.stopWaiting();
      this.toolCount++;
      this.reasoningBlock = null;
      this.reasoningBuffer = "";
      if (this.reasoningRafHandle !== null) {
        window.cancelAnimationFrame(this.reasoningRafHandle);
        this.reasoningRafHandle = null;
      }
      const step = this.stepsEl.createDiv("ai-wiki-step");
      const head = step.createDiv("ai-wiki-step-head");
      head.createSpan({ cls: "ai-wiki-step-icon" }).setText("🔧");
      head.createSpan({ cls: "ai-wiki-step-name" }).setText(ev.name);
      const summary = summariseInput(ev.input);
      if (summary) head.createSpan({ cls: "ai-wiki-step-arg" }).setText(summary);
      head.createSpan({ cls: "ai-wiki-step-time muted" }).setText(this.elapsedShort());
      this.currentToolStep = step;
      this.currentToolStartedAt = Date.now();
      this.scrollSteps();
      this.liveStatusIconEl?.setText("🔧");
      this.liveStatusTextEl?.setText(`${ev.name}  ${summariseInput(ev.input)}`);
    } else if (ev.kind === "tool_result") {
      const step = this.currentToolStep;
      if (step) {
        const head = step.querySelector(".ai-wiki-step-head");
        head?.addClass(ev.ok ? "ok" : "err");
        const dur = ((Date.now() - this.currentToolStartedAt) / 1000).toFixed(1);
        const t = step.querySelector(".ai-wiki-step-time");
        if (t) t.setText(`${dur}s`);
        if (ev.preview) {
          const p = step.createDiv("ai-wiki-step-preview");
          p.setText(truncate(ev.preview.replace(/\s+/g, " "), PREVIEW_INLINE));
        }
        this.currentToolStep = null;
      }
      this.startWaiting();
    } else if (ev.kind === "ask_user") {
      const el = this.stepsEl.createDiv("ai-wiki-step ai-wiki-step--ask");
      el.createSpan({ text: "⏳ Waiting for answer…" });
      return;
    } else if (ev.kind === "assistant_text") {
      this.stopWaiting();
      if (ev.isReasoning) {
        if (!this.reasoningBlock) {
          this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
          const rHead = this.reasoningBlock.createDiv("ai-wiki-step-head");
          rHead.createSpan({ cls: "ai-wiki-step-icon" }).setText("🧠");
          rHead.createSpan({ cls: "ai-wiki-step-name muted" }).setText(i18n().view.analysing);
          this.reasoningBlock.createSpan({ cls: "ai-wiki-reasoning-text" });
        }
        this.reasoningBuffer += ev.delta;
        if (!this.reasoningRafHandle) {
          this.reasoningRafHandle = window.requestAnimationFrame(() => {
            this.reasoningRafHandle = null;
            const span = this.reasoningBlock?.querySelector<HTMLElement>(".ai-wiki-reasoning-text");
            if (span) span.setText(this.reasoningBuffer);
            this.scrollSteps();
          });
        }
        this.liveStatusIconEl?.setText("🧠");
        this.liveStatusTextEl?.setText("Analysing...");
      } else {
        this.liveStatusIconEl?.setText("💬");
        this.liveStatusTextEl?.setText("Forming response...");
      }
    } else if (ev.kind === "system") {
      const step = this.stepsEl.createDiv("ai-wiki-step");
      const head = step.createDiv("ai-wiki-step-head");
      head.createSpan({ cls: "ai-wiki-step-icon" }).setText("⚙");
      head.createSpan({ cls: "ai-wiki-step-name muted" }).setText(translateSystemEvent(ev.message));
      this.scrollSteps();
    } else if (ev.kind === "error") {
      this.stopWaiting();
      this.stepsEl.createDiv("ai-wiki-step err").setText(`✗ ${ev.message}`);
      this.scrollSteps();
    } else if (ev.kind === "result") {
      this.stopWaiting();
      if (ev.outputTokens !== undefined && ev.durationMs > 0) {
        this.lastTokPerSec = Math.round(ev.outputTokens / (ev.durationMs / 1000));
      }
    } else if (ev.kind === "eval_result") {
      const el = this.stepsEl.createEl("div", { cls: "ai-wiki-eval-result" });
      el.setText(`[eval: ${ev.score}/10] ${ev.reasoning}`);
    }
    this.updateMetrics();
  }

  private renderFormatPreview(tempPath: string, report: string, missing: { token: string; context: string }[]): void {
    const T = i18n();
    this.formatPreviewSection?.remove();

    const root = this.containerEl.children[1] as HTMLElement;
    this.formatPreviewSection = root.createDiv("ai-wiki-format-preview");

    this.formatPreviewSection.createEl("h4", { text: T.view.formatPreviewHeader });

    const link = this.formatPreviewSection.createEl("a", {
      text: `📄 ${tempPath}`,
      cls: "internal-link",
      attr: { href: tempPath, "data-href": tempPath },
    });
    void link;
    registerLinkHandler(this.formatPreviewSection, this.app);

    const reportEl = this.formatPreviewSection.createDiv("ai-wiki-format-report");
    const comp = new Component();
    comp.load();
    void MarkdownRenderer.render(this.app, report, reportEl, "", comp).then(() => sanitizeLinks(reportEl));

    if (missing.length > 0) {
      const warn = this.formatPreviewSection.createEl("details", { cls: "ai-wiki-format-warn" });
      const summary = warn.createEl("summary");
      summary.setText(T.view.formatMissingTokens(missing.length));
      const list = warn.createEl("ul", { cls: "ai-wiki-format-warn-list" });
      for (const m of missing) {
        const li = list.createEl("li");
        li.createEl("code", { text: m.token, cls: "ai-wiki-format-warn-token" });
        if (m.context) {
          li.createSpan({ text: " — ", cls: "ai-wiki-format-warn-sep" });
          li.createSpan({ text: m.context, cls: "ai-wiki-format-warn-ctx" });
        }
      }
    }

    const btnRow = this.formatPreviewSection.createDiv("ai-wiki-format-actions");
    const applyReplaceBtn = btnRow.createEl("button", { text: T.view.formatApplyReplace, cls: "mod-cta" });
    applyReplaceBtn.addEventListener("click", () => void this.plugin.controller.formatApply(false));

    const applyKeepBtn = btnRow.createEl("button", { text: T.view.formatApplyKeep });
    applyKeepBtn.addEventListener("click", () => void this.plugin.controller.formatApply(true));

    const cancelBtn = btnRow.createEl("button", { text: T.view.formatCancelBtn, cls: "mod-warning" });
    cancelBtn.addEventListener("click", () => void this.plugin.controller.formatCancel());

    const chatBox = this.formatPreviewSection.createDiv("ai-wiki-format-chat");
    const inputEl = chatBox.createEl("textarea", {
      cls: "ai-wiki-format-chat-input",
      attr: { placeholder: T.view.formatRefinePlaceholder, rows: "3" },
    });
    const sendRow = chatBox.createDiv("ai-wiki-format-chat-send-row");
    const sendBtn = sendRow.createEl("button", { text: T.view.chatSend });
    sendBtn.addEventListener("click", () => {
      const msg = inputEl.value.trim();
      if (!msg) return;
      inputEl.value = "";
      void this.plugin.controller.formatRefine(msg);
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });
  }

  async finish(entry: RunHistoryEntry): Promise<void> {
    this.state = entry.status;
    this.statusEl.setText(this.statusLabel(entry));
    this.cancelBtn.disabled = true;
    this.askBtn.disabled = false;
    this.askSaveBtn.disabled = false;
    if (this.initBtn) this.initBtn.disabled = false;
    if (this.ingestBtn) this.ingestBtn.disabled = false;
    if (this.lintBtn) this.lintBtn.disabled = false;
    if (this.formatBtn) this.formatBtn.disabled = false;
    if (this.reinitBtn) this.reinitBtn.disabled = !(this.domainSelect && this.domainSelect.value);
    if (this.addSourceBtn) this.addSourceBtn.disabled = !(this.domainSelect && this.domainSelect.value);
    if (this.tickHandle !== null) { window.clearTimeout(this.tickHandle); this.tickHandle = null; }
    this.updateMetrics();
    this.liveStatusSection?.addClass("ai-wiki-hidden");
    const totalDur = ((entry.finishedAt - entry.startedAt) / 1000).toFixed(1);
    this.progressCount.setText(`${totalDur}s`);
    this.resultSpeedEl?.setText(this.lastTokPerSec !== undefined ? ` ${this.lastTokPerSec} tok/s` : "");
    this.finalEl.empty();
    if (entry.finalText) {
      const comp = new Component();
      comp.load();
      await MarkdownRenderer.render(this.app, entry.finalText, this.finalEl, "", comp);
      sanitizeLinks(this.finalEl);
      this.resultSection.removeClass("ai-wiki-hidden");
      this.finalEl.removeClass("ai-wiki-hidden");
      this.resultOpen = true;
      this.resultToggle.setText("▼");

      const CHAT_OPS: WikiOperation[] = ["lint", "lint-chat", "ingest", "query", "query-save"];
      if (CHAT_OPS.includes(entry.operation) && entry.status === "done" && entry.finalText) {
        this.lastContext = {
          operation: entry.operation,
          domainId: entry.domainId,
          report: entry.finalText,
        };
        this.chatHistory = [];
        this.showChatSection();
      }
    }
    this.renderHistory();
  }

  private showChatSection(): void {
    this.chatSection?.remove();
    this.chatOpen = true;
    const T = i18n();
    this.chatSection = this.resultSection.createDiv("ai-wiki-chat-section");

    const chatHeader = this.chatSection.createDiv("ai-wiki-progress-header");
    const chatH4 = chatHeader.createEl("h4", { cls: "ai-wiki-progress-title" });
    this.chatToggle = chatH4.createSpan({ cls: "ai-wiki-progress-arrow", text: "▼" });
    chatH4.appendText(` ${T.view.chatLabel}`);
    chatHeader.addEventListener("click", () => this.toggleChat());

    this.chatBodyEl = this.chatSection.createDiv("ai-wiki-chat-body");
    this.chatMessagesEl = this.chatBodyEl.createDiv("ai-wiki-chat-messages");
    const inputRow = this.chatBodyEl.createDiv("ai-wiki-chat-input-row");
    this.chatInputEl = inputRow.createEl("textarea", { cls: "ai-wiki-chat-input", attr: { rows: "2" } });
    this.chatSendBtn = inputRow.createEl("button", { text: T.view.chatSend, cls: "ai-wiki-chat-send" });
    const submit = () => {
      const text = this.chatInputEl!.value.trim();
      if (!text || !this.lastContext) return;
      this.chatInputEl!.value = "";
      this.addChatBubble("user", text);
      this.lastUserMessage = text;
      const ctx = this.lastContext;
      if (ctx.operation === "lint" || ctx.operation === "lint-chat") {
        const domainId = (ctx.domainId ?? this.domainSelect?.value) || undefined;
        if (!domainId) {
          new Notice(i18n().view.selectDomainFirst ?? "Select a domain first");
          return;
        }
        void this.plugin.controller.lintApplyFromChat(
          domainId,
          ctx.report,
          this.chatHistory,
          text,
        );
      } else {
        void this.plugin.controller.chat(
          ctx.operation,
          ctx.domainId,
          ctx.report,
          this.chatHistory,
          text,
        );
      }
    };
    this.chatSendBtn.addEventListener("click", submit);
  }

  private addChatBubble(role: "user" | "assistant", text: string): HTMLElement {
    const el = this.chatMessagesEl!.createDiv(`ai-wiki-chat-msg ai-wiki-chat-msg--${role}`);
    if (role === "user") {
      el.setText(text);
    } else {
      const comp = new Component();
      comp.load();
      void MarkdownRenderer.render(this.app, text, el, "", comp).then(() => sanitizeLinks(el));
      registerLinkHandler(el, this.app);
    }
    const copyBtn = el.createEl("button", { cls: "ai-wiki-copy-btn", attr: { "aria-label": "Copy" } });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(text);
      setIcon(copyBtn, "check");
      window.setTimeout(() => setIcon(copyBtn, "copy"), 1500);
    });
    el.scrollIntoView({ block: "end" });
    return el;
  }

  setChatRunning(): void {
    if (this.chatSendBtn) this.chatSendBtn.disabled = true;
    if (this.chatInputEl) this.chatInputEl.disabled = true;
    this.currentChatBuffer = "";
    if (this.chatMessagesEl) {
      this.currentChatBubble = this.chatMessagesEl.createDiv("ai-wiki-chat-msg ai-wiki-chat-msg--assistant ai-wiki-chat-msg--streaming");
      this.currentChatBubble.setText("…");
      this.currentChatBubble.scrollIntoView({ block: "end" });
    }
    this.chatStartTs = Date.now();
    if (this.chatTickHandle !== null) { window.clearTimeout(this.chatTickHandle); this.chatTickHandle = null; }
    this.scheduleChatTick();
  }

  private scheduleChatTick(): void {
    this.chatTickHandle = window.setTimeout(() => {
      if (this.currentChatBubble) {
        const s = ((Date.now() - this.chatStartTs) / 1000).toFixed(1);
        this.currentChatBubble.setText(`⏳ ${s}s…`);
        this.scheduleChatTick();
      } else {
        this.chatTickHandle = null;
      }
    }, 500);
  }

  appendChatEvent(ev: RunEvent): void {
    if (ev.kind === "assistant_text" && !ev.isReasoning && this.currentChatBubble) {
      if (this.chatTickHandle !== null) {
        window.clearTimeout(this.chatTickHandle);
        this.chatTickHandle = null;
        this.currentChatBubble.setText("");
      }
      this.currentChatBuffer += ev.delta;
      this.currentChatBubble.setText(this.currentChatBuffer);
      this.currentChatBubble.scrollIntoView({ block: "end" });
    }
  }

  finishChat(msg: ChatMessage, isError: boolean): void {
    if (this.chatTickHandle !== null) {
      window.clearTimeout(this.chatTickHandle);
      this.chatTickHandle = null;
    }
    if (this.chatSendBtn) this.chatSendBtn.disabled = false;
    if (this.chatInputEl) { this.chatInputEl.disabled = false; this.chatInputEl.focus(); }
    if (this.currentChatBubble) {
      this.currentChatBubble.removeClass("ai-wiki-chat-msg--streaming");
      this.currentChatBubble.empty();
      if (isError) {
        this.currentChatBubble.addClass("ai-wiki-chat-msg--error");
        this.currentChatBubble.setText(msg.content);
      } else {
        const comp = new Component();
        comp.load();
        void MarkdownRenderer.render(this.app, msg.content, this.currentChatBubble, "", comp).then(() => sanitizeLinks(this.currentChatBubble!));
        registerLinkHandler(this.currentChatBubble, this.app);
      }
      this.currentChatBubble = null;
    }
    if (!isError && this.lastUserMessage) {
      this.chatHistory.push({ role: "user", content: this.lastUserMessage });
      this.chatHistory.push(msg);
    }
    this.lastUserMessage = "";
    this.currentChatBuffer = "";
  }

  private toggleHistory(): void {
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen) {
      this.historyEl.removeClass("ai-wiki-hidden");
    } else {
      this.historyEl.addClass("ai-wiki-hidden");
    }
    this.historyToggle.setText(this.historyOpen ? "▼" : "▶");
  }

  private toggleResult(): void {
    this.resultOpen = !this.resultOpen;
    if (this.resultOpen) {
      this.finalEl.removeClass("ai-wiki-hidden");
    } else {
      this.finalEl.addClass("ai-wiki-hidden");
    }
    this.resultToggle.setText(this.resultOpen ? "▼" : "▶");
  }

  private toggleSteps(): void {
    this.stepsOpen = !this.stepsOpen;
    if (this.stepsOpen) {
      this.stepsEl.removeClass("ai-wiki-hidden");
    } else {
      this.stepsEl.addClass("ai-wiki-hidden");
    }
    this.progressToggle.setText(this.stepsOpen ? "▼" : "▶");
  }

  private toggleChat(): void {
    this.chatOpen = !this.chatOpen;
    this.chatBodyEl?.toggleClass("ai-wiki-hidden", !this.chatOpen);
    this.chatToggle?.setText(this.chatOpen ? "▼" : "▶");
  }

  private updateMetrics(): void {
    if (this.state !== "running") {
      this.progressCount.setText("");
      return;
    }
    const dur = ((Date.now() - this.startTs) / 1000).toFixed(1);
    this.progressCount.setText(i18n().view.stepsCount(this.stepCount, dur));
  }

  private scheduleMetricsTick(): void {
    this.tickHandle = window.setTimeout(() => {
      this.updateMetrics();
      if (this.state === "running") this.scheduleMetricsTick();
    }, 500);
  }

  private elapsedShort(): string {
    return `${((Date.now() - this.startTs) / 1000).toFixed(1)}s`;
  }

  private scrollSteps(): void {
    this.stepsEl.scrollTop = this.stepsEl.scrollHeight;
  }

  private startWaiting(): void {
    this.stopWaiting();
    this.waitingStartedAt = Date.now();
    this.waitingStep = this.stepsEl.createDiv("ai-wiki-step ai-wiki-step--waiting");
    this.waitingStep.createSpan({ cls: "ai-wiki-step-icon" }).setText("⏳");
    this.waitingStep.createSpan({ cls: "ai-wiki-waiting-text" }).setText("0.0s");
    this.scrollSteps();
    this.scheduleWaitingTick();
    this.liveStatusIconEl?.setText("⏳");
    this.liveStatusTextEl?.setText("0.0s");
  }

  private stopWaiting(): void {
    if (this.waitingTickHandle !== null) {
      window.clearTimeout(this.waitingTickHandle);
      this.waitingTickHandle = null;
    }
    this.waitingStep?.remove();
    this.waitingStep = null;
  }

  private scheduleWaitingTick(): void {
    this.waitingTickHandle = window.setTimeout(() => {
      if (!this.waitingStep) return;
      const s = ((Date.now() - this.waitingStartedAt) / 1000).toFixed(1);
      const span = this.waitingStep.querySelector<HTMLElement>(".ai-wiki-waiting-text");
      if (span) span.setText(`${s}s`);
      this.liveStatusTextEl?.setText(`${s}s`);
      this.scheduleWaitingTick();
    }, 100);
  }

  private statusLabel(entry: RunHistoryEntry): string {
    const dur = ((entry.finishedAt - entry.startedAt) / 1000).toFixed(1);
    const icon = entry.status === "done" ? "✓" : entry.status === "cancelled" ? "⛔" : "✗";
    return `${icon} ${entry.operation} (${dur}s)`;
  }

  private renderHistory(): void {
    this.historyEl.empty();
    const items = this.plugin.settings.history.slice().reverse();
    if (items.length === 0) {
      this.historySection.addClass("ai-wiki-hidden");
      this.historyOpen = false;
      return;
    }
    this.historySection.removeClass("ai-wiki-hidden");
    for (const it of items) {
      const row = this.historyEl.createDiv("ai-wiki-history-row");
      row.createSpan().setText(this.statusLabel(it));
      row.createSpan({ cls: "muted" }).setText(` ${it.args.join(" ")}`);
      row.addEventListener("click", () => {
        this.finalEl.empty();
        const comp = new Component();
        comp.load();
        void MarkdownRenderer.render(this.app, it.finalText || "(empty)", this.finalEl, "", comp).then(() => sanitizeLinks(this.finalEl));
        this.resultSection.removeClass("ai-wiki-hidden");
        this.finalEl.removeClass("ai-wiki-hidden");
        this.resultOpen = true;
        this.resultToggle.setText("▼");
      });
    }
  }

  showQuestionModal(question: string, options: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const modal = new WikiQuestionModal(this.app, question, options, resolve, reject);
      modal.open();
    });
  }
}

class WikiQuestionModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private question: string,
    private options: string[],
    private resolve: (answer: string) => void,
    private reject: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: i18n().view.answerRequired });
    contentEl.createEl("p", { text: this.question });

    if (this.options.length > 0) {
      const btnRow = contentEl.createDiv("ai-wiki-modal-options");
      for (const opt of this.options) {
        const btn = btnRow.createEl("button", { text: opt });
        btn.addEventListener("click", () => {
          if (this.settled) return;
          this.settled = true;
          this.resolve(opt);
          this.close();
        });
      }
    } else {
      const input = contentEl.createEl("input", {
        attr: { type: "text" },
        cls: "ai-wiki-modal-input",
      });
      input.focus();
      const submit = () => {
        if (this.settled) return;
        const val = input.value.trim();
        if (!val) return;
        this.settled = true;
        this.resolve(val);
        this.close();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
      contentEl.createEl("button", { text: "OK" }).addEventListener("click", submit);
    }

    const cancelBtn = contentEl.createEl("button", {
      text: i18n().view.cancel,
      cls: "mod-warning",
    });
    cancelBtn.addEventListener("click", () => {
      if (this.settled) return;
      this.settled = true;
      this.reject();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.reject();
    }
  }
}

function summariseInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  // Приоритетные ключи по убыванию информативности.
  const candidates: Array<[string, string?]> = [
    ["file_path"],
    ["path"],
    ["pattern"],
    ["query"],
    ["command"],
    ["url"],
    ["notebook_path"],
  ];
  for (const [k] of candidates) {
    const v = o[k];
    if (typeof v === "string" && v) return truncate(v, 80);
  }
  // Фолбэк — первый строковый аргумент.
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "string" && v) return `${k}=${truncate(v, 60)}`;
  }
  return "";
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function sanitizeLinks(el: HTMLElement): void {
  el.querySelectorAll("a[href]").forEach((a) => {
    if (/^javascript:/i.test((a.getAttribute("href") ?? "").trim())) {
      a.removeAttribute("href");
    }
  });
}

function translateSystemEvent(message: string): string {
  const T = i18n().view;
  if (message === "hook_started") return T.starting;
  if (message === "hook_response") return T.initialising;
  if (message.startsWith("init")) {
    const model = message.replace(/^init\s*/, "").replace(/[()]/g, "").trim();
    return model ? `${T.initialising} (${model})` : T.initialising;
  }
  return message;
}
