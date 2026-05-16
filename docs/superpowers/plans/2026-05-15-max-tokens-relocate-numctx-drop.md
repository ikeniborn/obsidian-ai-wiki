---
review:
  plan_hash: 63a992bb71cc8120
  spec_hash: 2b94558aab9d2a75
  last_run: 2026-05-15
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---

# max_tokens Relocate + numCtx Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `maxTokens` from top-level `LlmWikiPluginSettings.maxTokens` to `nativeAgent.maxTokens` (native-only); remove `numCtx` entirely (ignored by Ollama OpenAI route).

**Architecture:** Schema v3 migration. `data.json` migrated on load: legacy `s.maxTokens` (or `claudeAgent.maxTokens` / `nativeAgent.maxTokens` legacy) → `nativeAgent.maxTokens`. `numCtx` silently dropped from `data.json` and `local.json`. UI moves "Max tokens" field from General section to Backend section under "Model" (native, non-perOperation). `numCtx` UI removed. i18n keys `numCtx_*` removed from en/ru/es. `LlmCallOptions.numCtx` and `params.num_ctx` plumbing removed.

**Tech Stack:** TypeScript, Obsidian Plugin API, esbuild, vitest.

---

## File Map

- **Modify** `src/types.ts` — drop `LlmWikiPluginSettings.maxTokens`, drop `nativeAgent.numCtx`, add `nativeAgent.maxTokens`, drop `LlmCallOptions.numCtx`; update `DEFAULT_SETTINGS`.
- **Modify** `src/local-config.ts` — drop `LocalConfig.nativeAgent.numCtx`; silent cleanup in `load()`.
- **Modify** `src/phases/llm-utils.ts` — drop `num_ctx` plumbing in `buildChatParams`.
- **Modify** `src/agent-runner.ts` — `buildOptsFor` reads `na.maxTokens`, drops `numCtx`.
- **Modify** `src/i18n.ts` — remove `numCtx_name`/`numCtx_desc` from en/ru/es.
- **Modify** `src/settings.ts` — remove General `maxTokens` block, remove `numCtx` UI block, remove `numCtx` from `patchLocalNative` fallback, add new `Max tokens` Setting after "Model" in native non-perOperation branch.
- **Modify** `src/main.ts` — replace v2 maxTokens migration with v3 (top-level → `nativeAgent.maxTokens`); drop `numCtx` from `migrateToLocalV1`; silent drop `nativeAgent.numCtx` field from data.json.
- **Modify** `tests/effective-settings.test.ts` — drop `numCtx` from sample nativeAgent override.
- **Modify** `tests/main-migration.test.ts` — drop `numCtx` from `migrateToLocalV1` test fixture.
- **Create** `tests/max-tokens-migration.test.ts` — new vitest covering schema v3 migration.
- **Modify** `package.json`, `src/manifest.json` — bump 0.1.99 → 0.1.100.

---

## Task 1: Update Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Edit `LlmCallOptions` — drop `numCtx`**

In `src/types.ts:79-87`, replace:

```ts
export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  numCtx?: number | null;
  jsonMode?: "json_object" | false;
  structuredRetries?: number;
}
```

with:

```ts
export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  jsonMode?: "json_object" | false;
  structuredRetries?: number;
}
```

- [ ] **Step 2: Edit `LlmWikiPluginSettings` — drop top-level `maxTokens`, drop `nativeAgent.numCtx`, add `nativeAgent.maxTokens`**

In `src/types.ts:118-155`, replace:

```ts
export interface LlmWikiPluginSettings {
  backend: "claude-agent" | "native-agent";
  systemPrompt: string;
  maxTokens: number;
  agentLogEnabled: boolean;
  historyLimit: number;
  graphDepth: number;
  hubThreshold: number;
  timeouts: {
    ingest: number;
    query: number;
    lint: number;
    init: number;
    format: number;
  };
  history: RunHistoryEntry[];
  claudeAgent: {
    model: string;
    allowedTools: string;
    perOperation: boolean;
    operations: OpMap<ClaudeOperationConfig>;
  };
  nativeAgent: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
    numCtx: number | null;
    perOperation: boolean;
    operations: OpMap<NativeOperationConfig>;
    structuredRetries: number;
  };
  devMode: {
    enabled: boolean;
    evaluatorModel: string;
  };
}
```

