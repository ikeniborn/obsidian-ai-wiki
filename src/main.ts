import { Plugin, WorkspaceLeaf, Platform } from "obsidian";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings, type RunHistoryEntry } from "./types";
import type { DomainEntry } from "./domain";
import { LlmWikiSettingTab } from "./settings";
import { LLM_WIKI_VIEW_TYPE, LlmWikiView } from "./view";
import { WikiController } from "./controller";
import { QueryModal, DomainModal } from "./modals";
import { i18n } from "./i18n";
import { DomainStore } from "./domain-store";
import { LocalConfigStore } from "./local-config";

export default class LlmWikiPlugin extends Plugin {
  settings!: LlmWikiPluginSettings;
  controller!: WikiController;
  settingTab?: LlmWikiSettingTab;
  domainStore!: DomainStore;
  localConfigStore!: LocalConfigStore;

  async onload(): Promise<void> {
    this.domainStore = new DomainStore(this.app.vault);
    this.localConfigStore = new LocalConfigStore(this);
    await migrateLegacyData(this, this.domainStore, this.localConfigStore);
    await this.loadSettings();
    await migrateToLocalV1(this, this.localConfigStore);
    this.controller = new WikiController(this.app, this, this.domainStore, this.localConfigStore);
    this.controller.onBusyChange = () => this.settingTab?.display();

    this.registerView(LLM_WIKI_VIEW_TYPE, (leaf: WorkspaceLeaf) => new LlmWikiView(leaf, this));

    // eslint-disable-next-line /skip
    this.addRibbonIcon("brain-circuit", "LLM Wiki", () => {
      const leaves = this.app.workspace.getLeavesOfType(LLM_WIKI_VIEW_TYPE);
      if (leaves.length > 0) {
        void this.app.workspace.revealLeaf(leaves[0]);
      } else {
        const right = this.app.workspace.getRightLeaf(false);
        if (right) void right.setViewState({ type: LLM_WIKI_VIEW_TYPE, active: true });
      }
    });

    const T = i18n();

    this.addCommand({
      id: "open-panel",
      name: T.cmd.openPanel,
      callback: () => {
        const right = this.app.workspace.getRightLeaf(false);
        if (right) void right.setViewState({ type: LLM_WIKI_VIEW_TYPE, active: true });
      },
    });

    if (!Platform.isMobile) {
      this.addCommand({
        id: "ingest-current",
        name: T.cmd.ingestActive,
        callback: () => void this.controller.ingestActive(),
      });
    }

    this.addCommand({
      id: "query",
      name: T.cmd.query,
      callback: () => new QueryModal(this.app, false, (q) => void this.controller.query(q, false)).open(),
    });

    this.addCommand({
      id: "query-save",
      name: T.cmd.querySave,
      callback: () => new QueryModal(this.app, true, (q) => void this.controller.query(q, true)).open(),
    });

    if (!Platform.isMobile) {
      this.addCommand({
        id: "lint",
        name: T.cmd.lint,
        callback: () => {
          void (async () => {
            let domains: DomainEntry[];
            try { domains = await this.controller.loadDomains(); } catch { return; }
            new DomainModal(this.app, T.cmd.lint, true, null, domains,
              (d) => void this.controller.lint(d)).open();
          })();
        },
      });

      this.addCommand({
        id: "init",
        name: T.cmd.init,
        callback: () => {
          void (async () => {
            let domains: DomainEntry[];
            try { domains = await this.controller.loadDomains(); } catch { return; }
            new DomainModal(this.app, T.cmd.init, false, { dryRun: true }, domains,
              (d, f) => void this.controller.init(d, f.dryRun ?? false)).open();
          })();
        },
      });
    }

    this.addCommand({
      id: "cancel",
      name: T.cmd.cancel,
      callback: () => this.controller.cancelCurrent(),
    });

    this.settingTab = new LlmWikiSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    console.debug("[llm-wiki] loaded");
  }

  onunload(): void {
    this.controller.cancelCurrent();
    console.debug("[llm-wiki] unloaded");
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Record<string, unknown> | null;

    const caData = (data?.claudeAgent as Record<string, unknown>) ?? {};
    const naData = (data?.nativeAgent as Record<string, unknown>) ?? {};
    const caOps = (caData.operations as Record<string, unknown>) ?? {};
    const naOps = (naData.operations as Record<string, unknown>) ?? {};

    const defCA = DEFAULT_SETTINGS.claudeAgent;
    const defNA = DEFAULT_SETTINGS.nativeAgent;

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(data ?? {}),
      timeouts: { ...DEFAULT_SETTINGS.timeouts, ...((data?.timeouts as object) ?? {}) },
      claudeAgent: {
        ...defCA,
        ...caData,
        operations: {
          ingest: { ...defCA.operations.ingest, ...((caOps.ingest as object) ?? {}) },
          query:  { ...defCA.operations.query,  ...((caOps.query  as object) ?? {}) },
          lint:   { ...defCA.operations.lint,   ...((caOps.lint   as object) ?? {}) },
          init:   { ...defCA.operations.init,   ...((caOps.init   as object) ?? {}) },
          format: { ...defCA.operations.format, ...((caOps.format as object) ?? {}) },
        },
      },
      nativeAgent: {
        ...defNA,
        ...naData,
        operations: {
          ingest: { ...defNA.operations.ingest, ...((naOps.ingest as object) ?? {}) },
          query:  { ...defNA.operations.query,  ...((naOps.query  as object) ?? {}) },
          lint:   { ...defNA.operations.lint,   ...((naOps.lint   as object) ?? {}) },
          init:   { ...defNA.operations.init,   ...((naOps.init   as object) ?? {}) },
          format: { ...defNA.operations.format, ...((naOps.format as object) ?? {}) },
        },
      },
      history: (data?.history as RunHistoryEntry[]) ?? [],
    } as LlmWikiPluginSettings;

