import { access, constants } from "node:fs/promises";
import { App, DropdownComponent, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import { ConfirmModal, EditDomainModal, ShellConsentModal } from "./modals";
import type LlmWikiPlugin from "./main";
import type { LlmWikiPluginSettings, OpKey } from "./types";
import type { DomainEntry } from "./domain";
import { i18n } from "./i18n";
import { resolveEffective } from "./effective-settings";
import type { LocalConfig } from "./local-config";

async function checkClaudeAvailability(iclaudePath: string): Promise<void> {
  await access(iclaudePath, constants.X_OK);
}

async function checkNativeAvailability(baseUrl: string, apiKey: string, model: string): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Привет, AI Wiki! Поработаем?" }],
        max_tokens: 50,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function parseTimeoutString(v: string): { ingest: number; query: number; lint: number; init: number; format: number } | null {
  const parts = v.split("/").map((x) => Number(x.trim()));
  if (parts.length === 5 && parts.every((n) => Number.isFinite(n) && n >= 0)) {
    return { ingest: parts[0], query: parts[1], lint: parts[2], init: parts[3], format: parts[4] };
  }
  return null;
}

export class LlmWikiSettingTab extends PluginSettingTab {
  private cachedDomains: DomainEntry[] = [];
  private localCache: LocalConfig = { iclaudePath: "" };

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

  private async patchLocalNative(patch: Partial<NonNullable<LocalConfig["nativeAgent"]>>): Promise<void> {
    const cur = this.localCache.nativeAgent ?? {
      baseUrl: this.plugin.settings.nativeAgent.baseUrl,
      apiKey: this.plugin.settings.nativeAgent.apiKey,
      model: this.plugin.settings.nativeAgent.model,
      temperature: this.plugin.settings.nativeAgent.temperature,
      topP: this.plugin.settings.nativeAgent.topP,
    };
    await this.patchLocal({ nativeAgent: { ...cur, ...patch } });
  }

  private async patchLocalClaude(patch: Partial<NonNullable<LocalConfig["claudeAgent"]>>): Promise<void> {
    const cur = this.localCache.claudeAgent ?? {
      model: this.plugin.settings.claudeAgent.model,
      allowedTools: this.plugin.settings.claudeAgent.allowedTools,
    };
    await this.patchLocal({ claudeAgent: { ...cur, ...patch } });
  }

  private async patchLocalProxy(patch: Partial<NonNullable<LocalConfig["proxy"]>>): Promise<void> {
    const cur = this.localCache.proxy ?? { enabled: false, url: "" };
    await this.patchLocal({ proxy: { ...cur, ...patch } });
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const eff = resolveEffective(s, this.localCache);
    const T = i18n();

    const busy = this.plugin.controller.running;
    if (busy) {
      containerEl.createEl("div", {
        text: T.settings.busyBanner,
        cls: "setting-item-description ai-wiki-settings-busy-banner",
      });
    }

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
          b.setButtonText("Проверить").onClick(async () => {
            b.setButtonText("Проверка…").setDisabled(true);
            try {
              await checkClaudeAvailability(this.localCache.iclaudePath);
              new Notice("✅ Claude доступен");
            } catch (e) {
              new Notice(`❌ ${(e as Error).message}`);
            } finally {
              b.setButtonText("Проверить").setDisabled(false);
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
              .onChange(async (v) => { await this.patchLocalClaude({ model: v.trim() }); }),
          );
      }

      new Setting(containerEl)
        .setName(T.settings.allowedTools_name)
        .setDesc(T.settings.allowedTools_desc)
        .addText((t) =>
          t.setPlaceholder("Bash,read,write")
            .setValue(eff.claudeAgent.allowedTools)
            .onChange(async (v) => { await this.patchLocalClaude({ allowedTools: v.trim() }); }),
        );

      new Setting(containerEl)
        .setName("Effort level")
        .setDesc("Уровень размышления Claude (--effort). Пусто = без thinking. В per-op режиме — глобальный fallback.")
        .addDropdown(d => {
          d.addOption("", "Отключено");
          for (const lv of ["low", "medium", "high", "xhigh", "max"] as const) d.addOption(lv, lv);
          d.setValue(eff.claudeAgent.effort ?? "");
          d.onChange(async v => {
            await this.patchLocalClaude({ effort: (v || undefined) as typeof eff.claudeAgent.effort });
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
              d.addOption("", "Унаследовать");
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
            .onChange(async (v) => { await this.patchLocalNative({ baseUrl: v.trim() }); }),
        );

      new Setting(containerEl)
        .setName(T.settings.apiKey_name)
        .setDesc(T.settings.apiKey_desc)
        .addText((t) =>
          t.setPlaceholder("Ollama")
            .setValue(eff.nativeAgent.apiKey)
            .onChange(async (v) => { await this.patchLocalNative({ apiKey: v.trim() }); }),
        );

      new Setting(containerEl)
        .setName("Проверить соединение")
        .setDesc("Отправляет тестовый промпт к endpoint для проверки доступности.")
        .addButton(b => {
          b.setButtonText("Проверить").onClick(async () => {
            b.setButtonText("Проверка…").setDisabled(true);
            const na = eff.nativeAgent;
            try {
              await checkNativeAvailability(na.baseUrl, na.apiKey, na.model);
              new Notice("✅ Модель отвечает");
            } catch (e) {
              new Notice(`❌ ${(e as Error).message}`);
            } finally {
              b.setButtonText("Проверить").setDisabled(false);
            }
          });
          return b;
        });

      if (!s.nativeAgent.perOperation) {
        new Setting(containerEl)
          .setName(T.settings.model_name)
          .setDesc(T.settings.model_desc_native)
          .addText((t) =>
            t.setPlaceholder("llama3.2")
              .setValue(eff.nativeAgent.model)
              .onChange(async (v) => { await this.patchLocalNative({ model: v.trim() }); }),
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
          .setDesc("Макс. токены для размышления. 0 или пусто = отключено.")
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
                if (Number.isFinite(n) && n >= 0 && n <= 2) await this.patchLocalNative({ temperature: n });
              }),
          );
      }

      if (!Platform.isMobile) {
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
          new Setting(containerEl)
            .setName(T.settings.opModel_name)
            .setDesc(T.settings.opModel_desc)
            .addText((t) =>
              t.setValue(s.nativeAgent.operations[key].model)
                .onChange(async (v) => { s.nativeAgent.operations[key].model = v.trim(); await this.plugin.saveSettings(); }),
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

      // Relevant pages top-K (always visible for native-agent)
      new Setting(containerEl)
        .setName("Relevant pages (top-K)")
        .setDesc("Max wiki pages loaded per ingest call. Lower = faster, less context. Default: 15.")
        .addText((t) =>
          t.setPlaceholder("15")
            .setValue(String(this.localCache.nativeAgent?.relevantPagesTopK ?? 15))
            .onChange(async (v) => {
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) {
                await this.patchLocalNative({ relevantPagesTopK: Math.floor(n) });
              }
            }),
        );

      new Setting(containerEl)
        .setName("Enable semantic similarity (embeddings)")
        .setDesc("Use embedding vectors for relevant page selection. Requires native backend with an embeddings-capable model.")
        .addToggle((t) =>
          t.setValue(!!this.localCache.nativeAgent?.embeddingModel)
            .onChange(async (v) => {
              if (!v) {
                await this.patchLocalNative({ embeddingModel: undefined, embeddingDimensions: undefined });
                this.display();
              } else {
                this.display();
              }
            }),
        );

      if (this.localCache.nativeAgent?.embeddingModel !== undefined) {
        new Setting(containerEl)
          .setName("Embedding model")
          .setDesc("Model name for embeddings, e.g. text-embedding-3-small")
          .addText((t) =>
            t.setPlaceholder("text-embedding-3-small")
              .setValue(this.localCache.nativeAgent?.embeddingModel ?? "")
              .onChange(async (v) => {
                await this.patchLocalNative({ embeddingModel: v.trim() || undefined });
              }),
          );

        new Setting(containerEl)
          .setName("Embedding dimensions")
          .setDesc("Vector dimensions, e.g. 512 or 1536")
          .addText((t) =>
            t.setPlaceholder("512")
              .setValue(String(this.localCache.nativeAgent?.embeddingDimensions ?? ""))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) {
                  await this.patchLocalNative({ embeddingDimensions: Math.floor(n) });
                }
              }),
          );
      }

      // ── Proxy section (native-agent only) ───────────────────────────────────
      const proxy = eff.proxy;
      new Setting(containerEl).setName(T.settings.proxy_h3).setHeading();

      new Setting(containerEl)
        .setName(T.settings.proxy_enabled_name)
        .setDesc(T.settings.proxy_enabled_desc)
        .addToggle((t) =>
          t.setValue(proxy.enabled)
            .onChange(async (v) => { await this.patchLocalProxy({ enabled: v }); this.display(); }),
        );

      if (proxy.enabled) {
        new Setting(containerEl)
          .setName(T.settings.proxy_url_name)
          .setDesc(T.settings.proxy_url_desc)
          .addText((t) =>
            t.setPlaceholder("http://proxy.example.com:8080")
              .setValue(proxy.url)
              .onChange(async (v) => { await this.patchLocalProxy({ url: v.trim() }); }),
          );

        new Setting(containerEl)
          .setName(T.settings.proxy_username_name)
          .setDesc(T.settings.proxy_username_desc)
          .addText((t) =>
            t.setValue(proxy.username ?? "")
              .onChange(async (v) => { await this.patchLocalProxy({ username: v }); }),
          );

        new Setting(containerEl)
          .setName(T.settings.proxy_password_name)
          .setDesc(T.settings.proxy_password_desc)
          .addText((t) => {
            t.setValue(proxy.password ?? "")
              .onChange(async (v) => { await this.patchLocalProxy({ password: v }); });
            t.inputEl.type = "password";
          });

        new Setting(containerEl)
          .setName(T.settings.proxy_noProxy_name)
          .setDesc(T.settings.proxy_noProxy_desc)
          .addText((t) =>
            t.setPlaceholder("localhost,127.0.0.1")
              .setValue(proxy.noProxy ?? "")
              .onChange(async (v) => { await this.patchLocalProxy({ noProxy: v.trim() }); }),
          );

        containerEl.createEl("p", { text: T.settings.proxy_hint, cls: "setting-item-description" });
      }
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
      .setName(T.settings.hubThreshold_name)
      .setDesc(T.settings.hubThreshold_desc)
      .addText((t) =>
        t.setPlaceholder("20")
          .setValue(String(s.hubThreshold))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n > 0) {
              s.hubThreshold = n;
              await this.plugin.saveSettings();
            }
          }),
      );

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
  }
}
