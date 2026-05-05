# Domain Form UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Улучшить UX `EditDomainModal`: карточки вместо JSON для entity_types, per-item список для source_paths, textarea для language_notes.

**Architecture:** `EditDomainModal` получает два новых метода рендеринга (`renderEntityTypes`, `renderSourcePaths`), которые перерисовывают только свой контейнер при переключении режима. `handleSave()` читает из `entityTypesList` (card-mode) или парсит `entityTypesVal` (json-mode). Source paths хранятся как `string[]` напрямую.

**Tech Stack:** TypeScript, Obsidian API (Modal, Setting, HTMLElement), Vitest

---

## File Map

| Файл | Что меняется |
|---|---|
| `src/i18n.ts` | 5 новых строк в `en`, `ru`, `es`; обновить `sourcePathsLabel` и `entityTypesLabel` |
| `styles.css` | CSS классы для карточек entity_types и строк source_paths |
| `src/modals.ts` | `EditDomainModal`: новые поля, `onOpen()`, два метода рендеринга, `handleSave()` |
| `vitest.mock.ts` | Добавить минимальный `contentEl` в `Modal` для тестов |
| `tests/modals.test.ts` | Тесты для `handleSave()` routing + state init |

---

### Task 1: i18n strings

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: Обновить два существующих ключа и добавить 5 новых в `en.modal`**

Сначала заменить два существующих ключа (найти по точному тексту и заменить значение):

```ts
// Найти строку:  entityTypesLabel: "Entity types (JSON array)",
// Заменить на:
entityTypesLabel: "Entity types",

// Найти строку:  sourcePathsLabel: "Source paths (one per line)",
// Заменить на:
sourcePathsLabel: "Source paths",
```

Затем добавить 5 новых ключей после `sourcePathsLabel`:

```ts
entityTypesEditJson: "Edit JSON",
entityTypesBackToCards: "← Cards",
entityTypesEmpty: "No entity types defined. Click 'Edit JSON' to add.",
sourcePathsAdd: "Add",
sourcePathsPlaceholder: "/path/to/folder or file",
```

- [ ] **Step 2: Обновить два существующих ключа и добавить 5 новых в `ru.modal`**

Заменить два существующих ключа:

```ts
// Найти строку:  entityTypesLabel: "Типы сущностей (JSON-массив)",
// Заменить на:
entityTypesLabel: "Типы сущностей",

// Найти строку:  sourcePathsLabel: "Пути источников (по одному на строку)",
// Заменить на:
sourcePathsLabel: "Пути источников",
```

Добавить 5 новых ключей после `sourcePathsLabel`:

```ts
entityTypesEditJson: "Редактировать JSON",
entityTypesBackToCards: "← Карточки",
entityTypesEmpty: "Типы сущностей не заданы. Нажмите «Редактировать JSON» чтобы добавить.",
sourcePathsAdd: "Добавить",
sourcePathsPlaceholder: "/путь/к/папке или файлу",
```

- [ ] **Step 3: Обновить два существующих ключа и добавить 5 новых в `es.modal`**

Заменить два существующих ключа:

```ts
// Найти строку с entityTypesLabel в es (содержит "JSON"):
entityTypesLabel: "Tipos de entidades",

// Найти строку с sourcePathsLabel в es:
sourcePathsLabel: "Rutas fuente",
```

Добавить 5 новых ключей после `sourcePathsLabel`:

```ts
entityTypesEditJson: "Editar JSON",
entityTypesBackToCards: "← Tarjetas",
entityTypesEmpty: "No hay tipos de entidades. Haz clic en 'Editar JSON' para añadir.",
sourcePathsAdd: "Añadir",
sourcePathsPlaceholder: "/ruta/a/carpeta o archivo",
```

- [ ] **Step 4: Убедиться что TypeScript компилируется**

```bash
cd /home/UF.RT.RU/i.y.tischenko/Документы/Git/obsidian-llm-wiki
npx tsc --noEmit 2>&1 | head -20
```

