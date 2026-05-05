# Domain Populate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При создании домена позволить указать папки-источники и автоматически запустить расширенный `init`, который анализирует эти источники и создаёт wiki-страницы.

**Architecture:** Добавляем `sourcePaths: string[]` в форму AddDomainModal с FolderSuggest autocomplete. После регистрации домена с источниками — диалог подтверждения, затем `controller.init()` передаёт пути через args `--sources`. Расширенный `runInit` работает в две фазы: анализ источников (LLM → entity_types) + создание страниц (runIngest на каждый файл) с поддержкой FileErrorModal (Skip/Retry/Stop).

**Tech Stack:** TypeScript, Obsidian API (AbstractInputSuggest, Modal), vitest

---

## File Map

| Файл | Роль изменения |
|------|----------------|
| `src/domain-map.ts` | Add `sourcePaths` to `AddDomainInput` |
| `src/types.ts` | Add `init_start`, `file_start`, `file_done` RunEvent kinds; `OnFileError` type; `onFileError` to `RunRequest` |
| `src/i18n.ts` | Add i18n strings for sourcePaths in AddDomainModal + confirm dialog |
| `src/modals.ts` | Add `FolderSuggest` class; update `AddDomainModal`; add `FileErrorModal` |
| `src/view.ts` | Fix wikiRoot bug; update `openAddDomain()` flow; render new events |
| `src/controller.ts` | Update `registerDomain()` to save sourcePaths; update `init()` to pass sources + onFileError |
| `src/agent-runner.ts` | Pass `req.onFileError` to `runInit` |
| `src/phases/init.ts` | Two-phase init when `--sources` present |
| `tests/init-args.test.ts` | Unit tests for args parsing + wikiRoot fix |

---

## Task 1: Types

**Files:**
- Modify: `src/domain-map.ts:18-22`
- Modify: `src/types.ts:20-31`, `src/types.ts:33-45`

- [ ] **Step 1: Add `sourcePaths` to `AddDomainInput` in `src/domain-map.ts`**

```typescript
export interface AddDomainInput {
  id: string;
  name: string;
  wikiFolder: string;  // vault-relative, e.g. "!Wiki/os"
  sourcePaths: string[];
}
```

- [ ] **Step 2: Add `OnFileError` type and `onFileError` to `RunRequest` in `src/types.ts`**

After line 11 (`| "init";`), add:

```typescript
export type OnFileError = (
  file: string,
  err: Error,
  canRetry: boolean,
) => Promise<"skip" | "retry" | "stop">;
```

Add to `RunRequest` interface (after `instruction?:`):

```typescript
  onFileError?: OnFileError;
```

- [ ] **Step 3: Add three new RunEvent kinds to `src/types.ts`**

In the `RunEvent` union (after `| { kind: "eval_result"; ... }`), add:

```typescript
  | { kind: "init_start"; totalFiles: number }
  | { kind: "file_start"; file: string; index: number; total: number }
  | { kind: "file_done"; file: string };
```

- [ ] **Step 4: Run tests to verify types compile**

```bash
npm test
```

Expected: all tests pass (only type changes, no logic change)

- [ ] **Step 5: Commit**

```bash
git add src/domain-map.ts src/types.ts
git commit -m "feat(types): add sourcePaths to AddDomainInput, OnFileError, init progress events"
```

---

## Task 2: Fix wikiFolder placeholder bug

**Files:**
- Modify: `src/view.ts:191-208`
- Test: `tests/init-args.test.ts`

The bug: `wikiRoot` in `openAddDomain()` is derived from `domains[0].wiki_folder` which might contain `vaults/<name>/` prefix from old LLM-generated entries (e.g. `vaults/work/!Wiki/ai` → `wikiRoot = vaults/work/!Wiki` instead of `!Wiki`).

- [ ] **Step 1: Write the failing test in `tests/init-args.test.ts`**