with:

```ts
export interface LlmWikiPluginSettings {
  backend: "claude-agent" | "native-agent";
  systemPrompt: string;
  agentLogEnabled: boolean;
  historyLimit: number;
  graphDepth: number;
  hubThreshold: number;
  timeouts: {
    ingest: number;
    query: number;
    lint: number;
    init: number;
    format: number;
  };
  history: RunHistoryEntry[];
  claudeAgent: {
    model: string;
    allowedTools: string;
    perOperation: boolean;
    operations: OpMap<ClaudeOperationConfig>;
  };
  nativeAgent: {
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
    topP: number | null;
    perOperation: boolean;
    operations: OpMap<NativeOperationConfig>;
    structuredRetries: number;
  };
  devMode: {
    enabled: boolean;
    evaluatorModel: string;
  };
}
```

- [ ] **Step 3: Edit `DEFAULT_SETTINGS` — drop top-level `maxTokens: 4096`, drop `nativeAgent.numCtx: null`, add `nativeAgent.maxTokens: 4096`**

In `src/types.ts:157-200`, replace with:

```ts
export const DEFAULT_SETTINGS: LlmWikiPluginSettings = {
  backend: "claude-agent",
  systemPrompt: "",
  agentLogEnabled: false,
  historyLimit: 20,
  graphDepth: 1,
  hubThreshold: 20,
  timeouts: { ingest: 300, query: 300, lint: 900, init: 3600, format: 600 },
  history: [],
  claudeAgent: {
    model: "sonnet",
    allowedTools: "",
    perOperation: false,
    operations: {
      ingest: { model: "haiku" },
      query:  { model: "sonnet" },
      lint:   { model: "sonnet" },
      init:   { model: "sonnet" },
      format: { model: "sonnet" },
    },
  },
  nativeAgent: {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "llama3.2",
    maxTokens: 4096,
    temperature: 0.2,
    topP: null,
    perOperation: false,
    operations: {
      ingest: { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
      query:  { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
      lint:   { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
      init:   { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
      format: { model: "llama3.2", maxTokens: 32768, temperature: 0.2 },
    },
    structuredRetries: 1,
  },
  devMode: {
    enabled: false,
    evaluatorModel: "sonnet",
  },
};
```

- [ ] **Step 4: Verify TypeScript compiles (will fail — expected, fix in later tasks)**

Run: `npx tsc --noEmit`
Expected: errors in `src/agent-runner.ts` (refs `s.maxTokens`, `na.numCtx`, `opts.numCtx`), `src/phases/llm-utils.ts` (`opts.numCtx`), `src/settings.ts` (`s.maxTokens`, `nativeAgent.numCtx`, `T.settings.numCtx_*`), `src/main.ts` (`this.settings.maxTokens`, `s.nativeAgent.numCtx`), `src/local-config.ts` (`numCtx: number | null`).
This is expected — types are now ahead of impl. Subsequent tasks fix each callsite.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "refactor(types): move maxTokens to nativeAgent, drop numCtx (schema v3)"
```

---

## Task 2: Update local-config

**Files:**
- Modify: `src/local-config.ts`

- [ ] **Step 1: Drop `numCtx` from `LocalConfig.nativeAgent` type**

In `src/local-config.ts:19-26`, replace:

```ts
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
    numCtx: number | null;
  };
```

with:

```ts
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
  };
