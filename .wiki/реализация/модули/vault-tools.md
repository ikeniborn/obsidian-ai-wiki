---
wiki_sources: ["src/vault-tools.ts"]
wiki_updated: 2026-05-08
wiki_status: developing
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[run-ingest]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["VaultTools", "VaultAdapter"]
---
# VaultTools (vault-tools.ts)

Абстракция доступа к файловой системе Obsidian vault. Скрывает детали `VaultAdapter` (Obsidian API или мок в тестах) и предоставляет высокоуровневые операции: чтение, запись, рекурсивный листинг, преобразование абсолютных путей в vault-relative.

## Основные характеристики

- **Расположение:** `src/vault-tools.ts`
- **Интерфейс:** `VaultAdapter` — минимальный контракт адаптера (read, write, append, list, exists, mkdir)
- **Класс:** `VaultTools(adapter: VaultAdapter, basePath: string)`

### Ключевые методы

| Метод | Описание |
|-------|---------|
| `read(vaultPath)` | Читает файл по vault-relative пути |
| `write(vaultPath, content)` | Записывает файл, создаёт промежуточные директории автоматически |
| `listFiles(vaultDir)` | Рекурсивно собирает все файлы в директории |
| `readAll(paths)` | Параллельно читает массив файлов → Map<path, content> |
| `exists(vaultPath)` | Проверяет существование файла/папки |
| `toVaultPath(absolutePath)` | Преобразует абсолютный путь в vault-relative; null если вне vault |
| `vaultRoot` (getter) | Возвращает basePath |

### VaultAdapter

```typescript
interface VaultAdapter {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}
```

В production-коде адаптер создаётся из `this.app.vault.adapter`. В тестах — мокируется через `vi.fn()`. Метод `append` нужен `WikiController.logEvent()` и `AgentRunner.writeDevLog()` для эффективной дозаписи JSONL без read+concat.

## Применение в контексте реализации

Все фазовые функции (`runIngest`, `runQuery`, `runLint`, `runInit`) принимают `VaultTools` как зависимость, что позволяет тестировать их без реального Obsidian vault.

## Связанные концепции

- [[agent-runner]] — использует VaultTools для чтения/записи файлов в рамках инструментальных вызовов
- [[run-ingest]] — передаёт VaultTools как зависимость для работы с vault

Интерфейс `VaultAdapter` описан в разделе выше — минимальный контракт, который реализуется через `this.app.vault.adapter` в production и мок-объект в тестах.