```typescript
import { describe, it, expect } from "vitest";

function deriveWikiRoot(wikiFolder: string): string {
  const raw = wikiFolder.replace(/\/[^/]+$/, "") || "!Wiki";
  return raw.replace(/^vaults\/[^/]+\//, "");
}

describe("deriveWikiRoot", () => {
  it("strips vault prefix from old-format wiki_folder", () => {
    expect(deriveWikiRoot("vaults/work/!Wiki/ai")).toBe("!Wiki");
  });

  it("leaves clean vault-relative path unchanged", () => {
    expect(deriveWikiRoot("!Wiki/ai")).toBe("!Wiki");
  });

  it("defaults to !Wiki when folder has no parent", () => {
    expect(deriveWikiRoot("!Wiki")).toBe("!Wiki");
  });

  it("handles nested path without vault prefix", () => {
    expect(deriveWikiRoot("Notes/wiki/ai")).toBe("Notes/wiki");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/init-args.test.ts
```

Expected: FAIL — `deriveWikiRoot` is not defined yet (it's inlined in view.ts)

- [ ] **Step 3: Fix `openAddDomain()` in `src/view.ts`**

Replace lines 196-199:

```typescript
// OLD:
const wikiRoot = (() => {
  const sample = domains[0]?.wiki_folder ?? `!Wiki/x`;
  return sample.replace(/\/[^/]+$/, "") || "!Wiki";
})();

// NEW:
const wikiRoot = (() => {
  const sample = domains[0]?.wiki_folder ?? `!Wiki/x`;
  const raw = sample.replace(/\/[^/]+$/, "") || "!Wiki";
  return raw.replace(/^vaults\/[^/]+\//, "");
})();
```

- [ ] **Step 4: Make test pass by extracting the helper (optional)**

The test references `deriveWikiRoot` as an exported function. Either:
- Export it from view.ts (not ideal — view.ts is an Obsidian class)
- Or move it to a pure utility and import in both test and view.ts

Simplest: inline the logic in view.ts and duplicate the formula in the test (the test IS the spec for the formula). Keep the test as-is since it documents the expected behaviour — the test function mirrors what view.ts does inline.

Update the test to test the formula directly without importing:

```typescript
// The formula inlined in view.ts openAddDomain():
function deriveWikiRoot(wikiFolder: string): string {
  const raw = wikiFolder.replace(/\/[^/]+$/, "") || "!Wiki";
  return raw.replace(/^vaults\/[^/]+\//, "");
}
```

This is acceptable — the test documents and verifies the formula.

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/init-args.test.ts
```

Expected: PASS all 4 cases

- [ ] **Step 6: Commit**

```bash
git add src/view.ts tests/init-args.test.ts
git commit -m "fix(view): strip vault prefix from wikiRoot in openAddDomain"
```

---

## Task 3: i18n strings for sourcePaths + confirm dialog

**Files:**
- Modify: `src/i18n.ts:114-150` (modal section) and the `ru` translation

- [ ] **Step 1: Add strings to the `modal` section in `en` object (line ~133 area)**

Add after `addDomainNote`:

```typescript
    addDomainSourcePathsLabel: "Source paths",
    addDomainSourcePathsPlaceholder: "Notes/AI/",
    addDomainSourcePathsAdd: "+ Add path",
    initConfirmTitle: "Start domain initialization?",
    initConfirmBody: (files: number, folders: number) =>
      `Found ${files} .md files in ${folders} folder(s). Run init to analyze sources and create wiki pages?`,
    fileErrorTitle: "Error processing file",
    fileErrorSkip: "Skip",
    fileErrorRetry: "Retry",
    fileErrorStop: "Stop",
```

- [ ] **Step 2: Add the same keys to the `ru` object (search for `modal:` in the ru section)**

```typescript
    addDomainSourcePathsLabel: "Пути источников",
    addDomainSourcePathsPlaceholder: "Notes/AI/",
    addDomainSourcePathsAdd: "+ Добавить путь",
    initConfirmTitle: "Запустить инициализацию домена?",
    initConfirmBody: (files: number, folders: number) =>
      `Найдено ${files} .md файлов в ${folders} папках. Запустить init для анализа источников и создания wiki-страниц?`,
    fileErrorTitle: "Ошибка при обработке файла",
    fileErrorSkip: "Пропустить",
    fileErrorRetry: "Повторить",
    fileErrorStop: "Остановить",
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: PASS (i18n changes don't break existing tests)

- [ ] **Step 4: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): add strings for sourcePaths in AddDomainModal and FileErrorModal"
```

---

## Task 4: FolderSuggest + AddDomainModal sourcePaths UI

**Files:**
- Modify: `src/modals.ts:1-3` (imports), `src/modals.ts:128-183` (AddDomainModal)

- [ ] **Step 1: Add `FolderSuggest` class before `AddDomainModal` in `src/modals.ts`**

Add after line 2 (`import { App, Modal, Setting } from "obsidian";`), extend import:

```typescript
import { AbstractInputSuggest, App, Modal, Setting, TFolder } from "obsidian";
```

Add class before `AddDomainModal` (around line 127):

```typescript
class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
  }

  getSuggestions(inputStr: string): TFolder[] {
    const lower = inputStr.toLowerCase();
    return this.app.vault.getAllFolders(true)
      .filter((f) => f.path.toLowerCase().includes(lower))
      .slice(0, 20);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path + "/");
  }

  selectSuggestion(folder: TFolder): void {
    this.inputEl.value = folder.path + "/";
    this.inputEl.trigger("input");
    this.close();
  }
}
```

- [ ] **Step 2: Update `AddDomainModal` to track sourcePaths and render source path fields**

Replace `AddDomainModal` class (lines 128-183):

```typescript
export class AddDomainModal extends Modal {
  private input: AddDomainInput = { id: "", name: "", wikiFolder: "", sourcePaths: [] };
  private wikiFolderInput: { setValue: (v: string) => void } | null = null;
  private sourcePathsContainer: HTMLElement | null = null;

