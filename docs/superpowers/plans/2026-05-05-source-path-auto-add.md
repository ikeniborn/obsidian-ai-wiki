# Source Path Auto-Add: Parent + Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При ingest автоматически добавлять прямого родителя файла в `source_paths` домена, заменяя более глубокие покрытые пути (consolidation), с верхней границей — vault root.

**Architecture:** Три точечных изменения: (1) `VaultTools` открывает `vaultRoot`; (2) чистая функция `consolidateSourcePaths` в новом `src/source-paths.ts`; (3) `extractTopLevelSourcePath` → `extractParentSourcePath` с clamping; (4) controller заменяет простой push на consolidation.

**Tech Stack:** TypeScript, Node.js `node:path`, vitest.

---

## Затронутые файлы

| Файл | Действие |
|---|---|
| `src/vault-tools.ts` | Modify: добавить `get vaultRoot()` |
| `src/source-paths.ts` | Create: чистая функция `consolidateSourcePaths` |
| `src/phases/ingest.ts` | Modify: `extractTopLevelSourcePath` → `extractParentSourcePath`, обновить call site |
| `src/controller.ts` | Modify: handler `source_path_added` использует `consolidateSourcePaths` |
| `tests/vault-tools.test.ts` | Modify: добавить тест на `vaultRoot` |
| `tests/source-paths.test.ts` | Create: тесты `consolidateSourcePaths` |
| `tests/ingest.test.ts` | Create: тесты `extractParentSourcePath` и `detectDomain` |

---

### Task 1: `VaultTools.vaultRoot` getter

**Files:**
- Modify: `src/vault-tools.ts`
- Modify: `tests/vault-tools.test.ts`

- [ ] **Step 1: Написать падающий тест**

Добавить в `tests/vault-tools.test.ts` после последнего `it(...)`:

```ts
it("vaultRoot returns the absolute vault base path", () => {
  const vt = new VaultTools(mockAdapter(), "/home/user/vault");
  expect(vt.vaultRoot).toBe("/home/user/vault");
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
npx vitest run tests/vault-tools.test.ts
```

Ожидаем: FAIL — `TypeError: vt.vaultRoot is not a function` или `undefined`.

- [ ] **Step 3: Добавить getter в `VaultTools`**

В `src/vault-tools.ts`, после конструктора (после строки `) {}`), добавить:

```ts
  get vaultRoot(): string { return this.basePath; }
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
npx vitest run tests/vault-tools.test.ts
```

Ожидаем: PASS все тесты.

- [ ] **Step 5: Commit**

```bash
git add src/vault-tools.ts tests/vault-tools.test.ts
git commit -m "feat(vault-tools): expose vaultRoot getter"
```

---

### Task 2: Чистая функция `consolidateSourcePaths`

**Files:**
- Create: `src/source-paths.ts`
- Create: `tests/source-paths.test.ts`

- [ ] **Step 1: Создать тестовый файл с падающими тестами**

Создать `tests/source-paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { consolidateSourcePaths } from "../src/source-paths";

const ROOT = "/project";

describe("consolidateSourcePaths", () => {
  it("adds path to empty list", () => {
    expect(consolidateSourcePaths([], "notes/", ROOT))
      .toEqual(["notes/"]);
  });

  it("no change when new path is already covered by ancestor", () => {
    // "notes/" covers "notes/sub/" — adding "notes/sub/" is redundant
    expect(consolidateSourcePaths(["notes/"], "notes/sub/", ROOT))
      .toEqual(["notes/"]);
  });

  it("no change when identical path already exists", () => {
    expect(consolidateSourcePaths(["notes/"], "notes/", ROOT))
      .toEqual(["notes/"]);
  });

  it("replaces deeper descendants when ancestor is added", () => {
    const result = consolidateSourcePaths(["notes/sub/", "docs/"], "notes/", ROOT);
    expect(result).toContain("notes/");
    expect(result).toContain("docs/");
    expect(result).not.toContain("notes/sub/");
  });

  it("replaces multiple descendants", () => {
    const result = consolidateSourcePaths(["notes/a/", "notes/b/", "other/"], "notes/", ROOT);
    expect(result).toContain("notes/");
    expect(result).toContain("other/");
    expect(result).not.toContain("notes/a/");
    expect(result).not.toContain("notes/b/");
  });

  it("no overlap — both paths kept", () => {
    const result = consolidateSourcePaths(["docs/"], "notes/", ROOT);
    expect(result).toContain("docs/");
    expect(result).toContain("notes/");
  });

  it("handles absolute existing paths mixed with relative new path", () => {
    const result = consolidateSourcePaths(["/project/notes/sub/"], "notes/", ROOT);
    expect(result).toContain("notes/");
    expect(result).not.toContain("/project/notes/sub/");
  });

  it("handles absolute new path with relative existing", () => {
    const result = consolidateSourcePaths(["notes/sub/"], "/project/notes/", ROOT);
    expect(result).toContain("/project/notes/");
    expect(result).not.toContain("notes/sub/");
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться что падают**

```bash
npx vitest run tests/source-paths.test.ts
```

Ожидаем: FAIL — `Cannot find module '../src/source-paths'`.

- [ ] **Step 3: Создать `src/source-paths.ts`**

```ts
import { isAbsolute, join } from "node:path";

