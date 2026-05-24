---
review:
  spec_hash: b4623430859304e9
  last_run: 2026-05-19
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  section_hashes:
    Problem:            ec06958694465f9b
    Required Hierarchy: 4b9e257ef5b9ca12
    Changes:            89cb0c5117e9d0f5
    Out of Scope:       6ce76b9c5b3d4ab7
    Test Cases:         f87cebfb01c2c73d
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: Out of Scope
      section_hash: 6ce76b9c5b3d4ab7
      text: "`_wiki_schema.md` listed in Out of Scope but not exempt in `validateArticlePath`. If LLM returns it as a page, validation fails with no defined handling."
      verdict: fixed
      verdict_at: 2026-05-19
    - id: F-002
      phase: clarity
      severity: WARNING
      section: Changes
      section_hash: 89cb0c5117e9d0f5
      text: "Exception clause second condition incomplete (missing `wikiVaultPath +`). Fixed: explicit `path === wikiVaultPath + \"/_log.md\"` and `\"/_wiki_schema.md\"`."
      verdict: fixed
      verdict_at: 2026-05-19
    - id: F-003
      phase: clarity
      severity: WARNING
      section: Changes
      section_hash: 89cb0c5117e9d0f5
      text: "`sanitizeWikiFolder`: \"Assert no remaining `/`\" contradicted silent fallback. Fixed: \"silently take last segment (no throw)\"."
      verdict: fixed
      verdict_at: 2026-05-19
    - id: F-004
      phase: clarity
      severity: INFO
      section: Changes
      section_hash: 89cb0c5117e9d0f5
      text: "\"LLM output is deterministic given the same prompt\" — factually incorrect. Fixed: removed determinism claim."
      verdict: fixed
      verdict_at: 2026-05-19
---
# Spec: Strict 4-Level Wiki Path Hierarchy

**Date:** 2026-05-19  
**Status:** approved

## Problem

LLM incorrectly generates `wiki_subfolder` values that include the domain prefix (e.g. `os/network` instead of `network`), resulting in paths like `!Wiki/os/os/network/nfs/NFS.md` instead of the required `!Wiki/os/network/NFS.md`. No validation exists to catch or reject these violations.

## Required Hierarchy

```
!Wiki/                    ← level 1: wiki root (fixed)
  <domain>/               ← level 2: domain subfolder (e.g. os)
    <entity>/             ← level 3: entity type subfolder (e.g. network)
      <Article>.md        ← level 4: article file
```

**Rule:** every article path must have exactly 4 segments. No deeper nesting. No shallower. System files (`_index.md`, `_log.md`, `_wiki_schema.md`) directly in `!Wiki/<domain>/` are exempt.

## Changes

### 1. Prompts

**`prompts/ingest.md`** — add rule before the JSON output instruction:

```
ПРАВИЛО ПУТЕЙ: путь каждой статьи = !Wiki/<domain>/<entity>/<Article>.md — ровно 4 сегмента.
Нельзя: !Wiki/os/os/network/NFS.md (домен дважды), !Wiki/os/network/nfs/NFS.md (5 сегментов).
Можно:  !Wiki/os/network/NFS.md
```

**`prompts/init.md`** — add rule for `wiki_subfolder`:

```
ПРАВИЛО wiki_subfolder: одно слово, без слэшей, без domain_id.
Нельзя: "os/network", "os_network". Можно: "network", "processes", "protocols".
```

### 2. `src/wiki-path.ts` — new sanitize/validate functions

**`sanitizeWikiFolder(raw: string): string`**
- Strip `vaults/<name>/` prefix if present
- Strip `!Wiki/` prefix if present
- If `/` still present after strip — silently take last segment (no throw)
- Return single-segment string (e.g. `"os"`)

**`sanitizeWikiSubfolder(raw: string): string`**
- If no `/` — return as-is
- If `/` present — take last segment (strips domain prefix like `os/network` → `network`)

**`validateArticlePath(path: string, wikiVaultPath: string): boolean`**
- `path` must start with `wikiVaultPath + "/"`
- Remainder after strip must have exactly 2 segments: `<entity>/<Article>.md`
- Exception: `path === wikiVaultPath + "/_index.md"` or `path === wikiVaultPath + "/_log.md"` or `path === wikiVaultPath + "/_wiki_schema.md"` → valid

### 3. `src/phases/init.ts` — sanitize after LLM parse

After stripping `!Wiki/` from `entry.wiki_folder`, apply `sanitizeWikiFolder`.

For each `entity_type.wiki_subfolder` in `entry.entity_types`, apply `sanitizeWikiSubfolder`.

No retry needed — sanitization corrects silently; we fix structurally rather than re-asking.

### 4. `src/phases/ingest.ts` — validate paths + retry

After parsing LLM JSON pages:

1. Split into `valid` and `invalid` by `validateArticlePath`
2. If `invalid.length > 0` and no retry yet:
   - Emit `assistant_text` warning listing invalid paths
   - Re-call LLM with feedback message:  
     `"Paths violate 4-level rule (!Wiki/<d>/<e>/<f>.md): [list]. Return corrected JSON array only."`
   - Parse response, merge with `valid`
3. After retry, paths still invalid → emit `tool_result ok: false` per path, skip write

## Out of Scope

- Migrating existing corrupted data — manual deletion required
- Changing `wiki_subfolder` values already stored in domain settings
- Validating path depth for system files (`_wiki_schema.md`, `_index.md`, `_log.md`)

## Test Cases

| Input path | wikiVaultPath | Result |
|---|---|---|
| `!Wiki/os/network/NFS.md` | `!Wiki/os` | valid |
| `!Wiki/os/os/network/NFS.md` | `!Wiki/os` | invalid → retry |
| `!Wiki/os/network/nfs/NFS.md` | `!Wiki/os` | invalid → retry |
| `!Wiki/os/_index.md` | `!Wiki/os` | valid (exempt) |
| `!Wiki/other/network/NFS.md` | `!Wiki/os` | invalid (wrong domain) |