  constructor(
    app: App,
    private wikiRoot: string,
    private onSubmit: (input: AddDomainInput) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.addDomain });

    new Setting(contentEl)
      .setName(T.id_name)
      .setDesc(T.id_desc)
      .addText((t) =>
        t.setPlaceholder(T.idPlaceholder).onChange((v) => {
          this.input.id = v.trim();
          if (this.wikiFolderInput && !this.input.wikiFolder) {
            this.wikiFolderInput.setValue(`${this.wikiRoot}/${this.input.id}`);
          }
        }),
      );

    new Setting(contentEl)
      .setName(T.displayName_name)
      .addText((t) => t.setPlaceholder(T.idPlaceholder).onChange((v) => { this.input.name = v.trim(); }));

    new Setting(contentEl)
      .setName(T.wikiFolder_name)
      .setDesc(T.wikiFolder_desc(this.wikiRoot))
      .addText((t) => {
        t.setPlaceholder(T.wikiFolder_placeholder(this.wikiRoot)).onChange((v) => {
          this.input.wikiFolder = v.trim();
        });
        this.wikiFolderInput = t;
      });

    this.sourcePathsContainer = contentEl.createDiv();
    this.renderSourcePaths();

    new Setting(contentEl).addButton((b) =>
      b.setButtonText(T.add).setCta().onClick(() => {
        if (!this.input.id) return;
        this.close();
        this.onSubmit(this.input);
      }),
    );
  }

  private renderSourcePaths(): void {
    if (!this.sourcePathsContainer) return;
    this.sourcePathsContainer.empty();
    const T = i18n().modal;

    const header = this.sourcePathsContainer.createDiv({ cls: "llm-wiki-sp-header" });
    header.createEl("span", { text: T.addDomainSourcePathsLabel, cls: "llm-wiki-sp-label" });

    const listEl = this.sourcePathsContainer.createDiv({ cls: "llm-wiki-sp-list" });
    const rerender = () => {
      listEl.empty();
      this.input.sourcePaths.forEach((p, i) => {
        const row = listEl.createDiv({ cls: "llm-wiki-sp-row" });
        row.createEl("span", { text: p, cls: "llm-wiki-sp-path", attr: { title: p } });
        const removeBtn = row.createEl("button", { text: "×", cls: "llm-wiki-sp-remove" });
        removeBtn.addEventListener("click", () => {
          this.input.sourcePaths.splice(i, 1);
          rerender();
        });
      });
    };
    rerender();

    const addRow = this.sourcePathsContainer.createDiv({ cls: "llm-wiki-sp-add-row" });
    const inputEl = addRow.createEl("input", {
      cls: "llm-wiki-sp-input",
      attr: { type: "text", placeholder: T.addDomainSourcePathsPlaceholder },
    }) as HTMLInputElement;
    new FolderSuggest(this.app, inputEl);

    const addPath = () => {
      const val = inputEl.value.trim();
      if (!val || this.input.sourcePaths.includes(val)) return;
      this.input.sourcePaths.push(val);
      inputEl.value = "";
      rerender();
    };

    inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); addPath(); }
    });

    addRow.createEl("button", { text: T.addDomainSourcePathsAdd, cls: "mod-cta" })
      .addEventListener("click", addPath);
  }

  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: PASS (Modal uses Obsidian API mocked in vitest.mock.ts)

