---
review:
  plan_hash: de1270bb944ba7ea
  spec_hash: 1fd4b91ce7156322
  last_run: 2026-05-24
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
  section_hashes:
    "### Task 1": fc38c452b1786925
    "### Task 2": 814aaf9d1e653463
    "### Task 3": c8edd134a02efd97
    "### Task 4": b7636bbc21cfb2f3
---

# History Re-run & Last Domain Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ↺ re-run button to query history rows, and persist/restore the last selected domain across sessions via `local.json`.

**Architecture:** Two independent UI features in `src/view.ts`. Feature 33 also touches `src/local-config.ts` to extend `LocalConfig`. No new files, no new methods — both features are additive changes to existing methods.

**Tech Stack:** TypeScript, Obsidian Plugin API, Vitest

---

## File Map

| File | Change |
|---|---|
| `src/local-config.ts` | Add `lastDomain?: string` to `LocalConfig` interface |
| `src/view.ts` | `renderHistory()`: add ↺ button; `buildDomainRow()`: add save listener; `refreshDomains()`: add restore logic |
| `tests/local-config.test.ts` | Add test for `lastDomain` field |
| `tests/view-history-rerun.test.ts` | New: tests for ↺ button behavior |
| `tests/view-last-domain.test.ts` | New: tests for save/restore domain |

---

### Task 1: Add `lastDomain` to `LocalConfig`

**Files:**
- Modify: `src/local-config.ts:11-30`
- Modify: `tests/local-config.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/local-config.test.ts` inside the existing `describe("LocalConfigStore", ...)` block:

```typescript
it("save persists lastDomain and load returns it", async () => {
  const adapter = {
    exists: vi.fn().mockResolvedValue(false),
    read: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
  };
  const store = new LocalConfigStore(makePlugin(adapter));
  await store.save({ lastDomain: "ai" });
  expect((await store.load()).lastDomain).toBe("ai");
});

it("lastDomain defaults to undefined when not in file", async () => {
  const adapter = {
    exists: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockResolvedValue(JSON.stringify({ iclaudePath: "/bin/iclaude.sh" })),
    write: vi.fn(),
  };
  const store = new LocalConfigStore(makePlugin(adapter));
  expect((await store.load()).lastDomain).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/local-config.test.ts
```

Expected: FAIL — TypeScript error: `lastDomain` does not exist on `LocalConfig`.

- [ ] **Step 3: Add field to `LocalConfig`**

In `src/local-config.ts`, change line 29 (`migrated_v1?: boolean;`) area:

```typescript
export interface LocalConfig {
  iclaudePath: string;
  backend?: "claude-agent" | "native-agent";
  agentLogEnabled?: boolean;
  claudeAgent?: {
    model: string;
    allowedTools: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
  };
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
  };
  proxy?: ProxyConfig;
  migrated_v1?: boolean;
  shellConsentGiven?: boolean;
  lastDomain?: string;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/local-config.test.ts
```

Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add src/local-config.ts tests/local-config.test.ts
git commit -m "feat(local-config): add lastDomain field to LocalConfig"
```

---

### Task 2: Re-run button in `renderHistory()`

**Files:**
- Modify: `src/view.ts:1018-1032` (inside `renderHistory()`)
- Create: `tests/view-history-rerun.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/view-history-rerun.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { LlmWikiView } from "../src/view";
import type LlmWikiPlugin from "../src/main";

function makeView() {
  const plugin = {
    controller: {
      loadDomains: vi.fn().mockResolvedValue([]),
      isBusy: vi.fn().mockReturnValue(false),
      currentOp: null,
    },
    localConfigStore: {
      load: vi.fn().mockResolvedValue({ iclaudePath: "" }),
      save: vi.fn().mockResolvedValue(undefined),
    },
    settings: { history: [], historyLimit: 20 },
    app: {},
  } as unknown as LlmWikiPlugin;
  const leaf = { view: null } as any;
  return new LlmWikiView(leaf, plugin);
}