/**
 * Returns updated source_paths after adding newPath with consolidation:
 * - If newPath is already covered by an existing ancestor → returns existing unchanged
 * - Removes entries that are descendants of newPath (they become redundant)
 * - Adds newPath
 */
export function consolidateSourcePaths(
  existing: string[],
  newPath: string,
  repoRoot: string,
): string[] {
  const toAbs = (p: string): string => (isAbsolute(p) ? p : join(repoRoot, p));
  const normed = (p: string): string => {
    const a = toAbs(p);
    return a.endsWith("/") ? a : a + "/";
  };

  const newNormed = normed(newPath);

  // Already covered by an existing ancestor?
  if (existing.some((sp) => newNormed.startsWith(normed(sp)))) {
    return existing;
  }

  // Remove descendants (paths that start with newNormed)
  const filtered = existing.filter((sp) => !normed(sp).startsWith(newNormed));

  return [...filtered, newPath];
}
```

- [ ] **Step 4: Запустить тесты — убедиться что проходят**

```bash
npx vitest run tests/source-paths.test.ts
```

Ожидаем: PASS все 8 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/source-paths.ts tests/source-paths.test.ts
git commit -m "feat(source-paths): add consolidateSourcePaths pure function"
```

---

### Task 3: `extractParentSourcePath` + обновление call site в `ingest.ts`

**Files:**
- Create: `tests/ingest.test.ts`
- Modify: `src/phases/ingest.ts`

- [ ] **Step 1: Создать тестовый файл с падающими тестами**

Создать `tests/ingest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractParentSourcePath, detectDomain } from "../src/phases/ingest";
import type { DomainEntry } from "../src/domain-map";

describe("extractParentSourcePath", () => {
  it("returns direct parent relative to repoRoot", () => {
    expect(extractParentSourcePath(
      "/project/notes/sub/file.md",
      "/project",
      "/project",
    )).toBe("notes/sub/");
  });

  it("returns direct parent when file is one level deep", () => {
    expect(extractParentSourcePath(
      "/project/notes/file.md",
      "/project",
      "/project",
    )).toBe("notes/");
  });

  it("returns vault root path when file is directly in vault", () => {
    // родитель = vault root → "./"
    expect(extractParentSourcePath(
      "/project/file.md",
      "/project",
      "/project",
    )).toBe("./");
  });

  it("works when repoRoot differs from vaultRoot (vaults/ structure)", () => {
    expect(extractParentSourcePath(
      "/project/vaults/MyVault/folder/file.md",
      "/project",
      "/project/vaults/MyVault",
    )).toBe("vaults/MyVault/folder/");
  });

  it("returns vault root path when file is directly in vault (vaults/ structure)", () => {
    expect(extractParentSourcePath(
      "/project/vaults/MyVault/file.md",
      "/project",
      "/project/vaults/MyVault",
    )).toBe("vaults/MyVault/");
  });
});

describe("detectDomain", () => {
  const makeD = (id: string, paths: string[]): DomainEntry => ({
    id, name: id, wiki_folder: `!Wiki/${id}`, source_paths: paths,
  });

  it("matches by source_paths prefix", () => {
    const domains = [makeD("d1", ["notes/"]), makeD("d2", ["docs/"])];
    const result = detectDomain("/project/notes/sub/file.md", domains, "/project");
    expect(result?.id).toBe("d1");
  });

  it("falls back to first domain if no match", () => {
    const domains = [makeD("fallback", []), makeD("other", ["docs/"])];
    const result = detectDomain("/project/unknown/file.md", domains, "/project");
    expect(result?.id).toBe("fallback");
  });

  it("returns null if domains empty", () => {
    expect(detectDomain("/project/file.md", [], "/project")).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться что падают**

```bash
npx vitest run tests/ingest.test.ts
```

Ожидаем: FAIL — `extractParentSourcePath is not a function`.

- [ ] **Step 3: Обновить `src/phases/ingest.ts` — функция и call site в одном шаге**

Добавить `dirname` в импорт `node:path` (строка 1):

```ts
import { isAbsolute, join, relative, dirname } from "node:path";
```

Заменить call site (строки ~120–129):

```ts
    const topPath = extractTopLevelSourcePath(absSource, repoRoot);
    if (topPath) {
      const norm = (p: string) => p.replace(/\/$/, "");
      const alreadyCovered = (domain.source_paths ?? []).some((sp) => norm(sp) === norm(topPath));
      if (!alreadyCovered) {
        yield { kind: "source_path_added", domainId: domain.id, path: topPath };
      }
    }