- [ ] **Step 4: Commit**

```bash
git add src/modals.ts
git commit -m "feat(modals): add FolderSuggest and sourcePaths fields to AddDomainModal"
```

---

## Task 5: FileErrorModal

**Files:**
- Modify: `src/modals.ts` — add `FileErrorModal` class after `AddDomainModal`

- [ ] **Step 1: Add `FileErrorModal` to `src/modals.ts`**

Add after the `AddDomainModal` class (before `EditDomainModal`):

```typescript
export class FileErrorModal extends Modal {
  private resolve!: (choice: "skip" | "retry" | "stop") => void;
  readonly result: Promise<"skip" | "retry" | "stop">;
  private resolved = false;

  constructor(
    app: App,
    private file: string,
    private err: Error,
    private canRetry: boolean,
  ) {
    super(app);
    this.result = new Promise((res) => { this.resolve = res; });
  }

  private pick(choice: "skip" | "retry" | "stop"): void {
    if (this.resolved) return;
    this.resolved = true;
    this.close();
    this.resolve(choice);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.fileErrorTitle });
    contentEl.createEl("p", { text: this.file, cls: "llm-wiki-file-error-path" });
    contentEl.createEl("p", { text: this.err.message, cls: "llm-wiki-file-error-msg" });

    const setting = new Setting(contentEl);
    setting.addButton((b) =>
      b.setButtonText(T.fileErrorSkip).onClick(() => this.pick("skip")),
    );
    if (this.canRetry) {
      setting.addButton((b) =>
        b.setButtonText(T.fileErrorRetry).onClick(() => this.pick("retry")),
      );
    }
    setting.addButton((b) =>
      b.setButtonText(T.fileErrorStop).setWarning().onClick(() => this.pick("stop")),
    );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) { this.resolved = true; this.resolve("skip"); }
  }
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/modals.ts
git commit -m "feat(modals): add FileErrorModal with skip/retry/stop for init errors"
```

---

## Task 6: openAddDomain flow + controller.init + registerDomain

**Files:**
- Modify: `src/view.ts:191-208`
- Modify: `src/controller.ts:140-143` (init method), `src/controller.ts:154-177` (registerDomain)

- [ ] **Step 1: Update `registerDomain` in `src/controller.ts` to save `sourcePaths`**

Replace line 170 (`source_paths: [],`):

