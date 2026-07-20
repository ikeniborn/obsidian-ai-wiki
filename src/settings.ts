import { AbstractInputSuggest, App, DropdownComponent, Notice, Platform, PluginSettingTab, requestUrl, Setting } from "obsidian";
import { ConfirmModal, EditDomainModal, ExportOkfModal, ShellConsentModal } from "./modals";
import { probeClaudeBinary } from "./claude-cli-client";
import type LlmWikiPlugin from "./main";
import {
  parseLlmConnectionTimeoutSec,
  parseLlmIdleTimeoutSec,
  parseLlmRetryCount,
  type CompressionProfile,
  type LlmWikiPluginSettings,
  type OpKey,
} from "./types";
import type { DomainEntry } from "./domain";
import { removeDomainFolder } from "./domain-store";
import { i18n } from "./i18n";
import { resolveEffective } from "./effective-settings";
import { DEFAULT_CHUNKING, probeEmbeddingDimensions, probeEmbeddingDimensionsResult } from "./page-similarity";
import type { LocalConfig } from "./local-config";
import { probeRerankerModel, normalizeRerankerConfig } from "./reranker";
import {
  backendModelControlDescriptor,
  createLiveModelControl,
  parsePositiveBudgetInput,
  renderModelControlFields,
  type ModelControlField,
} from "./model-call-policy";
import { createRequestUrlVisionTransport, runNativeVisionModelCheck } from "./vision-probe";

async function checkNativeAvailability(baseUrl: string, apiKey: string, model: string): Promise<void> {
  let timerId: number | undefined;
  const timeoutP = new Promise<never>((_, rej) => {
    timerId = window.setTimeout(() => rej(new DOMException("Request timed out", "AbortError")), 30_000);
  });
  try {
    const resp = await Promise.race([
      requestUrl({
        url: `${baseUrl.replace(/\/$/, "")}/chat/completions`,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Hi, AI Wiki! Ready to work?" }], max_tokens: 50, stream: false }),
        throw: false,
      }),
      timeoutP,
    ]);
    if (resp.status >= 400) throw new Error(`HTTP ${resp.status}`);
  } finally {
    if (timerId !== undefined) window.clearTimeout(timerId);
  }
}

export function parseTimeoutString(v: string): { ingest: number; query: number; lint: number; init: number; format: number } | null {
  const parts = v.split("/").map((x) => Number(x.trim()));
  if (parts.length === 5 && parts.every((n) => Number.isFinite(n) && n >= 0)) {
    return { ingest: parts[0], query: parts[1], lint: parts[2], init: parts[3], format: parts[4] };
  }
  return null;
}

class ModelInputSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private getModels: () => string[],
    private onPick: (v: string) => void,
  ) {
    super(app, input);
    this.onSelect((model) => { this.setValue(model); onPick(model); this.close(); });
  }
  protected getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.getModels().filter((m) => m.toLowerCase().includes(q)).slice(0, 10);
  }
  renderSuggestion(model: string, el: HTMLElement): void { el.setText(model); }
}

export class LlmWikiSettingTab extends PluginSettingTab {
  private cachedDomains: DomainEntry[] = [];
  private localCache: LocalConfig = { iclaudePath: "" };
  private _availableModels: string[] = [];

  constructor(app: App, private plugin: LlmWikiPlugin) {
    super(app, plugin);
  }

