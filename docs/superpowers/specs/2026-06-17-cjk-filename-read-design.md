---
review:
  spec_hash: a3d7cc7601ed0ff1
  last_run: 2026-06-17
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "### 3. Diagnostic log (diagnose)"
      section_hash: cb80506fce71f4ae
      text: "Parent dirents cap stated inconsistently — '≤20' in the log example, '~20' in prose. Pick one exact number."
      verdict: open
      verdict_at: null
chain:
  intent: null
---

# CJK / Unicode Filename Read Failure — Design

**Issue:** [#14](https://github.com/ikeniborn/obsidian-ai-wiki/issues/14) — "The ingestion function cannot read the file."

## Problem

Ingestion (and format) fail with "cannot read file" when the source note's
filename contains certain non-ASCII characters. The reported case involves
"hieroglyph" filenames.

### Confirmed root cause (mechanism)

Verified on Linux (ext4) with a standalone Node probe:

| Filename | NFC == NFD | read via wrong form |
|----------|-----------|---------------------|
| `中文文档` (Chinese hanzi) | **yes** | OK |
| `日本語` (Japanese kanji) | **yes** | OK |
| `が` (hiragana + dakuten) | no | **ENOENT** |
| `한국어` (Korean Hangul) | no | **ENOENT** |
| `café` (accented Latin) | no | **ENOENT** |

Two findings:

1. **Pure Han ideographs have no canonical decomposition** → NFC == NFD →
   they are *not* affected by normalization. If a pure-hanzi filename fails,
   the cause is something other than NFC/NFD and the design must detect that.
2. **Decomposable scripts** (Hangul, kana with combining marks, accented
   Latin) differ between NFC and NFD. On byte-exact filesystems
   (Linux ext4/btrfs, Android, NTFS) reading the wrong form raises `ENOENT`.
   macOS APFS/HFS+ normalize at the FS layer and hide the bug.

### How the mismatch arises in this plugin

The on-disk filename is stored in one normalization form (often NFD — common
for files synced from macOS or via Syncthing). Obsidian's path APIs
(`getActiveFile().path`, `normalizePath`) yield NFC. The read path is:

```
getActiveFile().path (NFC)
  → controller.getFullPath(file.path)            controller.ts:192
  → runIngest → toVaultPath(abs)                 ingest.ts:75
  → vaultTools.read(sourceVaultPath)             ingest.ts:84
  → adapter.read(NFC)  →  disk is NFD  →  ENOENT
```

The **source note** is the primary failing read (ingestion input). Wiki pages
are the output (writes). The same `VaultTools.read` also serves wiki-page
reads, `_index.md`, config, and migrations — so a single centralized fix
covers every reader.

## Scope

Platform-independent fix. Two coordinated changes, both centralized in
`src/vault-tools.ts` so no caller changes:

1. **Self-healing read** with built-in diagnostics (the issue's bug).
2. **Write-guard** to prevent duplication when a recovered file is written
   back (e.g. the ingest backlink write to the source note, `ingest.ts:510`).

Out of scope: bulk re-normalization of an existing vault; UI surface for the
diagnostic. Diagnostics go to the existing `console.warn("[ai-wiki] …")`
channel (Obsidian devtools), matching current convention.

## Design

### 1. `resolveOnDiskPath(vaultPath)` — private helper

Returns the path form that actually exists on disk, or the input unchanged
for a genuinely new file.

```
resolveOnDiskPath(vaultPath):
  if await adapter.exists(vaultPath): return vaultPath
  const nfc = vaultPath.normalize("NFC")
  if nfc !== vaultPath && await adapter.exists(nfc): return nfc
  const nfd = vaultPath.normalize("NFD")
  if nfd !== vaultPath && await adapter.exists(nfd): return nfd
  return vaultPath        // new file → caller-provided (canonical) form
```

- ASCII paths: `normalize()` is identity → both branches skipped → zero effect.
- Used by both `read` and `write`.

### 2. Self-healing `read`

```
read(vaultPath):
  try:
    return await adapter.read(vaultPath)        // hot path, no overhead
  catch e:
    if not isNotFound(e): throw e               // perms/IO → original error
    diagnose(vaultPath, e)                       // §3
    const resolved = await resolveOnDiskPath(vaultPath)
    if resolved !== vaultPath:
      const r = await adapter.read(resolved)
      console.warn(`[ai-wiki] read recovered (${formLabel}): ${vaultPath}`)
      return r
    throw e                                      // no form matched → original error
```

`isNotFound(e)`: `e.code === "ENOENT"` OR `/ENOENT|no such file|not exist/i`
on the message — the Obsidian adapter does not always set `e.code`.

Fallback only runs on failure; successful reads are unchanged. When no form
recovers, the **original** error is re-thrown so caller semantics
(`ingest.ts:86`, `format.ts:89`, `readAll` catch) are preserved.

### 3. Diagnostic log (`diagnose`)

One compact `console.warn` per miss, enough to confirm the cause from a single
user repro:

```
[ai-wiki] read miss: "!Wiki/中文/が.md"
  filename codepoints: U+304B U+3099           ← hex of filename chars only
  nfc!=nfd: true                               ← is the name decomposable
  forms: NFC→ENOENT NFD→OK                      ← per-form retry result
  parent dirents: ["が.md", …]                  ← actual on-disk form (≤20)
```

Field rationale:

- **codepoints** — distinguishes pure hanzi (not decomposable → cause is *not*
  normalization, pivot the investigation) from Hangul/kana/accent.
- **nfc!=nfd** — at a glance, whether normalization can even apply.
- **forms** — shows which form disk holds; confirms the fix engaged.
- **parent dirents** — if neither NFC nor NFD matches a dirent, the cause lies
  outside normalization (encoding / percent-encoding / dispatch mangling) and
  we pivot. Wrapped in try/catch (parent may be absent); list capped ~20.

`codePointsHex(name)` operates on `path.split("/").pop()` only — the filename
carries the problem and keeps the log short.

### 4. Write-guard

`VaultTools.write` resolves the target through `resolveOnDiskPath` before
writing, so an existing file in a different normalization form is overwritten
in place rather than duplicated:

```
write(vaultPath, content):
  const target = await resolveOnDiskPath(vaultPath)
  … existing mkdir-parents + vault.modify/create / adapter.write logic on target …
```

Without this, a read recovered via NFD followed by `adapter.write(NFC)` on
Linux creates a second NFC file and orphans the NFD original — turning a read
bug into corruption of the user's source note (ingest writes backlinks to the
same source path at `ingest.ts:510`). New files (no existing form) keep the
caller's canonical form, so wiki-page creation is unchanged.

## Edge cases

- Non-"not found" read errors (permissions, IO) bypass the fallback; original
  error surfaces immediately.
- Mobile: `adapter.exists` is available → `resolveOnDiskPath` works there too.
- `readAll` swallows per-file errors; recovered paths simply stop disappearing.
- `detectDomain` / `source_paths` matching uses string `startsWith` on config
  paths; those originate NFC and are not read directly — out of scope, noted
  as a follow-up if a repro shows domain mismatch.

## Verification

No functional test suite in this project (`lat.md` records this; verify via
build/lint/manual run):

1. `npm run build` and `npm run lint` — clean.
2. Standalone probe (extends `/tmp/cjk-probe`): create an NFD-named file on
   disk, call `read` with the NFC path → recovers and logs the diagnostic;
   call `write` with the NFC path → overwrites the NFD file in place, no
   duplicate dirent.
3. `lat check` passes; update `lat.md/` to document normalization-tolerant
   read/write in `VaultTools`.

## Branch workflow

Per project rules: merge `master` into `dev`, branch a `fix/` from `dev`,
merge the fix back into `dev` (PR targeting `dev`), never into `master`.