```typescript
      source_paths: input.sourcePaths ?? [],
```

- [ ] **Step 2: Update `init()` method in `src/controller.ts` to accept sourcePaths and onFileError**

Replace lines 140-143:

```typescript
  async init(domain: string, dryRun: boolean, sourcePaths?: string[]): Promise<void> {
    const args = dryRun ? [domain, "--dry-run"] : [domain];
    if (sourcePaths?.length) args.push("--sources", ...sourcePaths);
    const onFileError: import("./types").OnFileError | undefined = sourcePaths?.length
      ? (file, err, canRetry) => {
          const modal = new (require("./modals").FileErrorModal)(this.app, file, err, canRetry);
          modal.open();
          return modal.result;
        }
      : undefined;
    await this.dispatch("init", args, undefined, undefined, undefined, onFileError);
  }
```

- [ ] **Step 3: Update `dispatch()` signature in `src/controller.ts` to accept onFileError**

Replace line 233:
```typescript
private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string, onFileError?: import("./types").OnFileError): Promise<void> {
```

And update RunRequest construction at line 267 to include onFileError:
```typescript
    const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError });
```

- [ ] **Step 4: Update `openAddDomain()` in `src/view.ts`**

Import `FileErrorModal` is already in modals (used by controller). Update the `openAddDomain` method (lines 191-208):

```typescript
  private openAddDomain(): void {
    const cwd = this.plugin.controller.cwdOrEmpty();
    if (!cwd) { new Notice(i18n().view.cwdNotSet); return; }
    const domains = this.plugin.controller.loadDomains();
    const wikiRoot = (() => {
      const sample = domains[0]?.wiki_folder ?? `!Wiki/x`;
      const raw = sample.replace(/\/[^/]+$/, "") || "!Wiki";
      return raw.replace(/^vaults\/[^/]+\//, "");
    })();
    new AddDomainModal(this.app, wikiRoot, (input) => {
      const r = this.plugin.controller.registerDomain(input);
      if (!r.ok) return;
      this.refreshDomains();
      this.domainSelect.value = input.id;

      if (!input.sourcePaths.length) {
        void this.plugin.controller.init(input.id, false);
        return;
      }

      const T = i18n().modal;
      const allFiles = this.app.vault.getFiles();
      const mdFiles = allFiles.filter(
        (f) => f.extension === "md" &&
          input.sourcePaths.some((p) => f.path.startsWith(p)),
      );

      if (!mdFiles.length) {
        void this.plugin.controller.init(input.id, false);
        return;
      }

      new ConfirmModal(
        this.app,
        T.initConfirmTitle,
        [T.initConfirmBody(mdFiles.length, input.sourcePaths.length)],
        () => void this.plugin.controller.init(input.id, false, input.sourcePaths),
      ).open();
    }).open();
  }
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/view.ts src/controller.ts
git commit -m "feat(view,ctrl): openAddDomain count files, confirm dialog, init with sources"
```

---

## Task 7: Pass onFileError through AgentRunner to runInit

**Files:**
- Modify: `src/agent-runner.ts:56-98` (runOperation switch)

- [ ] **Step 1: Update `runOperation` in `src/agent-runner.ts` to pass `req.onFileError` to `runInit`**

Replace the `case "init":` block (line 89-91):

```typescript
      case "init":
        yield* runInit(req.args, this.vaultTools, this.llm, model, domains, this.vaultName, req.signal, opts, req.onFileError);
        break;
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(runner): thread onFileError from RunRequest to runInit"
```

---

## Task 8: Extend runInit for source-based initialization

**Files:**
- Modify: `src/phases/init.ts`
- Test: `tests/init-args.test.ts` (add new tests)

- [ ] **Step 1: Add tests for args parsing to `tests/init-args.test.ts`**

Append to existing file:

