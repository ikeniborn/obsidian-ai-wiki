import { AbstractInputSuggest, App, Notice, Platform, PluginSettingTab, requestUrl, Setting } from "obsidian";
import type { SettingDefinition, SettingDefinitionItem, SettingGroup } from "obsidian";
import { ConfirmModal, EditDomainModal, ExportOkfModal } from "./modals";
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
  applyBudgetInput,
  configuredContextWindowFor,
  createLiveModelControl,
  effectiveModel,
  setConfiguredContextWindow,
  renderModelControlFields,
  renderNativeBudgetControls,
  type ModelControlField,
} from "./model-call-policy";
import { resolveBudget } from "./budget-resolver";
import {
  configuredContextRecord,
  MIN_CONTEXT_WINDOW,
  placeholderContextWindow,
  plausibleContextWindow,
} from "./model-context";
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
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Hi, AI Wiki! Ready to work?" }], max_completion_tokens: 50, stream: false }),
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
  private localCache: LocalConfig = {};
  private _availableModels: string[] = [];
  private refreshPromise: Promise<void> | null = null;
  private refreshingDefinitions = false;
  private cacheLoaded = false;
  private localMutationGeneration = 0;
  private localWritesInFlight = 0;

  constructor(app: App, private plugin: LlmWikiPlugin) {
    super(app, plugin);
    this.requestRefresh();
  }

  private requestRefresh(): void {
    if (this.refreshingDefinitions || this.refreshPromise !== null) return;
    const refreshPromise = this.refresh();
    this.refreshPromise = refreshPromise;
    const finish = (): void => {
      if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
    };
    void refreshPromise.then(finish, finish);
  }

  private async refresh(): Promise<void> {
    const localMutationGeneration = this.localMutationGeneration;
    const localWritePending = this.localWritesInFlight > 0;
    let domains: DomainEntry[];
    try {
      domains = await this.plugin.domainStore.load();
    } catch (e) {
      domains = [];
      new Notice(`Domain map load failed: ${(e as Error).message}`);
    }
    const loadedLocalCache = await this.plugin.localConfigStore.load();
    const localCache = localWritePending || localMutationGeneration !== this.localMutationGeneration
      ? this.localCache
      : loadedLocalCache;
    const changed = !this.cacheLoaded
      || JSON.stringify(domains) !== JSON.stringify(this.cachedDomains)
      || JSON.stringify(localCache) !== JSON.stringify(this.localCache);
    this.cachedDomains = domains;
    this.localCache = localCache;
    this.cacheLoaded = true;
    if (!changed) return;
    this.refreshingDefinitions = true;
    try {
      this.update();
    } finally {
      this.refreshingDefinitions = false;
    }
  }

  private async patchLocal(patch: Partial<LocalConfig>): Promise<void> {
    this.localMutationGeneration++;
    this.localWritesInFlight++;
    this.localCache = { ...this.localCache, ...patch };
    try {
      await this.plugin.localConfigStore.save(patch);
    } finally {
      this.localWritesInFlight--;
    }
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
    const T = i18n();
    const na = this.plugin.settings.nativeAgent;
    if (!na.baseUrl || !na.embeddingModel) { new Notice("Set Base URL and embedding model first"); return; }
    if (!na.embeddingDimensions) { new Notice("Enter a dimension value to check, or use Default"); return; }
    const apiKey = this.localCache.nativeAgent?.apiKey ?? "";
    const requested = na.embeddingDimensions;
    const result = await probeEmbeddingDimensionsResult(this.plugin.settings.nativeAgent.baseUrl, apiKey, na.embeddingModel, requested);
    if (!result.probe) { new Notice(T.settings.embeddingDimensionCheck_failed(result.error ?? "unknown error")); return; }
    const probe = result.probe;
    const nativeProbe = await probeEmbeddingDimensions(na.baseUrl, apiKey, na.embeddingModel);
    const native = nativeProbe?.actual;
    const nativeStr = native != null ? String(native) : "?";

    if (!probe.honored) {
      // Requested size not produced — server ignored or capped it (e.g. > native).
      new Notice(T.settings.embeddingDimensionCheck_notSupported(probe.actual, nativeStr, requested));
    } else if (native != null && requested === native) {
      new Notice(T.settings.embeddingDimensionCheck_native(native));
    } else if (native != null && requested < native) {
      // Honored via truncation — valid but lossy; tiny values are effectively useless.
      new Notice(T.settings.embeddingDimensionCheck_truncated(requested, native));
    } else {
      new Notice(T.settings.embeddingDimensionCheck_ok(probe.actual, nativeStr));
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
    const T = i18n();
    const na = this.plugin.settings.nativeAgent;
    if (!na.baseUrl || !na.embeddingModel) { new Notice("Set Base URL and embedding model first"); return; }
    const apiKey = this.localCache.nativeAgent?.apiKey ?? "";
    const result = await probeEmbeddingDimensionsResult(na.baseUrl, apiKey, na.embeddingModel);
    new Notice(result.probe
      ? T.settings.embeddingCheck_ok(na.embeddingModel, result.probe.actual)
      : T.settings.embeddingCheck_failed(result.error ?? "unknown error"));
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
    this.update();
  }

  private addModelControl(
    s: Setting,
    currentValue: string,
    onChange: (v: string) => Promise<void>,
    saveOnTyping = false,
    check?: { tooltip: string; run: (currentValue: string) => void | Promise<void> },
  ): () => void {
    const live = createLiveModelControl(currentValue, onChange, saveOnTyping);
    let suggest: ModelInputSuggest | null = null;
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
      suggest = new ModelInputSuggest(
        this.app,
        t.inputEl,
        () => this._availableModels,
        (v) => { void live.select(v); },
      );
    });
    return () => { suggest?.close(); };
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    this.requestRefresh();
    const definitions: SettingDefinitionItem[] = [];
    let items: SettingDefinition[] = [];
    const addGroup = (heading: string): void => {
      items = [];
      definitions.push({ type: "group", heading, items });
    };
    const addSetting = (
      name: string,
      desc?: string,
      render?: (setting: Setting, group: SettingGroup) => void | (() => void),
    ): void => {
      items.push(render
        ? { name, desc, render: (setting, group) => render(setting, group) }
        : { name, desc });
    };
    const s = this.plugin.settings;
    const eff = resolveEffective(s, this.localCache);
    const T = i18n();
    const globalModelFields = [
      "inputBudgetTokens",
      "maxTokens",
      "compressionProfile",
    ] as const satisfies readonly ModelControlField[];
    const modelControls = {
      globalFields: globalModelFields,
      operations: {
        ingest: globalModelFields,
        query: globalModelFields,
        lint: globalModelFields,
        init: globalModelFields,
        format: ["inputBudgetTokens", "maxTokens"] as const,
      },
    };
    // Every automatic budget field registers how to repaint itself here. A context
    // window edit changes what the OTHER fields show as their automatic number, and
    // `onChange` fires once per typed character — re-rendering the tab there would
    // destroy the input the user is typing into and steal focus. So a committed
    // change repaints the placeholders of the live controls in place instead.
    // `resetValue` additionally re-reads the stored value; it is used only after a
    // model change, which commits discretely (a suggestion is picked, not typed),
    // because a per-model window belongs to a different model afterwards.
    const automaticControls: Array<(resetValue: boolean) => void> = [];
    const refreshAutomaticControls = (resetValue = false): void => {
      for (const repaint of automaticControls) repaint(resetValue);
    };
    // Native-only: a budget the user has not overridden is derived from the model's
    // context window instead of a fixed constant (Task 7). The control must still
    // render — never hidden by an `undefined` value — showing the resolved automatic
    // number when a context record is already cached, or the localized "Automatic"
    // word when nothing has been probed yet. Empty input clears the override.
    // `value` and `placeholder` are read lazily, so a repaint reflects the settings
    // as they are now rather than as they were when the tab was drawn.
    const addAutomaticBudgetControl = (
      setting: Setting,
      value: () => number | undefined,
      update: (next: number | undefined) => void,
      placeholder: () => string,
      // Entries below this are refused rather than stored: a field showing a number
      // the engine will not use is exactly what automatic budgeting
      // is supposed to avoid. Budget fields keep the default floor of 1.
      min?: number,
    ): void => {
      const holder: { value?: number } = {};
      setting.addText((text) => {
        const repaint = (resetValue: boolean): void => {
          if (resetValue) holder.value = value();
          const rendered = renderNativeBudgetControls({ value: holder.value }, placeholder())[0];
          text.setPlaceholder(rendered.placeholder);
          if (resetValue) text.setValue(rendered.value);
        };
        repaint(true);
        automaticControls.push(repaint);
        text.onChange(async (raw) => {
          const previous = holder.value;
          applyBudgetInput(holder, "value", raw, min);
          if (holder.value === previous) return;
          update(holder.value);
          await this.plugin.saveSettings();
          // Placeholders only: the field being typed into keeps its own text.
          refreshAutomaticControls();
        });
      });
    };
    // Cached-only: never probes. `record` is undefined until the first operation has
    // resolved this (baseUrl, model) pair, in which case the placeholder falls back to
    // the localized "Automatic" word rather than a guessed number. A configured window
    // needs no run to take effect: it is the same record `ModelContextStore.resolve`
    // will build, so the numbers shown here are the ones the next run budgets from.
    const automaticBudgetPlaceholders = (
      model: string,
      operation: OpKey,
      overrides: { input?: number; output?: number },
    ): { input: string; output: string; contextWindow: string } => {
      const cached = this.plugin.controller.cachedModelContext(s.nativeAgent.baseUrl, model);
      // The window configured FOR THIS MODEL: with a window per model, reading the
      // setting of another model here would advertise a number this model's runs
      // will never budget from.
      const configured = plausibleContextWindow(configuredContextWindowFor(s.nativeAgent, model));
      // Once the setting is cleared, the record it wrote is already refused by
      // `resolve` — so the placeholder must not go on advertising its number either.
      const discovered = cached?.source === "configured" ? undefined : cached;
      const record = configured === null
        ? discovered
        : configuredContextRecord(configured, cached);
      const automatic = T.settings.budgetAutomatic;
      if (!record) return { input: automatic, output: automatic, contextWindow: automatic };
      const budget = resolveBudget(record, operation, overrides);
      // The budgets are what the next run WILL use, fallback included, so they are
      // reported either way. The window is a claim about the model: a fallback is
      // not one, and this field exists to supply it — see `placeholderContextWindow`.
      const window = placeholderContextWindow(record);
      return {
        input: String(budget.inputBudgetTokens),
        output: String(budget.outputBudgetTokens),
        contextWindow: window === null ? automatic : String(window),
      };
    };
    // The context-window field that sits next to a model field. One per model role
    // that names a model — the global chat model, each per-operation model, and the
    // vision model — because those models can be genuinely different sizes and
    // `ModelContextStore` already keys its record by model.
    const addContextWindowControl = (model: () => string): void => {
      if (!model()) return;
      addSetting(
        T.settings.contextWindowTokens_name,
        T.settings.contextWindowTokens_desc,
        (setting) => {
          addAutomaticBudgetControl(
            setting,
            () => configuredContextWindowFor(s.nativeAgent, model()),
            (next) => { setConfiguredContextWindow(s.nativeAgent, model(), next); },
            () => automaticBudgetPlaceholders(model(), "init", {}).contextWindow,
            MIN_CONTEXT_WINDOW,
          );
        },
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
      updates: { compressionProfile?: (next: CompressionProfile | undefined) => void },
      useGlobalCompression: boolean,
      // Input/output budgets render as automatic undefined-capable fields.
      // `model`/`operation` locate the cached record used only to compute the
      // placeholder text — never to probe. `model` and `current` are read lazily so a
      // repaint after a window or model change sees the settings as they are now.
      automatic: {
        model: () => string;
        operation: OpKey;
        current: () => { input?: number; output?: number };
        updates: {
          inputBudgetTokens?: (next: number | undefined) => void;
          maxTokens?: (next: number | undefined) => void;
        };
      },
    ): void => {
      // One thunk per call (not one per field): both renderers below read the same
      // {input, output} pair rather than each triggering its own resolveBudget.
      const placeholders = () => automaticBudgetPlaceholders(
        automatic.model(),
        automatic.operation,
        automatic.current(),
      );
      renderModelControlFields(fields, {
        inputBudgetTokens: () => {
          const updateInputBudget = automatic.updates.inputBudgetTokens;
          if (!updateInputBudget) return;
          addSetting(
            T.settings.inputBudgetTokens_name,
            T.settings.inputBudgetTokens_descAutomatic,
            (setting) => {
              addAutomaticBudgetControl(
                setting,
                () => automatic.current().input,
                updateInputBudget,
                () => placeholders().input,
              );
            },
          );
        },
        maxTokens: () => {
          const updateMaxTokens = automatic.updates.maxTokens;
          if (!updateMaxTokens) return;
          addSetting(
            T.settings.outputBudgetTokens_name,
            T.settings.outputBudgetTokens_descAutomatic,
            (setting) => {
              addAutomaticBudgetControl(
                setting,
                () => automatic.current().output,
                updateMaxTokens,
                () => placeholders().output,
              );
            },
          );
        },
        compressionProfile: () => {
          const updateCompression = updates.compressionProfile;
          if (!updateCompression) return;
          addSetting(
            T.settings.compressionProfile_name,
            T.settings.compressionProfile_desc,
            (setting) => {
              addCompressionControl(
                setting,
                values.compressionProfile,
                useGlobalCompression,
                updateCompression,
              );
            },
          );
        },
      });
    };

    const busy = this.plugin.controller.running;

    // ── General settings ───────────────────────────────────────────────────
    addGroup(T.settings.h3_general);

    addSetting(T.settings.systemPrompt_name, T.settings.systemPrompt_desc, (setting) => {
      setting.addTextArea((t) => {
        t.inputEl.addClass("ai-wiki-settings-textarea");
        t.setValue(s.systemPrompt)
          .onChange(async (v) => { s.systemPrompt = v; await this.plugin.saveSettings(); });
        return t;
      });
    });

    addSetting(T.settings.outputLanguage_name, T.settings.outputLanguage_desc, (setting) => {
      setting.addDropdown((d) =>
        d.addOptions({ auto: "Auto (match UI language)", ru: "Russian", en: "English", es: "Spanish" })
          .setValue(s.outputLanguage ?? "auto")
          .onChange(async (v) => {
            s.outputLanguage = v as "auto" | "ru" | "en" | "es";
            await this.plugin.saveSettings();
          }),
      );
    });

    addSetting(T.settings.reasoningLanguage_name, T.settings.reasoningLanguage_desc, (setting) => {
      setting.addDropdown((d) =>
        d.addOptions({ auto: "Auto (match response)", en: "English", ru: "Russian", es: "Spanish" })
          .setValue(s.reasoningLanguage ?? "en")
          .onChange(async (v) => {
            s.reasoningLanguage = v as "auto" | "ru" | "en" | "es";
            await this.plugin.saveSettings();
          }),
      );
    });

    addSetting(T.settings.timeouts_name, T.settings.timeouts_desc, (setting) => {
      setting.addText((t) =>
        t.setValue(`${s.timeouts.ingest}/${s.timeouts.query}/${s.timeouts.lint}/${s.timeouts.init}/${s.timeouts.format}`)
          .onChange(async (v) => {
            const parsed = parseTimeoutString(v);
            if (parsed) {
              s.timeouts = { ...s.timeouts, ...parsed };
              await this.plugin.saveSettings();
            }
          }),
      );
    });

    addSetting(T.settings.llmConnectionTimeout_name, T.settings.llmConnectionTimeout_desc, (setting) => {
      setting.addText((t) =>
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
    });

    addSetting(T.settings.llmRequestIdleTimeout_name, T.settings.llmRequestIdleTimeout_desc, (setting) => {
      setting.addText((t) =>
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
    });

    addSetting(T.settings.llmRequestRetries_name, T.settings.llmRequestRetries_desc, (setting) => {
      setting.addText((t) =>
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
    });

    addSetting(T.settings.historyLimit_name, T.settings.historyLimit_desc, (setting) => {
      setting.addText((t) =>
        t.setValue(String(s.historyLimit))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) { s.historyLimit = Math.floor(n); await this.plugin.saveSettings(); }
          }),
      );
    });

    addSetting(T.settings.agentLog_name, T.settings.agentLog_desc, (setting) => {
      setting.addToggle((t) =>
        t.setValue(eff.agentLogEnabled)
          .onChange(async (v) => { await this.patchLocal({ agentLogEnabled: v }); }),
      );
    });

    // ── Domains ───────────────────────────────────────────────────────────────
    addGroup(T.settings.domains_heading);

    if (busy) {
      addSetting(`⚠ ${T.settings.busyBanner}`, undefined, (setting) => {
        setting.settingEl.addClass("ai-wiki-settings-busy-banner");
      });
    }

    const domains = this.cachedDomains;
    if (domains.length === 0) {
      addSetting("", T.settings.domains_empty);
    } else {
      for (let i = 0; i < domains.length; i++) {
        const d = domains[i];
        addSetting(d.name || d.id, d.id, (setting) => {
          setting.addButton((b) => {
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
        });
      }
    }

    // ── OpenAI-compatible settings ─────────────────────────────────────────
    addGroup(T.settings.h3_backendConnection);

      addSetting(T.settings.baseUrl_name, T.settings.baseUrl_desc, (setting) => {
        setting.addText((t) =>
          t.setPlaceholder("")
            .setValue(eff.nativeAgent.baseUrl)
            .onChange(async (v) => { s.nativeAgent.baseUrl = v.trim(); await this.plugin.saveSettings(); }),
        );
      });

      addSetting(T.settings.apiKey_name, T.settings.apiKey_desc, (setting) => {
        setting.addText((t) =>
          t.setPlaceholder("Ollama")
            .setValue(eff.nativeAgent.apiKey)
            .onChange(async (v) => { await this.patchLocalNativeApiKey(v.trim()); }),
        );
      });

      addGroup(T.settings.h3_defaultChatModel);

      const globalBudgetOverrides = (): { input?: number; output?: number } => ({
        input: s.nativeAgent.inputBudgetTokens,
        output: s.nativeAgent.maxTokens,
      });

      if (!s.nativeAgent.perOperation) {
        addSetting(T.settings.model_name, T.settings.model_desc_native, (setting) => {
          return this.addModelControl(
            setting,
            eff.nativeAgent.model,
            async (v) => {
              s.nativeAgent.model = v;
              await this.plugin.saveSettings();
              // The window field below belongs to whichever model this names, so it
              // has to re-read its stored value — not just its placeholder.
              refreshAutomaticControls(true);
            },
            false,
            { tooltip: "Verify the chat model is reachable", run: () => this.checkChatModel() },
          );
        });

        // Native-only, next to the model field it belongs to. Empty means "ask the
        // backend"; a number replaces the discovered window FOR THIS MODEL, and every
        // budget below is derived from it. Needed on backends that answer /v1/models
        // without ever advertising a context length.
        addContextWindowControl(() => s.nativeAgent.model);
      }

      addPolicyControls(
        modelControls.globalFields,
        {
          inputBudgetTokens: s.nativeAgent.inputBudgetTokens,
          maxTokens: s.nativeAgent.maxTokens,
          compressionProfile: s.nativeAgent.compressionProfile,
        },
        {
          compressionProfile: (next) => { s.nativeAgent.compressionProfile = next ?? "balanced"; },
        },
        false,
        {
          // The global fields are the fallback default for every operation, not one
          // operation in particular; "init" (multiplier 1, no format-style x4) is used
          // only to compute a representative placeholder number and never changes what
          // gets stored.
          model: () => s.nativeAgent.model,
          operation: "init",
          current: globalBudgetOverrides,
          updates: {
            inputBudgetTokens: (next) => { s.nativeAgent.inputBudgetTokens = next; },
            maxTokens: (next) => { s.nativeAgent.maxTokens = next; },
          },
        },
      );

      addSetting(
        T.settings.repairInputBudgetTokens_name,
        T.settings.repairInputBudgetTokens_descAutomatic,
        (setting) => {
          addAutomaticBudgetControl(
            setting,
            () => s.nativeAgent.repairInputBudgetTokens,
            (next) => { s.nativeAgent.repairInputBudgetTokens = next; },
            () => automaticBudgetPlaceholders(
              s.nativeAgent.model, "init", globalBudgetOverrides(),
            ).input,
          );
        },
      );

      if (!s.nativeAgent.perOperation) {
        addSetting(T.settings.temperature_name, T.settings.temperature_desc, (setting) => {
          setting.addText((t) =>
            t.setPlaceholder("0.2")
              .setValue(String(eff.nativeAgent.temperature))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n >= 0 && n <= 2) { s.nativeAgent.temperature = n; await this.plugin.saveSettings(); }
              }),
          );
        });
      }

      addSetting(T.settings.structuredRetries_name, T.settings.structuredRetries_desc, (setting) => {
        setting.addText((t) =>
          t.setPlaceholder("1")
            .setValue(String(s.nativeAgent.structuredRetries))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isFinite(n) || n < 0 || n > 3) return;
              s.nativeAgent.structuredRetries = Math.floor(n);
              await this.plugin.saveSettings();
            }),
        );
      });

      addSetting(T.settings.synthesisMaxEntityBatchSize_name, T.settings.synthesisMaxEntityBatchSize_desc, (setting) => {
        setting.addText((t) =>
          t.setPlaceholder("1")
            .setValue(String(s.nativeAgent.synthesisMaxEntityBatchSize ?? 1))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isInteger(n) || n < 1 || n > 10) return;
              s.nativeAgent.synthesisMaxEntityBatchSize = n;
              await this.plugin.saveSettings();
            }),
        );
      });

      addSetting(T.settings.synthesisMaxEntitiesPerSource_name, T.settings.synthesisMaxEntitiesPerSource_desc, (setting) => {
        setting.addText((t) =>
          t.setPlaceholder("6")
            .setValue(String(s.nativeAgent.synthesisMaxEntitiesPerSource ?? 6))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isInteger(n) || n < 1 || n > 50) return;
              s.nativeAgent.synthesisMaxEntitiesPerSource = n;
              await this.plugin.saveSettings();
            }),
        );
      });

      addSetting(T.settings.wikiLinkValidationRetries_name, T.settings.wikiLinkValidationRetries_desc, (setting) => {
        setting.addText((t) =>
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
      });

      if (!Platform.isMobile) {
        addGroup(T.settings.perOperation_name);
        addSetting(T.settings.perOperation_name, T.settings.perOperation_desc, (setting) => {
          setting.addToggle((t) =>
            t.setValue(s.nativeAgent.perOperation)
              .onChange(async (v) => { s.nativeAgent.perOperation = v; await this.plugin.saveSettings(); this.update(); }),
          );
        });
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
          addGroup(label);
          addSetting(T.settings.opModel_name, T.settings.opModel_desc, (setting) => {
            return this.addModelControl(
              setting,
              s.nativeAgent.operations[key].model,
              async (v) => {
                s.nativeAgent.operations[key].model = v;
                await this.plugin.saveSettings();
                refreshAutomaticControls(true);
              },
            );
          });
          addContextWindowControl(() => effectiveModel(s, key));
          addPolicyControls(
            modelControls.operations[key],
            {
              inputBudgetTokens: s.nativeAgent.operations[key].inputBudgetTokens,
              maxTokens: s.nativeAgent.operations[key].maxTokens,
              compressionProfile: s.nativeAgent.operations[key].compressionProfile,
            },
            {
              compressionProfile: (next) => { s.nativeAgent.operations[key].compressionProfile = next; },
            },
            true,
            {
              model: () => effectiveModel(s, key),
              operation: key,
              current: () => ({
                input: s.nativeAgent.operations[key].inputBudgetTokens,
                output: s.nativeAgent.operations[key].maxTokens,
              }),
              updates: {
                inputBudgetTokens: (next) => { s.nativeAgent.operations[key].inputBudgetTokens = next; },
                maxTokens: (next) => { s.nativeAgent.operations[key].maxTokens = next; },
              },
            },
          );
          addSetting(T.settings.opTemperature_name, T.settings.opTemperature_desc, (setting) => {
            setting.addText((t) =>
              t.setValue(String(s.nativeAgent.operations[key].temperature))
                .onChange(async (v) => {
                  const n = Number(v);
                  if (Number.isFinite(n) && n >= 0 && n <= 2) { s.nativeAgent.operations[key].temperature = n; await this.plugin.saveSettings(); }
                }),
            );
          });
        }
      }

      addGroup(T.settings.h3_semanticSearch);

      addSetting("Enable semantic similarity (embeddings)", T.settings.semanticEnable_desc, (setting) => {
        setting.addToggle((t) =>
          t.setValue(s.nativeAgent.embeddingModel !== undefined)
            .onChange(async (v) => {
              if (!v) {
                s.nativeAgent.embeddingModel = undefined; s.nativeAgent.embeddingDimensions = undefined; await this.plugin.saveSettings();
                this.update();
              } else {
                s.nativeAgent.embeddingModel = ""; await this.plugin.saveSettings();
                this.update();
              }
            }),
        );
      });

      if (s.nativeAgent.embeddingModel !== undefined) {
        addSetting("Relevant pages (top-K)", T.settings.relevantTopK_desc, (setting) => {
          setting.addText((t) =>
            t.setPlaceholder("15")
              .setValue(String(s.nativeAgent.relevantPagesTopK ?? 15))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) {
                  s.nativeAgent.relevantPagesTopK = Math.floor(n); await this.plugin.saveSettings();
                }
              }),
          );
        });

        addSetting("Embedding model", T.settings.embeddingModel_desc, (setting) => {
          return this.addModelControl(
            setting,
            s.nativeAgent.embeddingModel ?? "",
            async (v) => {
              s.nativeAgent.embeddingModel = v || undefined;
              await this.plugin.saveSettings();
            },
            false,
            { tooltip: "Verify the embedding model is reachable", run: () => this.checkEmbeddingModel() },
          );
        });

        addSetting("Embedding dimensions", T.settings.embeddingDimensions_desc, (setting) => {
          setting.addButton((b) =>
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
        });

        const chunkField = (
          name: string, desc: string, placeholder: string,
          get: () => number, set: (n: number) => void,
        ): void => {
          addSetting(name, desc, (setting) => {
            setting.addText((t) =>
            t.setPlaceholder(placeholder)
              .setValue(String(get()))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) { set(Math.floor(n)); await this.plugin.saveSettings(); }
              }),
            );
          });
        };

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

      addGroup("Retrieval");
      addGroup(T.settings.reranker_heading);
      addSetting("", T.settings.rerankerFlow_desc);
      addSetting(T.settings.rerankerEnabled_name, T.settings.rerankerEnabled_desc, (setting) => {
        setting.addToggle((t) =>
          t.setValue(s.nativeAgent.rerankerEnabled ?? false)
            .onChange(async (v) => { s.nativeAgent.rerankerEnabled = v; await this.plugin.saveSettings(); }),
        );
      });
      addSetting(T.settings.rerankerModel_name, T.settings.rerankerModel_desc, (setting) => {
        return this.addModelControl(
          setting,
          s.nativeAgent.rerankerModel ?? "",
          async (v) => { s.nativeAgent.rerankerModel = v.trim(); await this.plugin.saveSettings(); },
          true,
          { tooltip: "Verify the reranker model is reachable", run: () => this.checkReranker() },
        );
      });
      addSetting(T.settings.rerankerTopN_name, T.settings.rerankerTopN_desc, (setting) => {
        setting.addText((t) =>
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
              if (next !== requested) this.update();
            }),
        );
      });
      addSetting(T.settings.contextTopN_name, T.settings.contextTopN_desc, (setting) => {
        setting.addText((t) =>
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
                this.update();
                return;
              }
              await this.plugin.saveSettings();
              if (next !== requested) this.update();
            }),
        );
      });
      addSetting(T.settings.rerankerTimeoutMs_name, T.settings.rerankerTimeoutMs_desc, (setting) => {
        setting.addText((t) =>
          t.setPlaceholder("800")
            .setValue(String(s.nativeAgent.rerankerTimeoutMs ?? 800))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              const requested = Math.floor(n);
              const next = Math.max(100, Math.min(5000, requested));
              s.nativeAgent.rerankerTimeoutMs = next;
              await this.plugin.saveSettings();
              if (next !== requested) this.update();
            }),
        );
      });

      if (s.nativeAgent.embeddingModel !== undefined) {
        addSetting("Hybrid retrieval (dense ⊕ sparse)", T.settings.hybridRetrieval_desc, (setting) => {
          setting.addToggle((t) =>
            t.setValue(s.nativeAgent.hybridRetrieval ?? false)
              .onChange(async (v) => { s.nativeAgent.hybridRetrieval = v; await this.plugin.saveSettings(); }),
          );
        });
        addSetting("RRF k", T.settings.rrfK_desc, (setting) => {
          setting.addText((t) =>
            t.setValue(String(s.nativeAgent.rrfK ?? 60))
              .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) { s.nativeAgent.rrfK = Math.floor(n); await this.plugin.saveSettings(); } }),
          );
        });
        addSetting("BFS fusion (vector ⊕ graph)", T.settings.bfsFusion_desc, (setting) => {
          setting.addToggle((t) =>
            t.setValue(s.nativeAgent.bfsFusion ?? false)
              .onChange(async (v) => { s.nativeAgent.bfsFusion = v; await this.plugin.saveSettings(); }),
          );
        });
        addSetting("Graph relevance floor (ratio)", T.settings.bfsMinScoreRatio_desc, (setting) => {
          setting.addSlider((sl) =>
            sl.setLimits(0, 1, 0.05)
              .setDynamicTooltip()
              .setValue(s.nativeAgent.bfsMinScoreRatio ?? 0.6)
              .onChange(async (v) => { s.nativeAgent.bfsMinScoreRatio = v; await this.plugin.saveSettings(); }),
          );
        });
        addSetting("Seed similarity threshold", T.settings.seedSimilarityThreshold_desc, (setting) => {
          setting.addText((t) =>
            t.setValue(String(s.nativeAgent.seedSimilarityThreshold ?? 0))
              .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) { s.nativeAgent.seedSimilarityThreshold = n; await this.plugin.saveSettings(); } }),
          );
        });

        if (!Platform.isMobile) {
          addGroup("Graph health");
          addSetting("Dedup on ingest", T.settings.dedupOnIngest_desc, (setting) => {
            setting.addToggle((t) =>
              t.setValue(s.nativeAgent.dedupOnIngest ?? false)
                .onChange(async (v) => { s.nativeAgent.dedupOnIngest = v; await this.plugin.saveSettings(); }),
            );
          });
          addSetting("Dedup threshold", T.settings.dedupThreshold_desc, (setting) => {
            setting.addText((t) =>
              t.setValue(String(s.nativeAgent.dedupThreshold ?? 0.85))
                .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0 && n <= 1) { s.nativeAgent.dedupThreshold = n; await this.plugin.saveSettings(); } }),
            );
          });
          addSetting("Lint near-duplicate report", T.settings.lintNearDuplicate_desc, (setting) => {
            setting.addToggle((t) =>
              t.setValue(s.nativeAgent.lintNearDuplicate ?? false)
                .onChange(async (v) => { s.nativeAgent.lintNearDuplicate = v; await this.plugin.saveSettings(); }),
            );
          });
          addSetting("Near-duplicate threshold", T.settings.nearDupThreshold_desc, (setting) => {
            setting.addText((t) =>
              t.setValue(String(s.nativeAgent.nearDupThreshold ?? 0.80))
                .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0 && n <= 1) { s.nativeAgent.nearDupThreshold = n; await this.plugin.saveSettings(); } }),
            );
          });

          addSetting(T.settings.mergeDeleteWarnThreshold_name, T.settings.mergeDeleteWarnThreshold_desc, (setting) => {
            setting.addSlider((sl) =>
              sl.setLimits(1, 20, 1)
                .setDynamicTooltip()
                .setValue(s.nativeAgent.mergeDeleteWarnThreshold ?? 5)
                .onChange(async (v) => {
                  s.nativeAgent.mergeDeleteWarnThreshold = v; await this.plugin.saveSettings();
                }),
            );
          });
        }
      }

    // ── Vision settings ─────────────────────────────────────────────────────
    addGroup(T.settings.h3_vision);

    addSetting(T.settings.visionEnable_name, T.settings.visionEnable_desc, (setting) => {
      setting.addToggle((t) =>
        t.setValue(s.vision.enabled)
          .onChange(async (v) => {
            s.vision.enabled = v;
            await this.plugin.saveSettings();
            this.update();
          }),
      );
    });

    if (s.vision.enabled) {
      addSetting(T.settings.visionModel_name, T.settings.visionModel_desc, (setting) => {
        return this.addModelControl(
          setting,
          s.vision.model,
          async (v) => {
            s.vision.model = v;
            await this.plugin.saveSettings();
            this.update();
          },
          false,
          { tooltip: T.settings.visionCheck_tooltip, run: (model) => this.checkVisionModel(model) },
        );
      });

      // Vision runs a model of its own, usually a far smaller one than the chat
      // model, and it now resolves a context record of its own too.
      addContextWindowControl(() => s.vision.model);
    }

    // ── Graph settings ────────────────────────────────────────────────────────
    addGroup(T.settings.h3_graph);

    addSetting(T.settings.graphDepth_name, T.settings.graphDepth_desc, (setting) => {
      setting.addText((t) =>
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
    });

    addSetting(T.settings.bfsTopK_name, T.settings.bfsTopK_desc, (setting) => {
      setting.addText((t) =>
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
    });

    // ── Jaccard (keyword scoring) ─────────────────────────────────────────────
    addGroup(T.settings.h3_jaccard);

    addSetting(T.settings.seedTopK_name, T.settings.seedTopK_desc, (setting) => {
      setting.addText((t) =>
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
    });

    addSetting(T.settings.seedMinScore_name, T.settings.seedMinScore_desc, (setting) => {
      setting.addText((t) =>
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
    });

    // ── Proxy ─────────────────────────────────────────────────────────────────
    if (!Platform.isMobile) {
      const proxy = eff.proxy;
      addGroup(T.settings.proxy_h3);

      addSetting(T.settings.proxy_enabled_name, T.settings.proxy_enabled_desc, (setting) => {
        setting.addToggle((t) =>
          t.setValue(proxy.enabled)
            .onChange(async (v) => { await this.patchProxy({ enabled: v }); this.update(); }),
        );
      });

      if (proxy.enabled) {
        addSetting(T.settings.proxy_url_name, T.settings.proxy_url_desc, (setting) => {
          setting.addText((t) =>
            t.setPlaceholder("http://proxy.example.com:8080")
              .setValue(proxy.url)
              .onChange(async (v) => { await this.patchProxy({ url: v.trim() }); }),
          );
        });

        addSetting(T.settings.proxy_username_name, T.settings.proxy_username_desc, (setting) => {
          setting.addText((t) =>
            t.setValue(proxy.username ?? "")
              .onChange(async (v) => { await this.patchProxy({ username: v }); }),
          );
        });

        addSetting(T.settings.proxy_password_name, T.settings.proxy_password_desc, (setting) => {
          setting.addText((t) => {
            t.setValue(proxy.password ?? "")
              .onChange(async (v) => { await this.patchLocalProxyPassword(v); });
            t.inputEl.type = "password";
          });
        });

        addSetting(T.settings.proxy_noProxy_name, T.settings.proxy_noProxy_desc, (setting) => {
          setting.addText((t) =>
            t.setPlaceholder("localhost,127.0.0.1")
              .setValue(proxy.noProxy ?? "")
              .onChange(async (v) => { await this.patchProxy({ noProxy: v.trim() }); }),
          );
        });

        addSetting("", T.settings.proxy_hint);
      }
    }

    // ── Dev mode ──────────────────────────────────────────────────────────────
    if (!Platform.isMobile) {
      addGroup(T.settings.h3_devmode);

      addSetting(T.settings.devMode_enabled_name, T.settings.devMode_enabled_desc, (setting) => {
        setting.addToggle((t) =>
          t.setValue(s.devMode.enabled)
            .onChange(async (v) => { s.devMode.enabled = v; await this.plugin.saveSettings(); }),
        );
      });
    }
    return definitions;
  }
}
