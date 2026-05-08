import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import { ConfirmModal, EditDomainModal } from "./modals";
import type LlmWikiPlugin from "./main";
import type { LlmWikiPluginSettings, OpKey } from "./types";
import type { DomainEntry } from "./domain";
import { i18n } from "./i18n";
import { resolveEffective } from "./effective-settings";
import type { LocalConfig } from "./local-config";

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
      numCtx: this.plugin.settings.nativeAgent.numCtx,
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
        cls: "setting-item-description llm-wiki-settings-busy-banner",
      });
    }

    // ── General settings ───────────────────────────────────────────────────
    new Setting(containerEl).setName(T.settings.h3_general).setHeading();

    new Setting(containerEl)
      .setName(T.settings.systemPrompt_name)
      .setDesc(T.settings.systemPrompt_desc)
      .addTextArea((t) => {
        t.inputEl.addClass("llm-wiki-settings-textarea");
        t.setValue(s.systemPrompt)
          .onChange(async (v) => { s.systemPrompt = v; await this.plugin.saveSettings(); });
        return t;
      });

    const isPerOp = eff.backend === "claude-agent" ? s.claudeAgent.perOperation : s.nativeAgent.perOperation;
    if (!isPerOp && eff.backend !== "claude-agent") {
      new Setting(containerEl)
        .setName(T.settings.maxTokens_name)
        .setDesc(T.settings.maxTokens_desc)
        .addText((t) =>
          t.setPlaceholder("4096")
            .setValue(String(s.maxTokens))
            .onChange(async (v) => {
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) { s.maxTokens = Math.floor(n); await this.plugin.saveSettings(); }
            }),
        );
    }

    new Setting(containerEl)
      .setName(T.settings.timeouts_name)
      .setDesc(T.settings.timeouts_desc)
      .addText((t) =>
        t.setValue(`${s.timeouts.ingest}/${s.timeouts.query}/${s.timeouts.lint}/${s.timeouts.init}`)
          .onChange(async (v) => {
            const parts = v.split("/").map((x) => Number(x.trim()));
            if (parts.length === 4 && parts.every((n) => Number.isFinite(n) && n > 0)) {
              s.timeouts = { ingest: parts[0], query: parts[1], lint: parts[2], init: parts[3] };
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

    if (!Platform.isMobile) {
      new Setting(containerEl)
        .setName(T.settings.agentLog_name)
        .setDesc(T.settings.agentLog_desc)
        .addToggle((t) =>
          t.setValue(eff.agentLogEnabled)
            .onChange(async (v) => { await this.patchLocal({ agentLogEnabled: v }); }),
        );
    }

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
        .addDropdown((d) =>
          d.addOption("claude-agent", T.settings.claudeCodeAgent)
            .addOption("native-agent", T.settings.nativeAgent)
            .setValue(eff.backend)
            .onChange(async (v) => {
              await this.patchLocal({ backend: v as LlmWikiPluginSettings["backend"] });
              this.display();
            }),
        );
    } else {
      const p = containerEl.createEl("p", {
        text: "Mobile: cloud LLM (native-agent) only. Setup guide: ",
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
        );

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
            .setName(T.settings.opMaxTokens_name)
            .setDesc(T.settings.opMaxTokens_desc)
            .addText((t) =>
              t.setValue(String(s.claudeAgent.operations[key].maxTokens))
                .onChange(async (v) => {
                  const n = Number(v);
                  if (Number.isFinite(n) && n > 0) { s.claudeAgent.operations[key].maxTokens = Math.floor(n); await this.plugin.saveSettings(); }
                }),
            );
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
          .setName(T.settings.numCtx_name)
          .setDesc(T.settings.numCtx_desc)
          .addText((t) =>
            t.setPlaceholder("(дефолт модели)")
              .setValue(eff.nativeAgent.numCtx != null ? String(eff.nativeAgent.numCtx) : "")
              .onChange(async (v) => {
                const trimmed = v.trim();
                if (!trimmed) { await this.patchLocalNative({ numCtx: null }); return; }
                const n = Number(trimmed);
                if (Number.isFinite(n) && n > 0) await this.patchLocalNative({ numCtx: Math.floor(n) });
              }),
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
  }
}
