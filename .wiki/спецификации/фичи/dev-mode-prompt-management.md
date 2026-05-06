---
wiki_sources:
  - "docs/superpowers/specs/2026-05-04-dev-mode-prompt-management-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - dev-mode
  - prompts
  - dspy
aliases:
  - "Dev Mode"
  - "Evaluator Phase"
  - "Prompt Templates"
---

# Dev Mode и управление промптами

Инфраструктура для анализа и оптимизации системных промптов: вынос промптов в Markdown-шаблоны (`prompts/*.md`), исправление уточняющего промпта, подраздел «Разработка» в настройках, JSONL-логгер, evaluator-фаза для оценки качества операций.

## Основные характеристики

- **Промт-шаблоны**: 7 файлов `prompts/*.md` (ingest, query, lint, chat, fix, init, evaluator); плейсхолдеры `{{variable_name}}`; встраиваются через esbuild md-loader
- **`template.ts`**: функция `render(template, vars)` — замена плейсхолдеров; неизвестные оставляются как есть
- **Уточняющий промпт**: дефолт → `""`; `injectSystemPrompt()` добавляет `## Уточнение` в конец (не начало); поле UI переименовано в «User prompt»
- **DevModeSettings**: `{ enabled, logDir, evaluatorModel }`; добавляется в `LlmWikiPluginSettings`
- **Dev Logger**: при `devMode.enabled` и непустом `logDir` — JSONL-запись после каждой операции с финальным промптом, входным сообщением, результатом, длительностью, `eval: null`
- **Evaluator**: LLM-вызов с `evaluator.md` после основной операции; возвращает `{ score: 0-10, reasoning }`; результат записывается в лог; в панели отображается `[eval: 8/10] ...`
- **DSPy-совместимость**: поля лога маппируются на DSPy example (`input = { system_prompt, user_message }`, `output = { result }`, `metric = eval.score`)

## Порядок реализации

1. Промт-шаблоны: файлы + esbuild-плагин + `template.ts` + рефактор фаз
2. Уточняющий промпт: исправить дефолт и порядок инжекции
3. Dev mode: типы, настройки, UI
4. Dev logger: JSONL в `agent-runner.ts`
5. Evaluator: `evaluator.ts` + интеграция + рендер в `view.ts`

## Связанные концепции

- [[dspy-prompt-optimization]]
- [[agent-base-contract]]
- [[devmode-logdir]]
