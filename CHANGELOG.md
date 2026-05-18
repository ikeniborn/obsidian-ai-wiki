# Changelog

## 0.1.108 — 2026-05-18

### Новое
- feat(index): parseIndexAnnotations + upsertIndexAnnotation — хранение аннотаций в индексе
- feat(seeds): skip frontmatter, add wiki_keywords + annotation scoring
- feat(prompts): add wiki_keywords + annotation to ingest/lint/init prompts
- feat(query): pass indexAnnotations to selectSeeds, simplify LLM seed prompt
- feat(ingest): upsertIndexAnnotation per page, parseJsonPages includes annotation
- feat(lint): upsertIndexAnnotation per fixed page
- feat(lint-chat): implement runLintFixChat phase — интерактивный чат-режим lint
- feat(types): add lint-chat WikiOperation
- feat(settings): add effort dropdown + thinkingBudgetTokens for claude/native-agent
- feat(settings): add availability check buttons for claude-agent and native-agent
- feat(claude-cli-client): add effort field, pass --effort arg to iclaude.sh
- feat(controller): resolve per-op effort; add lintApplyFromChat dispatch route
- feat(view): route lint chat submissions through lintApplyFromChat

### Исправления
- fix(query): recall-based seeds, strip thinking params for seedLLM, cap context pages
- fix(query): add Read/SelectSeeds progress events and signal checks before blocking ops
- fix(controller): add timeout abort and surface error on silent abort in dispatch
- fix(mobile): AbortSignal via Promise.race in mobileFetch
- fix(lint): return markdown analysis instead of JSON in lint report
- fix(lint-chat): handle possibly-undefined pages from Zod inference
- fix(view): show elapsed time in progress after operation completes
- fix(settings): show agentLog toggle on mobile
- fix(review): normalize chat opKey, static child_process import, expose global effort

### Прочее
- refactor(agent-runner): plumb seedTopK/seedMinScore into runQuery

---
