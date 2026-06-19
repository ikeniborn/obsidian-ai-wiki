import { AbstractInputSuggest, App, DropdownComponent, Notice, Platform, PluginSettingTab, requestUrl, Setting } from "obsidian";
import { ConfirmModal, EditDomainModal, ShellConsentModal } from "./modals";
import type LlmWikiPlugin from "./main";
import type { LlmWikiPluginSettings, OpKey } from "./types";
import type { DomainEntry } from "./domain";
import { i18n } from "./i18n";
import { resolveEffective } from "./effective-settings";
import { DEFAULT_CHUNKING, probeEmbeddingDimensions } from "./page-similarity";
import type { LocalConfig } from "./local-config";

async function checkClaudeAvailability(iclaudePath: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node.js fs check for Claude CLI executable, desktop only
  const { access, constants } = require("node:fs/promises") as typeof import("node:fs/promises");
  await access(iclaudePath, constants.X_OK);
}

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
    const probe = await probeEmbeddingDimensions(na.baseUrl, apiKey, na.embeddingModel, requested);
    if (probe == null) { new Notice("Dimension check failed: API error"); return; }
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
  ): void {
    s.addButton((b) =>
      b.setIcon("refresh-cw").setTooltip("Fetch available models from base URL")
        .onClick(() => { void this.fetchModels(); }),
    );
    s.addText((t) => {
      t.setPlaceholder("Type to search models…").setValue(currentValue);
      t.inputEl.addEventListener("focus", () => {
        if (this._availableModels.length === 0) void this.fetchModels();
      });
      new ModelInputSuggest(this.app, t.inputEl, () => this._availableModels, (v) => { void onChange(v); });
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
        d.addOptions({ auto: "Auto (match source)", ru: "Russian", en: "English", es: "Spanish" })
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

    new Setting(containerEl)
      .setName(T.settings.llmIdleTimeout_name)
      .setDesc(T.settings.llmIdleTimeout_desc)
      .addText((t) =>
        t.setPlaceholder("300")
          .setValue(String(s.llmIdleTimeoutSec))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) {
              s.llmIdleTimeoutSec = Math.floor(n);
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(T.settings.llmIdleRetries_name)
      .setDesc(T.settings.llmIdleRetries_desc)
      .addText((t) =>
        t.setPlaceholder("3")
          .setValue(String(s.llmIdleRetries))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n >= 0) {
              s.llmIdleRetries = n;
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
              await checkClaudeAvailability(this.localCache.iclaudePath);
              new Notice(T.settings.claudeAvailable_ok);
            } catch (e) {
              new Notice(`❌ ${(e as Error).message}`);
            } finally {
              b.setButtonText(T.settings.testConnection_btn).setDisabled(false);
            }
          });
          return b;
        });

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

      new Setting(containerEl)
        .setName(T.settings.allowedTools_name)
        .setDesc(T.settings.allowedTools_desc)
        .addText((t) =>
          t.setPlaceholder("Bash,read,write")
            .setValue(eff.claudeAgent.allowedTools)
            .onChange(async (v) => { s.claudeAgent.allowedTools = v.trim(); await this.plugin.saveSettings(); }),
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
        .setName(T.settings.testConnection_name)
        .setDesc(T.settings.testConnection_desc)
        .addButton(b => {
          b.setButtonText(T.settings.testConnection_btn).onClick(async () => {
            b.setButtonText(T.settings.testConnection_btnBusy).setDisabled(true);
            const na = eff.nativeAgent;
            try {
              await checkNativeAvailability(na.baseUrl, na.apiKey, na.model);
              new Notice(T.settings.testConnection_ok);
            } catch (e) {
              new Notice(`❌ ${(e as Error).message}`);
            } finally {
              b.setButtonText(T.settings.testConnection_btn).setDisabled(false);
            }
          });
          return b;
        });

      if (!s.nativeAgent.perOperation) {
        this.addModelControl(
          new Setting(containerEl).setName(T.settings.model_name).setDesc(T.settings.model_desc_native),
          eff.nativeAgent.model,
          async (v) => { s.nativeAgent.model = v; await this.plugin.saveSettings(); },
        );

        new Setting(containerEl)
          .setName(T.settings.maxTokens_name)
          .setDesc(T.settings.maxTokens_desc)
          .addText((t) =>
            t.setPlaceholder("4096")
              .setValue(String(s.nativeAgent.maxTokens))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) {
                  s.nativeAgent.maxTokens = Math.floor(n);
                  await this.plugin.saveSettings();
                }
              }),
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
        new Setting(containerEl).setName("Per-operation models").setHeading();
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
          new Setting(containerEl)
            .setName(T.settings.opMaxTokens_name)
            .setDesc(T.settings.opMaxTokens_desc)
            .addText((t) =>
              t.setValue(String(s.nativeAgent.operations[key].maxTokens))
                .onChange(async (v) => {
                  const n = Number(v);
                  if (Number.isFinite(n) && n > 0) { s.nativeAgent.operations[key].maxTokens = Math.floor(n); await this.plugin.saveSettings(); }
                }),
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

      new Setting(containerEl).setName("Semantic Search").setHeading();

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
            if (v) await this.setDefaultDimensions(true);  // seed the model's native dimension
          },
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

        new Setting(containerEl).setName("Retrieval").setHeading();
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
          .setName("Seed similarity threshold")
          .setDesc(T.settings.seedSimilarityThreshold_desc)
          .addText((t) =>
            t.setValue(String(s.nativeAgent.seedSimilarityThreshold ?? 0))
              .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) { s.nativeAgent.seedSimilarityThreshold = n; await this.plugin.saveSettings(); } }),
          );

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

    // ── Vision settings ─────────────────────────────────────────────────────
    new Setting(containerEl).setName("Vision").setHeading();

    new Setting(containerEl)
      .setName("Enable vision analysis")
      .setDesc("Analyse embedded images, PDFs, and Excalidraw files before formatting. Uses the same baseUrl and API key as the main backend.")
      .addToggle((t) =>
        t.setValue(s.vision.enabled)
          .onChange(async (v) => {
            s.vision.enabled = v;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (s.vision.enabled) {
      this.addModelControl(
        new Setting(containerEl)
          .setName("Vision model")
          .setDesc("Model name for vision calls, e.g. gpt-4o-mini or claude-3-haiku-20240307"),
        s.vision.model,
        async (v) => { s.vision.model = v; await this.plugin.saveSettings(); },
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
            .onChange(async (v) => { s.devMode.enabled = v; await this.plugin.saveSettings(); this.display(); }),
        );

      if (s.devMode.enabled) {
        new Setting(containerEl)
          .setName(T.settings.devMode_evaluatorModel_name)
          .setDesc(T.settings.devMode_evaluatorModel_desc)
          .addText((t) =>
            t.setPlaceholder("")
              .setValue(s.devMode.evaluatorModel)
              .onChange(async (v) => { s.devMode.evaluatorModel = v.trim(); await this.plugin.saveSettings(); }),
          );
      }
    }
    window.requestAnimationFrame(() => { scrollEl.scrollTop = savedScroll; });
  }
}
