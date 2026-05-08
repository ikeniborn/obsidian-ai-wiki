---
wiki_sources: ["src/controller.ts"]
wiki_updated: 2026-05-08
wiki_status: developing
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[llm-wiki-view]]"
  - "[[run-event]]"
  - "[[claude-cli-client]]"
  - "[[domain-store]]"
  - "[[local-config]]"
  - "[[effective-settings]]"
  - "[[mobile-fetch]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["WikiController", "controller.ts"]
---
# WikiController (controller.ts)

Координатор между UI Obsidian и `AgentRunner`. Single-flight guard, lifecycle AbortController, обработка доменных событий из потока. Читает synced-настройки из `plugin.settings`, per-device overlay из `LocalConfigStore`, объединяет через [[effective-settings|resolveEffective()]].

## Основные характеристики

- **Расположение:** `src/controller.ts`
- **Конструктор:** `WikiController(app, plugin, domainStore, localConfigStore)`
- **Single-flight guard:** `current: AbortController | null`

### Публичный API

| Метод | Описание |
|-------|---------|
| `ingestActive(domainId?)` | Ingest активного файла vault |
| `query(question, save, domainId?)` | Query с опциональным сохранением |
| `lint(domain)` | Lint домена или всей wiki |
| `fix(domainId, lintReport, instruction)` | Fix по результатам lint |
| `chat(...)` | Chat-режим (multi-turn с session resume) |
| `init(domain, dryRun, sourcePaths?)` | Init домена; при `sourcePaths` подключает `FileErrorModal` через `onFileError` |
| `loadDomains()` | Async чтение через `DomainStore.load()`. Throws `DomainCorruptError`. |
| `registerDomain(input)` | Создаёт домен, save через `DomainStore` |
| `cancelCurrent()` | Отмена текущей операции |
| `isBusy()` | Проверка занятости |

### Mobile guards

- `Platform.isMobile && op !== "query" && op !== "query-save"` → `Notice` "mobile not available", прекращение dispatch
- `cwdOrEmpty()` — при отсутствии `getBasePath()` (мобильный) возвращает `""` без warn; на десктопе — warn в консоль

### Backend selection

В `dispatch()`/`dispatchChat()` перед запуском:
1. `local = await localConfigStore.load()`
2. `eff = resolveEffective(plugin.settings, local)`
3. По `eff.backend`:
   - `claude-agent` → `requireClaudeAgent(local)` проверяет `iclaudePath` через `existsSync`
   - `native-agent` → `requireNativeAgent(eff)` проверяет `baseUrl` + `apiKey`

### buildAgentRunner()

Создаёт `AgentRunner` с эффективными настройками:
- `claude-agent`: lazy-require `node:path`/`node:fs` + `ClaudeCliClient`; spawn в `tmpDir = <plugin-dir>/tmp`; запоминает `_currentClaudeClient` для post-turn capture `lastSessionId`
- `native-agent`: создаёт `OpenAI` клиент с `dangerouslyAllowBrowser: true`; на `Platform.isMobile` подключает [[mobile-fetch|mobileFetch]] для обхода CORS

### Обработка доменных событий

В цикле dispatch потока `AgentRunner`:
1. `await domainStore.load()` — текущее состояние
2. `applyDomainEvent(cur, ev, { vaultRoot })` — pure reducer
3. Если ссылка изменилась → `await domainStore.save(next)`
4. На `DomainCorruptError` → `Notice` пользователю, `ctrl.abort()`, `break`

События: `domain_created`, `domain_updated`, `source_path_added`. Параметр `vaultRoot` нужен для `consolidateSourcePaths()` при `source_path_added`.

### Логирование событий

`logEvent()` пишет JSONL в `!Logs/agent.jsonl` через `vault.adapter` (mobile-compatible). Контролируется `plugin.settings.agentLogEnabled` (synced) — overlay из `LocalConfig.agentLogEnabled` применяется только в UI и при чтении через `resolveEffective`; запись в `dispatch()` смотрит `plugin.settings.agentLogEnabled` напрямую.

### Chat session management

`_chatSessionId` хранит ID claude-сессии для многотурного диалога. Сбрасывается при ошибке/abort/новой `dispatch()`-операции. После успешного тура подтягивается из `_currentClaudeClient.lastSessionId`.

## Связанные концепции

- [[domain-store]] — load/save карты доменов
- [[local-config]] — `iclaudePath`, `backend`, API-credentials
- [[effective-settings]] — слияние synced + local перед использованием
- [[mobile-fetch]] — `fetch` для OpenAI клиента на мобильной платформе
- [[agent-runner]] — исполнитель операций
- [[llm-wiki-view]] — UI потребитель событий
