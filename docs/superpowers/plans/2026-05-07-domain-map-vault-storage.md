# Domain-map → vault + iclaudePath → local-config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести `domains[]` из `data.json` в vault-файл `!Wiki/_domain.json` и `iclaudePath` в `<plugin-dir>/local.json`, добавить one-shot auto-migration.

**Architecture:** Два изолированных store-модуля: `DomainStore` (vault-relative, lazy reads, atomic writes, hard-fail на corrupt) и `LocalConfigStore` (plugin-dir, кэширующий). `WikiController` принимает оба store через конструктор. Миграция вызывается в `onload()` ДО `loadSettings()`, мутирует `data.json` (удаляет legacy-поля), затем `loadSettings()` читает уже очищенный конфиг.

**Tech Stack:** TypeScript, Obsidian Plugin API (`Vault.adapter`), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-07-domain-map-vault-storage-design.md`

---

## File Map

| Файл | Действие |
|------|---------|
| `src/domain-store.ts` | **Create** — `DomainStore` class + `DomainCorruptError` |
| `src/local-config.ts` | **Create** — `LocalConfigStore` class, `LocalConfig` type |
| `src/domain.ts` | **Modify** — добавить helper `applyDomainEvent` |
| `src/types.ts` | **Modify** — удалить `domains` и `claudeAgent.iclaudePath`, обновить `DEFAULT_SETTINGS` |
| `src/main.ts` | **Modify** — добавить `migrateLegacyData()`, инстанцировать stores, вызвать миграцию ПЕРЕД `loadSettings()` |
| `src/controller.ts` | **Modify** — конструктор принимает stores, `loadDomains()` async, `registerDomain()` async, `dispatch()` пишет через store, `requireClaudeAgent()` async через `localConfig` |
| `src/settings.ts` | **Modify** — `display()` async, edit/delete доменов через `store.save()`, `iclaudePath` через `localConfig.save()` |
| `tests/domain-store.test.ts` | **Create** |
| `tests/local-config.test.ts` | **Create** |
| `tests/apply-domain-event.test.ts` | **Create** |
| `tests/main-migration.test.ts` | **Create** |
| `tests/agent-runner.integration.test.ts` | **Modify** — обновить вызовы (без `iclaudePath` в settings) |

---

## Task 1: `DomainStore` — TDD

**Files:**
- Create: `tests/domain-store.test.ts`
- Create: `src/domain-store.ts`

- [ ] **Step 1.1: Написать failing-тест**

Создать `tests/domain-store.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { DomainStore, DomainCorruptError } from "../src/domain-store";
import type { DomainEntry } from "../src/domain";

function makeVault(adapter: Record<string, any>): any {
  return { adapter };
}

const sampleDomain: DomainEntry = {
  id: "os",
  name: "OS",
  wiki_folder: "os",
  source_paths: [],
  entity_types: [],
  language_notes: "",
};

