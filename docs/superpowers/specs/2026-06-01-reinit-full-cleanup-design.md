---
chain:
  intent: docs/superpowers/intents/2026-05-31-init-reinit-allfailed-intent.md
review:
  spec_hash: 7bbcc2439f6ab332
  last_run: "2026-06-01"
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "### 5. Lint: invalid-page cleanup pass"
      section_hash: 2e43bdcde991f343
      text: "§5 describes 'new synchronous pass' but implementation is async function — terminology mismatch"
      verdict: fixed
      verdict_at: "2026-06-01"
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "## Problem"
      section_hash: 52cbcf26f0af8f6f
      text: "Inconsistent terms for same concept: 'wiki article' (§Problem, §Invalid), 'wiki page' (§4 emit text), 'wiki file' (§5)"
      verdict: fixed
      verdict_at: "2026-06-01"
    - id: F-003
      phase: clarity
      severity: WARNING
      section: "### 5. Lint: invalid-page cleanup pass"
      section_hash: 2e43bdcde991f343
      text: "§5 says 'Emit a step event' but shows no emission code and does not define event shape — missing DoD"
      verdict: fixed
      verdict_at: "2026-06-01"
---
# Design: reinit full cleanup — subfolders + invalid article deletion

## Status

approved

## Problem

Two related cleanup gaps during `reinit` (and ingest/lint):

1. **Subfolders not deleted.** `wipeDomainFolder` removes all files recursively but never calls `rmdir` on subdirectories. Entity catalog folders (`!Wiki/fin/strategies/`, `!Wiki/fin/contracts/`, etc.) persist as empty directories after reinit.

2. **`language_notes` wrongly cleared.** The `domain_updated` patch on reinit includes `language_notes: ""`, erasing a domain-level description that is not an extraction artifact and should survive reinit.

3. **Invalid wiki articles not deleted.** A wiki article is invalid if it has no `wiki_sources` in frontmatter OR its filename does not match `GENERIC_WIKI_STEM_REGEX` (`wiki_<domain>_<entity>`). Currently ingest only warns about such pages (`ingest.ts:183`); lint ignores them entirely. They accumulate across runs and generate repeated notifications.

## Scope

- `src/vault-tools.ts` — VaultAdapter interface + VaultTools method
- `src/phases/init.ts` — `wipeDomainFolder` + `domain_updated` patch
- `src/phases/ingest.ts` — auto-delete invalid pages
- `src/phases/lint.ts` — new invalid-page cleanup pass
- `tests/phases/init.test.ts` — tests for subdirectory removal
- `tests/phases/ingest.test.ts` — tests for auto-delete
- `tests/phases/lint.test.ts` — tests for lint cleanup pass

## Design

### 1. VaultAdapter: add optional `rmdir`

Add to `VaultAdapter` interface in `src/vault-tools.ts`:

```typescript
rmdir?(path: string, recursive: boolean): Promise<void>;
```

Optional (`?`) — no existing test mocks need updating.

Add to `VaultTools` class:

```typescript
async removeSubfolders(vaultDir: string): Promise<void> {
  const exists = await this.adapter.exists(vaultDir);
  if (!exists) return;
  const { folders } = await this.adapter.list(vaultDir);
  for (const folder of folders) {
    try { await this.adapter.rmdir?.(folder, true); } catch { /* skip locked */ }
  }
}
```

Only removes immediate children of `vaultDir`. `recursive: true` on each child handles nested depth.

### 2. wipeDomainFolder: remove subfolders after files

In `src/phases/init.ts`, after the existing file-removal loop:

```typescript
await vaultTools.removeSubfolders(root);
```

This removes entity catalog subdirectories left empty by file deletion.

### 3. domain_updated patch: preserve language_notes

Change the reinit patch from:
```typescript
patch: { entity_types: [], analyzed_sources: [], language_notes: "" }
```
to:
```typescript
patch: { entity_types: [], analyzed_sources: [] }
```

`language_notes` is a domain-level description set once during init. It is not an extraction artifact and must survive reinit.

### 4. Ingest: auto-delete invalid pages (two checks)

In `src/phases/ingest.ts`:

**Check A — naming prefix** (extends existing block at line 183):

Instead of warn-only, delete each unprefixed file and emit a consolidated `info_text`:

