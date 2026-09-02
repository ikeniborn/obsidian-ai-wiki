import { Plugin, WorkspaceLeaf, Platform, Notice } from "obsidian";
import {
  type LlmWikiPluginSettings,
} from "./types";
import { hydrateSettings } from "./settings-persistence";
import type { DomainEntry } from "./domain";
import { LlmWikiSettingTab } from "./settings";
import { AI_WIKI_DISPLAY_NAME, AI_WIKI_VIEW_TYPE, LlmWikiView } from "./view";
import { WikiController } from "./controller";
import { QueryModal, DomainModal, LintOptionsModal, ExportOkfModal, AutoBudgetNoticeModal } from "./modals";
import { i18n } from "./i18n";
import { DomainStore } from "./domain-store";
import { LocalConfigStore, sanitizeLocalConfig } from "./local-config";
import { structuralErrorCounter } from "./structural-error-counter";
import { runStorageMigration, cleanupBundledSchemaCopies, migrateLogsToPluginDir, removeEmptyConfigDirs } from "./storage-migration";
import { migrateIndexFormat } from "./migrate-index-format";
import { migrateDropSections } from "./migrate-drop-sections";
import { migrateOkfFrontmatter } from "./migrate-okf-frontmatter";
import { migrateJsonlDomainStorage } from "./migrate-jsonl-domain-storage";
import { GLOBAL_DOMAIN_PATH, domainWikiFolder, effectiveSubfolder } from "./wiki-path";
import { clearNativeBudgets, hasStoredNativeBudget } from "./auto-budget-notice";

export default class LlmWikiPlugin extends Plugin {
  declare settings: LlmWikiPluginSettings;
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
    await offerAutoBudgetMigration(this, this.localConfigStore);
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
    this.controller.onBusyChange = () => this.settingTab?.update();

    this.registerView(AI_WIKI_VIEW_TYPE, (leaf: WorkspaceLeaf) => new LlmWikiView(leaf, this));

    this.addRibbonIcon("brain-circuit", AI_WIKI_DISPLAY_NAME, () => {
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
      statusBar.setText("Schema: 0/0");
      statusBar.setAttribute("aria-label", "Validation: 0 ok, 0 retried, 0 failed");
      const unsub = structuralErrorCounter.subscribe((s) => {
        const total = s.failed + s.retried + s.ok;
        statusBar.setText(`Schema: ${s.failed}/${total}`);
        statusBar.setAttribute(
          "aria-label",
          `Validation: ${s.ok} ok, ${s.retried} retried, ${s.failed} failed`,
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
    const naData = (data?.nativeAgent as Record<string, unknown>) ?? {};
    this.settings = hydrateSettings(data);

    // Schema v2: systemPrompt promoted to top-level
    if (!data?.systemPrompt && typeof naData.systemPrompt === "string")
      this.settings.systemPrompt = naData.systemPrompt;

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
    const legacyNA = typeof naData.maxTokens === "number" ? naData.maxTokens : undefined;
    if (legacyNA === undefined && legacyTop !== undefined) {
      this.settings.nativeAgent.maxTokens = legacyTop;
      schemaV3Dirty = true;
    }
    if (data && "maxTokens" in data) {
      schemaV3Dirty = true;
    }
    if ("numCtx" in naData) {
      schemaV3Dirty = true;
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
      nativeTransportDiagnosticMode: this.settings.devMode.nativeTransportDiagnosticMode,
    };

    // Миграция v0.1.65: format.maxTokens 16384 (старый default) → 32768.
    let formatMaxTokensMigrated = false;
    if (this.settings.nativeAgent.operations.format.maxTokens === 16384) {
      this.settings.nativeAgent.operations.format.maxTokens = 32768;
      formatMaxTokensMigrated = true;
    }
    if (formatMaxTokensMigrated || schemaV3Dirty) await this.saveData(this.settings);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

export async function migrateLegacyData(
  plugin: LlmWikiPlugin,
  domainStore: DomainStore,
  _localConfigStore: LocalConfigStore,
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
  // Read raw local.json to access old nativeAgent and proxy fields.
  const adapter = plugin.app.vault.adapter;
  const localPath = `${plugin.manifest.dir}/local.json`;
  let raw: Record<string, unknown> = {};
  try {
    if (await adapter.exists(localPath)) {
      raw = JSON.parse(await adapter.read(localPath)) as Record<string, unknown>;
    }
  } catch { /* ignore */ }

  const ln = (raw.nativeAgent as Record<string, unknown>) ?? {};
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

  // Move proxy (except password) to data.json settings.
  if (typeof lp.enabled === "boolean" || typeof lp.url === "string") {
    s.proxy = {
      enabled: typeof lp.enabled === "boolean" ? lp.enabled : false,
      url: typeof lp.url === "string" ? lp.url : "",
      username: typeof lp.username === "string" ? lp.username : undefined,
      noProxy: typeof lp.noProxy === "string" ? lp.noProxy : undefined,
    };
  }

  await plugin.saveSettings();

  // Rewrite local.json keeping only local-specific fields.
  const newLocal = sanitizeLocalConfig({
    ...local,
    migrated_v1: true,
    migrated_v2: true,
  });
  await adapter.write(localPath, JSON.stringify(newLocal, null, 2));
  localConfigStore["cache"] = null; // invalidate cache
}

/**
 * One-shot upgrade prompt: an existing user with a stored native-agent budget override
 * is asked once whether to switch to automatic (context-window-derived) budgeting or
 * keep the stored values. Nothing is rewritten unless the user explicitly answers yes;
 * dismissing the modal any way (Escape, close, or clicking outside) keeps the stored
 * values, same as an explicit "keep".
 *
 * Every user is on the OpenAI-compatible path. A user with stored overrides is asked,
 * and the flag is recorded exactly once either way.
 */
export async function offerAutoBudgetMigration(
  plugin: LlmWikiPlugin,
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const local = await localConfigStore.load();
  if (local.migrated_auto_budget) return;

  if (hasStoredNativeBudget(plugin.settings)) {
    const switchToAutomatic = await new AutoBudgetNoticeModal(plugin.app).ask();
    if (switchToAutomatic) {
      clearNativeBudgets(plugin.settings);
      await plugin.saveSettings();
    }
  }
  await localConfigStore.save({ migrated_auto_budget: true });
}