describe("DomainStore", () => {
  describe("load", () => {
    it("returns [] when file missing", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(false),
        read: vi.fn(),
      };
      const store = new DomainStore(makeVault(adapter));
      expect(await store.load()).toEqual([]);
    });

    it("returns parsed domains when file present", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue(JSON.stringify([sampleDomain])),
      };
      const store = new DomainStore(makeVault(adapter));
      const result = await store.load();
      expect(result).toEqual([sampleDomain]);
    });

    it("throws DomainCorruptError on invalid JSON", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue("{not json"),
      };
      const store = new DomainStore(makeVault(adapter));
      await expect(store.load()).rejects.toBeInstanceOf(DomainCorruptError);
    });

    it("throws DomainCorruptError on non-array JSON", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue('{"foo":"bar"}'),
      };
      const store = new DomainStore(makeVault(adapter));
      await expect(store.load()).rejects.toBeInstanceOf(DomainCorruptError);
    });
  });

  describe("save", () => {
    it("creates !Wiki dir if missing, writes tmp, then renames", async () => {
      const calls: string[] = [];
      const adapter = {
        exists: vi.fn().mockImplementation(async (p: string) => {
          calls.push(`exists:${p}`);
          if (p === "!Wiki") return false;
          if (p === "!Wiki/_domain.json") return false;
          return false;
        }),
        mkdir: vi.fn().mockImplementation(async (p: string) => { calls.push(`mkdir:${p}`); }),
        write: vi.fn().mockImplementation(async (p: string) => { calls.push(`write:${p}`); }),
        rename: vi.fn().mockImplementation(async (a: string, b: string) => { calls.push(`rename:${a}->${b}`); }),
        remove: vi.fn().mockImplementation(async (p: string) => { calls.push(`remove:${p}`); }),
      };
      const store = new DomainStore(makeVault(adapter));
      await store.save([sampleDomain]);
      expect(adapter.mkdir).toHaveBeenCalledWith("!Wiki");
      expect(adapter.write).toHaveBeenCalledWith(
        "!Wiki/_domain.json.tmp",
        JSON.stringify([sampleDomain], null, 2),
      );
      expect(adapter.rename).toHaveBeenCalledWith(
        "!Wiki/_domain.json.tmp",
        "!Wiki/_domain.json",
      );
    });

    it("removes existing target before rename", async () => {
      const adapter = {
        exists: vi.fn().mockImplementation(async (p: string) => {
          if (p === "!Wiki") return true;
          if (p === "!Wiki/_domain.json") return true;
          return false;
        }),
        mkdir: vi.fn(),
        write: vi.fn(),
        rename: vi.fn(),
        remove: vi.fn(),
      };
      const store = new DomainStore(makeVault(adapter));
      await store.save([sampleDomain]);
      expect(adapter.remove).toHaveBeenCalledWith("!Wiki/_domain.json");
      expect(adapter.mkdir).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 1.2: Запустить — должен упасть на отсутствии модуля**

```bash
npx vitest run tests/domain-store.test.ts
```

Ожидаемо: ошибка импорта `../src/domain-store`.

- [ ] **Step 1.3: Реализовать `src/domain-store.ts`**

```ts
import type { Vault } from "obsidian";
import type { DomainEntry } from "./domain";

const FILE_PATH = "!Wiki/_domain.json";
const TMP_PATH = `${FILE_PATH}.tmp`;
const WIKI_DIR = "!Wiki";

export class DomainCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainCorruptError";
  }
}

export class DomainStore {
  constructor(private vault: Vault) {}

  async load(): Promise<DomainEntry[]> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists(FILE_PATH))) return [];
    const raw = await adapter.read(FILE_PATH);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch (e) { throw new DomainCorruptError(`${FILE_PATH}: ${(e as Error).message}`); }
    if (!Array.isArray(parsed)) throw new DomainCorruptError(`${FILE_PATH}: expected JSON array`);
    return parsed as DomainEntry[];
  }

  async save(domains: DomainEntry[]): Promise<void> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists(WIKI_DIR))) await adapter.mkdir(WIKI_DIR);
    const body = JSON.stringify(domains, null, 2);
    await adapter.write(TMP_PATH, body);
    if (await adapter.exists(FILE_PATH)) await adapter.remove(FILE_PATH);
    await adapter.rename(TMP_PATH, FILE_PATH);
  }
}
```

- [ ] **Step 1.4: Запустить — должны пройти**

```bash
npx vitest run tests/domain-store.test.ts
```

Ожидаемо: 6 passed.

- [ ] **Step 1.5: Коммит**

```bash
git add src/domain-store.ts tests/domain-store.test.ts
git commit -m "feat: add DomainStore for vault-backed domain storage"
```

---

## Task 2: `LocalConfigStore` — TDD

**Files:**
- Create: `tests/local-config.test.ts`
- Create: `src/local-config.ts`

- [ ] **Step 2.1: Написать тест**

Создать `tests/local-config.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { LocalConfigStore } from "../src/local-config";

function makePlugin(adapterImpl: Record<string, any>, manifestDir = ".obsidian/plugins/llm-wiki") {
  return {
    manifest: { dir: manifestDir, id: "llm-wiki" },
    app: { vault: { adapter: adapterImpl } },
  } as any;
}

describe("LocalConfigStore", () => {
  it("returns defaults when local.json missing", async () => {
    const adapter = { exists: vi.fn().mockResolvedValue(false), read: vi.fn(), write: vi.fn() };
    const store = new LocalConfigStore(makePlugin(adapter));
    const cfg = await store.load();
    expect(cfg).toEqual({ iclaudePath: "" });
  });

  it("merges defaults with stored values", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue(JSON.stringify({ iclaudePath: "/usr/bin/iclaude.sh" })),
      write: vi.fn(),
    };
    const store = new LocalConfigStore(makePlugin(adapter));
    expect(await store.load()).toEqual({ iclaudePath: "/usr/bin/iclaude.sh" });
  });

  it("returns defaults on corrupt JSON", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue("not json"),
      write: vi.fn(),
    };
    const store = new LocalConfigStore(makePlugin(adapter));
    expect(await store.load()).toEqual({ iclaudePath: "" });
  });

  it("save writes JSON to plugin-dir/local.json and updates cache", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
    };
    const store = new LocalConfigStore(makePlugin(adapter, ".obsidian/plugins/llm-wiki"));
    await store.save({ iclaudePath: "/new/path" });
    expect(adapter.write).toHaveBeenCalledWith(
      ".obsidian/plugins/llm-wiki/local.json",
      JSON.stringify({ iclaudePath: "/new/path" }, null, 2),
    );
    // second load returns cached value without re-reading
    expect((await store.load()).iclaudePath).toBe("/new/path");
  });

  it("save merges with existing values", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue(JSON.stringify({ iclaudePath: "/old" })),
      write: vi.fn(),
    };
    const store = new LocalConfigStore(makePlugin(adapter));
    await store.save({ iclaudePath: "/new" });
    expect((await store.load()).iclaudePath).toBe("/new");
  });
});
```

- [ ] **Step 2.2: Запустить — упадёт**

```bash
npx vitest run tests/local-config.test.ts
```

- [ ] **Step 2.3: Реализовать `src/local-config.ts`**

```ts
import type { Plugin } from "obsidian";

export interface LocalConfig {
  iclaudePath: string;
}

const DEFAULTS: LocalConfig = { iclaudePath: "" };

export class LocalConfigStore {
  private cache: LocalConfig | null = null;

  constructor(private plugin: Plugin) {}

  private path(): string {
    const dir = this.plugin.manifest.dir;
    if (!dir) throw new Error("LocalConfigStore: plugin manifest.dir is undefined");
    return `${dir}/local.json`;
  }

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
      this.cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LocalConfig>) };
    } catch {
      this.cache = { ...DEFAULTS };
    }
    return this.cache;
  }

  async save(patch: Partial<LocalConfig>): Promise<void> {
    const cur = await this.load();
    this.cache = { ...cur, ...patch };
    await this.plugin.app.vault.adapter.write(this.path(), JSON.stringify(this.cache, null, 2));
  }
}
```

- [ ] **Step 2.4: Запустить — должны пройти**

```bash
npx vitest run tests/local-config.test.ts
```

Ожидаемо: 5 passed.

- [ ] **Step 2.5: Коммит**

```bash
git add src/local-config.ts tests/local-config.test.ts
git commit -m "feat: add LocalConfigStore for machine-local plugin settings"
```

---

## Task 3: `applyDomainEvent` helper — TDD

**Files:**
- Create: `tests/apply-domain-event.test.ts`
- Modify: `src/domain.ts`

- [ ] **Step 3.1: Написать тест**

Создать `tests/apply-domain-event.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyDomainEvent } from "../src/domain";
import type { DomainEntry } from "../src/domain";

const base: DomainEntry = {
  id: "os",
  name: "OS",
  wiki_folder: "os",
  source_paths: ["docs/os"],
  entity_types: [],
  language_notes: "",
};

describe("applyDomainEvent", () => {
  it("appends new domain on domain_created", () => {
    const result = applyDomainEvent([], { kind: "domain_created", entry: base });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(base);
  });

  it("idempotent: domain_created with existing id does not duplicate", () => {
    const result = applyDomainEvent([base], { kind: "domain_created", entry: base });
    expect(result).toHaveLength(1);
  });

  it("merges patch on domain_updated", () => {
    const result = applyDomainEvent([base], {
      kind: "domain_updated",
      domainId: "os",
      patch: { language_notes: "RU" },
    });
    expect(result[0].language_notes).toBe("RU");
    expect(result[0].name).toBe("OS");
  });

  it("returns same list on domain_updated for unknown id", () => {
    const result = applyDomainEvent([base], {
      kind: "domain_updated",
      domainId: "unknown",
      patch: { language_notes: "X" },
    });
    expect(result[0].language_notes).toBe("");
  });

  it("adds source path with dedupe", () => {
    const result = applyDomainEvent([base], {
      kind: "source_path_added",
      domainId: "os",
      path: "docs/os/new",
    });
    expect(result[0].source_paths).toEqual(["docs/os", "docs/os/new"]);
  });

  it("does not duplicate existing source path", () => {
    const result = applyDomainEvent([base], {
      kind: "source_path_added",
      domainId: "os",
      path: "docs/os",
    });
    expect(result[0].source_paths).toEqual(["docs/os"]);
  });

  it("does not mutate input array", () => {
    const input = [base];
    applyDomainEvent(input, { kind: "domain_created", entry: { ...base, id: "new" } });
    expect(input).toHaveLength(1);
  });
});
```

- [ ] **Step 3.2: Запустить — упадёт**

```bash
npx vitest run tests/apply-domain-event.test.ts
```

- [ ] **Step 3.3: Добавить helper в `src/domain.ts`**

В конец `src/domain.ts` добавить:

```ts
import type { RunEvent } from "./types";

type DomainPersistEvent = Extract<RunEvent, { kind: "domain_created" | "domain_updated" | "source_path_added" }>;

export function applyDomainEvent(domains: DomainEntry[], ev: DomainPersistEvent): DomainEntry[] {
  const next = [...domains];
  if (ev.kind === "domain_created") {
    if (next.some((d) => d.id === ev.entry.id)) return next;
    next.push(ev.entry);
    return next;
  }
  const i = next.findIndex((d) => d.id === ev.domainId);
  if (i < 0) return next;
  if (ev.kind === "domain_updated") {
    next[i] = { ...next[i], ...ev.patch };
    return next;
  }
  // source_path_added
  const paths = new Set(next[i].source_paths ?? []);
  paths.add(ev.path);
  next[i] = { ...next[i], source_paths: [...paths] };
  return next;
}
```

- [ ] **Step 3.4: Запустить — должны пройти**

```bash
npx vitest run tests/apply-domain-event.test.ts
```

Ожидаемо: 7 passed.

- [ ] **Step 3.5: Коммит**

```bash
git add src/domain.ts tests/apply-domain-event.test.ts
git commit -m "feat: add applyDomainEvent helper for store updates"
```

---

## Task 4: Очистить `src/types.ts` — убрать legacy-поля

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 4.1: Удалить `domains` из `LlmWikiPluginSettings`**

В `src/types.ts` строка 110, удалить строку:
```ts
domains: DomainEntry[];
```

Удалить из `DEFAULT_SETTINGS` (строка 148):
```ts
domains: [],
```

- [ ] **Step 4.2: Удалить `iclaudePath` из `claudeAgent`**

В `LlmWikiPluginSettings.claudeAgent` (строки 122-128) удалить `iclaudePath: string;`.

В `DEFAULT_SETTINGS.claudeAgent` (строки 154-165) удалить `iclaudePath: "",`.

- [ ] **Step 4.3: Убрать неиспользуемый импорт `DomainEntry` если нужно**

Если после удаления `domains` импорт `DomainEntry` в `types.ts` больше не нужен — удалить его. Проверить grep: тип всё ещё используется в `RunEvent` (`domain_created`), значит импорт остаётся.

- [ ] **Step 4.4: Запустить TS-проверку через сборку**

```bash
npx tsc --noEmit -p tsconfig.json
```

Ожидаемо: ошибки в `src/controller.ts`, `src/main.ts`, `src/settings.ts` (используют удалённые поля). Это нормально — починим в следующих тасках.

**Важно:** ошибки TS блокируют commit. Делаем коммит только после Task 6, когда controller/main/settings обновлены.

- [ ] **Step 4.5: Не коммитить пока — переходим к следующим таскам**

---

## Task 5: `migrateLegacyData` — TDD

**Files:**
- Create: `tests/main-migration.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 5.1: Написать тест**

Создать `tests/main-migration.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { migrateLegacyData } from "../src/main";
import type { DomainEntry } from "../src/domain";

function makePlugin(initial: any, adapter: Record<string, any>) {
  let stored = JSON.parse(JSON.stringify(initial));
  return {
    manifest: { dir: ".obsidian/plugins/llm-wiki", id: "llm-wiki" },
    app: { vault: { adapter } },
    loadData: vi.fn().mockImplementation(async () => stored),
    saveData: vi.fn().mockImplementation(async (d: any) => { stored = d; }),
    getStored: () => stored,
  } as any;
}

const sampleDomain: DomainEntry = {
  id: "os", name: "OS", wiki_folder: "os",
  source_paths: [], entity_types: [], language_notes: "",
};

describe("migrateLegacyData", () => {
  it("moves data.domains to vault store when vault file absent", async () => {
    const vaultFiles = new Map<string, string>();
    const adapter = {
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p)),
      read: vi.fn().mockImplementation(async (p: string) => vaultFiles.get(p)!),
      write: vi.fn().mockImplementation(async (p: string, c: string) => { vaultFiles.set(p, c); }),
      rename: vi.fn().mockImplementation(async (a: string, b: string) => {
        vaultFiles.set(b, vaultFiles.get(a)!); vaultFiles.delete(a);
      }),
      remove: vi.fn().mockImplementation(async (p: string) => { vaultFiles.delete(p); }),
      mkdir: vi.fn().mockResolvedValue(undefined),
    };
    const plugin = makePlugin({ domains: [sampleDomain] }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    await migrateLegacyData(plugin, new DomainStore({ adapter } as any), new LocalConfigStore(plugin));
    expect(vaultFiles.has("!Wiki/_domain.json")).toBe(true);
    expect(JSON.parse(vaultFiles.get("!Wiki/_domain.json")!)).toEqual([sampleDomain]);
    expect(plugin.getStored().domains).toBeUndefined();
  });

  it("does not overwrite existing vault file", async () => {
    const existing = [{ id: "existing", name: "E", wiki_folder: "e" }];
    const vaultFiles = new Map<string, string>([
      ["!Wiki/_domain.json", JSON.stringify(existing)],
    ]);
    const adapter = {
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p) || p === "!Wiki"),
      read: vi.fn().mockImplementation(async (p: string) => vaultFiles.get(p)!),
      write: vi.fn().mockImplementation(async (p: string, c: string) => { vaultFiles.set(p, c); }),
      rename: vi.fn(),
      remove: vi.fn(),
      mkdir: vi.fn(),
    };
    const plugin = makePlugin({ domains: [sampleDomain] }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    await migrateLegacyData(plugin, new DomainStore({ adapter } as any), new LocalConfigStore(plugin));
    expect(JSON.parse(vaultFiles.get("!Wiki/_domain.json")!)).toEqual(existing);
    expect(plugin.getStored().domains).toBeUndefined();
  });

  it("moves iclaudePath from claudeAgent to local config", async () => {
    const vaultFiles = new Map<string, string>();
    const adapter = {
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p)),
      read: vi.fn().mockImplementation(async (p: string) => vaultFiles.get(p)!),
      write: vi.fn().mockImplementation(async (p: string, c: string) => { vaultFiles.set(p, c); }),
      rename: vi.fn(), remove: vi.fn(), mkdir: vi.fn(),
    };
    const plugin = makePlugin({ claudeAgent: { iclaudePath: "/usr/local/bin/iclaude.sh", model: "sonnet" } }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    const localStore = new LocalConfigStore(plugin);
    await migrateLegacyData(plugin, new DomainStore({ adapter } as any), localStore);
    expect(plugin.getStored().claudeAgent.iclaudePath).toBeUndefined();
    expect((await localStore.load()).iclaudePath).toBe("/usr/local/bin/iclaude.sh");
  });

  it("idempotent: second run is no-op", async () => {
    const vaultFiles = new Map<string, string>();
    const adapter = {
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p)),
      read: vi.fn().mockImplementation(async (p: string) => vaultFiles.get(p)!),
      write: vi.fn().mockImplementation(async (p: string, c: string) => { vaultFiles.set(p, c); }),
      rename: vi.fn().mockImplementation(async (a: string, b: string) => {
        vaultFiles.set(b, vaultFiles.get(a)!); vaultFiles.delete(a);
      }),
      remove: vi.fn().mockImplementation(async (p: string) => { vaultFiles.delete(p); }),
      mkdir: vi.fn(),
    };
    const plugin = makePlugin({ domains: [sampleDomain] }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    const dms = new DomainStore({ adapter } as any);
    const lcs = new LocalConfigStore(plugin);
    await migrateLegacyData(plugin, dms, lcs);
    const saveCallsAfter1 = plugin.saveData.mock.calls.length;
    await migrateLegacyData(plugin, dms, lcs);
    expect(plugin.saveData.mock.calls.length).toBe(saveCallsAfter1); // no extra saves
  });

  it("handles null/empty data without errors", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn(), write: vi.fn(),
      rename: vi.fn(), remove: vi.fn(), mkdir: vi.fn(),
    };
    const plugin = {
      manifest: { dir: ".obsidian/plugins/llm-wiki", id: "llm-wiki" },
      app: { vault: { adapter } },
      loadData: vi.fn().mockResolvedValue(null),
      saveData: vi.fn(),
    } as any;
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    await expect(migrateLegacyData(
      plugin,
      new DomainStore({ adapter } as any),
      new LocalConfigStore(plugin),
    )).resolves.toBeUndefined();
    expect(plugin.saveData).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5.2: Запустить — упадёт (no `migrateLegacyData` export)**

```bash
npx vitest run tests/main-migration.test.ts
```

- [ ] **Step 5.3: Реализовать `migrateLegacyData` в `src/main.ts`**

Добавить экспортируемую функцию в конец `src/main.ts` (после `migrateDomainWikiFolder`):

```ts
import type { DomainStore } from "./domain-store";
import type { LocalConfigStore } from "./local-config";

export async function migrateLegacyData(
  plugin: LlmWikiPlugin,
  domainMapStore: DomainStore,
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const data = (await plugin.loadData()) as Record<string, any> | null;
  if (!data) return;

  let dirty = false;

  // domains → vault
  if (Array.isArray(data.domains)) {
    if (data.domains.length > 0) {
      const vaultExists = await plugin.app.vault.adapter.exists("!Wiki/_domain.json");
      if (!vaultExists) {
        await domainMapStore.save(data.domains as DomainEntry[]);
      }
    }
    delete data.domains;
    dirty = true;
  }

  // claudeAgent.iclaudePath → local config
  const ca = data.claudeAgent as Record<string, any> | undefined;
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
```

Объединить импорт `DomainEntry`: сверху файла должен быть один импорт `import type { DomainEntry } from "./domain";`.

- [ ] **Step 5.4: Запустить тесты миграции**

```bash
npx vitest run tests/main-migration.test.ts
```

Ожидаемо: 5 passed.

- [ ] **Step 5.5: Не коммитить пока — TS-ошибки в других файлах**

---

## Task 6: Обновить `src/controller.ts` — async loadDomains, dispatch через store

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 6.1: Обновить импорты и конструктор**

В `src/controller.ts`:

Импорты — добавить:
```ts
import { applyDomainEvent } from "./domain";
import type { DomainStore } from "./domain-store";
import { DomainCorruptError } from "./domain-store";
import type { LocalConfigStore } from "./local-config";
```

Изменить конструктор (строка 22):
```ts
constructor(
  private app: App,
  private plugin: LlmWikiPlugin,
  private domainMapStore: DomainStore,
  private localConfigStore: LocalConfigStore,
) {}
```

- [ ] **Step 6.2: Сделать `loadDomains()` async и читать из store**

Заменить (строки 165-167):
```ts
async loadDomains(): Promise<DomainEntry[]> {
  try {
    return await this.domainMapStore.load();
  } catch (e) {
    if (e instanceof DomainCorruptError) {
      new Notice(`Domain map corrupt: ${e.message}`);
    }
    throw e;
  }
}
```

- [ ] **Step 6.3: Сделать `registerDomain()` async и писать через store**

Заменить (строки 169-192):
```ts
async registerDomain(input: AddDomainInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = input.id.trim();
  const err = validateDomainId(id);
  if (err) { new Notice(i18n().ctrl.domainAddFailed(err)); return { ok: false, error: err }; }
  const cur = await this.domainMapStore.load();
  if (cur.some((d) => d.id === id)) {
    const msg = `Домен «${id}» уже существует`;
    new Notice(i18n().ctrl.domainAddFailed(msg));
    return { ok: false, error: msg };
  }
  const wikiSubfolder = input.wikiFolder.trim() || id;
  const next: DomainEntry[] = [...cur, {
    id,
    name: input.name.trim() || id,
    wiki_folder: wikiSubfolder,
    source_paths: input.sourcePaths ?? [],
    entity_types: [],
    language_notes: "",
  }];
  await this.domainMapStore.save(next);
  new Notice(i18n().ctrl.domainAdded(id));
  return { ok: true };
}
```

- [ ] **Step 6.4: Обновить `requireClaudeAgent()` — читать iclaudePath из localConfig**

Заменить (строки 194-201):
```ts
private async requireClaudeAgent(): Promise<string | null> {
  const { iclaudePath } = await this.localConfigStore.load();
  if (!iclaudePath || !existsSync(iclaudePath)) {
    new Notice(i18n().ctrl.setClaudeCodePath);
    return null;
  }
  return iclaudePath;
}
```

В `dispatch()` (строка 255) и `dispatchChat()` (строка 66) обновить вызов:
```ts
if (this.plugin.settings.backend === "claude-agent") {
  const path = await this.requireClaudeAgent();
  if (!path) return;
}
```

- [ ] **Step 6.5: Обновить `buildAgentRunner()` — принимать iclaudePath параметром, читать домены из store**

Заменить сигнатуру и тело (строки 203-234):
```ts
private async buildAgentRunner(vaultRoot: string, resumeSessionId?: string): Promise<AgentRunner> {
  const adapter = this.app.vault.adapter as unknown as VaultAdapter;
  const base = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
  const manifestDir = this.plugin.manifest.dir
    ?? join(this.app.vault.configDir, "plugins", this.plugin.manifest.id);
  const pluginDir = (this.app.vault.adapter as { getFullPath: (p: string) => string })
    .getFullPath(manifestDir);
  const tmpDir = join(pluginDir, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const vaultTools = new VaultTools(adapter, base);
  const vaultName = this.app.vault.getName();
  const domains = await this.domainMapStore.load();
  const s = this.plugin.settings;
  const local = await this.localConfigStore.load();

  const maxTimeoutSec = Math.max(...Object.values(s.timeouts));
  let llm: import("./types").LlmClient;
  if (s.backend === "claude-agent") {
    const client = new ClaudeCliClient({
      ...s.claudeAgent,
      iclaudePath: local.iclaudePath,
      requestTimeoutSec: maxTimeoutSec,
      cwd: vaultRoot,
      tmpDir,
      resumeSessionId,
    });
    this._currentClaudeClient = client;
    llm = client;
  } else {
    this._currentClaudeClient = null;
    llm = new OpenAI({
      baseURL: s.nativeAgent.baseUrl,
      apiKey: s.nativeAgent.apiKey,
      timeout: maxTimeoutSec * 1000,
      dangerouslyAllowBrowser: true,
    });
  }

  return new AgentRunner(llm, s, vaultTools, vaultName, domains);
}
```

В `dispatch()` (строка 263) и `dispatchChat()` (строка 74):
```ts
const agentRunner = await this.buildAgentRunner(vaultRoot);
```

- [ ] **Step 6.6: Заменить блок обработки domain-событий в `dispatch()`**

Заменить строки 287-308 на:
```ts
if (ev.kind === "domain_created" || ev.kind === "domain_updated" || ev.kind === "source_path_added") {
  try {
    const cur = await this.domainMapStore.load();
    const next = applyDomainEvent(cur, ev);
    if (next !== cur) await this.domainMapStore.save(next);
  } catch (e) {
    if (e instanceof DomainCorruptError) {
      new Notice(`Domain map corrupt: ${e.message}`);
    }
    status = "error";
  }
}
```

Удалить импорт `consolidateSourcePaths` если он больше нигде не используется (grep), и сам файл `src/source-paths.ts` оставить как есть (фазы могут пользоваться).

- [ ] **Step 6.7: Удалить из `dispatch()` и `dispatchChat()` обращения к `settings.domains`**

Все `this.plugin.settings.domains` → удалены / заменены на store-вызовы (см. Step 6.5).

- [ ] **Step 6.8: TS-проверка**

```bash
npx tsc --noEmit -p tsconfig.json
```

Должны остаться только ошибки в `main.ts` и `settings.ts`.

---

## Task 7: Обновить `src/main.ts` — инстанцировать stores, миграция перед loadSettings

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 7.1: Импорты**

Добавить в начало:
```ts
import { DomainStore } from "./domain-store";
import { LocalConfigStore } from "./local-config";
```

- [ ] **Step 7.2: Поля плагина**

В классе `LlmWikiPlugin` (после `controller!: WikiController;`):
```ts
domainMapStore!: DomainStore;
localConfigStore!: LocalConfigStore;
```

- [ ] **Step 7.3: `onload()` — порядок: stores → migrate → loadSettings → controller**

Заменить начало `onload()` (строки 15-17):
```ts
async onload(): Promise<void> {
  this.domainMapStore = new DomainStore(this.app.vault);
  this.localConfigStore = new LocalConfigStore(this);
  await migrateLegacyData(this, this.domainMapStore, this.localConfigStore);
  await this.loadSettings();
  this.controller = new WikiController(this.app, this, this.domainMapStore, this.localConfigStore);
  this.controller.onBusyChange = () => this.settingTab?.display();
  // ... остальное без изменений
```

- [ ] **Step 7.4: Удалить ссылку на `domains` из `loadSettings()`**

В `loadSettings()` строка 134 удалить:
```ts
domains: Array.isArray(data?.domains) ? (data.domains as DomainEntry[]) : [],
```

Удалить блок миграции wiki_folder (строки 163-166), потому что миграция wiki_folder теперь применима только при загрузке из vault. Перенести её внутрь `DomainStore.load()` ИЛИ оставить как разовый вызов после migrateLegacyData. Оставляем существующий вызов: `migrateLegacyData` записывает в vault уже мигрированные значения. Добавим стрип в `DomainStore.load()`:

В `src/domain-store.ts` после `parsed = JSON.parse(raw)` добавить:
```ts
if (Array.isArray(parsed)) {
  for (const d of parsed as DomainEntry[]) {
    if (typeof d.wiki_folder === "string" && d.wiki_folder.startsWith("!Wiki/")) {
      d.wiki_folder = d.wiki_folder.slice("!Wiki/".length);
    }
  }
}
```

- [ ] **Step 7.5: Удалить миграцию `claudeAgent.iclaudePath` из `loadSettings`**

Строки 144-150 (миграция `claude-code` → `claude-agent`): оставить только переименование backend, удалить `if (data.iclaudePath && !this.settings.claudeAgent.iclaudePath) ...` (поле уже не существует).

Заменить блок (строки 144-150):
```ts
if ((data?.backend as string) === "claude-code") {
  this.settings.backend = "claude-agent";
  if (data && data.model && !this.settings.claudeAgent.model)
    this.settings.claudeAgent.model = data.model as string;
}
```

- [ ] **Step 7.6: TS-проверка**

```bash
npx tsc --noEmit -p tsconfig.json
```

Останутся только ошибки в `settings.ts`.

---

## Task 8: Обновить `src/settings.ts` — UI domains через store, iclaudePath через localConfig

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 8.1: Сделать `display()` async-friendly**

Перед существующим методом `display()` добавить асинхронную загрузку и оставить `display()` синхронным wrapper-ом, который дёргает store + перерисовывает:

Заменить класс шапку и `display()`:
```ts
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
      this.cachedDomains = await this.plugin.domainMapStore.load();
    } catch (e) {
      this.cachedDomains = [];
      new Notice(`Domain map load failed: ${(e as Error).message}`);
    }
    this.cachedIclaudePath = (await this.plugin.localConfigStore.load()).iclaudePath;
    this.render();
  }

  private render(): void {
    // тело старого display() с двумя заменами:
    // 1. domains получаем из this.cachedDomains
    // 2. iclaudePath - из this.cachedIclaudePath
    // ... (см. шаги ниже)
  }
}
```

Импорт:
```ts
import type { DomainEntry } from "./domain";
import { Notice } from "obsidian";
```

- [ ] **Step 8.2: Перенести тело `display()` в `render()`, заменить domain/iclaude источники**

В блоке Domains (строка 90):
```ts
const domains = this.cachedDomains;
```

В блоке iclaudePath (строки 146-153):
```ts
new Setting(containerEl)
  .setName(T.settings.iclaudePath_name)
  .setDesc(T.settings.iclaudePath_desc + " (хранится в local.json, не синхронизируется)")
  .addText((t) =>
    t.setPlaceholder("/home/user/Documents/Project/iclaude/iclaude.sh")
      .setValue(this.cachedIclaudePath)
      .onChange(async (v) => {
        this.cachedIclaudePath = v.trim();
        await this.plugin.localConfigStore.save({ iclaudePath: this.cachedIclaudePath });
      }),
  );
```

В edit/delete доменов (строки 104-122):
```ts
.addButton((b) => {
  b.setButtonText(T.settings.editDomain).setDisabled(busy).onClick(() => {
    new EditDomainModal(this.plugin.app, d, (updated) => {
      void (async () => {
        const cur = await this.plugin.domainMapStore.load();
        const idx = cur.findIndex((x) => x.id === updated.id);
        if (idx >= 0) cur[idx] = updated;
        await this.plugin.domainMapStore.save(cur);
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
        const cur = await this.plugin.domainMapStore.load();
        await this.plugin.domainMapStore.save(cur.filter((x) => x.id !== d.id));
        await this.refresh();
      })();
    }).open();
  });
});
```

- [ ] **Step 8.3: TS-проверка**

```bash
npx tsc --noEmit -p tsconfig.json
```

Ожидаемо: ноль ошибок.

- [ ] **Step 8.4: Запустить полный тест-сьют**

```bash
npm test
```

Ожидаемо: ошибок только в `tests/agent-runner.integration.test.ts` если он использует удалённый `iclaudePath` в settings — починим в Task 9. Все остальные должны быть зелёные.

- [ ] **Step 8.5: Коммит (промежуточный — после Task 6/7/8)**

```bash
git add src/types.ts src/main.ts src/controller.ts src/settings.ts src/domain.ts src/domain-store.ts src/local-config.ts tests/main-migration.test.ts
git commit -m "feat: domain-map → vault, iclaudePath → local config

- DomainStore writes !Wiki/_domain.json (atomic, lazy reads)
- LocalConfigStore writes <plugin-dir>/local.json (machine-local)
- migrateLegacyData runs in onload before loadSettings
- WikiController takes both stores via constructor
- Settings UI binds to stores instead of plugin.settings"
```

---

## Task 9: Обновить тесты integration

**Files:**
- Modify: `tests/agent-runner.integration.test.ts`

- [ ] **Step 9.1: Грепнуть упоминания удалённых полей**

```bash
grep -rn "iclaudePath\|settings.domains\|claudeAgent.iclaudePath" tests/
```

- [ ] **Step 9.2: В каждом найденном тесте**

- Удалить `iclaudePath` из mock-объектов `claudeAgent`.
- Заменить `settings.domains: [...]` на mock domainMapStore (если controller инстанцируется в тесте) ИЛИ передавать domains прямо в `AgentRunner` конструктор (он принимает `domains` параметром).
- Если тест использует `WikiController` — добавить mock-stores с `load()`/`save()` vi.fn().

- [ ] **Step 9.3: Прогнать**

```bash
npm test
```

Все зелёные.

- [ ] **Step 9.4: Коммит**

```bash
git add tests/
git commit -m "test: update integration tests for store-based domain/iclaude storage"
```

---

## Task 10: Сборка, version bump, финальный коммит

**Files:**
- Modify: `package.json`, `src/manifest.json`

- [ ] **Step 10.1: Запустить полный сьют**

```bash
npm test
```

Все зелёные.

- [ ] **Step 10.2: Bump patch-версии**

Прочитать `package.json` field `version`. Инкрементировать patch (`X.Y.Z` → `X.Y.(Z+1)`).

Записать новое значение в `package.json` и `src/manifest.json`.

- [ ] **Step 10.3: Сборка**

```bash
npm run build
```

Ожидаемо: `main.js` пересобран без ошибок.

- [ ] **Step 10.4: Финальный коммит**

```bash
git add package.json src/manifest.json dist/main.js dist/manifest.json
git commit -m "chore: bump version, rebuild dist"
```

---

## Self-Review Result

**Spec coverage:**
- Components (DomainStore, LocalConfigStore) — Task 1, 2 ✓
- Migration — Task 5 ✓
- Types удаление — Task 4 ✓
- Controller интеграция — Task 6 ✓
- onload порядок — Task 7 ✓
- Settings UI — Task 8 ✓
- Tests — Task 1, 2, 3, 5, 9 ✓
- Atomic write через .tmp + rename — Step 1.3 ✓
- Hard-fail на corrupt → Notice + abort — Step 6.6 ✓
- `_domain.json` отсутствует → `[]` — Step 1.3 (load returns []) ✓
- `applyDomainEvent` helper — Task 3 ✓
- wiki_folder strip migration — Step 7.4 (перенесена в DomainStore.load) ✓
- README sync exclusion note — **gap**: добавить в Task 10 step.

**Дополнить Task 10:**

- [ ] **Step 10.5: Обновить README**

Добавить в README раздел:

```markdown
## Sync configuration

Файл `<plugin-dir>/local.json` содержит machine-specific путь до `iclaude.sh`.
При использовании Obsidian Sync / git / Syncthing для `.obsidian/plugins/obsidian-llm-wiki/`
исключите `local.json` из синка чтобы избежать перезаписи пути на других машинах.
```

- [ ] **Step 10.6: Закоммитить README**

```bash
git add README.md
git commit -m "docs: note about local.json sync exclusion"
```

**Placeholder scan:** ноль `TBD/TODO/implement later`.

**Type consistency:** `DomainStore`, `LocalConfigStore`, `applyDomainEvent`, `migrateLegacyData` — имена консистентны во всех тасках.
