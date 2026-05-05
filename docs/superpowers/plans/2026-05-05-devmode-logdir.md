# devMode logPath → logDir Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить поле `devMode.logPath` (полный путь к файлу) на `devMode.logDir` (только директория); имя файла `dev.jsonl` фиксировано в коде.

**Architecture:** Переименование поля в типах и дефолтных настройках, обновление места использования в `agent-runner.ts` (конструируем путь через `path.join`), обновление UI в `settings.ts` и описаний в `i18n.ts`, добавление миграции в `main.ts`.

**Tech Stack:** TypeScript, Obsidian Plugin API, Node.js `path`, `node:fs`

---

### Task 1: Обновить тип и дефолтные настройки

**Files:**
- Modify: `src/types.ts:128-133` (интерфейс `devMode`), `src/types.ts:172-176` (DEFAULT_SETTINGS)

- [ ] **Step 1: Заменить `logPath` на `logDir` в интерфейсе `LlmWikiPluginSettings`**

В `src/types.ts`, строки 128–131, заменить:
```ts
  devMode: {
    enabled: boolean;
    logPath: string;
    evaluatorModel: string;
  };
```
на:
```ts
  devMode: {
    enabled: boolean;
    logDir: string;
    evaluatorModel: string;
  };
```

- [ ] **Step 2: Заменить `logPath` на `logDir` в `DEFAULT_SETTINGS`**

В `src/types.ts`, строки 172–176, заменить:
```ts
  devMode: {
    enabled: false,
    logPath: "",
    evaluatorModel: "sonnet",
  },
```
на:
```ts
  devMode: {
    enabled: false,
    logDir: "",
    evaluatorModel: "sonnet",
  },
```

- [ ] **Step 3: Убедиться что TypeScript компилируется без ошибок**

```bash
npx tsc --noEmit
```

Ожидание: ошибки в `agent-runner.ts` и `settings.ts` (они ссылаются на `logPath` — исправим в следующих задачах).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "refactor(types): rename devMode.logPath to logDir"
```

---

### Task 2: Обновить agent-runner.ts

**Files:**
- Modify: `src/agent-runner.ts:1` (импорты), `src/agent-runner.ts:46-50` (writeDevLog), `src/agent-runner.ts:136-146` (updateDevLogEval)

- [ ] **Step 1: Добавить импорт `path` в начало файла**

В `src/agent-runner.ts` строка 1, после `import { appendFileSync } from "node:fs";` добавить:
```ts
import { join } from "node:path";
```

- [ ] **Step 2: Обновить метод `writeDevLog`**

Строки 46–51 (`writeDevLog`), заменить:
```ts
    const logPath = this.settings.devMode?.logPath;
    if (!logPath) return;
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
      appendFileSync(logPath, line, "utf-8");
    } catch { /* не блокируем операцию */ }
```
на:
```ts
    const logDir = this.settings.devMode?.logDir;
    if (!logDir) return;
    const logPath = join(logDir, "dev.jsonl");
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
      appendFileSync(logPath, line, "utf-8");
    } catch { /* не блокируем операцию */ }
