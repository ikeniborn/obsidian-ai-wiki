---
review:
  spec_hash: 239ec06c16ee20af
  last_run: "2026-05-24"
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  section_hashes:
    "## Problem": 4108e23cab2b3aa9
    "## Root Cause": 3ba01558f3314152
    "## Fix": 897e3b1f45b96704
    "## Testing": 25e52eaceca4e816
    "## Scope": bbbb1474547102fd
  findings: []
---

# Design: Fix _log/_index not updated after init/ingest/lint (#35)

**Date:** 2026-05-24
**Status:** approved
**Intent:** `docs/superpowers/intents/2026-05-24-log-index-update-bug-intent.md`

## Problem

Obsidian does not index files in hidden directories (`.config`).
`VaultTools.write()` calls `vault.getAbstractFileByPath()` → returns `null` for hidden paths →
falls through to `vault.create()` → throws `"File already exists"` (file is on disk but not indexed) →
write silently fails → `_log.md` and `_index.md` are never updated.

## Root Cause

`src/vault-tools.ts` lines 42–51:

```typescript
if (this.vault) {
  const indexed = this.vault.getAbstractFileByPath(vaultPath);
  if (indexed) {
    await this.vault.modify(indexed, content);
  } else {
    await this.vault.create(vaultPath, content); // throws for .config files
  }
} else {
  await this.adapter.write(vaultPath, content);
}
```

## Fix

Catch the error from `vault.create()` and fall back to `adapter.write()`.

**File:** `src/vault-tools.ts` — change lines 46–48 only.

```typescript
} else {
  try {
    await this.vault.create(vaultPath, content);
  } catch {
    // Obsidian doesn't index hidden dirs (.config) — vault.create() throws if file exists on disk
    await this.adapter.write(vaultPath, content);
  }
}
```

No other files changed.

## Testing

Add one test to the existing `VaultTools` test suite:

- Setup: vault with `getAbstractFileByPath` → `null`, `create()` throws `"File already exists"`
- Assert: `adapter.write()` is called with the correct path and content

Existing tests (modify path, adapter-only path) remain unchanged.

## Scope

- **In scope:** `src/vault-tools.ts` write fallback, one new test
- **Out of scope:** format of `_log`/`_index`, architecture of VaultTools, other operations