```

- [ ] **Step 2: Silent cleanup of legacy `numCtx` in `load()`**

In `src/local-config.ts:44-59`, replace method body:

```ts
  async load(): Promise<LocalConfig> {
    if (this.cache) return this.cache;
    const adapter = this.plugin.app.vault.adapter;
    const p = this.path();
    if (!(await adapter.exists(p))) {
      this.cache = { ...DEFAULTS };
      return this.cache;
    }
    try {
      const raw = await adapter.read(p);
      const parsed = JSON.parse(raw) as Partial<LocalConfig> & { nativeAgent?: Record<string, unknown> };
      if (parsed.nativeAgent && "numCtx" in parsed.nativeAgent) {
        const na = { ...parsed.nativeAgent };
        delete na.numCtx;
        parsed.nativeAgent = na as LocalConfig["nativeAgent"];
      }
      this.cache = { ...DEFAULTS, ...parsed };
    } catch {
      this.cache = { ...DEFAULTS };
    }
    return this.cache;
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/local-config.ts
git commit -m "refactor(local-config): drop nativeAgent.numCtx, silent cleanup on load"
```

---

## Task 3: Update llm-utils — drop num_ctx plumbing

**Files:**
- Modify: `src/phases/llm-utils.ts`

- [ ] **Step 1: Remove `num_ctx` line in `buildChatParams`**

In `src/phases/llm-utils.ts:64`, delete:

```ts
  if (opts.numCtx != null) params.num_ctx = opts.numCtx;
```

Resulting block (lines 60-65):

```ts
  const params: Record<string, unknown> = { model, messages: msgs };
  if (opts.temperature !== undefined) params.temperature = opts.temperature;
  if (opts.maxTokens != null) params.max_tokens = opts.maxTokens;
  if (opts.topP != null) params.top_p = opts.topP;
  if (stream) params.stream_options = { include_usage: true };
```

- [ ] **Step 2: Commit**

```bash
git add src/phases/llm-utils.ts
git commit -m "refactor(llm-utils): drop num_ctx param (Ollama OpenAI route ignores it)"
```

---

## Task 4: Update agent-runner — use nativeAgent.maxTokens

**Files:**
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Rewrite `buildOptsFor` native branch**

In `src/agent-runner.ts:38-41`, replace:

```ts
    const na = s.nativeAgent;
    const c = na.perOperation ? na.operations[key] : undefined;
    if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
    return { model: na.model, opts: { maxTokens: s.maxTokens, temperature: na.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
```

with:

```ts
    const na = s.nativeAgent;
    const c = na.perOperation ? na.operations[key] : undefined;
    if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
    return { model: na.model, opts: { maxTokens: na.maxTokens, temperature: na.temperature, topP: na.topP, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
```

- [ ] **Step 2: Commit**

```bash
git add src/agent-runner.ts
git commit -m "refactor(agent-runner): read maxTokens from nativeAgent, drop numCtx"
```

---

## Task 5: Remove numCtx i18n keys

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: Delete `numCtx_name`/`numCtx_desc` from en locale**

In `src/i18n.ts:41-42`, delete these two lines:

```ts
    numCtx_name: "Context window",
    numCtx_desc: "Context size (num_ctx). Empty — model default.",
```

- [ ] **Step 2: Delete `numCtx_name`/`numCtx_desc` from ru locale**

In `src/i18n.ts:245-246`, delete:

```ts
    numCtx_name: "Контекстное окно",
    numCtx_desc: "Размер контекста (num_ctx). Пусто — дефолт модели.",
```

- [ ] **Step 3: Delete `numCtx_name`/`numCtx_desc` from es locale**

In `src/i18n.ts:447-448`, delete:

```ts
    numCtx_name: "Ventana de contexto",
    numCtx_desc: "Tamaño del contexto (num_ctx). Vacío — valor por defecto del modelo.",
```

- [ ] **Step 4: Verify no stale numCtx refs**

Run: `grep -n "numCtx" src/i18n.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "i18n: remove numCtx keys from en/ru/es"
```

---

## Task 6: Update settings UI

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Remove `numCtx` from `patchLocalNative` fallback object**

In `src/settings.ts:46-56`, replace:

```ts
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
```

with:

```ts
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
```

- [ ] **Step 2: Remove General `maxTokens` block**

In `src/settings.ts:99-112`, delete the entire block:

```ts
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
```

(The General section now goes directly from `systemPrompt` Setting to `timeouts` Setting.)

- [ ] **Step 3: Remove `numCtx` UI block**

In `src/settings.ts:307-319`, delete:

```ts
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
```

- [ ] **Step 4: Add `Max tokens` Setting after `Model` in native non-perOperation branch**

In `src/settings.ts` (in the `!s.nativeAgent.perOperation` block, immediately after the `Model` Setting that ends with `.onChange(async (v) => { await this.patchLocalNative({ model: v.trim() }); }),` followed by `);`), insert:

```ts
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
```

This insertion takes the place vacated by the deleted `numCtx` block (Step 3), so the resulting order in the native non-perOperation branch is: `Model` → `Max tokens` → `Temperature`.

- [ ] **Step 5: Verify TypeScript compiles for settings.ts**

Run: `npx tsc --noEmit`
Expected: errors in `src/main.ts` only (tasks 7+ pending). No errors in `settings.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts
git commit -m "ui(settings): move maxTokens under native Model, drop numCtx UI"
```

---

## Task 7: Schema v3 migration in main.ts

**Files:**
- Test: `tests/max-tokens-migration.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write failing test — `tests/max-tokens-migration.test.ts`**

Create file with:

```ts
import { describe, it, expect, vi } from "vitest";
import LlmWikiPlugin from "../src/main";

function makePlugin(loaded: Record<string, unknown> | null): LlmWikiPlugin {
  const p = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
  (p as unknown as { loadData: () => Promise<unknown> }).loadData = vi.fn().mockResolvedValue(loaded);
  (p as unknown as { saveData: (d: unknown) => Promise<void> }).saveData = vi.fn().mockResolvedValue(undefined);
  return p;
}

describe("schema v3 migration: maxTokens + numCtx", () => {
  it("migrates top-level maxTokens to nativeAgent.maxTokens", async () => {
    const p = makePlugin({ maxTokens: 8192 });
    await p.loadSettings();
    expect(p.settings.nativeAgent.maxTokens).toBe(8192);
    expect((p.settings as unknown as Record<string, unknown>).maxTokens).toBeUndefined();
  });

  it("migrates legacy claudeAgent.maxTokens to nativeAgent.maxTokens when top-level absent", async () => {
    const p = makePlugin({ claudeAgent: { maxTokens: 12000 } });
    await p.loadSettings();
    expect(p.settings.nativeAgent.maxTokens).toBe(12000);
  });

  it("drops nativeAgent.numCtx from data.json", async () => {
    const p = makePlugin({ nativeAgent: { numCtx: 16384, baseUrl: "x" } });
    await p.loadSettings();
    expect((p.settings.nativeAgent as Record<string, unknown>).numCtx).toBeUndefined();
  });

  it("uses default nativeAgent.maxTokens when no legacy data", async () => {
    const p = makePlugin({});
    await p.loadSettings();
    expect(p.settings.nativeAgent.maxTokens).toBe(4096);
  });

  it("preserves existing nativeAgent.maxTokens over legacy top-level", async () => {
    const p = makePlugin({ maxTokens: 8192, nativeAgent: { maxTokens: 10000 } });
    await p.loadSettings();
    expect(p.settings.nativeAgent.maxTokens).toBe(10000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/max-tokens-migration.test.ts`
Expected: FAIL (migration not yet present; top-level `maxTokens` persists or `nativeAgent.maxTokens` stays at default).

- [ ] **Step 3: Replace v2 migration with v3 in `loadSettings`**

In `src/main.ts`, find the v2 block (lines 172-176):

```ts
    // Миграция: поля, перенесённые с per-backend уровня на top-level (schema v2)
    if (!data?.systemPrompt && (caData.systemPrompt || naData.systemPrompt))
      this.settings.systemPrompt = (caData.systemPrompt ?? naData.systemPrompt) as string;
    if (!data?.maxTokens && (caData.maxTokens || naData.maxTokens))
      this.settings.maxTokens = (caData.maxTokens ?? naData.maxTokens) as number;
```

Replace with:

```ts
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
```

Then, at the very end of `loadSettings` (after the existing `if (formatMaxTokensMigrated || claudeCleanup) await this.saveData(this.settings);` line), change that line to also include `schemaV3Dirty`:

Replace `src/main.ts:231`:

```ts
    if (formatMaxTokensMigrated || claudeCleanup) await this.saveData(this.settings);
```

with:

```ts
    if (formatMaxTokensMigrated || claudeCleanup || schemaV3Dirty) await this.saveData(this.settings);
```

- [ ] **Step 4: Update `migrateToLocalV1` — drop `numCtx`**

In `src/main.ts:292-301`, replace:

```ts
    nativeAgent: {
      baseUrl: s.nativeAgent.baseUrl,
      apiKey: s.nativeAgent.apiKey,
      model: s.nativeAgent.model,
      temperature: s.nativeAgent.temperature,
      topP: s.nativeAgent.topP,
      numCtx: s.nativeAgent.numCtx,
    },
```

with:

```ts
    nativeAgent: {
      baseUrl: s.nativeAgent.baseUrl,
      apiKey: s.nativeAgent.apiKey,
      model: s.nativeAgent.model,
      temperature: s.nativeAgent.temperature,
      topP: s.nativeAgent.topP,
    },
```

- [ ] **Step 5: Run new test to verify it passes**

Run: `npx vitest run tests/max-tokens-migration.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 6: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts tests/max-tokens-migration.test.ts
git commit -m "feat(migration): schema v3 — relocate maxTokens to nativeAgent, drop numCtx"
```

---

## Task 8: Update existing tests

**Files:**
- Modify: `tests/effective-settings.test.ts`
- Modify: `tests/main-migration.test.ts`

- [ ] **Step 1: Drop `numCtx` from `effective-settings.test.ts` fixture**

In `tests/effective-settings.test.ts:18-27`, replace:

```ts
    const eff = resolveEffective(DEFAULT_SETTINGS, {
      iclaudePath: "",
      nativeAgent: {
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "m",
        temperature: 0.5,
        topP: null,
        numCtx: null,
      },
    });
```

with:

```ts
    const eff = resolveEffective(DEFAULT_SETTINGS, {
      iclaudePath: "",
      nativeAgent: {
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "m",
        temperature: 0.5,
        topP: null,
      },
    });
```

- [ ] **Step 2: Drop `numCtx` from `main-migration.test.ts` fixture**

In `tests/main-migration.test.ts:135`, replace:

```ts
          temperature: 0.2, topP: null, numCtx: null,
```

with:

```ts
          temperature: 0.2, topP: null,
```

- [ ] **Step 3: Run full vitest suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/effective-settings.test.ts tests/main-migration.test.ts
git commit -m "test: drop numCtx from existing fixtures"
```

---

## Task 9: Version bump + build

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`

- [ ] **Step 1: Bump patch version in `package.json`**

Read `package.json` `version` field. Replace `"version": "0.1.99"` with `"version": "0.1.100"`.

- [ ] **Step 2: Bump patch version in `src/manifest.json`**

Replace `"version": "0.1.99"` with `"version": "0.1.100"`.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: `main.js` produced, no esbuild errors.

- [ ] **Step 4: Run full test suite for regression check**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Verify no stale references remain**

Run: `grep -rn "numCtx\|num_ctx" src/ tests/`
Expected: no output.

Run: `grep -rn "s\.maxTokens\|settings\.maxTokens" src/`
Expected: no output (only `nativeAgent.maxTokens` and `operations[k].maxTokens` should remain).

- [ ] **Step 6: Commit**

```bash
git add package.json src/manifest.json main.js
git commit -m "chore: bump version to 0.1.100, build"
```

---

## Final Verification Checklist

After all tasks:

- [ ] `npm run build` — green
- [ ] `npm test` — all green
- [ ] `npx tsc --noEmit` — no errors
- [ ] `grep -rn "numCtx\|num_ctx" src/ tests/` — empty
- [ ] `grep -rn "s\.maxTokens" src/` — empty
- [ ] Manual UI smoke (Obsidian dev vault):
  - `data.json` with `maxTokens: 8192` top-level → after load: `nativeAgent.maxTokens === 8192`, top-level absent
  - `data.json` with `nativeAgent.numCtx: 16384` → after load: field removed
  - UI: `backend=native`, `perOperation=false` → "Max tokens" appears under "Model"
  - UI: `backend=claude` → no "Max tokens" field anywhere
  - UI: no "Context window" / `numCtx` field
  - Runtime: native request → `params.max_tokens` present, `params.num_ctx` absent