```typescript
describe("parseSourcesFromArgs", () => {
  function parseSourcesFromArgs(args: string[]): string[] {
    const idx = args.indexOf("--sources");
    return idx >= 0 ? args.slice(idx + 1) : [];
  }

  it("returns empty array when no --sources flag", () => {
    expect(parseSourcesFromArgs(["domainId"])).toEqual([]);
  });

  it("returns paths after --sources flag", () => {
    expect(parseSourcesFromArgs(["domainId", "--sources", "Notes/AI/", "Sources/"])).toEqual([
      "Notes/AI/",
      "Sources/",
    ]);
  });

  it("handles --dry-run before --sources", () => {
    expect(parseSourcesFromArgs(["domainId", "--dry-run", "--sources", "Notes/"])).toEqual([
      "Notes/",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (formula is pure, extracted in test)**

```bash
npx vitest run tests/init-args.test.ts
```

Expected: PASS

- [ ] **Step 3: Update `runInit` signature in `src/phases/init.ts` to accept `onFileError`**

Change signature:

```typescript
export async function* runInit(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  onFileError?: import("../types").OnFileError,
): AsyncGenerator<RunEvent> {
```

- [ ] **Step 4: Add `--sources` parsing and two-phase logic to `runInit`**

After the `const dryRun = args.includes("--dry-run");` line, add:

```typescript
  const sourcesIdx = args.indexOf("--sources");
  const sourcePaths = sourcesIdx >= 0 ? args.slice(sourcesIdx + 1) : [];
```

After the guard `if (!domainId) { ... }` block and before `yield { kind: "assistant_text", delta: ... }`, add:

```typescript
  if (sourcePaths.length) {
    yield* runInitWithSources(
      domainId, sourcePaths, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError,
    );
    return;
  }
```

- [ ] **Step 5: Add `runInitWithSources` helper function to `src/phases/init.ts`**

Add the new function after `runInit` (before `appendLog`). It also needs import of `runIngest`:

Add at top of file:
```typescript
import { runIngest } from "./ingest";
```

Add function:

```typescript
async function* runInitWithSources(
  domainId: string,
  sourcePaths: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions,
  onFileError: import("../types").OnFileError | undefined,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const wikiRootGuess = `!Wiki`;

  await ensureRootFiles(vaultTools, wikiRootGuess);

  // Collect all .md files from source paths
  const allVaultFiles = await vaultTools.listFiles("");
  const sourceFiles = allVaultFiles.filter((f) =>
    f.endsWith(".md") && sourcePaths.some((sp) => f.startsWith(sp)),
  );

  if (!sourceFiles.length) {
    yield { kind: "error", message: `No .md files found in source paths: ${sourcePaths.join(", ")}` };
    return;
  }

  yield { kind: "init_start", totalFiles: sourceFiles.length };
  yield { kind: "assistant_text", delta: `Analysing ${sourceFiles.length} source files for domain "${domainId}"...\n` };

  // Phase 1: Analyse sources → entity_types + language_notes
  const sampleFiles = sourceFiles.slice(0, 10);
  const samples = await vaultTools.readAll(sampleFiles);
  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, `${wikiRootGuess}/_schema.md`),
    tryRead(vaultTools, `${wikiRootGuess}/_index.md`),
  ]);

  const existing = domains.find((d) => d.id === domainId);
  const systemContent = render(initTemplate, {
    domain_id: domainId,
    vault_name: vaultName,
    schema_block: schemaContent ? `\nКонвенции вики (_schema.md):\n${schemaContent.slice(0, 1500)}` : "",
    index_block: indexContent ? `\nСуществующая структура (_index.md):\n${indexContent.slice(0, 1000)}` : "",
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `Domain ID: ${domainId}`,
        `Vault name: ${vaultName}`,
        `Source paths: ${sourcePaths.join(", ")}`,
        "",
        `Примеры файлов источников:`,
        [...samples.entries()].map(([p, c]) => `${p}:\n${c.slice(0, 400)}`).join("\n\n"),
      ].join("\n"),
    },
  ];

  const params = buildChatParams(model, messages, opts);
  let fullText = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { fullText += content; yield { kind: "assistant_text", delta: content }; }
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    if (fullText) yield { kind: "assistant_text", delta: fullText };
  }

  if (signal.aborted) return;

  // Parse entity_types from LLM response and emit domain event
  let entry: DomainEntry;
  try {
    const match = fullText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found in LLM response");
    entry = JSON.parse(match[0]) as DomainEntry;
    const vaultPrefix = `vaults/${vaultName}/`;
    if (entry.wiki_folder?.startsWith(vaultPrefix)) {
      entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
    }
    if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
  } catch (e) {
    yield { kind: "error", message: `Failed to parse domain entry: ${(e as Error).message}` };
    return;
  }

  // Build updated domain with new entity_types for Phase 2
  const updatedDomain: DomainEntry = {
    ...(existing ?? { id: domainId, name: domainId, wiki_folder: entry.wiki_folder }),
    entity_types: entry.entity_types,
    language_notes: entry.language_notes,
    source_paths: sourcePaths,
  };

  yield { kind: "tool_use", name: existing ? "UpdateDomain" : "SaveDomain", input: { id: domainId } };
  if (existing) {
    yield { kind: "domain_updated", domainId, patch: { entity_types: entry.entity_types, language_notes: entry.language_notes } };
  } else {
    yield { kind: "domain_created", entry: { ...entry, source_paths: sourcePaths } };
  }
  yield { kind: "tool_result", ok: true };

  yield { kind: "assistant_text", delta: `\nCreating wiki pages from ${sourceFiles.length} source files...\n` };

  // Phase 2: Ingest each source file
  for (let i = 0; i < sourceFiles.length; i++) {
    if (signal.aborted) return;
    const file = sourceFiles[i];
    yield { kind: "file_start", file, index: i, total: sourceFiles.length };

    let retried = false;
    let done = false;
    while (!done) {
      let hadError = false;
      let caughtErr: Error | null = null;

      try {
        for await (const ev of runIngest([file], vaultTools, llm, model, [updatedDomain], "", signal, opts)) {
          yield ev;
        }
        done = true;
      } catch (e) {
        hadError = true;
        caughtErr = e as Error;
      }

      if (hadError && caughtErr) {
        const canRetry = !retried;
        const choice = onFileError
          ? await onFileError(file, caughtErr, canRetry)
          : "skip";
        if (choice === "stop") return;
        if (choice === "retry" && canRetry) {
          retried = true;
          continue;
        }
        done = true; // skip
      }
    }

    yield { kind: "file_done", file };
  }

  await appendLog(vaultTools, wikiRootGuess, domainId);

  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised from ${sourceFiles.length} source files. ${sourceFiles.length} files processed.`,
  };
}
```

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: PASS (no breaking changes to existing behaviour; new path only triggers with `--sources` flag)