  display(): void {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.cachedDomains = await this.plugin.domainStore.load();
    } catch (e) {
      this.cachedDomains = [];
      new Notice(`Domain map load failed: ${(e as Error).message}`);
    }
    this.localCache = await this.plugin.localConfigStore.load();
    this.render();
  }

  private async patchLocal(patch: Partial<LocalConfig>): Promise<void> {
    this.localCache = { ...this.localCache, ...patch };
    await this.plugin.localConfigStore.save(patch);
  }

  private async patchLocalNativeApiKey(apiKey: string): Promise<void> {
    await this.patchLocal({ nativeAgent: { apiKey } });
  }

  private async patchLocalProxyPassword(password: string): Promise<void> {
    const cur = this.localCache.proxy ?? {};
    await this.patchLocal({ proxy: { ...cur, password } });
  }

  private async patchProxy(patch: Partial<NonNullable<LlmWikiPluginSettings["proxy"]>>): Promise<void> {
    this.plugin.settings.proxy = { ...(this.plugin.settings.proxy ?? { enabled: false, url: "" }), ...patch };
    await this.plugin.saveSettings();
  }

  private async fetchModels(): Promise<void> {
    const na = this.plugin.settings.nativeAgent;
    if (!na.baseUrl) { new Notice("Set Base URL first"); return; }
    const url = `${na.baseUrl.replace(/\/$/, "")}/models`;
    try {
      const resp = await requestUrl({
        url,
        headers: { Authorization: `Bearer ${this.localCache.nativeAgent?.apiKey ?? ""}` },
        throw: false,
      });
      if (resp.status >= 400) throw new Error(`${resp.status}`);
      const json = JSON.parse(resp.text) as { data: { id: string }[] };
      this._availableModels = json.data.map((m) => m.id).sort();
      this.display();
    } catch (e) {
      new Notice(`Failed to fetch models: ${(e as Error).message}`);
    }
  }

  // CHECK: verify the entered dimension against the model. Probes twice — the model's
  // native size (no `dimensions` sent) and the requested size — then reports the relation.
  // Servers like Ollama blindly truncate to ANY requested size (even a useless 1) and cap
  // over-large requests at native, so "the model returned N" alone is misleading; showing
  // the native size lets the user see that e.g. 1-of-1024 is a degenerate truncation.
  // Read-only — does not overwrite the field.
  private async checkDimensions(): Promise<void> {
    const na = this.plugin.settings.nativeAgent;
    if (!na.baseUrl || !na.embeddingModel) { new Notice("Set Base URL and embedding model first"); return; }
    if (!na.embeddingDimensions) { new Notice("Enter a dimension value to check, or use Default"); return; }
    const apiKey = this.localCache.nativeAgent?.apiKey ?? "";
    const requested = na.embeddingDimensions;
    const result = await probeEmbeddingDimensionsResult(this.plugin.settings.nativeAgent.baseUrl, apiKey, na.embeddingModel, requested);
    if (!result.probe) { new Notice(`Dimension check failed: ${result.error ?? "unknown error"}`); return; }
    const probe = result.probe;
    const nativeProbe = await probeEmbeddingDimensions(na.baseUrl, apiKey, na.embeddingModel);
    const native = nativeProbe?.actual;
    const nativeStr = native != null ? String(native) : "?";

    if (!probe.honored) {
      // Requested size not produced — server ignored or capped it (e.g. > native).
      new Notice(`Not supported — model returns ${probe.actual} (native ${nativeStr}), not ${requested}. Use Default.`);
    } else if (native != null && requested === native) {
      new Notice(`OK — native dimension ${native}`);
    } else if (native != null && requested < native) {
      // Honored via truncation — valid but lossy; tiny values are effectively useless.
      new Notice(`Truncated — ${requested} of ${native} native. Smaller dimensions reduce retrieval quality.`);
    } else {
      new Notice(`OK — model returns ${probe.actual} (native ${nativeStr}).`);
    }
  }

  private async checkReranker(): Promise<void> {
    const T = i18n();
    const na = this.plugin.settings.nativeAgent;
    if (!na.baseUrl || !na.rerankerModel) { new Notice("Set Base URL and reranker model first"); return; }
    const model = na.rerankerModel;
    const apiKey = this.localCache.nativeAgent?.apiKey ?? "";
    const config = normalizeRerankerConfig({ enabled: true, model });
    const r = await probeRerankerModel(na.baseUrl, apiKey, config);
    new Notice(r.ok ? T.settings.rerankerCheck_ok(model) : `Reranker check failed: ${r.error}`);
  }

  // Verify the chat model responds (a minimal /chat/completions probe).
  private async checkChatModel(): Promise<void> {
    const T = i18n();
    const na = this.plugin.settings.nativeAgent;
    if (!na.baseUrl || !na.model) { new Notice("Set Base URL and model first"); return; }
    const model = na.model;
    const apiKey = this.localCache.nativeAgent?.apiKey ?? "";
    try {
      await checkNativeAvailability(na.baseUrl, apiKey, model);
      new Notice(T.settings.chatCheck_ok(model));
    } catch (e) {
      new Notice(`Chat model check failed: ${(e as Error).message}`);
    }
  }

  private async checkVisionModel(model: string): Promise<void> {
    const T = i18n();
    const na = this.plugin.settings.nativeAgent;
    await runNativeVisionModelCheck({
      baseUrl: na.baseUrl,
      apiKey: this.localCache.nativeAgent?.apiKey ?? "",
      model,
      timeoutMs: 30_000,
      request: createRequestUrlVisionTransport(requestUrl),
      messages: {
        missing: T.settings.visionCheck_missing,
        success: T.settings.visionCheck_ok(model),
        details: {
          timeout: T.settings.visionCheck_timeout,
          http: T.settings.visionCheck_http,
          malformed: T.settings.visionCheck_malformed,
          empty: T.settings.visionCheck_empty,
        },
        failure: T.settings.visionCheck_failed,
      },
      notify: (message) => { new Notice(message); },
    });
  }

  // Verify the embedding model is reachable (a native-dimension probe).
  private async checkEmbeddingModel(): Promise<void> {
    const na = this.plugin.settings.nativeAgent;
    if (!na.baseUrl || !na.embeddingModel) { new Notice("Set Base URL and embedding model first"); return; }
    const apiKey = this.localCache.nativeAgent?.apiKey ?? "";
    const result = await probeEmbeddingDimensionsResult(na.baseUrl, apiKey, na.embeddingModel);
    new Notice(result.probe
      ? `OK — embedding model "${na.embeddingModel}" reachable (native dim ${result.probe.actual})`
      : `Embedding model check failed: ${result.error ?? "unknown error"}`);
  }

  private openExportOkfModal(domainEntry: DomainEntry): void {
    const defaultDest = `${this.plugin.controller.cwdOrEmpty()}/okf-export/${domainEntry.wiki_folder}`;
    new ExportOkfModal(this.plugin.app, defaultDest, (dest) => {
      void this.plugin.controller.exportOkf(domainEntry, dest)
        .then((r) => new Notice(`OKF: ${r.pages} pages → ${dest}${r.warnings.length ? ` (${r.warnings.length} warnings)` : ""}`))
        .catch((e) => new Notice(`OKF export failed: ${(e as Error).message}`, 0));
    }).open();
  }

  // Default: fetch the model's native output dimension (no `dimensions` sent) and store it.
  // silent=true skips notices when auto-triggered on model change.
  private async setDefaultDimensions(silent = false): Promise<void> {
    const na = this.plugin.settings.nativeAgent;
    if (!na.baseUrl || !na.embeddingModel) { if (!silent) new Notice("Set Base URL and embedding model first"); return; }
    const probe = await probeEmbeddingDimensions(
      na.baseUrl, this.localCache.nativeAgent?.apiKey ?? "", na.embeddingModel,
    );
    if (probe == null) { if (!silent) new Notice("Failed to detect dimensions from API"); return; }
    na.embeddingDimensions = probe.actual;
    await this.plugin.saveSettings();
    if (!silent) new Notice(`Default dimensions for model: ${probe.actual}`);
    this.display();
  }

  private addModelControl(
    s: Setting,
    currentValue: string,
    onChange: (v: string) => Promise<void>,
    saveOnTyping = false,
    check?: { tooltip: string; run: (currentValue: string) => void | Promise<void> },
  ): void {
    const live = createLiveModelControl(currentValue, onChange, saveOnTyping);
    if (check) {
      s.addButton((b) =>
        b.setButtonText("Check").setTooltip(check.tooltip)
          .onClick(() => { void live.check(check.run); }),
      );
    }
    s.addButton((b) =>
      b.setIcon("refresh-cw").setTooltip("Fetch available models from base URL")
        .onClick(() => { void this.fetchModels(); }),
    );
    s.addText((t) => {
      t.setPlaceholder("Type to search models…").setValue(currentValue);
      t.inputEl.addEventListener("focus", () => {
        if (this._availableModels.length === 0) void this.fetchModels();
      });
      t.onChange((v) => { void live.type(v); });
      new ModelInputSuggest(
        this.app,
        t.inputEl,
        () => this._availableModels,
        (v) => { void live.select(v); },
      );
    });
  }

  private render(): void {
    const { containerEl } = this;
    const scrollEl = (
      containerEl.closest(".vertical-tab-content") ??
      containerEl.closest(".modal-content") ??
      containerEl.parentElement ??
      containerEl
    );
    const savedScroll = scrollEl.scrollTop;
    containerEl.empty();
    const s = this.plugin.settings;
    const eff = resolveEffective(s, this.localCache);
    const T = i18n();
    const modelControls = backendModelControlDescriptor(eff.backend);
    const addBudgetControl = (
      setting: Setting,
      value: number,
      update: (next: number) => void,
    ): void => {
      let previous = value;
      setting.addText((text) =>
        text.setValue(String(value)).onChange(async (raw) => {
          const next = parsePositiveBudgetInput(raw, previous);
          if (next === previous) return;
          update(next);
          previous = next;
          await this.plugin.saveSettings();
        }),
      );
    };
    const addCompressionControl = (
      setting: Setting,
      value: CompressionProfile | undefined,
      useGlobal: boolean,
      update: (next: CompressionProfile | undefined) => void,
    ): void => {
      setting.addDropdown((dropdown) => {
        if (useGlobal) dropdown.addOption("", T.settings.compressionUseGlobal);
        dropdown
          .addOption("maximum", T.settings.compressionMaximum)
          .addOption("balanced", T.settings.compressionBalanced)
          .addOption("minimum", T.settings.compressionMinimum)
          .setValue(value ?? "")
          .onChange(async (raw) => {
            update((raw || undefined) as CompressionProfile | undefined);
            await this.plugin.saveSettings();
          });
      });
    };
    const addPolicyControls = (
      fields: readonly ModelControlField[],
      values: {
        inputBudgetTokens?: number;
        maxTokens?: number;
        compressionProfile?: CompressionProfile;
      },
      updates: {
        inputBudgetTokens?: (next: number) => void;
        maxTokens?: (next: number) => void;
        compressionProfile?: (next: CompressionProfile | undefined) => void;
      },
      useGlobalCompression: boolean,
    ): void => {
      renderModelControlFields(fields, {
        inputBudgetTokens: () => {
          if (values.inputBudgetTokens === undefined || !updates.inputBudgetTokens) return;
          addBudgetControl(
            new Setting(containerEl)
              .setName(T.settings.inputBudgetTokens_name)
              .setDesc(T.settings.inputBudgetTokens_desc),
            values.inputBudgetTokens,
            updates.inputBudgetTokens,
          );
        },
        maxTokens: () => {
          if (values.maxTokens === undefined || !updates.maxTokens) return;
          addBudgetControl(
            new Setting(containerEl)
              .setName(T.settings.outputBudgetTokens_name)
              .setDesc(T.settings.outputBudgetTokens_desc),
            values.maxTokens,
            updates.maxTokens,
          );
        },
        compressionProfile: () => {
          if (!updates.compressionProfile) return;
          addCompressionControl(
            new Setting(containerEl)
              .setName(T.settings.compressionProfile_name)
              .setDesc(T.settings.compressionProfile_desc),
            values.compressionProfile,
            useGlobalCompression,
            updates.compressionProfile,
          );
        },
      });
    };

    const busy = this.plugin.controller.running;

    // ── General settings ───────────────────────────────────────────────────
    new Setting(containerEl).setName(T.settings.h3_general).setHeading();

    new Setting(containerEl)
      .setName(T.settings.systemPrompt_name)
      .setDesc(T.settings.systemPrompt_desc)
      .addTextArea((t) => {
        t.inputEl.addClass("ai-wiki-settings-textarea");
        t.setValue(s.systemPrompt)
          .onChange(async (v) => { s.systemPrompt = v; await this.plugin.saveSettings(); });
        return t;
      });

    new Setting(containerEl)
      .setName(T.settings.outputLanguage_name)
      .setDesc(T.settings.outputLanguage_desc)
      .addDropdown((d) =>
        d.addOptions({ auto: "Auto (match UI language)", ru: "Russian", en: "English", es: "Spanish" })
          .setValue(s.outputLanguage ?? "auto")
          .onChange(async (v) => {
            s.outputLanguage = v as "auto" | "ru" | "en" | "es";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(T.settings.reasoningLanguage_name)
      .setDesc(T.settings.reasoningLanguage_desc)
      .addDropdown((d) =>
        d.addOptions({ auto: "Auto (match response)", en: "English", ru: "Russian", es: "Spanish" })
          .setValue(s.reasoningLanguage ?? "en")
          .onChange(async (v) => {
            s.reasoningLanguage = v as "auto" | "ru" | "en" | "es";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(T.settings.timeouts_name)
      .setDesc(T.settings.timeouts_desc)
      .addText((t) =>
        t.setValue(`${s.timeouts.ingest}/${s.timeouts.query}/${s.timeouts.lint}/${s.timeouts.init}/${s.timeouts.format}`)
          .onChange(async (v) => {
            const parsed = parseTimeoutString(v);
            if (parsed) {
              s.timeouts = { ...s.timeouts, ...parsed };
              await this.plugin.saveSettings();
            }
          }),
      );

    if (eff.backend === "native-agent") {
      new Setting(containerEl)
        .setName(T.settings.llmConnectionTimeout_name)
        .setDesc(T.settings.llmConnectionTimeout_desc)
        .addText((t) =>
          t.setPlaceholder("15")
            .setValue(String(s.llmConnectionTimeoutSec))
            .onChange(async (v) => {
              const next = parseLlmConnectionTimeoutSec(v, 0);
              if (next >= 1) {
                s.llmConnectionTimeoutSec = next;
                await this.plugin.saveSettings();
              }
            }),
        );
    }

    new Setting(containerEl)
      .setName(eff.backend === "native-agent" ? T.settings.llmRequestIdleTimeout_name : T.settings.llmIdleTimeout_name)
      .setDesc(eff.backend === "native-agent" ? T.settings.llmRequestIdleTimeout_desc : T.settings.llmIdleTimeout_desc)
      .addText((t) =>
        t.setPlaceholder("300")
          .setValue(String(s.llmIdleTimeoutSec))
          .onChange(async (v) => {
            const next = parseLlmIdleTimeoutSec(v, -1);
            if (next >= 0) {
              s.llmIdleTimeoutSec = next;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(eff.backend === "native-agent" ? T.settings.llmRequestRetries_name : T.settings.llmIdleRetries_name)
      .setDesc(eff.backend === "native-agent" ? T.settings.llmRequestRetries_desc : T.settings.llmIdleRetries_desc)
      .addText((t) =>
        t.setPlaceholder("3")
          .setValue(String(s.llmIdleRetries))
          .onChange(async (v) => {
            const next = parseLlmRetryCount(v, -1);
            if (next >= 0) {
              s.llmIdleRetries = next;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(T.settings.historyLimit_name)
      .setDesc(T.settings.historyLimit_desc)
      .addText((t) =>
        t.setValue(String(s.historyLimit))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) { s.historyLimit = Math.floor(n); await this.plugin.saveSettings(); }
          }),
      );

    new Setting(containerEl)
      .setName(T.settings.agentLog_name)
      .setDesc(T.settings.agentLog_desc)
      .addToggle((t) =>
        t.setValue(eff.agentLogEnabled)
          .onChange(async (v) => { await this.patchLocal({ agentLogEnabled: v }); }),
      );

    // ── Domains ───────────────────────────────────────────────────────────────
    new Setting(containerEl).setName(T.settings.domains_heading).setHeading();

    if (busy) {
      containerEl.createEl("div", {
        cls: "ai-wiki-settings-busy-banner",
      }).createEl("span", { text: `⚠ ${T.settings.busyBanner}` });
    }

    const domains = this.cachedDomains;
    if (domains.length === 0) {
      containerEl.createEl("p", {
        text: T.settings.domains_empty,
        cls: "setting-item-description",
      });
    } else {
      for (let i = 0; i < domains.length; i++) {
        const d = domains[i];
        new Setting(containerEl)
          .setName(d.name || d.id)
          .setDesc(d.id)
          .addButton((b) => {
            b.setButtonText(T.view.exportOkf).setDisabled(busy).onClick(() => {
              this.openExportOkfModal(d);
            });
          })
          .addButton((b) => {
            b.setButtonText(T.settings.editDomain).setDisabled(busy).onClick(() => {
              new EditDomainModal(this.plugin.app, d, (updated) => {
                void (async () => {
                  const cur = await this.plugin.domainStore.load();
                  const idx = cur.findIndex((x) => x.id === updated.id);
                  if (idx >= 0) cur[idx] = updated;
                  await this.plugin.domainStore.save(cur);
                  await this.refresh();
                })();
              }).open();
            });
          })
          .addButton((b) => {
            b.setButtonText(T.settings.deleteDomain).setWarning().setDisabled(busy).onClick(() => {
              new ConfirmModal(this.plugin.app, T.settings.confirmDeleteDomain(d.id), [], () => {
                void (async () => {
                  new Notice(T.settings.domainDeleted(d.id));
                  const cur = await this.plugin.domainStore.load();
                  await this.plugin.domainStore.save(cur.filter((x) => x.id !== d.id));
                  // Remove the whole wiki folder (pages, sidecars, and the empty
                  // !Wiki/<domain> folder itself) — deletion should leave nothing behind.
                  await removeDomainFolder(this.plugin.app.vault.adapter, d.wiki_folder);
                  await this.refresh();
                })();
              }).open();
            });
          });
      }
    }

    // ── Backend settings ───────────────────────────────────────────────────
    new Setting(containerEl).setName(T.settings.h3_backend).setHeading();

    if (!Platform.isMobile) {
      new Setting(containerEl)
        .setName(T.settings.backend_name)
        .setDesc(T.settings.backend_desc)
        .addDropdown((d) => {
          let backendDd: DropdownComponent;
          backendDd = d
            .addOption("claude-agent", T.settings.claudeCodeAgent)
            .addOption("native-agent", T.settings.nativeAgent)
            .setValue(eff.backend)
            .onChange(async (v) => {
              if (v === "claude-agent") {
                backendDd.setValue(eff.backend);
                new ShellConsentModal(this.plugin.app, this.localCache.iclaudePath, async () => {
                  await this.patchLocal({ shellConsentGiven: true, backend: "claude-agent" });
                  this.display();
                }).open();
                return;
              }
              await this.patchLocal({ backend: v as LlmWikiPluginSettings["backend"] });
              this.display();
            });
          return d;
        });
    } else {
      const p = containerEl.createEl("p", {
        text: "Mobile: cloud LLM (native-agent) only. setup guide: ",
        cls: "setting-item-description",
      });
      p.createEl("a", {
        text: "ikeniborn/obsidian-llm-wiki — mobile-cloud-ollama.md",
        href: "https://github.com/ikeniborn/obsidian-llm-wiki/blob/master/docs/mobile-cloud-ollama.md",
      });
    }

    if (eff.backend === "claude-agent" && !Platform.isMobile) {
      new Setting(containerEl)
        .setName(T.settings.iclaudePath_name)
        .setDesc(T.settings.iclaudePath_desc)
        .addText((t) =>
          t.setPlaceholder("/home/user/Documents/Project/iclaude/iclaude.sh")
            .setValue(this.localCache.iclaudePath)
            .onChange(async (v) => {
              await this.patchLocal({ iclaudePath: v.trim() });
            }),
        )
        .addButton(b => {
          b.setButtonText(T.settings.testConnection_btn).onClick(async () => {
            b.setButtonText(T.settings.testConnection_btnBusy).setDisabled(true);
            try {
              await probeClaudeBinary(this.localCache.iclaudePath);
              new Notice(T.settings.claudeAvailable_ok);
            } catch (e) {
              new Notice(`❌ ${(e as Error).message}`);
            } finally {
              b.setButtonText(T.settings.testConnection_btn).setDisabled(false);
            }
          });
          return b;
        });

      new Setting(containerEl)
        .setName(T.settings.allowedTools_name)
        .setDesc(T.settings.allowedTools_desc)
        .addText((t) =>
          t.setPlaceholder("Bash,read,write")
            .setValue(eff.claudeAgent.allowedTools)
            .onChange(async (v) => { s.claudeAgent.allowedTools = v.trim(); await this.plugin.saveSettings(); }),
        );

      new Setting(containerEl)
        .setName(T.settings.h3_defaultChatModel)
        .setHeading();

      if (!s.claudeAgent.perOperation) {
        new Setting(containerEl)
          .setName(T.settings.model_name)
          .setDesc(T.settings.model_desc_claude)
          .addText((t) =>
            t.setPlaceholder("")
              .setValue(eff.claudeAgent.model)
              .onChange(async (v) => { s.claudeAgent.model = v.trim(); await this.plugin.saveSettings(); }),
          );
      }

      addPolicyControls(
        modelControls.globalFields,
        {
          inputBudgetTokens: s.claudeAgent.inputBudgetTokens,
          compressionProfile: s.claudeAgent.compressionProfile,
        },
        {
          inputBudgetTokens: (next) => { s.claudeAgent.inputBudgetTokens = next; },
          compressionProfile: (next) => { s.claudeAgent.compressionProfile = next ?? "balanced"; },
        },
        false,
      );

      new Setting(containerEl)
        .setName("Effort level")
        .setDesc(T.settings.effort_desc)
        .addDropdown(d => {
          d.addOption("", T.settings.effort_off);
          for (const lv of ["low", "medium", "high", "xhigh", "max"] as const) d.addOption(lv, lv);
          d.setValue(eff.claudeAgent.effort ?? "");
          d.onChange(async v => {
            s.claudeAgent.effort = (v || undefined) as typeof s.claudeAgent.effort; await this.plugin.saveSettings();
          });
          return d;
        });

      new Setting(containerEl)
        .setName(T.settings.perOperation_name)
        .setDesc(T.settings.perOperation_desc)
        .addToggle((t) =>
          t.setValue(s.claudeAgent.perOperation)
            .onChange(async (v) => { s.claudeAgent.perOperation = v; await this.plugin.saveSettings(); this.display(); }),
        );

      if (s.claudeAgent.perOperation) {
        const ops: Array<{ key: OpKey; label: string }> = [
          { key: "ingest", label: T.settings.op_ingest },
          { key: "query",  label: T.settings.op_query },
          { key: "lint",   label: T.settings.op_lint },
          { key: "init",   label: T.settings.op_init },
          { key: "format", label: T.settings.op_format },
        ];
        for (const { key, label } of ops) {
          new Setting(containerEl).setName(label).setHeading();
          new Setting(containerEl)
            .setName(T.settings.opModel_name)
            .setDesc(T.settings.opModel_desc)
            .addText((t) =>
              t.setValue(s.claudeAgent.operations[key].model)
                .onChange(async (v) => { s.claudeAgent.operations[key].model = v.trim(); await this.plugin.saveSettings(); }),
            );
          addPolicyControls(
            modelControls.operations[key],
            {
              inputBudgetTokens: s.claudeAgent.operations[key].inputBudgetTokens,
              compressionProfile: s.claudeAgent.operations[key].compressionProfile,
            },
            {
              inputBudgetTokens: (next) => { s.claudeAgent.operations[key].inputBudgetTokens = next; },
              compressionProfile: (next) => { s.claudeAgent.operations[key].compressionProfile = next; },
            },
            true,
          );
          new Setting(containerEl)
            .setName("Effort level")
            .addDropdown(d => {
              d.addOption("", T.settings.effort_inherit);
              for (const lv of ["low", "medium", "high", "xhigh", "max"] as const) d.addOption(lv, lv);
              d.setValue(s.claudeAgent.operations[key].effort ?? "");
              d.onChange(async v => {
                type OpEffort = (typeof s.claudeAgent.operations)[OpKey]["effort"];
                s.claudeAgent.operations[key].effort = (v || undefined) as OpEffort;
                await this.plugin.saveSettings();
              });
              return d;
            });
        }
      }
    } else {
      new Setting(containerEl).setName(T.settings.h3_backendConnection).setHeading();

      new Setting(containerEl)
        .setName(T.settings.baseUrl_name)
        .setDesc(T.settings.baseUrl_desc)
        .addText((t) =>
          t.setPlaceholder("")
            .setValue(eff.nativeAgent.baseUrl)
            .onChange(async (v) => { s.nativeAgent.baseUrl = v.trim(); await this.plugin.saveSettings(); }),
        );

      new Setting(containerEl)
        .setName(T.settings.apiKey_name)
        .setDesc(T.settings.apiKey_desc)
        .addText((t) =>
          t.setPlaceholder("Ollama")
            .setValue(eff.nativeAgent.apiKey)
            .onChange(async (v) => { await this.patchLocalNativeApiKey(v.trim()); }),
        );

      new Setting(containerEl)
        .setName(T.settings.h3_defaultChatModel)
        .setHeading();

      if (!s.nativeAgent.perOperation) {
        this.addModelControl(
          new Setting(containerEl).setName(T.settings.model_name).setDesc(T.settings.model_desc_native),
          eff.nativeAgent.model,
          async (v) => { s.nativeAgent.model = v; await this.plugin.saveSettings(); },
          false,
          { tooltip: "Verify the chat model is reachable", run: () => this.checkChatModel() },
        );

        new Setting(containerEl)
          .setName("Thinking budget tokens")
          .setDesc(T.settings.thinkingBudget_desc)
          .addText(t =>
            t.setPlaceholder("0")
              .setValue(String(s.nativeAgent.thinkingBudgetTokens ?? 0))
              .onChange(async v => {
                const n = Number(v);
                s.nativeAgent.thinkingBudgetTokens = Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
                await this.plugin.saveSettings();
              })
          );
      }

      addPolicyControls(
        modelControls.globalFields,
        {
          inputBudgetTokens: s.nativeAgent.inputBudgetTokens,
          maxTokens: s.nativeAgent.maxTokens,
          compressionProfile: s.nativeAgent.compressionProfile,
        },
        {
          inputBudgetTokens: (next) => { s.nativeAgent.inputBudgetTokens = next; },
          maxTokens: (next) => { s.nativeAgent.maxTokens = next; },
          compressionProfile: (next) => { s.nativeAgent.compressionProfile = next ?? "balanced"; },
        },
        false,
      );

      if (!s.nativeAgent.perOperation) {
        new Setting(containerEl)
          .setName(T.settings.temperature_name)
          .setDesc(T.settings.temperature_desc)
          .addText((t) =>
            t.setPlaceholder("0.2")
              .setValue(String(eff.nativeAgent.temperature))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n >= 0 && n <= 2) { s.nativeAgent.temperature = n; await this.plugin.saveSettings(); }
              }),
          );
      }

      new Setting(containerEl)
        .setName(T.settings.structuredRetries_name)
        .setDesc(T.settings.structuredRetries_desc)
        .addText((t) =>
          t.setPlaceholder("1")
            .setValue(String(s.nativeAgent.structuredRetries))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isFinite(n) || n < 0 || n > 3) return;
              s.nativeAgent.structuredRetries = Math.floor(n);
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(T.settings.wikiLinkValidationRetries_name)
        .setDesc(T.settings.wikiLinkValidationRetries_desc)
        .addText((t) =>
          t.setPlaceholder("3")
            .setValue(String(s.wikiLinkValidationRetries))
            .onChange(async (v) => {
              const n = Number(v);
              if (Number.isInteger(n) && n >= 0) {
                s.wikiLinkValidationRetries = n;
                await this.plugin.saveSettings();
              }
            }),
        );

      if (!Platform.isMobile) {
        new Setting(containerEl).setName(T.settings.perOperation_name).setHeading();
        new Setting(containerEl)
          .setName(T.settings.perOperation_name)
          .setDesc(T.settings.perOperation_desc)
          .addToggle((t) =>
            t.setValue(s.nativeAgent.perOperation)
              .onChange(async (v) => { s.nativeAgent.perOperation = v; await this.plugin.saveSettings(); this.display(); }),
          );
      }

      if (s.nativeAgent.perOperation) {
        const ops: Array<{ key: OpKey; label: string }> = [
          { key: "ingest", label: T.settings.op_ingest },
          { key: "query",  label: T.settings.op_query },
          { key: "lint",   label: T.settings.op_lint },
          { key: "init",   label: T.settings.op_init },
          { key: "format", label: T.settings.op_format },
        ];
        for (const { key, label } of ops) {
          new Setting(containerEl).setName(label).setHeading();
          this.addModelControl(
            new Setting(containerEl).setName(T.settings.opModel_name).setDesc(T.settings.opModel_desc),
            s.nativeAgent.operations[key].model,
            async (v) => { s.nativeAgent.operations[key].model = v; await this.plugin.saveSettings(); },
          );
          addPolicyControls(
            modelControls.operations[key],
            {
              inputBudgetTokens: s.nativeAgent.operations[key].inputBudgetTokens,
              maxTokens: s.nativeAgent.operations[key].maxTokens,
              compressionProfile: s.nativeAgent.operations[key].compressionProfile,
            },
            {
              inputBudgetTokens: (next) => { s.nativeAgent.operations[key].inputBudgetTokens = next; },
              maxTokens: (next) => { s.nativeAgent.operations[key].maxTokens = next; },
              compressionProfile: (next) => { s.nativeAgent.operations[key].compressionProfile = next; },
            },
            true,
          );
          new Setting(containerEl)
            .setName("Thinking budget tokens")
            .addText(t =>
              t.setPlaceholder("0")
                .setValue(String(s.nativeAgent.operations[key].thinkingBudgetTokens ?? 0))
                .onChange(async v => {
                  const n = Number(v);
                  s.nativeAgent.operations[key].thinkingBudgetTokens = Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
                  await this.plugin.saveSettings();
                })
            );
          new Setting(containerEl)
            .setName(T.settings.opTemperature_name)
            .setDesc(T.settings.opTemperature_desc)
            .addText((t) =>
              t.setValue(String(s.nativeAgent.operations[key].temperature))
                .onChange(async (v) => {
                  const n = Number(v);
                  if (Number.isFinite(n) && n >= 0 && n <= 2) { s.nativeAgent.operations[key].temperature = n; await this.plugin.saveSettings(); }
                }),
            );
        }
      }

      new Setting(containerEl).setName(T.settings.h3_semanticSearch).setHeading();

      new Setting(containerEl)
        .setName("Enable semantic similarity (embeddings)")
        .setDesc(T.settings.semanticEnable_desc)
        .addToggle((t) =>
          t.setValue(s.nativeAgent.embeddingModel !== undefined)
            .onChange(async (v) => {
              if (!v) {
                s.nativeAgent.embeddingModel = undefined; s.nativeAgent.embeddingDimensions = undefined; await this.plugin.saveSettings();
                this.display();
              } else {
                s.nativeAgent.embeddingModel = ""; await this.plugin.saveSettings();
                this.display();
              }
            }),
        );

      if (s.nativeAgent.embeddingModel !== undefined) {
        new Setting(containerEl)
          .setName("Relevant pages (top-K)")
          .setDesc(T.settings.relevantTopK_desc)
          .addText((t) =>
            t.setPlaceholder("15")
              .setValue(String(s.nativeAgent.relevantPagesTopK ?? 15))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) {
                  s.nativeAgent.relevantPagesTopK = Math.floor(n); await this.plugin.saveSettings();
                }
              }),
          );

        this.addModelControl(
          new Setting(containerEl).setName("Embedding model").setDesc(T.settings.embeddingModel_desc),
          s.nativeAgent.embeddingModel ?? "",
          async (v) => {
            s.nativeAgent.embeddingModel = v || undefined;
            await this.plugin.saveSettings();
          },
          false,
          { tooltip: "Verify the embedding model is reachable", run: () => this.checkEmbeddingModel() },
        );

        new Setting(containerEl)
          .setName("Embedding dimensions")
          .setDesc(T.settings.embeddingDimensions_desc)
          .addButton((b) =>
            b.setButtonText("Check").setTooltip("Verify the entered dimension is supported by the model")
              .onClick(() => { void this.checkDimensions(); }),
          )
          .addButton((b) =>
            b.setButtonText("Default").setTooltip("Use the model's native dimension")
              .onClick(() => { void this.setDefaultDimensions(); }),
          )
          .addText((t) =>
            t.setPlaceholder("512")
              .setValue(String(s.nativeAgent.embeddingDimensions ?? ""))
              .onChange(async (v) => {
                // Clear on empty/0/invalid so a stale value isn't silently kept — otherwise
                // Check would validate the old stored value while the field shows 0.
                const n = Number(v);
                s.nativeAgent.embeddingDimensions = Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
                await this.plugin.saveSettings();
              }),
          );

        const chunkField = (
          name: string, desc: string, placeholder: string,
          get: () => number, set: (n: number) => void,
        ) =>
          new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
            t.setPlaceholder(placeholder)
              .setValue(String(get()))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) { set(Math.floor(n)); await this.plugin.saveSettings(); }
              }),
          );

        if (!Platform.isMobile) {
          chunkField("Chunk size (chars)",
            T.settings.chunkSize_desc(DEFAULT_CHUNKING.maxChars),
            String(DEFAULT_CHUNKING.maxChars),
            () => s.nativeAgent.chunkMaxChars ?? DEFAULT_CHUNKING.maxChars,
            (n) => { s.nativeAgent.chunkMaxChars = n; });
          chunkField("Chunk overlap (chars)",
            T.settings.chunkOverlap_desc(DEFAULT_CHUNKING.overlapChars),
            String(DEFAULT_CHUNKING.overlapChars),
            () => s.nativeAgent.chunkOverlapChars ?? DEFAULT_CHUNKING.overlapChars,
            (n) => { s.nativeAgent.chunkOverlapChars = n; });
          chunkField("Min chunk size (merge)",
            T.settings.chunkMin_desc(DEFAULT_CHUNKING.minChars),
            String(DEFAULT_CHUNKING.minChars),
            () => s.nativeAgent.chunkMinChars ?? DEFAULT_CHUNKING.minChars,
            (n) => { s.nativeAgent.chunkMinChars = n; });
          chunkField("Max chunks per page",
            T.settings.chunkMaxCount_desc(DEFAULT_CHUNKING.maxCount),
            String(DEFAULT_CHUNKING.maxCount),
            () => s.nativeAgent.chunkMaxCount ?? DEFAULT_CHUNKING.maxCount,
            (n) => { s.nativeAgent.chunkMaxCount = n; });
        }
      }

      new Setting(containerEl).setName("Retrieval").setHeading();
      new Setting(containerEl).setName(T.settings.reranker_heading).setHeading();
      new Setting(containerEl).setDesc(T.settings.rerankerFlow_desc);
      new Setting(containerEl)
        .setName(T.settings.rerankerEnabled_name)
        .setDesc(T.settings.rerankerEnabled_desc)
        .addToggle((t) =>
          t.setValue(s.nativeAgent.rerankerEnabled ?? false)
            .onChange(async (v) => { s.nativeAgent.rerankerEnabled = v; await this.plugin.saveSettings(); }),
        );
      this.addModelControl(
        new Setting(containerEl).setName(T.settings.rerankerModel_name).setDesc(T.settings.rerankerModel_desc),
        s.nativeAgent.rerankerModel ?? "",
        async (v) => { s.nativeAgent.rerankerModel = v.trim(); await this.plugin.saveSettings(); },
        true,
        { tooltip: "Verify the reranker model is reachable", run: () => this.checkReranker() },
      );
      new Setting(containerEl)
        .setName(T.settings.rerankerTopN_name)
        .setDesc(T.settings.rerankerTopN_desc)
        .addText((t) =>
          t.setPlaceholder("30")
            .setValue(String(s.nativeAgent.rerankerTopN ?? 30))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              const requested = Math.floor(n);
              const bounded = Math.max(1, Math.min(100, requested));
              const contextTopN = Math.max(1, Math.min(50, Math.floor(s.nativeAgent.contextTopN ?? 8)));
              const next = Math.max(bounded, contextTopN);
              if (next !== bounded) new Notice(T.settings.rerankerInvalidTopN);
              s.nativeAgent.rerankerTopN = next;
              await this.plugin.saveSettings();
              if (next !== requested) this.display();
            }),
        );
      new Setting(containerEl)
        .setName(T.settings.contextTopN_name)
        .setDesc(T.settings.contextTopN_desc)
        .addText((t) =>
          t.setPlaceholder("8")
            .setValue(String(s.nativeAgent.contextTopN ?? 8))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              const requested = Math.floor(n);
              const next = Math.max(1, Math.min(50, requested));
              s.nativeAgent.contextTopN = next;
              if ((s.nativeAgent.rerankerTopN ?? 30) < next) {
                s.nativeAgent.rerankerTopN = next;
                new Notice(T.settings.rerankerInvalidTopN);
                await this.plugin.saveSettings();
                this.display();
                return;
              }
              await this.plugin.saveSettings();
              if (next !== requested) this.display();
            }),
        );
      new Setting(containerEl)
        .setName(T.settings.rerankerTimeoutMs_name)
        .setDesc(T.settings.rerankerTimeoutMs_desc)
        .addText((t) =>
          t.setPlaceholder("800")
            .setValue(String(s.nativeAgent.rerankerTimeoutMs ?? 800))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              const requested = Math.floor(n);
              const next = Math.max(100, Math.min(5000, requested));
              s.nativeAgent.rerankerTimeoutMs = next;
              await this.plugin.saveSettings();
              if (next !== requested) this.display();
            }),
        );

      if (s.nativeAgent.embeddingModel !== undefined) {
        new Setting(containerEl)
          .setName("Hybrid retrieval (dense ⊕ sparse)")
          .setDesc(T.settings.hybridRetrieval_desc)
          .addToggle((t) =>
            t.setValue(s.nativeAgent.hybridRetrieval ?? false)
              .onChange(async (v) => { s.nativeAgent.hybridRetrieval = v; await this.plugin.saveSettings(); }),
          );
        new Setting(containerEl)
          .setName("RRF k")
          .setDesc(T.settings.rrfK_desc)
          .addText((t) =>
            t.setValue(String(s.nativeAgent.rrfK ?? 60))
              .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) { s.nativeAgent.rrfK = Math.floor(n); await this.plugin.saveSettings(); } }),
          );
        new Setting(containerEl)
          .setName("BFS fusion (vector ⊕ graph)")
          .setDesc(T.settings.bfsFusion_desc)
          .addToggle((t) =>
            t.setValue(s.nativeAgent.bfsFusion ?? false)
              .onChange(async (v) => { s.nativeAgent.bfsFusion = v; await this.plugin.saveSettings(); }),
          );
        new Setting(containerEl)
          .setName("Graph relevance floor (ratio)")
          .setDesc(T.settings.bfsMinScoreRatio_desc)
          .addSlider((sl) =>
            sl.setLimits(0, 1, 0.05)
              .setDynamicTooltip()
              .setValue(s.nativeAgent.bfsMinScoreRatio ?? 0.6)
              .onChange(async (v) => { s.nativeAgent.bfsMinScoreRatio = v; await this.plugin.saveSettings(); }),
          );
        new Setting(containerEl)
          .setName("Seed similarity threshold")
          .setDesc(T.settings.seedSimilarityThreshold_desc)
          .addText((t) =>
            t.setValue(String(s.nativeAgent.seedSimilarityThreshold ?? 0))
              .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) { s.nativeAgent.seedSimilarityThreshold = n; await this.plugin.saveSettings(); } }),
          );

        if (!Platform.isMobile) {
          new Setting(containerEl).setName("Graph health").setHeading();
          new Setting(containerEl)
            .setName("Dedup on ingest")
            .setDesc(T.settings.dedupOnIngest_desc)
            .addToggle((t) =>
              t.setValue(s.nativeAgent.dedupOnIngest ?? false)
                .onChange(async (v) => { s.nativeAgent.dedupOnIngest = v; await this.plugin.saveSettings(); }),
            );
          new Setting(containerEl)
            .setName("Dedup threshold")
            .setDesc(T.settings.dedupThreshold_desc)
            .addText((t) =>
              t.setValue(String(s.nativeAgent.dedupThreshold ?? 0.85))
                .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0 && n <= 1) { s.nativeAgent.dedupThreshold = n; await this.plugin.saveSettings(); } }),
            );
          new Setting(containerEl)
            .setName("Lint near-duplicate report")
            .setDesc(T.settings.lintNearDuplicate_desc)
            .addToggle((t) =>
              t.setValue(s.nativeAgent.lintNearDuplicate ?? false)
                .onChange(async (v) => { s.nativeAgent.lintNearDuplicate = v; await this.plugin.saveSettings(); }),
            );
          new Setting(containerEl)
            .setName("Near-duplicate threshold")
            .setDesc(T.settings.nearDupThreshold_desc)
            .addText((t) =>
              t.setValue(String(s.nativeAgent.nearDupThreshold ?? 0.80))
                .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0 && n <= 1) { s.nativeAgent.nearDupThreshold = n; await this.plugin.saveSettings(); } }),
            );

          new Setting(containerEl)
            .setName(T.settings.mergeDeleteWarnThreshold_name)
            .setDesc(T.settings.mergeDeleteWarnThreshold_desc)
            .addSlider((sl) =>
              sl.setLimits(1, 20, 1)
                .setDynamicTooltip()
                .setValue(s.nativeAgent.mergeDeleteWarnThreshold ?? 5)
                .onChange(async (v) => {
                  s.nativeAgent.mergeDeleteWarnThreshold = v; await this.plugin.saveSettings();
                }),
            );
        }
      }

    }

    // ── Vision settings ─────────────────────────────────────────────────────
    new Setting(containerEl).setName(T.settings.h3_vision).setHeading();

    new Setting(containerEl)
      .setName(T.settings.visionEnable_name)
      .setDesc(T.settings.visionEnable_desc)
      .addToggle((t) =>
        t.setValue(s.vision.enabled)
          .onChange(async (v) => {
            s.vision.enabled = v;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (s.vision.enabled) {
      addPolicyControls(
        modelControls.vision.fields,
        { compressionProfile: s.vision.compressionProfile },
        { compressionProfile: (next) => { s.vision.compressionProfile = next; } },
        true,
      );
      this.addModelControl(
        new Setting(containerEl)
          .setName(T.settings.visionModel_name)
          .setDesc(T.settings.visionModel_desc),
        s.vision.model,
        async (v) => { s.vision.model = v; await this.plugin.saveSettings(); },
        false,
        modelControls.vision.check
          ? { tooltip: T.settings.visionCheck_tooltip, run: (model) => this.checkVisionModel(model) }
          : undefined,
      );

    }

    // ── Graph settings ────────────────────────────────────────────────────────
    new Setting(containerEl).setName(T.settings.h3_graph).setHeading();

    new Setting(containerEl)
      .setName(T.settings.graphDepth_name)
      .setDesc(T.settings.graphDepth_desc)
      .addText((t) =>
        t.setPlaceholder("1")
          .setValue(String(s.graphDepth))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n >= 0 && n <= 3) {
              s.graphDepth = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(T.settings.bfsTopK_name)
      .setDesc(T.settings.bfsTopK_desc)
      .addText((t) =>
        t.setPlaceholder("10")
          .setValue(String(s.bfsTopK))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n >= 0) {
              s.bfsTopK = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    // ── Jaccard (keyword scoring) ─────────────────────────────────────────────
    new Setting(containerEl).setName(T.settings.h3_jaccard).setHeading();

    new Setting(containerEl)
      .setName(T.settings.seedTopK_name)
      .setDesc(T.settings.seedTopK_desc)
      .addText((t) =>
        t.setPlaceholder("5")
          .setValue(String(s.seedTopK))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n >= 1 && n <= 50) {
              s.seedTopK = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(T.settings.seedMinScore_name)
      .setDesc(T.settings.seedMinScore_desc)
      .addText((t) =>
        t.setPlaceholder("0.1")
          .setValue(String(s.seedMinScore))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0 && n <= 1) {
              s.seedMinScore = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    // ── Proxy (native-agent only) ─────────────────────────────────────────────
    if (eff.backend !== "claude-agent" && !Platform.isMobile) {
      const proxy = eff.proxy;
      new Setting(containerEl).setName(T.settings.proxy_h3).setHeading();

      new Setting(containerEl)
        .setName(T.settings.proxy_enabled_name)
        .setDesc(T.settings.proxy_enabled_desc)
        .addToggle((t) =>
          t.setValue(proxy.enabled)
            .onChange(async (v) => { await this.patchProxy({ enabled: v }); this.display(); }),
        );

      if (proxy.enabled) {
        new Setting(containerEl)
          .setName(T.settings.proxy_url_name)
          .setDesc(T.settings.proxy_url_desc)
          .addText((t) =>
            t.setPlaceholder("http://proxy.example.com:8080")
              .setValue(proxy.url)
              .onChange(async (v) => { await this.patchProxy({ url: v.trim() }); }),
          );

        new Setting(containerEl)
          .setName(T.settings.proxy_username_name)
          .setDesc(T.settings.proxy_username_desc)
          .addText((t) =>
            t.setValue(proxy.username ?? "")
              .onChange(async (v) => { await this.patchProxy({ username: v }); }),
          );

        new Setting(containerEl)
          .setName(T.settings.proxy_password_name)
          .setDesc(T.settings.proxy_password_desc)
          .addText((t) => {
            t.setValue(proxy.password ?? "")
              .onChange(async (v) => { await this.patchLocalProxyPassword(v); });
            t.inputEl.type = "password";
          });

        new Setting(containerEl)
          .setName(T.settings.proxy_noProxy_name)
          .setDesc(T.settings.proxy_noProxy_desc)
          .addText((t) =>
            t.setPlaceholder("localhost,127.0.0.1")
              .setValue(proxy.noProxy ?? "")
              .onChange(async (v) => { await this.patchProxy({ noProxy: v.trim() }); }),
          );

        containerEl.createEl("p", { text: T.settings.proxy_hint, cls: "setting-item-description" });
      }
    }

    // ── Dev mode ──────────────────────────────────────────────────────────────
    if (!Platform.isMobile) {
      new Setting(containerEl).setName(T.settings.h3_devmode).setHeading();

      new Setting(containerEl)
        .setName(T.settings.devMode_enabled_name)
        .setDesc(T.settings.devMode_enabled_desc)
        .addToggle((t) =>
          t.setValue(s.devMode.enabled)
            .onChange(async (v) => { s.devMode.enabled = v; await this.plugin.saveSettings(); }),
        );
    }
    window.requestAnimationFrame(() => { scrollEl.scrollTop = savedScroll; });
  }
}
