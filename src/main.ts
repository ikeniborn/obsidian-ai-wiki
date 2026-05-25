import { Plugin, WorkspaceLeaf, Platform, Notice } from "obsidian";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings, type RunHistoryEntry } from "./types";
import type { DomainEntry } from "./domain";
import { LlmWikiSettingTab } from "./settings";
import { AI_WIKI_VIEW_TYPE, LlmWikiView } from "./view";
import { WikiController } from "./controller";
import { QueryModal, DomainModal } from "./modals";
import { i18n } from "./i18n";
import { DomainStore } from "./domain-store";
import { LocalConfigStore } from "./local-config";
import { structuralErrorCounter } from "./structural-error-counter";
import { runStorageMigration, StorageMigrationConflictError } from "./storage-migration";
import { GLOBAL_DOMAIN_PATH } from "./wiki-path";

export default class LlmWikiPlugin extends Plugin {
  settings!: LlmWikiPluginSettings;
  controller!: WikiController;
  settingTab?: LlmWikiSettingTab;
  domainStore!: DomainStore;
  localConfigStore!: LocalConfigStore;

  async onload(): Promise<void> {
    this.domainStore = new DomainStore(this.app.vault);
    this.localConfigStore = new LocalConfigStore(this);
    try {
      await runStorageMigration(this.app.vault);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`AI Wiki: storage migration failed — ${msg}`, 0);
      console.error("[AI Wiki] storage migration error:", e);
    }
    await migrateLegacyData(this, this.domainStore, this.localConfigStore);
    await this.loadSettings();
    await migrateToLocalV1(this, this.localConfigStore);
    this.controller = new WikiController(this.app, this, this.domainStore, this.localConfigStore);
    this.controller.onBusyChange = () => this.settingTab?.display();

    this.registerView(AI_WIKI_VIEW_TYPE, (leaf: WorkspaceLeaf) => new LlmWikiView(leaf, this));

    this.addRibbonIcon("brain-circuit", "AIWiki", () => {
      const leaves = this.app.workspace.getLeavesOfType(AI_WIKI_VIEW_TYPE);
      if (leaves.length > 0) {
        void this.app.workspace.revealLeaf(leaves[0]);
      } else {
        const right = this.app.workspace.getRightLeaf(false);
        if (right) void right.setViewState({ type: AI_WIKI_VIEW_TYPE, active: true });
      }
    });

    if (!Platform.isMobile) {
      const statusBar = this.addStatusBarItem();
      statusBar.setText("schema: 0/0");
      statusBar.setAttribute("aria-label", "validation: 0 ok, 0 retried, 0 failed");
      const unsub = structuralErrorCounter.subscribe((s) => {
        const total = s.failed + s.retried + s.ok;
        statusBar.setText(`schema: ${s.failed}/${total}`);
        statusBar.setAttribute(
          "aria-label",
          `validation: ${s.ok} ok, ${s.retried} retried, ${s.failed} failed`,
        );
      });
      this.register(() => unsub());
    }

    const T = i18n();

    this.addCommand({
      id: "open-panel",
      name: T.cmd.openPanel,
      callback: () => {
        const right = this.app.workspace.getRightLeaf(false);
        if (right) void right.setViewState({ type: AI_WIKI_VIEW_TYPE, active: true });
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
      callback: () => new QueryModal(this.app, (q) => void this.controller.query(q)).open(),
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

    console.debug("[ai-wiki] loaded");
  }

  onunload(): void {
    this.controller.cancelCurrent();
    console.debug("[ai-wiki] unloaded");
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

    // Schema v2: systemPrompt promoted to top-level
    if (!data?.systemPrompt && (caData.systemPrompt || naData.systemPrompt))
      this.settings.systemPrompt = (caData.systemPrompt ?? naData.systemPrompt) as string;

    // Schema v3: maxTokens moves to nativeAgent.maxTokens; numCtx dropped
    let schemaV3Dirty = false;
    const legacyTop = typeof data?.maxTokens === "number" ? (data.maxTokens as number) : undefined;
    const legacyCA = typeof caData.maxTokens === "number" ? (caData.maxTokens as number) : undefined;
    const legacyNA = typeof naData.maxTokens === "number" ? (naData.maxTokens as number) : undefined;
    const naAlreadySet = legacyNA !== undefined;
    if (!naAlreadySet) {
      const legacy = legacyTop ?? legacyCA;
      if (legacy !== undefined) {
        this.settings.nativeAgent.maxTokens = legacy;
        schemaV3Dirty = true;
      }
    }
    // Strip top-level maxTokens if it was carried over by spread
    if ("maxTokens" in this.settings) {
      delete (this.settings as unknown as Record<string, unknown>).maxTokens;
      schemaV3Dirty = true;
    }
    // Strip nativeAgent.numCtx if it was carried over by spread
    if ("numCtx" in this.settings.nativeAgent) {
      delete (this.settings.nativeAgent as unknown as Record<string, unknown>).numCtx;
      schemaV3Dirty = true;
    }

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
    const legacyLogPath = data?.agentLogPath;
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
    if (formatMaxTokensMigrated || claudeCleanup || schemaV3Dirty) await this.saveData(this.settings);
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
      const vaultExists = await plugin.app.vault.adapter.exists(GLOBAL_DOMAIN_PATH);
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

  // Migrate shellConsentGiven from data.json → local.json (one-shot)
  if (data.shellConsentGiven === true) {
    const localCur = await localConfigStore.load();
    if (!localCur.shellConsentGiven) {
      await localConfigStore.save({ shellConsentGiven: true });
    }
    delete data.shellConsentGiven;
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