- [ ] **Step 7: Commit**

```bash
git add src/phases/init.ts tests/init-args.test.ts
git commit -m "feat(init): two-phase init with --sources — analyse then create wiki pages"
```

---

## Task 9: Render init_start / file_start / file_done events in view

**Files:**
- Modify: `src/view.ts:256-339` (appendEvent method)

The new events need to update a progress indicator. We'll render `init_start` once as a header, then update a single progress div on each `file_start`/`file_done`.

- [ ] **Step 1: Add `progressEl` and `progressTotal` instance fields to `LlmWikiView`**

Find the class field declarations (search for `private stepsEl`) and add:

```typescript
  private progressEl: HTMLElement | null = null;
  private progressTotal = 0;
  private progressDone = 0;
```

Also reset these fields in `setRunning()` (add after `this.stepCount = 0;`):

```typescript
    this.progressEl = null;
    this.progressTotal = 0;
    this.progressDone = 0;
```

- [ ] **Step 2: Add handling of new event kinds in `appendEvent()`**

In `appendEvent()`, before the `if (ev.kind === "domain_created")` block (line 257), add:

```typescript
    if (ev.kind === "init_start") {
      this.progressTotal = ev.totalFiles;
      this.progressDone = 0;
      const step = this.stepsEl.createDiv("llm-wiki-step llm-wiki-progress");
      step.createSpan({ cls: "llm-wiki-step-icon" }).setText("📂");
      this.progressEl = step.createSpan({ cls: "llm-wiki-progress-text" });
      this.progressEl.setText(`0 / ${ev.totalFiles} файлов`);
      this.scrollSteps();
      return;
    }
    if (ev.kind === "file_start") {
      if (this.progressEl) {
        this.progressEl.setText(`${ev.index} / ${ev.total} файлов → ${ev.file.split("/").pop()}`);
      }
      this.scrollSteps();
      return;
    }
    if (ev.kind === "file_done") {
      this.progressDone++;
      if (this.progressEl) {
        this.progressEl.setText(`${this.progressDone} / ${this.progressTotal} файлов`);
      }
      this.scrollSteps();
      return;
    }
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): render init_start/file_start/file_done progress events"
```

