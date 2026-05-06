import { dirname } from "node:path";
import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings, type RunHistoryEntry } from "./types";
import type { DomainEntry } from "./domain-map";
import { LlmWikiSettingTab } from "./settings";
import { LLM_WIKI_VIEW_TYPE, LlmWikiView } from "./view";
import { WikiController } from "./controller";
import { QueryModal, DomainModal } from "./modals";
import { i18n } from "./i18n";

export default class LlmWikiPlugin extends Plugin {
  settings!: LlmWikiPluginSettings;
  controller!: WikiController;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.controller = new WikiController(this.app, this);

    this.registerView(LLM_WIKI_VIEW_TYPE, (leaf: WorkspaceLeaf) => new LlmWikiView(leaf, this));

    // eslint-disable-next-line obsidianmd/ui/sentence-case
    this.addRibbonIcon("brain-circuit", "LLM wiki", () => {
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

    this.addCommand({
      id: "ingest-current",
      name: T.cmd.ingestActive,
      callback: () => void this.controller.ingestActive(),
    });

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

    this.addCommand({
      id: "lint",
      name: T.cmd.lint,
      callback: () => {
        const domains = this.controller.loadDomains();
        new DomainModal(this.app, T.cmd.lint, true, null, domains,
          (d) => void this.controller.lint(d)).open();
      },
    });

    this.addCommand({
      id: "init",
      name: T.cmd.init,
      callback: () => {
        const domains = this.controller.loadDomains();
        new DomainModal(this.app, T.cmd.init, false, { dryRun: true }, domains,
          (d, f) => void this.controller.init(d, f.dryRun ?? false)).open();
      },
    });

    this.addCommand({
      id: "cancel",
      name: T.cmd.cancel,
      callback: () => this.controller.cancelCurrent(),
    });

    this.addSettingTab(new LlmWikiSettingTab(this.app, this));

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
        },
      },
      history: (data?.history as RunHistoryEntry[]) ?? [],
      domains: Array.isArray(data?.domains) ? (data.domains as DomainEntry[]) : [],
    } as LlmWikiPluginSettings;

    // Миграция: поля, перенесённые с per-backend уровня на top-level (schema v2)
    if (!data?.systemPrompt && (caData.systemPrompt || naData.systemPrompt))
      this.settings.systemPrompt = (caData.systemPrompt ?? naData.systemPrompt) as string;
    if (!data?.maxTokens && (caData.maxTokens || naData.maxTokens))
      this.settings.maxTokens = (caData.maxTokens ?? naData.maxTokens) as number;

    // Миграция с claude-code backend
    if ((data?.backend as string) === "claude-code") {
      this.settings.backend = "claude-agent";
      if (data && data.iclaudePath && !this.settings.claudeAgent.iclaudePath)
        this.settings.claudeAgent.iclaudePath = data.iclaudePath as string;
      if (data && data.model && !this.settings.claudeAgent.model)
        this.settings.claudeAgent.model = data.model as string;
    }

    // Миграция: devMode.logPath → devMode.logDir
    const devData = data?.devMode as Record<string, unknown> | undefined;
    if (devData?.logPath !== undefined && devData?.logDir === undefined) {
      this.settings.devMode.logDir = devData.logPath
        ? dirname(devData.logPath as string)
        : "";
    }

    // Миграция wiki_folder: strip !Wiki/ prefix (stored as subfolder only)
    if (migrateDomainWikiFolder(this.settings.domains)) {
      void this.saveSettings();
    }
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