function makeRow() {
  const listeners: Array<[string, EventListener]> = [];
  const els: Array<{ tag: string; opts: any; el: any }> = [];
  const row: any = {
    createSpan: vi.fn(() => ({ setText: vi.fn() })),
    createEl: vi.fn((tag: string, opts?: any) => {
      const el: any = {
        addEventListener: vi.fn((evt: string, cb: EventListener) => listeners.push([`btn:${evt}`, cb])),
      };
      els.push({ tag, opts, el });
      return el;
    }),
    addEventListener: vi.fn((evt: string, cb: EventListener) => listeners.push([`row:${evt}`, cb])),
  };
  return { row, listeners, els };
}

const queryItem = {
  id: "1", operation: "query" as const, args: ["test query"],
  domainId: "ai", startedAt: 0, finishedAt: 100,
  status: "done" as const, finalText: "answer", steps: [],
};

const ingestItem = {
  id: "2", operation: "ingest" as const, args: ["/some/path"],
  domainId: "ai", startedAt: 0, finishedAt: 100,
  status: "done" as const, finalText: "", steps: [],
};

describe("renderHistory — rerun button", () => {
  it("adds ↺ button for query items", () => {
    const v = makeView();
    (v as any).plugin.settings.history = [queryItem];

    const { row, els } = makeRow();
    (v as any).historyEl = { empty: vi.fn(), createDiv: vi.fn(() => row) };
    (v as any).historySection = { removeClass: vi.fn(), addClass: vi.fn() };

    (v as any).renderHistory();

    const rerunBtn = els.find((e) => e.opts?.text === "↺");
    expect(rerunBtn).toBeDefined();
  });

  it("does NOT add ↺ button for non-query items", () => {
    const v = makeView();
    (v as any).plugin.settings.history = [ingestItem];

    const { row, els } = makeRow();
    (v as any).historyEl = { empty: vi.fn(), createDiv: vi.fn(() => row) };
    (v as any).historySection = { removeClass: vi.fn(), addClass: vi.fn() };

    (v as any).renderHistory();

    const rerunBtn = els.find((e) => e.opts?.text === "↺");
    expect(rerunBtn).toBeUndefined();
  });

  it("↺ click sets domainSelect.value, dispatches change, sets queryInput.value, calls submitQuery", () => {
    const v = makeView();
    (v as any).plugin.settings.history = [queryItem];

    const domainSelect = { value: "", dispatchEvent: vi.fn() };
    const queryInput = { value: "" };
    (v as any).domainSelect = domainSelect;
    (v as any).queryInput = queryInput;
    const submitQuery = vi.spyOn(v as any, "submitQuery").mockImplementation(() => {});

    const { row, listeners } = makeRow();
    (v as any).historyEl = { empty: vi.fn(), createDiv: vi.fn(() => row) };
    (v as any).historySection = { removeClass: vi.fn(), addClass: vi.fn() };

    (v as any).renderHistory();

    const btnClick = listeners.find(([evt]) => evt === "btn:click");
    expect(btnClick).toBeDefined();
    const fakeEvent = { stopPropagation: vi.fn() };
    btnClick![1](fakeEvent as any);

    expect(fakeEvent.stopPropagation).toHaveBeenCalled();
    expect(domainSelect.value).toBe("ai");
    expect(domainSelect.dispatchEvent).toHaveBeenCalledWith(expect.any(Object));
    expect(queryInput.value).toBe("test query");
    expect(submitQuery).toHaveBeenCalled();
  });

  it("↺ click uses empty string when domainId is undefined", () => {
    const v = makeView();
    const itemNoDomain = { ...queryItem, domainId: undefined };
    (v as any).plugin.settings.history = [itemNoDomain];

    const domainSelect = { value: "prev", dispatchEvent: vi.fn() };
    (v as any).domainSelect = domainSelect;
    (v as any).queryInput = { value: "" };
    vi.spyOn(v as any, "submitQuery").mockImplementation(() => {});

    const { row, listeners } = makeRow();
    (v as any).historyEl = { empty: vi.fn(), createDiv: vi.fn(() => row) };
    (v as any).historySection = { removeClass: vi.fn(), addClass: vi.fn() };

    (v as any).renderHistory();

    const btnClick = listeners.find(([evt]) => evt === "btn:click");
    btnClick![1]({ stopPropagation: vi.fn() } as any);

    expect(domainSelect.value).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/view-history-rerun.test.ts
```

Expected: FAIL — no ↺ button created yet.

- [ ] **Step 3: Add ↺ button to `renderHistory()`**

In `src/view.ts`, replace lines 1018-1032 (the `for (const it of items)` loop) with:

```typescript
for (const it of items) {
  const row = this.historyEl.createDiv("ai-wiki-history-row");
  row.createSpan().setText(this.statusLabel(it));
  row.createSpan({ cls: "muted" }).setText(` ${it.args.join(" ")}`);
  if (it.operation === "query") {
    const rerunBtn = row.createEl("button", { text: "↺", attr: { title: "Re-run" } });
    rerunBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.domainSelect!.value = it.domainId ?? "";
      this.domainSelect!.dispatchEvent(new Event("change"));
      this.queryInput.value = it.args[0] ?? "";
      this.submitQuery();
    });
  }
  row.addEventListener("click", () => {
    this.finalEl.empty();
    const comp = new Component();
    comp.load();
    void MarkdownRenderer.render(this.app, it.finalText || "(empty)", this.finalEl, "", comp).then(() => sanitizeLinks(this.finalEl));
    this.resultSection.removeClass("ai-wiki-hidden");
    this.finalEl.removeClass("ai-wiki-hidden");
    this.resultOpen = true;
    this.resultToggle.setText("▼");
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/view-history-rerun.test.ts
```

Expected: PASS all 4.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts tests/view-history-rerun.test.ts
git commit -m "feat(view): add re-run button to query history rows (#32)"
```

---

### Task 3: Save & restore last selected domain

**Files:**
- Modify: `src/view.ts` — `buildDomainRow()` + `refreshDomains()`
- Create: `tests/view-last-domain.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/view-last-domain.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { LlmWikiView } from "../src/view";
import type LlmWikiPlugin from "../src/main";

function makePlugin(lastDomain?: string) {
  return {
    controller: {
      loadDomains: vi.fn().mockResolvedValue([
        { id: "ai", name: "AI", wiki_folder: "wiki/ai" },
        { id: "db", name: "DB", wiki_folder: "wiki/db" },
      ]),
      isBusy: vi.fn().mockReturnValue(false),
      currentOp: null,
    },
    localConfigStore: {
      load: vi.fn().mockResolvedValue({ iclaudePath: "", lastDomain }),
      save: vi.fn().mockResolvedValue(undefined),
    },
    settings: { history: [], historyLimit: 20 },
    app: {},
  } as unknown as LlmWikiPlugin;
}

function makeView(lastDomain?: string) {
  const plugin = makePlugin(lastDomain);
  const leaf = { view: null } as any;
  return { v: new LlmWikiView(leaf, plugin), plugin };
}

describe("buildDomainRow — save lastDomain on change", () => {
  it("change listener calls localConfigStore.save with domainSelect value", () => {
    const { v, plugin } = makeView();

    const saveListeners: EventListener[] = [];
    const domainSelect: any = {
      value: "ai",
      createEl: vi.fn(() => ({})),
      empty: vi.fn(),
      options: [],
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn((evt: string, cb: EventListener) => {
        if (evt === "change") saveListeners.push(cb);
      }),
    };
    (v as any).domainSelect = domainSelect;

    // Simulate buildDomainRow attaching the listener by calling the private method
    // We test indirectly: after buildDomainRow wires up domainSelect, trigger change
    // and verify save is called. We inject a pre-wired domainSelect and call the
    // relevant section via a minimal stub.
    //
    // Instead, verify via integration: call buildDomainRow in a controlled way.
    // Since buildDomainRow creates domainSelect itself, we capture through the mock.

    const parent: any = {
      createDiv: vi.fn(() => ({
        createDiv: vi.fn(() => ({
          createSpan: vi.fn(() => ({})),
          createEl: vi.fn((tag: string, opts?: any) => {
            if (tag === "select") return domainSelect;
            const el: any = { addEventListener: vi.fn(), disabled: false };
            return el;
          }),
          addEventListener: vi.fn(),
        })),
        createDiv: vi.fn(() => ({
          createEl: vi.fn(() => ({ addEventListener: vi.fn(), disabled: false })),
        })),
      })),
    };

    (v as any).buildDomainRow(parent, { withActions: false });

    // Trigger all change listeners captured by domainSelect.addEventListener
    domainSelect.value = "db";
    saveListeners.forEach((cb) => cb(new Event("change")));

    expect(plugin.localConfigStore.save).toHaveBeenCalledWith({ lastDomain: "db" });
  });
});

describe("refreshDomains — restore lastDomain", () => {
  it("restores lastDomain from localConfigStore when domainSelect.value is empty", async () => {
    const { v, plugin } = makeView("db");

    // Simulate options array with real value-matching
    const options = [
      { value: "" },
      { value: "ai" },
      { value: "db" },
    ];
    const domainSelect: any = {
      value: "",
      empty: vi.fn(),
      createEl: vi.fn(() => ({})),
      options,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
    };
    (v as any).domainSelect = domainSelect;
    (v as any).domains = [];

    await (v as any).refreshDomains();

    expect(domainSelect.value).toBe("db");
  });

  it("does NOT override existing selection with lastDomain", async () => {
    const { v, plugin } = makeView("db");

    const options = [
      { value: "" },
      { value: "ai" },
      { value: "db" },
    ];
    const domainSelect: any = {
      value: "ai",
      empty: vi.fn(),
      createEl: vi.fn(() => ({})),
      options,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
    };
    (v as any).domainSelect = domainSelect;
    (v as any).domains = [];

    await (v as any).refreshDomains();

    expect(domainSelect.value).toBe("ai");
  });

  it("does not restore lastDomain if domain no longer exists", async () => {
    const { v, plugin } = makeView("deleted-domain");

    const options = [
      { value: "" },
      { value: "ai" },
    ];
    const domainSelect: any = {
      value: "",
      empty: vi.fn(),
      createEl: vi.fn(() => ({})),
      options,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
    };
    (v as any).domainSelect = domainSelect;
    (v as any).domains = [];

    await (v as any).refreshDomains();

    expect(domainSelect.value).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/view-last-domain.test.ts
```

Expected: FAIL — save listener not added, restore logic missing.

- [ ] **Step 3: Add save listener in `buildDomainRow()`**

In `src/view.ts`, immediately after line 209 (`refreshBtn.addEventListener(...)`), add:

```typescript
this.domainSelect.addEventListener("change", () => {
  void this.plugin.localConfigStore.save({ lastDomain: this.domainSelect!.value });
});
```

- [ ] **Step 4: Add restore logic in `refreshDomains()`**

In `src/view.ts`, replace lines 327-329 (the `if (previous && ...)` block):

```typescript
const restoreTarget = previous || (await this.plugin.localConfigStore.load()).lastDomain;
if (restoreTarget && Array.from(this.domainSelect.options).some((o) => o.value === restoreTarget)) {
  this.domainSelect.value = restoreTarget;
}
```

- [ ] **Step 5: Run all related tests**

```bash
npx vitest run tests/view-last-domain.test.ts tests/view-history-rerun.test.ts tests/local-config.test.ts
```

Expected: PASS all.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: PASS all (no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/view.ts tests/view-last-domain.test.ts
git commit -m "feat(view): persist and restore last selected domain (#33)"
```

---

### Task 4: Build

**Files:**
- Modify: `package.json` (version bump)
- Modify: `src/manifest.json` (version bump)
- Output: `dist/main.js`

- [ ] **Step 1: Bump version**

Read current version from `package.json` (`0.1.136`), set next patch: `0.1.137`.

In `package.json`, change:
```json
"version": "0.1.137",
```

In `src/manifest.json`, change:
```json
"version": "0.1.137",
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: `dist/main.js` written, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json src/manifest.json dist/main.js
git commit -m "chore: bump version to 0.1.137"
```