```

- [ ] **Step 3: Обновить метод `updateDevLogEval`**

Строки 136–147 (`updateDevLogEval`), заменить:
```ts
    const logPath = this.settings.devMode?.logPath;
    if (!logPath) return;
    try {
      const fs = require("node:fs") as typeof import("node:fs");
      const content = fs.readFileSync(logPath, "utf-8");
```
на:
```ts
    const logDir = this.settings.devMode?.logDir;
    if (!logDir) return;
    const logPath = join(logDir, "dev.jsonl");
    try {
      const fs = require("node:fs") as typeof import("node:fs");
      const content = fs.readFileSync(logPath, "utf-8");
```

- [ ] **Step 4: Проверить компиляцию**

```bash
npx tsc --noEmit
```

Ожидание: ошибки только в `settings.ts` (ещё не обновлён).

- [ ] **Step 5: Commit**

```bash
git add src/agent-runner.ts
git commit -m "refactor(agent-runner): use devMode.logDir + fixed filename dev.jsonl"
```

---

### Task 3: Обновить settings.ts и i18n.ts

**Files:**
- Modify: `src/settings.ts:320-325` (поле devMode logPath)
- Modify: `src/i18n.ts:61-62`, `src/i18n.ts:208-209`, `src/i18n.ts:353-354`

- [ ] **Step 1: Обновить привязку поля в settings.ts**

Строки 319–326, заменить:
```ts
    new Setting(containerEl)
      .setName(T.settings.devMode_logPath_name)
      .setDesc(T.settings.devMode_logPath_desc)
      .addText((t) =>
        t.setPlaceholder("/tmp/llm-wiki-dev.jsonl")
          .setValue(s.devMode.logPath)
          .onChange(async (v) => { s.devMode.logPath = v.trim(); await this.plugin.saveSettings(); }),
      );
```
на:
```ts
    new Setting(containerEl)
      .setName(T.settings.devMode_logPath_name)
      .setDesc(T.settings.devMode_logPath_desc)
      .addText((t) =>
        t.setPlaceholder("/tmp")
          .setValue(s.devMode.logDir)
          .onChange(async (v) => { s.devMode.logDir = v.trim(); await this.plugin.saveSettings(); }),
      );
```

- [ ] **Step 2: Обновить английские строки в i18n.ts**

Строки 61–62, заменить:
```ts
    devMode_logPath_name: "Dev log path",
    devMode_logPath_desc: "Path to JSONL file for dev logs.",
```
на:
```ts
    devMode_logPath_name: "Dev log directory",
    devMode_logPath_desc: "Directory for dev logs. File name: dev.jsonl",
```

- [ ] **Step 3: Обновить русские строки в i18n.ts**

Строки 208–209, заменить:
```ts
    devMode_logPath_name: "Путь к dev-логу",
    devMode_logPath_desc: "Путь к JSONL-файлу для dev-логов.",
```
на:
```ts
    devMode_logPath_name: "Директория dev-логов",
    devMode_logPath_desc: "Директория для dev-логов. Имя файла: dev.jsonl",
```

- [ ] **Step 4: Обновить испанские строки в i18n.ts**

Строки 353–354, заменить:
```ts
    devMode_logPath_name: "Ruta del log dev",
    devMode_logPath_desc: "Ruta al archivo JSONL para logs dev.",
```
на:
```ts
    devMode_logPath_name: "Directorio de log dev",
    devMode_logPath_desc: "Directorio para logs dev. Nombre del archivo: dev.jsonl",
```

- [ ] **Step 5: Проверить что компиляция чистая**

```bash
npx tsc --noEmit
```

Ожидание: 0 ошибок.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts src/i18n.ts
git commit -m "refactor(settings): devMode logPath input → logDir directory input"
```

---

### Task 4: Добавить миграцию в main.ts

**Files:**
- Modify: `src/main.ts:134-148` (блок миграций в `loadSettings`)

- [ ] **Step 1: Добавить импорт `dirname` в main.ts**

В строке 1 `src/main.ts` добавить:
```ts
import { dirname } from "node:path";
```

- [ ] **Step 2: Добавить миграцию после существующих миграций**

После строки 147 (`}`), но внутри `loadSettings()`, добавить:
```ts
    // Миграция: devMode.logPath → devMode.logDir
    const devData = data?.devMode as Record<string, unknown> | undefined;
    if (devData?.logPath !== undefined && devData?.logDir === undefined) {
      this.settings.devMode.logDir = devData.logPath
        ? dirname(devData.logPath as string)
        : "";
    }
```

- [ ] **Step 3: Проверить компиляцию**

```bash
npx tsc --noEmit
```

Ожидание: 0 ошибок.

- [ ] **Step 4: Запустить тесты**

```bash
npm test
```

Ожидание: все тесты зелёные.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): migrate devMode.logPath to logDir on settings load"
```

---

### Task 5: Финальная сборка

**Files:**
- Modify: `package.json`, `manifest.json` (patch version bump)
- Build: `main.js`

- [ ] **Step 1: Поднять patch-версию**

Прочитать текущую версию из `package.json` (поле `version`), инкрементировать patch `X.Y.Z → X.Y.(Z+1)`, записать в `package.json` и `manifest.json`.

- [ ] **Step 2: Собрать**

```bash
npm run build
```

Ожидание: `main.js` обновлён, нет ошибок.

- [ ] **Step 3: Commit**

```bash
git add package.json manifest.json main.js
git commit -m "chore: bump version, build"
```