Ожидается: ошибки только в `modals.ts` (ещё не обновлён). Ошибок в `i18n.ts` быть не должно.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): add strings for entity-types cards and source-paths list UI"
```

---

### Task 2: CSS стили

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Добавить стили для entity_types карточек**

Добавить в конец `styles.css`:

```css
/* EditDomainModal — entity types cards */
.llm-wiki-et-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0 6px;
}
.llm-wiki-et-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-normal);
}
.llm-wiki-et-card {
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  margin-bottom: 6px;
  overflow: hidden;
}
.llm-wiki-et-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--background-secondary);
}
.llm-wiki-et-card-type {
  font-weight: 600;
  color: var(--text-accent);
}
.llm-wiki-et-card-subfolder {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-monospace);
}
.llm-wiki-et-card-body {
  padding: 6px 10px;
  font-size: 12px;
}
.llm-wiki-et-card-desc {
  margin: 0 0 4px;
  color: var(--text-normal);
}
.llm-wiki-et-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}
.llm-wiki-et-card-tag {
  background: var(--background-modifier-form-field);
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 11px;
  color: var(--text-muted);
}
.llm-wiki-et-card-meta {
  display: block;
  color: var(--text-faint);
  font-size: 11px;
}
```

- [ ] **Step 2: Добавить стили для source_paths списка**

```css
/* EditDomainModal — source paths list */
.llm-wiki-sp-header {
  margin: 12px 0 6px;
}
.llm-wiki-sp-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-normal);
}
.llm-wiki-sp-list {
  margin-bottom: 4px;
}
.llm-wiki-sp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.llm-wiki-sp-path {
  flex: 1;
  font-family: var(--font-monospace);
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-normal);
}
.llm-wiki-sp-remove {
  flex: 0 0 auto;
  padding: 2px 8px;
  cursor: pointer;
}
.llm-wiki-sp-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--background-modifier-border);
}
.llm-wiki-sp-input {
  flex: 1;
  font-family: var(--font-monospace);
  font-size: 12px;
}
```

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat(styles): add CSS for entity-types cards and source-paths list"
```

---

### Task 3: Обновить Mock и написать тесты

**Files:**
- Modify: `vitest.mock.ts`
- Modify: `tests/modals.test.ts`

- [ ] **Step 1: Добавить `contentEl` в Modal mock**

В `vitest.mock.ts` заменить:

```ts
export class Modal {}
```

на:

```ts
function makeEl() {
  const el: any = {
    empty: () => {},
    createEl: (_tag: string, opts?: any) => makeElWithText(opts?.text ?? ""),
    createDiv: (_opts?: any) => makeEl(),
    addClass: () => {},
    removeClass: () => {},
    textContent: "",
    value: "",
    rows: 0,
    addEventListener: () => {},
  };
  return el;
}
function makeElWithText(text: string) {
  const el = makeEl();
  el.textContent = text;
  return el;
}

export class Modal {
  contentEl = makeEl();
  close() {}
}
```

- [ ] **Step 2: Написать failing тесты в `tests/modals.test.ts`**

Заменить содержимое файла:

