---
wiki_sources: [docs/superpowers/plans/2026-05-05-e2big-fix.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [temp-files, e2big, большие-промпты]
---
# E2BIG Fix — Temp Files для больших промптов

Фича устраняет ошибку `Error: spawn E2BIG` при lint/fix, когда суммарный размер argv превышает системный лимит (обычно ~128 KB). Большой контент передаётся через временные файлы.

## Основные характеристики

- Порог: 32 KB (32 768 байт) на `userText` и `systemContent` независимо
- При превышении порога по `userText`: файл `llm-wiki-usr-<id>.txt` в `tmpDir`, аргументы `-p "." --append-system-prompt-file <path>`
- При превышении порога по `systemContent`: файл `llm-wiki-sys-<id>.txt` в `tmpDir`, аргумент `--system-prompt-file <path>`
- `tmpDir` вычисляется в `controller.ts` как `join(pluginDir, "tmp")` через `manifest.dir` + `getFullPath`
- Временные файлы гарантированно удаляются в `finally`-блоке `_generate()`
- `ClaudeCliConfig` получает обязательное поле `tmpDir: string`

## Сигнатуры после изменения

```typescript
// ClaudeCliClient внутренние методы передают tmpFiles: string[]
private _makeIterable(args, signal, timeoutSec, tmpFiles): AsyncIterable<...>
private _collect(args, signal, timeoutSec, tmpFiles): Promise<...>
private async *_generate(args, signal, timeoutSec, tmpFiles): AsyncGenerator<...>
```
