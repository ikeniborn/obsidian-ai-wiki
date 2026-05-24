# Spec: lint schema context

**Date:** 2026-05-24
**Status:** draft
**Intent:** `docs/superpowers/intents/2026-05-24-lint-schema-context-intent.md`

## Problem

`_wiki_schema.md` defines wiki conventions (frontmatter structure, link style, terminology). Phases that **write** wiki pages need this context; phases that only **read** do not.

Current state is inconsistent:

| Phase | Reads schema | Passes schema_block | Should? |
|---|---|---|---|
| `ingest.ts` | ✓ | ✓ | ✓ |
| `init.ts` | ✓ | ✓ | ✓ |
| `lint.ts` | ✗ | ✗ | ✓ **bug** |
| `lint-chat.ts` | ✗ | ✗ | ✓ **bug** |
| `query.ts` | ✓ | ✓ | ✗ **excess** |

Rule: **schema_block ↔ wiki modification**. `query` reads wiki, never modifies it.

## Design

### Changes

**`src/phases/lint.ts`**
- Compute `schemaRoot` from `wikiVaultPath` (same as `ingest.ts`: `.split("/").slice(0, -1).join("/")`)
- Add `tryRead(vaultTools, \`${schemaRoot}/.config/_wiki_schema.md\`)` after `ensureDomainConfig`
- Pass `schema_block: schemaContent ? \`\nКонвенции (_wiki_schema.md):\n${schemaContent}\` : ""` to `render(lintTemplate, {...})`
- Add local `tryRead` helper (identical to the one in `ingest.ts`)

**`prompts/lint.md`**
- Add `{{schema_block}}` after `{{entity_types_block}}`

**`src/phases/lint-chat.ts`**
- Same pattern: compute `schemaRoot`, read schema, pass `schema_block` to `render(lintChatTemplate, {...})`

**`prompts/lint-chat.md`**
- Add `{{schema_block}}` (placement: before `LINT-ОТЧЁТ:` section)

**`src/phases/query.ts`**
- Remove Phase 1 schema read (the `Promise.all` that fetches `_wiki_schema.md`)
- Remove `schema_block:` from `render(queryTemplate, {...})`

**`prompts/query.md`**
- Remove `{{schema_block}}` line

**`docs/prompt-architecture.md`**
- Update "Контекст, инжектируемый в каждый промт" table: lint/lint-chat get `schema_block`, query loses it
- Update "Сравнительная таблица промтов": fix lint.md and query.md rows
- Remove stale "### lint.md — не получает schema_block" remark

### Data flow (lint.ts)

```
ensureDomainConfig(vaultTools, wikiVaultPath)
↓
tryRead(_wiki_schema.md) → schemaContent
↓
render(lintTemplate, {
  domain_name,
  entity_types_block,
  schema_block: schemaContent ? `\nКонвенции...\n${schemaContent}` : "",
})
```

### schema_block format consistency

All phases use the same pattern:
```
schema_block: schemaContent ? `\nКонвенции (_wiki_schema.md):\n${schemaContent}` : ""
```
(ingest uses `"КОНВЕНЦИИ..."` with caps — keep per-phase wording as-is, don't normalize)

## Testing

- `tests/phases/lint.test.ts` — verify schema_block appears in messages when schema file present; absent when empty
- `tests/phases/query.test.ts` — verify schema_block NOT passed to query template
- No new test files needed; existing phase tests cover the pattern

## Out of scope

- `chat.ts` — intentionally schema-free (domain-agnostic dialog)
- `format.ts` — uses `_format_schema.md`, not `_wiki_schema.md`
- Normalization of schema_block string format across phases