```ts
import { describe, it, expect, vi } from "vitest";
import { EditDomainModal } from "../src/modals";
import type { DomainEntry } from "../src/domain-map";

const domain: DomainEntry = {
  id: "test",
  name: "Test",
  wiki_folder: "!Wiki/test",
  source_paths: ["/home/user/docs", "/home/user/notes with spaces"],
  entity_types: [
    { type: "Person", description: "People", extraction_cues: ["author"], min_mentions_for_page: 2 },
  ],
  language_notes: "Russian terminology",
};

function makeModal(onSave = vi.fn()) {
  return new EditDomainModal({} as any, domain, onSave);
}

describe("EditDomainModal", () => {
  it("is exported", () => {
    expect(EditDomainModal).toBeDefined();
  });

  it("initialises entityTypesList from domain", () => {
    const m = makeModal();
    expect((m as any).entityTypesList).toEqual(domain.entity_types);
  });

  it("initialises sourcePathsList from domain including paths with spaces", () => {
    const m = makeModal();
    expect((m as any).sourcePathsList).toEqual([
      "/home/user/docs",
      "/home/user/notes with spaces",
    ]);
  });

  it("initialises entityTypesMode to 'cards'", () => {
    const m = makeModal();
    expect((m as any).entityTypesMode).toBe("cards");
  });

  describe("handleSave — card-mode", () => {
    it("calls onSave with entityTypesList (no JSON parsing)", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "cards";
      (m as any).entityTypesList = domain.entity_types;
      (m as any).sourcePathsList = ["/home/user/docs"];
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "!Wiki/test";
      (m as any).languageNotesVal = "";
      (m as any).handleSave();
      expect(onSave).toHaveBeenCalledOnce();
      expect(onSave.mock.calls[0][0].entity_types).toEqual(domain.entity_types);
    });

    it("passes source_paths with spaces intact", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "cards";
      (m as any).entityTypesList = [];
      (m as any).sourcePathsList = ["/home/user/notes with spaces"];
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "!Wiki/test";
      (m as any).languageNotesVal = "";
      (m as any).handleSave();
      expect(onSave.mock.calls[0][0].source_paths).toEqual(["/home/user/notes with spaces"]);
    });
  });

  describe("handleSave — json-mode", () => {
    it("calls onSave with parsed entityTypes when JSON is valid", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "json";
      (m as any).entityTypesVal = JSON.stringify([{ type: "Tech", description: "x", extraction_cues: [] }]);
      (m as any).sourcePathsList = [];
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "!Wiki/test";
      (m as any).languageNotesVal = "";
      (m as any).handleSave();
      expect(onSave).toHaveBeenCalledOnce();
      expect(onSave.mock.calls[0][0].entity_types[0].type).toBe("Tech");
    });

    it("does NOT call onSave when JSON is invalid", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "json";
      (m as any).entityTypesVal = "not valid json {{{";
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "!Wiki/test";
      (m as any).handleSave();
      expect(onSave).not.toHaveBeenCalled();
    });

    it("does NOT call onSave when JSON is not an array", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "json";
      (m as any).entityTypesVal = '{"type":"Tech"}';
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "!Wiki/test";
      (m as any).handleSave();
      expect(onSave).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Запустить тесты — убедиться что падают**

```bash
npx vitest run tests/modals.test.ts 2>&1 | tail -30
```

Ожидается: тесты про `entityTypesList`, `entityTypesMode`, `handleSave` — FAIL (поля ещё не добавлены). Тест `"is exported"` — PASS.

- [ ] **Step 4: Commit тестов**

```bash
git add vitest.mock.ts tests/modals.test.ts
git commit -m "test(modals): add failing tests for EditDomainModal state and handleSave routing"
```

---

### Task 4: Рефакторинг полей и `handleSave()`

**Files:**
- Modify: `src/modals.ts`

- [ ] **Step 1: Обновить поля класса `EditDomainModal`**

В `src/modals.ts` заменить блок полей и конструктора `EditDomainModal` (строки 185–203):

```ts
export class EditDomainModal extends Modal {
  private nameVal: string;
  private wikiFolderVal: string;
  private entityTypesMode: "cards" | "json" = "cards";
  private entityTypesList: EntityType[];
  private entityTypesVal: string;
  private sourcePathsList: string[];
  private languageNotesVal: string;
  private errorEl: HTMLElement | null = null;

