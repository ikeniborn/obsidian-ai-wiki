import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import { ConfirmModal, EditDomainModal } from "./modals";
import type LlmWikiPlugin from "./main";
import type { LlmWikiPluginSettings, OpKey } from "./types";
import type { DomainEntry } from "./domain";
import { i18n } from "./i18n";

export class LlmWikiSettingTab extends PluginSettingTab {
  private cachedDomains: DomainEntry[] = [];
  private cachedIclaudePath = "";

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
    this.cachedIclaudePath = (await this.plugin.localConfigStore.load()).iclaudePath;
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
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

    const isPerOp = s.backend === "claude-agent" ? s.claudeAgent.perOperation : s.nativeAgent.perOperation;
    if (!isPerOp && s.backend !== "claude-agent") {
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
          t.setValue(s.agentLogEnabled)
            .onChange(async (v) => { s.agentLogEnabled = v; await this.plugin.saveSettings(); }),
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
            .setValue(s.backend)
            .onChange(async (v) => {
              s.backend = v as LlmWikiPluginSettings["backend"];
              await this.plugin.saveSettings();
              this.display();
            }),
        );
    } else {
      containerEl.createEl("p", {
        text: "Mobile: cloud LLM (native-agent) only. See docs/mobile-cloud-ollama.md.",
        cls: "setting-item-description",
      });
    }

    if (s.backend === "claude-agent" && !Platform.isMobile) {
      new Setting(containerEl)
        .setName(T.settings.iclaudePath_name)
        .setDesc(T.settings.iclaudePath_desc)
        .addText((t) =>
          t.setPlaceholder("/home/user/Documents/Project/iclaude/iclaude.sh")
            .setValue(this.cachedIclaudePath)
            .onChange(async (v) => {
              this.cachedIclaudePath = v.trim();
              await this.plugin.localConfigStore.save({ iclaudePath: this.cachedIclaudePath });
            }),
        );

      if (!s.claudeAgent.perOperation) {
        new Setting(containerEl)
          .setName(T.settings.model_name)
          .setDesc(T.settings.model_desc_claude)
          .addText((t) =>
            t.setPlaceholder("")
              .setValue(s.claudeAgent.model)
              .onChange(async (v) => { s.claudeAgent.model = v.trim(); await this.plugin.saveSettings(); }),
          );
      }

      new Setting(containerEl)
        .setName(T.settings.allowedTools_name)
        .setDesc(T.settings.allowedTools_desc)
        .addText((t) =>
          t.setPlaceholder("Bash,read,write")
            .setValue(s.claudeAgent.allowedTools)
            .onChange(async (v) => { s.claudeAgent.allowedTools = v.trim(); await this.plugin.saveSettings(); }),
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
        }
      }
    } else {
      new Setting(containerEl)
        .setName(T.settings.baseUrl_name)
        .setDesc(T.settings.baseUrl_desc)
        .addText((t) =>
          t.setPlaceholder("")
            .setValue(s.nativeAgent.baseUrl)
            .onChange(async (v) => { s.nativeAgent.baseUrl = v.trim(); await this.plugin.saveSettings(); }),
        );

      new Setting(containerEl)
        .setName(T.settings.apiKey_name)
        .setDesc(T.settings.apiKey_desc)
        .addText((t) =>
          t.setPlaceholder("Ollama")
            .setValue(s.nativeAgent.apiKey)
            .onChange(async (v) => { s.nativeAgent.apiKey = v.trim(); await this.plugin.saveSettings(); }),
        );

      if (!s.nativeAgent.perOperation) {
        new Setting(containerEl)
          .setName(T.settings.model_name)
          .setDesc(T.settings.model_desc_native)
          .addText((t) =>
            t.setPlaceholder("llama3.2")
              .setValue(s.nativeAgent.model)
              .onChange(async (v) => { s.nativeAgent.model = v.trim(); await this.plugin.saveSettings(); }),
          );

        new Setting(containerEl)
          .setName(T.settings.numCtx_name)
          .setDesc(T.settings.numCtx_desc)
          .addText((t) =>
            t.setPlaceholder("(дефолт модели)")
              .setValue(s.nativeAgent.numCtx != null ? String(s.nativeAgent.numCtx) : "")
              .onChange(async (v) => {
                const trimmed = v.trim();
                if (!trimmed) { s.nativeAgent.numCtx = null; }
                else { const n = Number(trimmed); if (Number.isFinite(n) && n > 0) s.nativeAgent.numCtx = Math.floor(n); }
                await this.plugin.saveSettings();
              }),
          );

        new Setting(containerEl)
          .setName(T.settings.temperature_name)
          .setDesc(T.settings.temperature_desc)
          .addText((t) =>
            t.setPlaceholder("0.2")
              .setValue(String(s.nativeAgent.temperature))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n >= 0 && n <= 2) { s.nativeAgent.temperature = n; await this.plugin.saveSettings(); }
              }),
          );
      }

      new Setting(containerEl)
        .setName(T.settings.perOperation_name)
        .setDesc(T.settings.perOperation_desc)
        .addToggle((t) =>
          t.setValue(s.nativeAgent.perOperation)
            .onChange(async (v) => { s.nativeAgent.perOperation = v; await this.plugin.saveSettings(); this.display(); }),
        );

      if (s.nativeAgent.perOperation) {
        const ops: Array<{ key: OpKey; label: string }> = [
          { key: "ingest", label: T.settings.op_ingest },
          { key: "query",  label: T.settings.op_query },
          { key: "lint",   label: T.settings.op_lint },
          { key: "init",   label: T.settings.op_init },
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
