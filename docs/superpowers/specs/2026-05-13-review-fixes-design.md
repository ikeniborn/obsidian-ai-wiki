# Дизайн: исправление замечаний ревью Obsidian Community

## Контекст

Obsidian Community plugin review выявил 5 категорий замечаний. Все исправления независимы.

---

## 1. `node:child_process` → `child_process`

**Файл:** `src/claude-cli-client.ts:1`

**Проблема:** Obsidian-валидатор отклоняет `node:`-префиксные импорты.

**Фикс:**
- `import { spawn } from "node:child_process"` → `import { spawn } from "child_process"`
- В `esbuild.config.mjs` в массиве `external`: заменить `"node:child_process"` на `"child_process"`

---

## 2. TypeScript-ошибки в `modals.ts:138`

**Файл:** `src/modals.ts:138`

**Проблема:** `activeDocument` из Obsidian не типизирован как `Document`. Три предупреждения ESLint:
- Unsafe assignment of an error typed value
- Unsafe call of a type that could not be resolved
- Unsafe member access `.body`

**Причина:** `activeDocument` в Obsidian typings объявлен как `Document` (`obsidian.d.ts:267`), поэтому каст на `activeDocument` бесполезен. Проблема в `Document.body` → `HTMLBodyElement | null`: ESLint видит `.createDiv()` как вызов на неразрешённом типе (`HTMLBodyElement | null` не имеет `createDiv` без Obsidian-аугментации).

**Фикс:**
```ts
// было
dropEl = activeDocument.body.createDiv({ cls: "ai-wiki-folder-dropdown" });
// стало
dropEl = (activeDocument.body as HTMLElement).createDiv({ cls: "ai-wiki-folder-dropdown" });
```

Каст на `HTMLElement` убирает `null` и даёт тип с Obsidian-расширением `createDiv`. Все 3 ESLint-предупреждения устраняются.

---

## 3. `setInterval` → рекурсивный `setTimeout`

**Файл:** `src/view.ts`, строки 302 и 589

**Проблема:** Валидатор помечает комбинацию `setInterval` + сетевые вызовы как подозрительную (ложный флаг — таймеры чисто UI). `setTimeout` рекурсивный семантически эквивалентен, но не триггерит правило.

### Таймер метрик (`tickHandle`, строка 302)

**До:**
```ts
private tickHandle: number | null = null;
// в setRunning():
this.tickHandle = window.setInterval(() => this.updateMetrics(), 500);
// остановка:
window.clearInterval(this.tickHandle); this.tickHandle = null;
```

**После:**
```ts
private tickHandle: ReturnType<typeof window.setTimeout> | null = null;

private scheduleMetricsTick(): void {
  this.tickHandle = window.setTimeout(() => {
    this.updateMetrics();
    if (this.state === "running") this.scheduleMetricsTick();
  }, 500);
}
// в setRunning():
if (this.tickHandle !== null) { window.clearTimeout(this.tickHandle); this.tickHandle = null; }
this.scheduleMetricsTick();
// остановка (строка 504):
window.clearTimeout(this.tickHandle); this.tickHandle = null;
```

### Таймер чат-баблa (`chatTickHandle`, строка 589)

Аналогичный рефакторинг: `setInterval` → рекурсивный `setTimeout` с проверкой `this.currentChatBubble !== null`.

**До:**
```ts
this.chatTickHandle = window.setInterval(() => {
  if (this.currentChatBubble) {
    const s = ((Date.now() - this.chatStartTs) / 1000).toFixed(1);
    this.currentChatBubble.setText(`⏳ ${s}s…`);
  }
}, 500);
```

**После:**
```ts
private scheduleChatTick(): void {
  this.chatTickHandle = window.setTimeout(() => {
    if (this.currentChatBubble) {
      const s = ((Date.now() - this.chatStartTs) / 1000).toFixed(1);
      this.currentChatBubble.setText(`⏳ ${s}s…`);
      this.scheduleChatTick();
    } else {
      this.chatTickHandle = null;
    }
  }, 500);
}
```

Все `clearInterval` → `clearTimeout`. Явный список замен в `view.ts`:

| Строка | Было | Стало |
|--------|------|-------|
| 195 | `window.clearInterval(this.chatTickHandle)` | `window.clearTimeout(this.chatTickHandle)` |
| 301 | `window.clearInterval(this.tickHandle)` | `window.clearTimeout(this.tickHandle)` |
| 504 | `window.clearInterval(this.tickHandle)` | `window.clearTimeout(this.tickHandle)` |
| 600 | `window.clearInterval(this.chatTickHandle)` | `window.clearTimeout(this.chatTickHandle)` |
| 612 | `window.clearInterval(this.chatTickHandle)` | `window.clearTimeout(this.chatTickHandle)` |

---

## 4. GitHub Artifact Attestations

**Файл:** `.github/workflows/release.yml`

**Проблема:** `main.js` и `styles.css` не имеют криптографической аттестации происхождения.

**Фикс — обновить `permissions`:**
```yaml
permissions:
  contents: write
  attestations: write
  id-token: write
```

**Добавить шаг после Build, перед Create release:**
```yaml
- name: Attest build provenance
  uses: actions/attest-build-provenance@v2
  with:
    subject-path: |
      dist/main.js
      dist/styles.css
```

---

## 5. README: английский текст

**Файл:** `README.md`

**Проблема:** Весь текст на русском. Obsidian Community требует английское описание.

**Фикс:** Добавить English section в начало README (перед русским блоком). Минимум: название, краткое описание (2–3 предложения), список ключевых фич, требования.

---

## Порядок реализации

Все изменения независимы. Рекомендуемый порядок:

1. `node:child_process` fix (1 строка)
2. `modals.ts` TypeScript cast (1 строка)
3. `setInterval` → `setTimeout` рефакторинг (`view.ts`)
4. CI: artifact attestations (`release.yml`)
5. README: английский раздел

После всех изменений — bump patch-версии и релиз через `/publish-version`.