    // Миграция: поля, перенесённые с per-backend уровня на top-level (schema v2)
    if (!data?.systemPrompt && (caData.systemPrompt || naData.systemPrompt))
      this.settings.systemPrompt = (caData.systemPrompt ?? naData.systemPrompt) as string;
    if (!data?.maxTokens && (caData.maxTokens || naData.maxTokens))
      this.settings.maxTokens = (caData.maxTokens ?? naData.maxTokens) as number;

    // Миграция с claude-code backend
    if ((data?.backend as string) === "claude-code") {
      this.settings.backend = "claude-agent";
      if (data && data.model && !this.settings.claudeAgent.model)
        this.settings.claudeAgent.model = data.model as string;
    }

    // Mobile: force native-agent backend (claude-agent unsupported on mobile).
    if (Platform.isMobile && this.settings.backend === "claude-agent") {
      this.settings.backend = "native-agent";
      await this.saveData(this.settings);
    }

    // Mobile: force per-op + dev mode off (irrelevant — only `query` runs on mobile).
    if (Platform.isMobile) {
      let dirty = false;
      if (this.settings.nativeAgent.perOperation) {
        this.settings.nativeAgent.perOperation = false;
        dirty = true;
      }
      if (this.settings.devMode.enabled) {
        this.settings.devMode.enabled = false;
        dirty = true;
      }
      if (dirty) await this.saveData(this.settings);
    }

    // Миграция: agentLogPath → agentLogEnabled
    const legacyLogPath = (data as Record<string, unknown> | null)?.agentLogPath;
    if (typeof legacyLogPath === "string") {
      this.settings.agentLogEnabled = legacyLogPath.length > 0;
    }

    // Миграция: devMode.logDir → удалён (путь фиксирован в коде)
    this.settings.devMode = {
      enabled: this.settings.devMode.enabled,
      evaluatorModel: this.settings.devMode.evaluatorModel,
    };

    // Миграция v0.1.65: format.maxTokens 16384 (старый default) → 32768 для native.
    // claude-agent.operations.*.maxTokens удалён в v0.1.66 (плумился из плагина впустую —
    // claude CLI берёт CLAUDE_CODE_MAX_OUTPUT_TOKENS из env iclaude.sh).
    let formatMaxTokensMigrated = false;
    if (this.settings.nativeAgent.operations.format.maxTokens === 16384) {
      this.settings.nativeAgent.operations.format.maxTokens = 32768;
      formatMaxTokensMigrated = true;
    }
    // Очистка старого поля у claude-операций (если присутствует в data.json).
    const ca = this.settings.claudeAgent.operations as unknown as Record<string, Record<string, unknown>>;
    let claudeCleanup = false;
    for (const k of Object.keys(ca)) {
      if ("maxTokens" in ca[k]) { delete ca[k].maxTokens; claudeCleanup = true; }
    }
    if (formatMaxTokensMigrated || claudeCleanup) await this.saveData(this.settings);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

export function migrateDomainWikiFolder(domains: DomainEntry[]): boolean {
  let changed = false;
  for (const d of domains) {
    if (d.wiki_folder?.startsWith("!Wiki/")) {
      d.wiki_folder = d.wiki_folder.slice("!Wiki/".length);
      changed = true;
    }
  }
  return changed;
}

export async function migrateLegacyData(
  plugin: LlmWikiPlugin,
  domainStore: DomainStore,
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const data = (await plugin.loadData()) as Record<string, unknown> | null;
  if (!data) return;

  let dirty = false;

  if (Array.isArray(data.domains)) {
    if (data.domains.length > 0) {
      const vaultExists = await plugin.app.vault.adapter.exists("!Wiki/_domain.json");
      if (!vaultExists) {
        await domainStore.save(data.domains as DomainEntry[]);
      }
    }
    delete data.domains;
    dirty = true;
  }

  const ca = data.claudeAgent as Record<string, unknown> | undefined;
  if (ca && typeof ca.iclaudePath === "string") {
    const cur = await localConfigStore.load();
    if (ca.iclaudePath.length > 0 && !cur.iclaudePath) {
      await localConfigStore.save({ iclaudePath: ca.iclaudePath });
    }
    delete ca.iclaudePath;
    dirty = true;
  }

  if (dirty) await plugin.saveData(data);
}

export async function migrateToLocalV1(
  plugin: LlmWikiPlugin,
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const local = await localConfigStore.load();
  if (local.migrated_v1) return;

  const s = plugin.settings;
  await localConfigStore.save({
    backend: s.backend,
    nativeAgent: {
      baseUrl: s.nativeAgent.baseUrl,
      apiKey: s.nativeAgent.apiKey,
      model: s.nativeAgent.model,
      temperature: s.nativeAgent.temperature,
      topP: s.nativeAgent.topP,
      numCtx: s.nativeAgent.numCtx,
    },
    claudeAgent: {
      model: s.claudeAgent.model,
      allowedTools: s.claudeAgent.allowedTools,
    },
    agentLogEnabled: s.agentLogEnabled,
    migrated_v1: true,
  });

  // Scrub apiKey from synced data.json — sensitive.
  s.nativeAgent.apiKey = "";
  await plugin.saveSettings();
}