---

## Task 10: Version bump + build

**Files:**
- Modify: `package.json`, `manifest.json`

- [ ] **Step 1: Read current version from `package.json`**

```bash
node -e "const p = require('./package.json'); console.log(p.version)"
```

- [ ] **Step 2: Bump patch version in `package.json` and `manifest.json`**

If current version is `X.Y.Z`, set to `X.Y.(Z+1)` in both files.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: `main.js` generated without errors

- [ ] **Step 4: Run full test suite one last time**

```bash
npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json manifest.json main.js
git commit -m "chore: bump version and build"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|-----------------|------|
| `sourcePaths: string[]` в `AddDomainInput` | Task 1 |
| Новые RunEvent kinds (init_start, file_start, file_done) | Task 1 |
| Фикс wikiFolder placeholder | Task 2 |
| i18n strings | Task 3 |
| FolderSuggest autocomplete | Task 4 |
| sourcePaths UI в AddDomainModal (+ / ×) | Task 4 |
| FileErrorModal (skip/retry/stop) | Task 5 |
| openAddDomain: счёт файлов + ConfirmModal | Task 6 |
| registerDomain сохраняет sourcePaths | Task 6 |
| controller.init принимает sourcePaths + onFileError | Task 6 + 7 |
| runInit фаза 1: анализ источников → entity_types | Task 8 |
| runInit фаза 2: runIngest на каждый файл | Task 8 |
| onFileError callback в runInit | Task 8 |
| Рендер прогресс-событий в view | Task 9 |

### Type consistency

- `OnFileError` определён в `src/types.ts` (Task 1), используется в `RunRequest`, `runInit`, `controller.init` — единообразно
- `init_start` / `file_start` / `file_done` — добавлены в `RunEvent` (Task 1), используются в `runInitWithSources` (Task 8), рендерятся в `appendEvent` (Task 9)
- `AddDomainInput.sourcePaths` — добавлен (Task 1), используется в `AddDomainModal` (Task 4), `registerDomain` (Task 6), `openAddDomain` (Task 6)

### Placeholder scan

Нет TBD / TODO / заглушек.

### Потенциальная проблема: runIngest с пустым vaultRoot

В Task 8 `runInitWithSources` вызывает `runIngest([file], ..., vaultRoot="", ...)`. Файлы из `vaultTools.listFiles("")` уже vault-relative, значит `vaultRoot=""` — корректно для vault-relative путей. `runIngest` использует `isAbsolute(filePath) ? filePath : join(vaultRoot, filePath)` → `join("", "Notes/AI/file.md") = "Notes/AI/file.md"` — правильно. `vaultTools.toVaultPath` конвертирует из abs-path, но если уже vault-relative это не проблема. Проверить при тестировании.