```

→ на:

```ts
    const parentPath = extractParentSourcePath(absSource, repoRoot, vaultTools.vaultRoot);
    yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
```

Заменить функцию `extractTopLevelSourcePath` (строки 211–217) на:

```ts
export function extractParentSourcePath(
  absSource: string,
  repoRoot: string,
  vaultRoot: string,
): string {
  const parentAbs = dirname(absSource);
  // Clamp: не выходить выше vault root
  const normedVault = vaultRoot.endsWith("/") ? vaultRoot : vaultRoot + "/";
  const clamped = (parentAbs + "/").startsWith(normedVault) ? parentAbs : vaultRoot;
  const rel = relative(repoRoot, clamped);
  return (rel || ".") + "/";
}
```

> Оба изменения — call site и определение функции — делаются в одном шаге, чтобы не создавать сломанное промежуточное состояние (TypeScript-ошибка на отсутствующее имя).

- [ ] **Step 4: Запустить все тесты**

```bash
npm test
```

Ожидаем: PASS все тесты.

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts tests/ingest.test.ts
git commit -m "feat(ingest): extractTopLevelSourcePath → extractParentSourcePath with vault-root clamping"
```

---

### Task 4: Consolidation в `controller.ts`

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Добавить импорт `consolidateSourcePaths`**

В начало `src/controller.ts`, после существующих импортов, добавить:

```ts
import { consolidateSourcePaths } from "./source-paths";
```

- [ ] **Step 2: Заменить handler `source_path_added`**

Найти блок (строки ~257–266):

```ts
        if (ev.kind === "source_path_added") {
          const domain = this.plugin.settings.domains.find((d) => d.id === ev.domainId);
          if (domain) {
            if (!domain.source_paths) domain.source_paths = [];
            if (!domain.source_paths.includes(ev.path)) {
              domain.source_paths.push(ev.path);
              void this.plugin.saveSettings();
            }
          }
        }
```

Заменить на:

```ts
        if (ev.kind === "source_path_added") {
          const domain = this.plugin.settings.domains.find((d) => d.id === ev.domainId);
          if (domain) {
            domain.source_paths = consolidateSourcePaths(
              domain.source_paths ?? [],
              ev.path,
              repoRoot,
            );
            void this.plugin.saveSettings();
          }
        }
```

> `repoRoot` уже объявлен в методе `dispatch()` выше (строка ~217) и доступен в замыкании event loop.

- [ ] **Step 3: Запустить все тесты**

```bash
npm test
```

Ожидаем: PASS всё.

- [ ] **Step 4: Проверить сборку**

```bash
npm run build
```

Ожидаем: успешно, без TypeScript ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): consolidate source_paths on ingest (replace deeper paths with ancestor)"
```

---

### Task 5: Финальная проверка

- [ ] **Step 1: Запустить все тесты ещё раз**

```bash
npm test
```

Ожидаем: все PASS.

- [ ] **Step 2: Проверить отсутствие старого имени в исходниках**

```bash
grep -r "extractTopLevelSourcePath" src/
```

Ожидаем: пустой вывод.

- [ ] **Step 3: Bump patch-версии и финальная сборка**

Прочитать текущую версию из `package.json`, увеличить patch, обновить `package.json` и `manifest.json`, запустить build:

```bash
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json','utf-8'));
const [maj,min,pat] = pkg.version.split('.').map(Number);
const next = \`\${maj}.\${min}.\${pat+1}\`;
pkg.version = next;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n');
const man = JSON.parse(fs.readFileSync('manifest.json','utf-8'));
man.version = next;
fs.writeFileSync('manifest.json', JSON.stringify(man, null, '\t') + '\n');
console.log('version:', next);
"
npm run build
```

- [ ] **Step 4: Финальный commit**

```bash
git add package.json manifest.json dist/main.js dist/manifest.json
git commit -m "chore: bump version, build"
```
