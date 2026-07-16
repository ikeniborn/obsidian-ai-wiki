import { Plugin, WorkspaceLeaf, Platform, Notice } from "obsidian";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings, type RunHistoryEntry } from "./types";
import { normalizeModelCallPolicySettings } from "./model-call-policy";
import type { DomainEntry } from "./domain";
import { LlmWikiSettingTab } from "./settings";
import { AI_WIKI_VIEW_TYPE, LlmWikiView } from "./view";
import { WikiController } from "./controller";
import { QueryModal, DomainModal, LintOptionsModal, ExportOkfModal } from "./modals";
import { i18n } from "./i18n";
import { DomainStore } from "./domain-store";
import { LocalConfigStore } from "./local-config";
import { structuralErrorCounter } from "./structural-error-counter";
import { runStorageMigration, cleanupBundledSchemaCopies, migrateLogsToPluginDir, removeEmptyConfigDirs } from "./storage-migration";
import { migrateIndexFormat } from "./migrate-index-format";
import { migrateDropSections } from "./migrate-drop-sections";
import { migrateOkfFrontmatter } from "./migrate-okf-frontmatter";
import { migrateJsonlDomainStorage } from "./migrate-jsonl-domain-storage";
import { GLOBAL_DOMAIN_PATH, domainWikiFolder, effectiveSubfolder } from "./wiki-path";

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
      const report = await migrateJsonlDomainStorage(this.app.vault);
      if (!report.ok) {
        new Notice(`AI Wiki: JSONL domain migration failed — ${report.errors.join("; ")}`, 0);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`AI Wiki: storage migration failed — ${msg}`, 0);
      console.error("[AI Wiki] storage migration error:", e);
    }
    // Schemas are bundled & delivered via release; drop any stale vault copies.
    await cleanupBundledSchemaCopies(this.app.vault);
    await migrateLogsToPluginDir(this.app.vault, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    await removeEmptyConfigDirs(this.app.vault);
    await migrateLegacyData(this, this.domainStore, this.localConfigStore);
    await this.loadSettings();
    await migrateToLocalV1(this, this.localConfigStore);
    await migrateToLocalV2(this, this.localConfigStore);
    try {
      const domains = await this.domainStore.load();
      await migrateIndexFormat(this.app.vault, domains);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`AI Wiki: index format migration failed — ${msg}`, 0);
      console.error("[AI Wiki] index format migration error:", e);
    }
    try {
      const domains = await this.domainStore.load();
      await migrateDropSections(this.app.vault, domains, this.localConfigStore);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`AI Wiki: drop-sections migration failed — ${msg}`, 0);
      console.error("[AI Wiki] drop-sections migration error:", e);
    }
    try {
      const domains = await this.domainStore.load();
      await migrateOkfFrontmatter(this.app.vault, domains, this.localConfigStore);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`AI Wiki: OKF frontmatter migration failed — ${msg}`, 0);
      console.error("[AI Wiki] OKF frontmatter migration error:", e);
    }
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
            const domainEntry = domains[0];
            if (!domainEntry) return;
            const counts = new Map<string, number>();
            const allMd = this.app.vault.getMarkdownFiles();
            for (const et of domainEntry.entity_types ?? []) {
              const prefix = `${domainWikiFolder(domainEntry.wiki_folder)}/${effectiveSubfolder(et)}/`;
              counts.set(et.type, allMd.filter(f => f.path.startsWith(prefix)).length);
            }
            new LintOptionsModal(this.app, domainEntry, this.settings.lintOptions.useLlm,
              counts, (opts) => void this.controller.lint(domainEntry.id, opts)).open();
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

      this.addCommand({
        id: "export-okf",
        name: T.cmd.exportOkf,
        callback: () => {
          void (async () => {
            let domains: DomainEntry[];
            try { domains = await this.controller.loadDomains(); } catch { return; }
            const last = (await this.localConfigStore.load()).lastDomain;
            const domain = domains.find((d) => d.id === last) ?? domains[0];
            if (!domain) { new Notice(i18n().view.selectDomainFirst); return; }
            const defaultDest = `${this.controller.cwdOrEmpty()}/okf-export/${domain.wiki_folder}`;
            new ExportOkfModal(this.app, defaultDest, (dest) => {
              void this.controller.exportOkf(domain, dest)
                .then((r) => new Notice(`OKF: ${r.pages} pages → ${dest}${r.warnings.length ? ` (${r.warnings.length} warnings)` : ""}`))
                .catch((e) => new Notice(`OKF export failed: ${(e as Error).message}`, 0));
            }).open();
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
      proxy: { ...DEFAULT_SETTINGS.proxy, ...((data?.proxy as object) ?? {}) },
      history: (data?.history as RunHistoryEntry[]) ?? [],
    };
    normalizeModelCallPolicySettings(this.settings);

    // Schema v2: systemPrompt promoted to top-level
    if (!data?.systemPrompt && (caData.systemPrompt || naData.systemPrompt))
      this.settings.systemPrompt = (caData.systemPrompt ?? naData.systemPrompt) as string;

    // Schema v4: vision.language promoted to top-level outputLanguage
    {
      const visionData = (data?.vision as { language?: string } | undefined) ?? undefined;
      if (typeof data?.outputLanguage !== "string" && typeof visionData?.language === "string") {
        this.settings.outputLanguage = visionData.language as LlmWikiPluginSettings["outputLanguage"];
      }
      if (this.settings.vision && "language" in this.settings.vision) {
        delete (this.settings.vision as unknown as Record<string, unknown>).language;
      }
    }

    // Schema v3: maxTokens moves to nativeAgent.maxTokens; numCtx dropped
    let schemaV3Dirty = false;
    const legacyTop = typeof data?.maxTokens === "number" ? data.maxTokens : undefined;
    const legacyCA = typeof caData.maxTokens === "number" ? caData.maxTokens : undefined;
    const legacyNA = typeof naData.maxTokens === "number" ? naData.maxTokens : undefined;
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
    nativeAgent: { apiKey: s.nativeAgent.apiKey },
    migrated_v1: true,
    migrated_v2: true,
  });
  // Scrub apiKey from synced data.json — sensitive.
  s.nativeAgent.apiKey = "";
  await plugin.saveSettings();
}

export async function migrateToLocalV2(
  plugin: LlmWikiPlugin,
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const local = await localConfigStore.load();
  if (local.migrated_v2) return;

  const s = plugin.settings;
  // Read raw local.json to access old fields (claudeAgent, full nativeAgent, proxy).
  const adapter = plugin.app.vault.adapter;
  const localPath = `${plugin.manifest.dir}/local.json`;
  let raw: Record<string, unknown> = {};
  try {
    if (await adapter.exists(localPath)) {
      raw = JSON.parse(await adapter.read(localPath)) as Record<string, unknown>;
    }
  } catch { /* ignore */ }

  const ln = (raw.nativeAgent as Record<string, unknown>) ?? {};
  const lc = (raw.claudeAgent as Record<string, unknown>) ?? {};
  const lp = (raw.proxy as Record<string, unknown>) ?? {};

  // Move nativeAgent fields (except apiKey) to data.json settings.
  if (typeof ln.baseUrl === "string" && ln.baseUrl) s.nativeAgent.baseUrl = ln.baseUrl;
  if (typeof ln.model === "string" && ln.model) s.nativeAgent.model = ln.model;
  if (typeof ln.temperature === "number") s.nativeAgent.temperature = ln.temperature;
  if (ln.topP !== undefined) s.nativeAgent.topP = ln.topP as number | null;
  if (typeof ln.embeddingModel === "string") s.nativeAgent.embeddingModel = ln.embeddingModel || undefined;
  if (typeof ln.embeddingDimensions === "number") s.nativeAgent.embeddingDimensions = ln.embeddingDimensions;
  if (typeof ln.relevantPagesTopK === "number") s.nativeAgent.relevantPagesTopK = ln.relevantPagesTopK;
  if (typeof ln.mergeDeleteWarnThreshold === "number") s.nativeAgent.mergeDeleteWarnThreshold = ln.mergeDeleteWarnThreshold;

  // Move claudeAgent fields to data.json settings.
  if (typeof lc.model === "string" && lc.model) s.claudeAgent.model = lc.model;
  if (typeof lc.allowedTools === "string") s.claudeAgent.allowedTools = lc.allowedTools;
  if (typeof lc.effort === "string") s.claudeAgent.effort = lc.effort as typeof s.claudeAgent.effort;

  // Move proxy (except password) to data.json settings.
  if (typeof lp.enabled === "boolean" || typeof lp.url === "string") {
    s.proxy = {
      enabled: typeof lp.enabled === "boolean" ? lp.enabled : false,
      url: typeof lp.url === "string" ? lp.url : "",
      username: typeof lp.username === "string" ? lp.username : undefined,
      noProxy: typeof lp.noProxy === "string" ? lp.noProxy : undefined,
    };
  }

  // Move backend to local backend override (keep it local).
  // agentLogEnabled stays local too (already in LocalConfig).

  await plugin.saveSettings();

  // Rewrite local.json keeping only local-specific fields.
  const newLocal = {
    iclaudePath: raw.iclaudePath ?? "",
    ...(raw.backend !== undefined ? { backend: raw.backend } : {}),
    ...(raw.agentLogEnabled !== undefined ? { agentLogEnabled: raw.agentLogEnabled } : {}),
    ...(typeof ln.apiKey === "string" && ln.apiKey ? { nativeAgent: { apiKey: ln.apiKey } } : {}),
    ...(typeof lp.password === "string" && lp.password ? { proxy: { password: lp.password } } : {}),
    ...(raw.shellConsentGiven !== undefined ? { shellConsentGiven: raw.shellConsentGiven } : {}),
    ...(raw.lastDomain !== undefined ? { lastDomain: raw.lastDomain } : {}),
    migrated_v1: true,
    migrated_v2: true,
  };
  await adapter.write(localPath, JSON.stringify(newLocal, null, 2));
  localConfigStore["cache"] = null; // invalidate cache
}
