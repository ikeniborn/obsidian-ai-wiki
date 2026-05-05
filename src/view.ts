import { App, ItemView, Modal, WorkspaceLeaf, MarkdownRenderer, Component, Notice } from "obsidian";
import { AddDomainModal, BusyCloseModal, ConfirmModal } from "./modals";
import type LlmWikiPlugin from "./main";
import type { ChatMessage, RunEvent, RunHistoryEntry, WikiOperation } from "./types";
import { i18n } from "./i18n";

export const LLM_WIKI_VIEW_TYPE = "llm-wiki-view";

type ViewState = "idle" | "running" | "done" | "error" | "cancelled";

const PREVIEW_INLINE = 140;
const ASSISTANT_TEXT_MAX = 600;

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
  private domainSelect!: HTMLSelectElement;
  private initBtn!: HTMLButtonElement;
  private ingestBtn!: HTMLButtonElement;
  private lintBtn!: HTMLButtonElement;
  private fixChatEl: HTMLElement | null = null;
  private lastLint: { domainId: string; report: string } | null = null;
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
  private chatTickHandle: number | null = null;
  private chatStartTs = 0;
  private lastUserMessage = "";
  private startTs = 0;
  private toolCount = 0;
  private stepCount = 0;
  private tickHandle: number | null = null;
  private currentToolStep: HTMLElement | null = null;
  private currentToolStartedAt = 0;
  private assistantBlock: HTMLElement | null = null;
  private assistantBuffer = "";
  private reasoningBlock: HTMLElement | null = null;
  private reasoningBuffer = "";

  constructor(leaf: WorkspaceLeaf, private plugin: LlmWikiPlugin) {
    super(leaf);
  }

  getViewType(): string { return LLM_WIKI_VIEW_TYPE; }
  getDisplayText(): string { return "LLM wiki"; }
  getIcon(): string { return "brain-circuit"; }

  onOpen(): void {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("llm-wiki-view");

    const T = i18n();

    const header = root.createDiv("llm-wiki-header");
    header.createEl("h3", { text: "LLM wiki" });
    this.statusEl = header.createDiv("llm-wiki-status");

    // 1. Создание нового домена
    root.createDiv({ cls: "llm-wiki-section-label", text: T.view.sectionCreate });
    const createRow = root.createDiv("llm-wiki-create-row");
    this.initBtn = createRow.createEl("button", { text: T.view.init, cls: "llm-wiki-init-btn" });
    this.initBtn.addEventListener("click", () => this.openAddDomain());

    // 2+3. Наполнение / Актуализация
    root.createDiv({ cls: "llm-wiki-section-label", text: T.view.sectionDomain });
    const domainBox = root.createDiv("llm-wiki-domain");
    const domainRow = domainBox.createDiv("llm-wiki-domain-row");
    domainRow.createSpan({ cls: "muted", text: "Domain:" });
    this.domainSelect = domainRow.createEl("select", { cls: "llm-wiki-domain-select" });
    const refreshBtn = domainRow.createEl("button", { text: "↻", attr: { title: T.view.refreshTitle } });
    refreshBtn.addEventListener("click", () => this.refreshDomains());

    const actionRow = domainBox.createDiv("llm-wiki-domain-actions");
    this.ingestBtn = actionRow.createEl("button", { text: T.view.ingest });
    this.lintBtn = actionRow.createEl("button", { text: T.view.lint });
    this.ingestBtn.addEventListener("click", () => {
      const file = this.plugin.app.workspace.getActiveFile();
      if (!file) { new Notice(i18n().view.noActiveFile); return; }
      const domainId = this.domainSelect.value || undefined;
      new ConfirmModal(this.plugin.app, "Ingest — confirm", [
        `File: ${file.name}`,
        "Claude will read the file, extract entities and update domain wiki pages.",
      ], () => void this.plugin.controller.ingestActive(domainId)).open();
    });
    this.lintBtn.addEventListener("click", () => {
      const d = this.domainSelect.value;
      const domainLabel = d ? `«${d}»` : "all wiki";
      new ConfirmModal(this.plugin.app, "Lint — confirm", [
        `Domain: ${domainLabel}`,
        "Claude will check wiki pages for quality and update entity_types.",
      ], () => void this.plugin.controller.lint(d || "all")).open();
    });
    this.refreshDomains();

    // 4. Запрос
    root.createDiv({ cls: "llm-wiki-section-label", text: T.view.sectionQuery });
    const ask = root.createDiv("llm-wiki-ask");
    this.queryInput = ask.createEl("textarea", {
      cls: "llm-wiki-query-input",
      attr: { placeholder: "Question…", rows: "3" },
    });
    const askRow = ask.createDiv("llm-wiki-ask-row");
    this.askBtn = askRow.createEl("button", { text: T.view.ask });
    this.askSaveBtn = askRow.createEl("button", { text: T.view.askAndSave });
    this.cancelBtn = askRow.createEl("button", { text: T.view.cancel, cls: "mod-warning" });
    this.cancelBtn.disabled = true;
    this.askBtn.addEventListener("click", () => this.submitQuery(false));
    this.askSaveBtn.addEventListener("click", () => this.submitQuery(true));
    this.cancelBtn.addEventListener("click", () => this.plugin.controller.cancelCurrent());

    const progressHeader = root.createDiv("llm-wiki-progress-header");
    const progressH4 = progressHeader.createEl("h4", { cls: "llm-wiki-progress-title" });
    this.progressToggle = progressH4.createSpan({ cls: "llm-wiki-progress-arrow", text: "▶" });
    progressH4.appendText(" Progress ");
    this.progressCount = progressH4.createSpan({ cls: "llm-wiki-progress-count muted", text: "" });
    progressHeader.addEventListener("click", () => this.toggleSteps());

    this.stepsEl = root.createDiv("llm-wiki-steps");
    this.stepsEl.addClass("llm-wiki-hidden");

    this.resultSection = root.createDiv("llm-wiki-result-section llm-wiki-hidden");
    const resultHeader = this.resultSection.createDiv("llm-wiki-progress-header");
    const resultH4 = resultHeader.createEl("h4", { cls: "llm-wiki-progress-title" });
    this.resultToggle = resultH4.createSpan({ cls: "llm-wiki-progress-arrow", text: "▶" });
    resultH4.appendText(` ${T.view.result}`);
    resultHeader.addEventListener("click", () => this.toggleResult());
    this.finalEl = this.resultSection.createDiv("llm-wiki-final llm-wiki-hidden");

    this.historySection = root.createDiv("llm-wiki-history-section llm-wiki-hidden");
    const historyHeader = this.historySection.createDiv("llm-wiki-progress-header");
    const historyH4 = historyHeader.createEl("h4", { cls: "llm-wiki-progress-title" });
    this.historyToggle = historyH4.createSpan({ cls: "llm-wiki-progress-arrow", text: "▶" });
    historyH4.appendText(` ${T.view.history}`);
    historyHeader.addEventListener("click", () => this.toggleHistory());
    this.historyEl = this.historySection.createDiv("llm-wiki-history llm-wiki-hidden");
    this.renderHistory();

    const ongoing = this.plugin.controller.currentOp;
    if (ongoing) {
      this.setRunning(ongoing.op, ongoing.args);
    }
  }

  onClose(): void {
    if (this.tickHandle !== null) window.clearInterval(this.tickHandle);
    if (this.chatTickHandle !== null) window.clearInterval(this.chatTickHandle);
    if (this.plugin.controller.isBusy()) {
      new BusyCloseModal(this.app, () => this.plugin.controller.cancelCurrent()).open();
    }
  }

  private refreshDomains(): void {
    const domains = this.plugin.controller.loadDomains();
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
  }

  private openAddDomain(): void {
    const cwd = this.plugin.controller.cwdOrEmpty();
    if (!cwd) { new Notice(i18n().view.cwdNotSet); return; }
    // wiki_root возьмём из существующих записей или дефолт !Wiki
    const domains = this.plugin.controller.loadDomains();
    const wikiRoot = (() => {
      const sample = domains[0]?.wiki_folder ?? `!Wiki/x`;
      return sample.replace(/\/[^/]+$/, "") || "!Wiki";
    })();
    new AddDomainModal(this.app, wikiRoot, (input) => {
      const r = this.plugin.controller.registerDomain(input);
      if (r.ok) {
        this.refreshDomains();
        this.domainSelect.value = input.id;
        void this.plugin.controller.init(input.id, false);
      }
    }).open();
  }

  private submitQuery(save: boolean): void {
    const q = this.queryInput.value.trim();
    if (!q) { new Notice(i18n().view.enterQuestion); return; }
    if (this.state === "running") { new Notice(i18n().view.operationInProgress); return; }
    void this.plugin.controller.query(q, save, this.domainSelect.value || undefined);
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
    this.initBtn.disabled = true;
    this.ingestBtn.disabled = true;
    this.lintBtn.disabled = true;
    this.fixChatEl?.remove();
    this.fixChatEl = null;

    this.resultSection.addClass("llm-wiki-hidden");
    this.finalEl.empty();
    this.resultOpen = false;

    this.startTs = Date.now();
    this.toolCount = 0;
    this.stepCount = 0;
    this.currentToolStep = null;
    this.assistantBlock = null;
    this.assistantBuffer = "";
    this.reasoningBlock = null;
    this.reasoningBuffer = "";
    this.stepsOpen = true;
    this.stepsEl.removeClass("llm-wiki-hidden");
    this.progressToggle.setText("▼");
    this.updateMetrics();
    if (this.tickHandle !== null) window.clearInterval(this.tickHandle);
    this.tickHandle = window.setInterval(() => this.updateMetrics(), 500);
  }

  appendEvent(ev: RunEvent): void {
    if (ev.kind === "domain_created") {
      this.refreshDomains();
      return;
    }
    if (ev.kind === "source_path_added") return;
    if (ev.kind === "domain_updated") { this.refreshDomains(); return; }
    this.stepCount++;
    if (ev.kind === "tool_use") {
      this.toolCount++;
      this.assistantBlock = null;
      this.assistantBuffer = "";
      this.reasoningBlock = null;
      this.reasoningBuffer = "";
      const step = this.stepsEl.createDiv("llm-wiki-step");
      const head = step.createDiv("llm-wiki-step-head");
      head.createSpan({ cls: "llm-wiki-step-icon" }).setText("🔧");
      head.createSpan({ cls: "llm-wiki-step-name" }).setText(ev.name);
      const summary = summariseInput(ev.input);
      if (summary) head.createSpan({ cls: "llm-wiki-step-arg" }).setText(summary);
      head.createSpan({ cls: "llm-wiki-step-time muted" }).setText(this.elapsedShort());
      this.currentToolStep = step;
      this.currentToolStartedAt = Date.now();
      this.scrollSteps();
    } else if (ev.kind === "tool_result") {
      const step = this.currentToolStep;
      if (step) {
        const head = step.querySelector(".llm-wiki-step-head");
        head?.addClass(ev.ok ? "ok" : "err");
        const dur = ((Date.now() - this.currentToolStartedAt) / 1000).toFixed(1);
        const t = step.querySelector(".llm-wiki-step-time");
        if (t) t.setText(`${dur}s`);
        if (ev.preview) {
          const p = step.createDiv("llm-wiki-step-preview");
          p.setText(truncate(ev.preview.replace(/\s+/g, " "), PREVIEW_INLINE));
        }
        this.currentToolStep = null;
      }
    } else if (ev.kind === "ask_user") {
      const el = this.stepsEl.createDiv("llm-wiki-step llm-wiki-step--ask");
      el.createSpan({ text: "⏳ Waiting for answer…" });
      return;
    } else if (ev.kind === "assistant_text") {
      if (ev.isReasoning) {
        if (!this.reasoningBlock) {
          this.reasoningBlock = this.stepsEl.createDiv("llm-wiki-step reasoning");
          if (this.assistantBlock) {
            this.stepsEl.insertBefore(this.reasoningBlock, this.assistantBlock);
          }
          this.reasoningBlock.createSpan({ cls: "llm-wiki-step-icon" }).setText("🧠");
          this.reasoningBlock.createSpan({ cls: "llm-wiki-reasoning-text" });
        }
        this.reasoningBuffer += ev.delta;
        const span = this.reasoningBlock.querySelector<HTMLElement>(".llm-wiki-reasoning-text");
        if (span) span.setText(truncate(this.reasoningBuffer, ASSISTANT_TEXT_MAX));
      } else {
        if (!this.assistantBlock) {
          this.assistantBlock = this.stepsEl.createDiv("llm-wiki-step assistant");
          this.assistantBlock.createSpan({ cls: "llm-wiki-step-icon" }).setText("💬");
          this.assistantBlock.createSpan({ cls: "llm-wiki-assistant-text" });
        }
        this.assistantBuffer += ev.delta;
        const span = this.assistantBlock.querySelector<HTMLElement>(".llm-wiki-assistant-text");
        if (span) span.setText(truncate(this.assistantBuffer, ASSISTANT_TEXT_MAX));
      }
      this.scrollSteps();
    } else if (ev.kind === "system") {
      const step = this.stepsEl.createDiv("llm-wiki-step");
      const head = step.createDiv("llm-wiki-step-head");
      head.createSpan({ cls: "llm-wiki-step-icon" }).setText("⚙");
      head.createSpan({ cls: "llm-wiki-step-name muted" }).setText(translateSystemEvent(ev.message));
      this.scrollSteps();
    } else if (ev.kind === "error") {
      this.stepsEl.createDiv("llm-wiki-step err").setText(`✗ ${ev.message}`);
      this.scrollSteps();
    } else if (ev.kind === "result") {
      // финальный result рендерим в finishe(), здесь — отметка
      this.assistantBlock = null;
    } else if (ev.kind === "eval_result") {
      const el = this.stepsEl.createEl("div", { cls: "llm-wiki-eval-result" });
      el.setText(`[eval: ${ev.score}/10] ${ev.reasoning}`);
    }
    this.updateMetrics();
  }

  async finish(entry: RunHistoryEntry): Promise<void> {
    this.state = entry.status;
    this.statusEl.setText(this.statusLabel(entry));
    this.cancelBtn.disabled = true;
    this.askBtn.disabled = false;
    this.askSaveBtn.disabled = false;
    this.initBtn.disabled = false;
    this.ingestBtn.disabled = false;
    this.lintBtn.disabled = false;
    this.fixChatEl?.remove();
    this.fixChatEl = null;
    if (this.tickHandle !== null) { window.clearInterval(this.tickHandle); this.tickHandle = null; }
    this.updateMetrics();
    this.finalEl.empty();
    if (entry.finalText) {
      const comp = new Component();
      comp.load();
      await MarkdownRenderer.render(this.app, entry.finalText, this.finalEl, this.plugin.controller.cwdOrEmpty(), comp);
      this.resultSection.removeClass("llm-wiki-hidden");
      this.finalEl.removeClass("llm-wiki-hidden");
      this.resultOpen = true;
      this.resultToggle.setText("▼");

      // Чат — только после lint на конкретном домене
      const domainId = entry.args[0];
      if (entry.operation === "lint" && entry.status === "done" && domainId) {
        this.lastLint = { domainId, report: entry.finalText };
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
    this.chatSection = this.resultSection.createDiv("llm-wiki-chat-section");

    const chatHeader = this.chatSection.createDiv("llm-wiki-progress-header");
    const chatH4 = chatHeader.createEl("h4", { cls: "llm-wiki-progress-title" });
    this.chatToggle = chatH4.createSpan({ cls: "llm-wiki-progress-arrow", text: "▼" });
    chatH4.appendText(` ${T.view.chatLabel}`);
    chatHeader.addEventListener("click", () => this.toggleChat());

    this.chatBodyEl = this.chatSection.createDiv("llm-wiki-chat-body");
    this.chatMessagesEl = this.chatBodyEl.createDiv("llm-wiki-chat-messages");
    const inputRow = this.chatBodyEl.createDiv("llm-wiki-chat-input-row");
    this.chatInputEl = inputRow.createEl("textarea", { cls: "llm-wiki-chat-input", attr: { rows: "2" } });
    this.chatSendBtn = inputRow.createEl("button", { text: T.view.chatSend, cls: "llm-wiki-chat-send" });
    const submit = () => {
      const text = this.chatInputEl!.value.trim();
      if (!text || !this.lastLint) return;
      this.chatInputEl!.value = "";
      this.addChatBubble("user", text);
      this.lastUserMessage = text;
      void this.plugin.controller.lintChat(this.lastLint.domainId, this.lastLint.report, this.chatHistory, text);
    };
    this.chatSendBtn.addEventListener("click", submit);
  }

  private addChatBubble(role: "user" | "assistant", text: string): HTMLElement {
    const el = this.chatMessagesEl!.createDiv(`llm-wiki-chat-msg llm-wiki-chat-msg--${role}`);
    if (role === "user") {
      el.setText(text);
    } else {
      void MarkdownRenderer.render(this.app, text, el, this.plugin.controller.cwdOrEmpty(), new Component());
    }
    el.scrollIntoView({ block: "end" });
    return el;
  }

  setChatRunning(): void {
    if (this.chatSendBtn) this.chatSendBtn.disabled = true;
    if (this.chatInputEl) this.chatInputEl.disabled = true;
    this.currentChatBuffer = "";
    if (this.chatMessagesEl) {
      this.currentChatBubble = this.chatMessagesEl.createDiv("llm-wiki-chat-msg llm-wiki-chat-msg--assistant llm-wiki-chat-msg--streaming");
      this.currentChatBubble.setText("…");
      this.currentChatBubble.scrollIntoView({ block: "end" });
    }
    this.chatStartTs = Date.now();
    this.chatTickHandle = window.setInterval(() => {
      if (this.currentChatBubble) {
        const s = ((Date.now() - this.chatStartTs) / 1000).toFixed(1);
        this.currentChatBubble.setText(`⏳ ${s}s…`);
      }
    }, 500);
  }

  appendChatEvent(ev: RunEvent): void {
    if (ev.kind === "assistant_text" && !ev.isReasoning && this.currentChatBubble) {
      if (this.chatTickHandle !== null) {
        window.clearInterval(this.chatTickHandle);
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
      window.clearInterval(this.chatTickHandle);
      this.chatTickHandle = null;
    }
    if (this.chatSendBtn) this.chatSendBtn.disabled = false;
    if (this.chatInputEl) { this.chatInputEl.disabled = false; this.chatInputEl.focus(); }
    if (this.currentChatBubble) {
      this.currentChatBubble.removeClass("llm-wiki-chat-msg--streaming");
      this.currentChatBubble.empty();
      if (isError) {
        this.currentChatBubble.addClass("llm-wiki-chat-msg--error");
        this.currentChatBubble.setText(msg.content);
      } else {
        void MarkdownRenderer.render(this.app, msg.content, this.currentChatBubble, this.plugin.controller.cwdOrEmpty(), new Component());
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
      this.historyEl.removeClass("llm-wiki-hidden");
    } else {
      this.historyEl.addClass("llm-wiki-hidden");
    }
    this.historyToggle.setText(this.historyOpen ? "▼" : "▶");
  }

  private toggleResult(): void {
    this.resultOpen = !this.resultOpen;
    if (this.resultOpen) {
      this.finalEl.removeClass("llm-wiki-hidden");
    } else {
      this.finalEl.addClass("llm-wiki-hidden");
    }
    this.resultToggle.setText(this.resultOpen ? "▼" : "▶");
  }

  private toggleSteps(): void {
    this.stepsOpen = !this.stepsOpen;
    if (this.stepsOpen) {
      this.stepsEl.removeClass("llm-wiki-hidden");
    } else {
      this.stepsEl.addClass("llm-wiki-hidden");
    }
    this.progressToggle.setText(this.stepsOpen ? "▼" : "▶");
  }

  private toggleChat(): void {
    this.chatOpen = !this.chatOpen;
    this.chatBodyEl?.toggleClass("llm-wiki-hidden", !this.chatOpen);
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

  private elapsedShort(): string {
    return `${((Date.now() - this.startTs) / 1000).toFixed(1)}s`;
  }

  private scrollSteps(): void {
    this.stepsEl.scrollTop = this.stepsEl.scrollHeight;
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
      this.historySection.addClass("llm-wiki-hidden");
      this.historyOpen = false;
      return;
    }
    this.historySection.removeClass("llm-wiki-hidden");
    for (const it of items) {
      const row = this.historyEl.createDiv("llm-wiki-history-row");
      row.createSpan().setText(this.statusLabel(it));
      row.createSpan({ cls: "muted" }).setText(` ${it.args.join(" ")}`);
      row.addEventListener("click", () => {
        this.finalEl.empty();
        const comp = new Component();
        comp.load();
        void MarkdownRenderer.render(this.app, it.finalText || "(empty)", this.finalEl, this.plugin.controller.cwdOrEmpty(), comp);
        this.resultSection.removeClass("llm-wiki-hidden");
        this.finalEl.removeClass("llm-wiki-hidden");
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
      const btnRow = contentEl.createDiv("llm-wiki-modal-options");
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
        cls: "llm-wiki-modal-input",
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