```typescript
if ((domain.pageNameVersion ?? 0) < 1) {
  const unprefixed = nonMetaPaths.filter((p) => {
    if (!p.endsWith(".md")) return false;
    const name = p.split("/").pop()!;
    if (name.startsWith("_")) return false;
    return !GENERIC_WIKI_STEM_REGEX.test(name.replace(/\.md$/, ""));
  });
  for (const p of unprefixed) {
    try { await vaultTools.remove(p); } catch { /* skip */ }
  }
  if (unprefixed.length > 0) {
    yield {
      kind: "info_text", icon: "🗑️",
      summary: `Deleted ${unprefixed.length} legacy page(s) without wiki_<domain>_<entity> prefix.`,
      details: unprefixed.slice(0, 10),
    };
  }
}
```

**Check B — missing wiki_sources** (after `existingPages` is populated):

After `existingPages = await vaultTools.readAll(nonMetaPaths)`, add:

```typescript
const noSources = [...existingPages.entries()]
  .filter(([, content]) => !/wiki_sources:/m.test(content))
  .map(([path]) => path);
for (const p of noSources) {
  try { await vaultTools.remove(p); } catch { /* skip */ }
}
if (noSources.length > 0) {
  yield {
    kind: "info_text", icon: "🗑️",
    summary: `Deleted ${noSources.length} wiki page(s) missing wiki_sources.`,
    details: noSources.slice(0, 10),
  };
}
```

Both checks run before ingest LLM calls so the page set is clean.

### 5. Lint: invalid-page cleanup pass

In `src/phases/lint.ts`, add a new async pass before LLM steps. For each wiki article in the domain:

- If filename doesn't match `GENERIC_WIKI_STEM_REGEX` → delete
- If frontmatter has no `wiki_sources` → delete

This pass acts as a safety net for pages that survived ingest cleanup (e.g., files created outside the normal ingest flow).

Implementation: add `cleanupInvalidPages(vaultTools, wikiVaultPath, domainId)` helper function called at the top of `runLint`. Returns `{ deleted: number }`.

After the call, `runLint` emits a `step` event if any files were deleted:

```typescript
const { deleted } = await cleanupInvalidPages(vaultTools, wikiVaultPath, domainId);
if (deleted > 0) {
  yield { kind: "step", icon: "🗑️", text: `Deleted ${deleted} invalid wiki article(s).` };
}
```

Event shape: `{ kind: "step", icon: string, text: string }` — same as other lint step events.

```typescript
async function cleanupInvalidPages(
  vaultTools: VaultTools,
  wikiVaultPath: string,
  domainId: string,
): Promise<{ deleted: number }> {
  const files = await vaultTools.listFiles(wikiVaultPath);
  const candidates = files.filter((f) => {
    if (!f.endsWith(".md")) return false;
    const name = f.split("/").pop()!;
    return !name.startsWith("_");
  });
  let deleted = 0;
  for (const f of candidates) {
    const stem = f.split("/").pop()!.replace(/\.md$/, "");
    if (!GENERIC_WIKI_STEM_REGEX.test(stem)) {
      try { await vaultTools.remove(f); deleted++; } catch { /* skip */ }
      continue;
    }
    try {
      const content = await vaultTools.read(f);
      if (!/wiki_sources:/m.test(content)) {
        await vaultTools.remove(f);
        deleted++;
      }
    } catch { /* skip unreadable */ }
  }
  return { deleted };
}
```

## Invalid page definition (canonical)

A wiki article is **invalid** if either condition holds:
- Filename stem does not match `GENERIC_WIKI_STEM_REGEX`
- Frontmatter does not contain a `wiki_sources` field

Invalid pages are deleted, not repaired. Reinit will recreate valid pages from sources.

## Tests

### init.test.ts
- `wipeDomainFolder` calls `removeSubfolders` after removing files
- `removeSubfolders` calls `adapter.rmdir` for each subdirectory
- `domain_updated` patch during reinit does NOT include `language_notes`

### ingest.test.ts
- Unprefixed files are deleted and emit `info_text` (not just warned)
- Files without `wiki_sources` are deleted after `existingPages` is populated

### lint.test.ts
- `cleanupInvalidPages` deletes files without stem prefix
- `cleanupInvalidPages` deletes files without `wiki_sources`
- Valid files are not deleted