  constructor(
    app: App,
    private domain: DomainEntry,
    private onSave: (updated: DomainEntry) => void,
  ) {
    super(app);
    this.nameVal = domain.name;
    this.wikiFolderVal = domain.wiki_folder;
    this.entityTypesList = [...(domain.entity_types ?? [])];
    this.entityTypesVal = JSON.stringify(domain.entity_types ?? [], null, 2);
    this.sourcePathsList = [...(domain.source_paths ?? [])];
    this.languageNotesVal = domain.language_notes ?? "";
  }
```

- [ ] **Step 2: Обновить `handleSave()`**

Заменить метод `handleSave()` (строки 247–274):

```ts
  private handleSave(): void {
    this.errorEl?.addClass("llm-wiki-hidden");
    let entityTypes: EntityType[];
    if (this.entityTypesMode === "cards") {
      entityTypes = this.entityTypesList;
    } else {
      try {
        const parsed = JSON.parse(this.entityTypesVal.trim() || "[]");
        if (!Array.isArray(parsed)) throw new Error("not an array");
        if (!parsed.every((x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x))) {
          throw new Error("not an array of objects");
        }
        entityTypes = parsed as EntityType[];
      } catch {
        if (this.errorEl) {
          this.errorEl.textContent = i18n().modal.entityTypesError;
          this.errorEl.removeClass("llm-wiki-hidden");
        }
        return;
      }
    }
    const updated: DomainEntry = {
      ...this.domain,
      name: this.nameVal.trim() || this.domain.name,
      wiki_folder: this.wikiFolderVal.trim() || this.domain.wiki_folder,
      source_paths: this.sourcePathsList.filter(Boolean),
      entity_types: entityTypes,
      language_notes: this.languageNotesVal.trim(),
    };
    this.close();
    this.onSave(updated);
  }
```

- [ ] **Step 3: Запустить тесты**

```bash
npx vitest run tests/modals.test.ts 2>&1 | tail -30
```

Ожидается: все тесты PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modals.ts
git commit -m "feat(modals): add entityTypesMode/entityTypesList/sourcePathsList fields and update handleSave routing"
```

---

### Task 5: Entity types — методы рендеринга

**Files:**
- Modify: `src/modals.ts`

- [ ] **Step 1: Добавить метод `renderEntityTypeCard()`**

Добавить перед `handleSave()`:

```ts
  private renderEntityTypeCard(container: HTMLElement, et: EntityType): void {
    const card = container.createDiv({ cls: "llm-wiki-et-card" });
    const head = card.createDiv({ cls: "llm-wiki-et-card-head" });
    head.createEl("span", { text: et.type, cls: "llm-wiki-et-card-type" });
    if (et.wiki_subfolder) {
      head.createEl("span", { text: et.wiki_subfolder + "/", cls: "llm-wiki-et-card-subfolder" });
    }
    const body = card.createDiv({ cls: "llm-wiki-et-card-body" });
    if (et.description) {
      body.createEl("p", { text: et.description, cls: "llm-wiki-et-card-desc" });
    }
    if (et.extraction_cues?.length) {
      const tags = body.createDiv({ cls: "llm-wiki-et-card-tags" });
      for (const cue of et.extraction_cues) {
        tags.createEl("span", { text: cue, cls: "llm-wiki-et-card-tag" });
      }
    }
    if (et.min_mentions_for_page != null) {
      body.createEl("small", { text: `min_mentions: ${et.min_mentions_for_page}`, cls: "llm-wiki-et-card-meta" });
    }
  }
```

- [ ] **Step 2: Добавить метод `renderEntityTypes()`**

Добавить перед `renderEntityTypeCard()`:

```ts
  private renderEntityTypes(container: HTMLElement): void {
    container.empty();
    const T = i18n().modal;

    const header = container.createDiv({ cls: "llm-wiki-et-header" });
    header.createEl("span", { text: T.entityTypesLabel, cls: "llm-wiki-et-label" });
    const toggleBtn = header.createEl("button", {
      text: this.entityTypesMode === "cards" ? T.entityTypesEditJson : T.entityTypesBackToCards,
    });

    if (this.entityTypesMode === "cards") {
      toggleBtn.addEventListener("click", () => {
        this.entityTypesVal = JSON.stringify(this.entityTypesList, null, 2);
        this.entityTypesMode = "json";
        this.renderEntityTypes(container);
      });
      if (this.entityTypesList.length === 0) {
        container.createEl("p", { text: T.entityTypesEmpty, cls: "setting-item-description" });
      } else {
        for (const et of this.entityTypesList) {
          this.renderEntityTypeCard(container, et);
        }
      }
    } else {
      const ta = container.createEl("textarea", {
        cls: "llm-wiki-settings-textarea llm-wiki-monospace",
        attr: { rows: "10" },
      });
      ta.value = this.entityTypesVal;
      ta.addEventListener("input", () => { this.entityTypesVal = ta.value; });

      const jsonErrorEl = container.createEl("p", { cls: "mod-warning llm-wiki-hidden" });

      toggleBtn.addEventListener("click", () => {
        try {
          const parsed = JSON.parse(this.entityTypesVal.trim() || "[]");
          if (!Array.isArray(parsed)) throw new Error();
          if (!parsed.every((x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x))) {
            throw new Error();
          }
          this.entityTypesList = parsed as EntityType[];
          this.entityTypesMode = "cards";
          this.renderEntityTypes(container);
        } catch {
          jsonErrorEl.textContent = T.entityTypesError;
          jsonErrorEl.removeClass("llm-wiki-hidden");
        }
      });
    }
  }
```

- [ ] **Step 3: Проверить TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Ожидается: ошибки только из `onOpen()` (ещё не обновлён).

- [ ] **Step 4: Commit**

```bash
git add src/modals.ts
git commit -m "feat(modals): add renderEntityTypes and renderEntityTypeCard methods"
```

---

### Task 6: Source paths — метод рендеринга

**Files:**
- Modify: `src/modals.ts`

- [ ] **Step 1: Добавить метод `renderSourcePaths()`**

Добавить после `renderEntityTypes()`:

```ts
  private renderSourcePaths(container: HTMLElement): void {
    container.empty();
    const T = i18n().modal;

    const header = container.createDiv({ cls: "llm-wiki-sp-header" });
    header.createEl("span", { text: T.sourcePathsLabel, cls: "llm-wiki-sp-label" });

    const listEl = container.createDiv({ cls: "llm-wiki-sp-list" });

    const rerender = () => {
      listEl.empty();
      this.sourcePathsList.forEach((p, i) => {
        const row = listEl.createDiv({ cls: "llm-wiki-sp-row" });
        row.createEl("span", { text: p, cls: "llm-wiki-sp-path", attr: { title: p } });
        const removeBtn = row.createEl("button", { text: "×", cls: "llm-wiki-sp-remove" });
        removeBtn.addEventListener("click", () => {
          this.sourcePathsList.splice(i, 1);
          rerender();
        });
      });
    };
    rerender();

    const addRow = container.createDiv({ cls: "llm-wiki-sp-add-row" });
    const input = addRow.createEl("input", {
      cls: "llm-wiki-sp-input",
      attr: { type: "text", placeholder: T.sourcePathsPlaceholder },
    }) as HTMLInputElement;

    const addPath = () => {
      const val = input.value.trim();
      if (!val || this.sourcePathsList.includes(val)) return;
      this.sourcePathsList.push(val);
      input.value = "";
      rerender();
    };

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); addPath(); }
    });

    const addBtn = addRow.createEl("button", { text: T.sourcePathsAdd, cls: "mod-cta" });
    addBtn.addEventListener("click", addPath);
  }
```

- [ ] **Step 2: Обновить `onOpen()`**

Заменить весь метод `onOpen()` (строки 206–244):

```ts
  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: T.editDomainTitle(this.domain.id) });

    new Setting(contentEl)
      .setName(T.displayName_name)
      .addText((t) => t.setValue(this.nameVal).onChange((v) => { this.nameVal = v; }));

    new Setting(contentEl)
      .setName(T.wikiFolder_name)
      .addText((t) => t.setValue(this.wikiFolderVal).onChange((v) => { this.wikiFolderVal = v; }));

    const entityTypesContainer = contentEl.createDiv();
    this.renderEntityTypes(entityTypesContainer);

    const sourcePathsContainer = contentEl.createDiv();
    this.renderSourcePaths(sourcePathsContainer);

    new Setting(contentEl)
      .setName(T.languageNotesLabel)
      .addTextArea((t) => {
        t.inputEl.rows = 4;
        t.setValue(this.languageNotesVal).onChange((v) => { this.languageNotesVal = v; });
      });

    this.errorEl = contentEl.createEl("p", { cls: "mod-warning llm-wiki-hidden" });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(T.save).setCta().onClick(() => this.handleSave()));
  }
```

- [ ] **Step 3: Проверить TypeScript**

```bash
npx tsc --noEmit 2>&1
```

Ожидается: 0 ошибок.

- [ ] **Step 4: Запустить все тесты**

```bash
npx vitest run 2>&1 | tail -20
```

Ожидается: все тесты PASS.

- [ ] **Step 5: Сборка и bump версии**

Прочитать текущую версию из `package.json`, инкрементировать patch, обновить `package.json` и `manifest.json`, затем:

```bash
npm run build 2>&1 | tail -5
```

Ожидается: `main.js` собран без ошибок.

- [ ] **Step 6: Ручная проверка в Obsidian**

Открыть настройки плагина → Домены → нажать «Редактировать» на домене с entity_types:
1. Убедиться что entity_types показываются как карточки
2. Нажать «Редактировать JSON» — должна открыться textarea с JSON
3. Нажать «← Карточки» — должны вернуться карточки
4. Ввести невалидный JSON и нажать «← Карточки» — должна появиться ошибка инлайн
5. Source paths: добавить путь с пробелами через поле, убедиться что сохраняется корректно
6. Нажать × рядом с путём — должен удалиться
7. Language notes: убедиться что поле многострочное, resize работает
8. Нажать «Сохранить» — данные сохранились в настройках

- [ ] **Step 7: Commit**

```bash
git add src/modals.ts
git commit -m "feat(modals): render entity-types as cards with JSON toggle, source-paths as list, language-notes as textarea"
```
