---
review:
  plan_hash: c1f6de1fdb471900
  spec_hash: a3d7cc7601ed0ff1
  last_run: 2026-06-17
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "## Task 4: Update documentation (iwiki)"
      section_hash: 8c942261bacae5ee
      text: "Spec Verification §3 requires 'lat check passes' + 'update lat.md/'. Plan substitutes iwiki (docs/wiki/) because the repo has no lat CLI or lat.md/ dir. Justified deviation (plan Decision 1); the 'lat check' command is dropped, not satisfied."
      verdict: accepted
      verdict_at: 2026-06-17
    - id: F-002
      phase: consistency
      severity: WARNING
      section: "## Task 5: Open the pull request"
      section_hash: cb80ac0a7243594c
      text: "Spec footer 'Branch workflow' says the PR targets dev, never master. Plan Task 5 targets master, following project CLAUDE.md (newer authority) over the stale spec footer. Documented deviation (plan Decision 2); plan contradicts spec text."
      verdict: accepted
      verdict_at: 2026-06-17
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-17-cjk-filename-read-design.md
---

# CJK / Unicode Filename Read Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `VaultTools` read and write tolerant of NFC/NFD filename mismatches so ingestion and format stop failing with "cannot read file" on CJK / accented filenames, without duplicating files on write-back.

**Architecture:** All changes are centralized in `src/vault-tools.ts` — no caller changes. A private `resolveOnDiskPath` probes the input, NFC, and NFD forms via `adapter.exists`. `read` keeps a zero-overhead hot path and only falls back on a not-found error; `write` resolves the target first so an existing file in another normalization form is overwritten in place. A `diagnose` helper emits one compact `console.warn` per miss for field debugging.

**Tech Stack:** TypeScript (ESM), Obsidian plugin API (`DataAdapter`), esbuild build, ESLint (Obsidian reviewer ruleset), `tsx` for the standalone verification probe. No unit-test framework exists in this repo.

---

## Context for the implementer (read first)

- **The bug:** On byte-exact filesystems (Linux ext4/btrfs, Android, NTFS) `adapter.read("café".normalize("NFC"))` raises `ENOENT` when the file on disk is stored in NFD form (`café` = `café`). macOS APFS/HFS+ hide this by normalizing at the FS layer. Obsidian's path APIs yield NFC; files synced from macOS / Syncthing are often NFD.
- **Pure Han ideographs (中文文档, 日本語) have NFC == NFD** — they are *not* affected by this fix. The `diagnose` log exists precisely so that, if a pure-hanzi name still fails, we can see `nfc!=nfd: false` and pivot the investigation away from normalization.
- **Where it flows:** `getActiveFile().path` (NFC) → `controller.ingestActive` (`src/controller.ts:192`) → `runIngest` → `vaultTools.read(sourceVaultPath)` (`src/phases/ingest.ts:84`). `format` reads the same way (`src/phases/format.ts:87`). Ingest also writes backlinks to the source note (`src/phases/ingest.ts:510`) — that write is why the write-guard is mandatory: a read recovered as NFD followed by a plain `adapter.write(NFC)` would create a second NFC file and orphan the NFD original, corrupting the user's source note.
- **Callers must keep their current semantics.** `ingest.ts:85`, `format.ts:88`, and `readAll` (`src/vault-tools.ts:83`) all catch read errors. When no normalization form recovers the file, `read` must re-throw the **original** error so those catches behave exactly as before.
- **Spec source:** `docs/superpowers/specs/2026-06-17-cjk-filename-read-design.md`.

### Decisions / deviations from the spec (apply as written below)

1. **Docs system is iwiki, not lat.** The repo has no `lat` CLI and no `lat.md/` directory; documentation lives in `docs/wiki/` (iwiki). The spec's "update `lat.md/`" step is satisfied by updating `docs/wiki/architecture.md` via the iwiki skills (Task 4). Skip every `lat …` command — they will fail.
2. **Branch workflow follows project CLAUDE.md, not the spec's footer.** The spec footer ("merge into `dev`, never `master`") is stale. Current rule: all work in `dev/*` branches, PR targets **`master`**. We are already on `dev/cjk-filename-read-design`; implement here and open the PR against `master` (Task 5).
3. **`diagnose` takes no error argument.** The spec pseudocode passes `e` to `diagnose`, but the diagnostic fields are all derived by re-probing forms — the error object is unused. Drop the parameter to avoid an unused-variable lint finding.
4. **Parent-dirents cap is exactly 20** (resolves spec finding F-001, which flagged "≤20" vs "~20" inconsistency).

### File structure

- **Modify:** `src/vault-tools.ts` — the only production file touched. Add two module-private helper functions (`codePointsHex`, `isNotFound`) above the class; add two private methods (`resolveOnDiskPath`, `diagnose`); rewrite `read` and `write`.
- **Create (throwaway, not committed):** `/tmp/cjk-probe/probe.ts` — the verification harness. Lives in `/tmp` so it never enters the repo or the `src/**` lint glob.
- **Modify:** `docs/wiki/architecture.md` — VaultTools section, via iwiki ingest.

---

## Task 1: Create the failing verification probe

This project has no unit-test runner, so the probe is our executable "test". It builds an fs-backed `VaultAdapter`, writes a file on disk in **NFD** form, then exercises `VaultTools.read`/`write` through the **NFC** path. Against the current code it must FAIL both checks — proving the bug and giving us a gate to flip to PASS.

**Files:**
- Create: `/tmp/cjk-probe/probe.ts`

- [ ] **Step 1: Create the probe directory**

Run: `mkdir -p /tmp/cjk-probe`

- [ ] **Step 2: Write the probe script**

Create `/tmp/cjk-probe/probe.ts` with exactly this content (the import path is absolute so the script runs regardless of cwd; `vault-tools.ts` imports nothing, so `tsx` loads it standalone):

```ts
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { VaultTools, type VaultAdapter } from "/home/ikeniborn/Documents/Project/obsidian-ai-wiki/src/vault-tools";

// Minimal fs-backed adapter so the probe exercises the real VaultTools code path.
class FsAdapter implements VaultAdapter {
  constructor(private root: string) {}
  private abs(p: string): string { return nodePath.join(this.root, p); }
  async read(p: string): Promise<string> { return fs.readFile(this.abs(p), "utf8"); }
  async write(p: string, data: string): Promise<void> {
    await fs.mkdir(nodePath.dirname(this.abs(p)), { recursive: true });
    await fs.writeFile(this.abs(p), data);
  }
  async append(p: string, data: string): Promise<void> { await fs.appendFile(this.abs(p), data); }
  async list(p: string): Promise<{ files: string[]; folders: string[] }> {
    const entries = await fs.readdir(this.abs(p), { withFileTypes: true });
    const files: string[] = [];
    const folders: string[] = [];
    for (const e of entries) {
      const rel = p ? `${p}/${e.name}` : e.name;
      if (e.isDirectory()) folders.push(rel); else files.push(rel);
    }
    return { files, folders };
  }
  async exists(p: string): Promise<boolean> {
    try { await fs.access(this.abs(p)); return true; } catch { return false; }
  }
  async mkdir(p: string): Promise<void> { await fs.mkdir(this.abs(p), { recursive: true }); }
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(nodePath.join("/tmp", "cjk-probe-run-"));
  const dir = "notes";
  await fs.mkdir(nodePath.join(root, dir), { recursive: true });

  // "が" = U+304B U+3099 in NFD (か + combining dakuten); U+304C in NFC.
  const nameNfd = "が".normalize("NFD");
  const nameNfc = "が".normalize("NFC");
  if (nameNfd === nameNfc) throw new Error("probe precondition failed: name is not decomposable");

  // Create the file on disk in NFD form (simulating a macOS / Syncthing source note).
  await fs.writeFile(nodePath.join(root, dir, `${nameNfd}.md`), "ORIGINAL", "utf8");

  const adapter = new FsAdapter(root);
  const tools = new VaultTools(adapter, root);
  const nfcPath = `${dir}/${nameNfc}.md`;

  let pass = true;

  // CHECK 1 — read recovery: reading via the NFC path recovers the NFD file.
  try {
    const got = await tools.read(nfcPath);
    if (got === "ORIGINAL") console.log("CHECK 1 read-recovery: PASS");
    else { console.log(`CHECK 1 read-recovery: FAIL (got ${JSON.stringify(got)})`); pass = false; }
  } catch (e) {
    console.log(`CHECK 1 read-recovery: FAIL (threw ${(e as Error).message})`);
    pass = false;
  }

  // CHECK 2 — write-guard: writing via the NFC path overwrites the NFD file in
  // place; the directory must still hold exactly one entry afterwards.
  await tools.write(nfcPath, "UPDATED");
  const after = await fs.readdir(nodePath.join(root, dir));
  if (after.length === 1) {
    const content = await fs.readFile(nodePath.join(root, dir, after[0]), "utf8");
    if (content === "UPDATED") console.log("CHECK 2 write-guard: PASS");
    else { console.log(`CHECK 2 write-guard: FAIL (content ${JSON.stringify(content)})`); pass = false; }
  } else {
    console.log(`CHECK 2 write-guard: FAIL (${after.length} dirents: ${JSON.stringify(after)})`);
    pass = false;
  }

  await fs.rm(root, { recursive: true, force: true });
  if (!pass) process.exit(1);
  console.log("ALL CHECKS PASS");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run the probe against current code to confirm it fails**

Run: `npx tsx /tmp/cjk-probe/probe.ts`

Expected (current code, before any fix):
```
CHECK 1 read-recovery: FAIL (threw ENOENT: no such file or directory, open '...')
CHECK 2 write-guard: FAIL (2 dirents: [...])
```
and a non-zero exit code. This proves both halves of the bug. (No commit — the probe lives in `/tmp` and is never committed.)

---

## Task 2: Self-healing read

Add the module helpers and private methods, then rewrite `read`. This whole task lands as one commit because the helpers and private methods are only referenced once `read`/`write` use them — committing them earlier would leave transient unused symbols. After this task CHECK 1 flips to PASS; CHECK 2 still fails (write-guard comes in Task 3).

**Files:**
- Modify: `src/vault-tools.ts` (helpers above the class at line 23; `read` at lines 35-37; private methods inside the class)

- [ ] **Step 1: Add the module-private helpers above the class**

In `src/vault-tools.ts`, insert these two functions immediately before `export class VaultTools {` (currently line 24):

```ts
/**
 * Hex codepoints of a filename, e.g. "U+304B U+3099". Distinguishes
 * decomposable scripts (kana / Hangul / accented Latin, where NFC != NFD)
 * from pure Han ideographs (NFC == NFD, so normalization is not the cause).
 */
function codePointsHex(name: string): string {
  return Array.from(name)
    .map((ch) => "U+" + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0"))
    .join(" ");
}

/**
 * True when an error means "file not found". The Obsidian adapter does not
 * always set `e.code`, so fall back to matching the message text.
 */
function isNotFound(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown };
  if (err?.code === "ENOENT") return true;
  return /ENOENT|no such file|not exist/i.test(String(err?.message ?? ""));
}
```

- [ ] **Step 2: Add the `resolveOnDiskPath` private method**

Inside the `VaultTools` class, add this method (place it just after the `write` method, before `listFiles`):

```ts
  /**
   * Return the path form that actually exists on disk (the input, its NFC, or
   * its NFD form), or the input unchanged for a genuinely new file. ASCII paths
   * normalize to themselves, so both retry branches are skipped — zero effect
   * on the common case. Used by both read (recovery) and write (guard).
   */
  private async resolveOnDiskPath(vaultPath: string): Promise<string> {
    if (await this.adapter.exists(vaultPath)) return vaultPath;
    const nfc = vaultPath.normalize("NFC");
    if (nfc !== vaultPath && (await this.adapter.exists(nfc))) return nfc;
    const nfd = vaultPath.normalize("NFD");
    if (nfd !== vaultPath && (await this.adapter.exists(nfd))) return nfd;
    return vaultPath;
  }
```

- [ ] **Step 3: Add the `diagnose` private method**

Inside the `VaultTools` class, add this method directly after `resolveOnDiskPath`:

```ts
  /**
   * Emit one compact console.warn explaining a read miss: filename codepoints,
   * whether the name is decomposable, per-form existence, and the actual parent
   * dirents (capped at 20). Enough to confirm the cause from a single repro.
   */
  private async diagnose(vaultPath: string): Promise<void> {
    const name = vaultPath.split("/").pop() ?? vaultPath;
    const nfc = vaultPath.normalize("NFC");
    const nfd = vaultPath.normalize("NFD");
    const probe = async (p: string): Promise<string> => {
      try { return (await this.adapter.exists(p)) ? "OK" : "ENOENT"; }
      catch { return "ERR"; }
    };
    const nfcResult = await probe(nfc);
    const nfdResult = await probe(nfd);
    let dirents = "n/a";
    try {
      const parent = vaultPath.split("/").slice(0, -1).join("/");
      const { files } = await this.adapter.list(parent);
      dirents = JSON.stringify(files.map((f) => f.split("/").pop()).slice(0, 20));
    } catch { /* parent may be absent — leave "n/a" */ }
    console.warn(
      `[ai-wiki] read miss: ${JSON.stringify(vaultPath)}\n` +
        `  filename codepoints: ${codePointsHex(name)}\n` +
        `  nfc!=nfd: ${nfc !== nfd}\n` +
        `  forms: NFC→${nfcResult} NFD→${nfdResult}\n` +
        `  parent dirents: ${dirents}`,
    );
  }
```

- [ ] **Step 4: Rewrite `read` to self-heal**

Replace the current `read` method (lines 35-37):

```ts
  async read(vaultPath: string): Promise<string> {
    return this.adapter.read(vaultPath);
  }
```

with:

```ts
  async read(vaultPath: string): Promise<string> {
    try {
      return await this.adapter.read(vaultPath); // hot path — no overhead on success
    } catch (e) {
      if (!isNotFound(e)) throw e; // perms / IO → surface the original error immediately
      await this.diagnose(vaultPath);
      const resolved = await this.resolveOnDiskPath(vaultPath);
      if (resolved !== vaultPath) {
        const data = await this.adapter.read(resolved);
        const formLabel = resolved === vaultPath.normalize("NFD") ? "NFD" : "NFC";
        console.warn(`[ai-wiki] read recovered (${formLabel}): ${vaultPath}`);
        return data;
      }
      throw e; // no form matched → re-throw original so caller semantics are preserved
    }
  }
```

- [ ] **Step 5: Run the probe — CHECK 1 must now PASS**

Run: `npx tsx /tmp/cjk-probe/probe.ts`

Expected:
```
CHECK 1 read-recovery: PASS
CHECK 2 write-guard: FAIL (2 dirents: [...])
```
(CHECK 2 still fails — write-guard is Task 3. Exit code is still non-zero; that's expected here.)

- [ ] **Step 6: Build and lint**

Run: `npm run build && npm run lint`
Expected: build succeeds; lint reports no new errors in `src/vault-tools.ts`. (A pre-existing `import/no-nodejs-modules` finding is a `warn`, not a release blocker — see `eslint.config.mjs:36`. Our changes add no node-builtin imports.)

- [ ] **Step 7: Commit**

```bash
git add src/vault-tools.ts
git commit -m "fix(vault-tools): self-healing NFC/NFD read with diagnostics (#14)"
```

---

## Task 3: Write-guard

Resolve the write target through `resolveOnDiskPath` so an existing file in a different normalization form is overwritten in place rather than duplicated. New files (no existing form) keep the caller's canonical NFC form, so wiki-page creation is unchanged. After this task CHECK 2 flips to PASS.

**Files:**
- Modify: `src/vault-tools.ts` (`write` method, currently lines 39-64)

- [ ] **Step 1: Rewrite `write` to resolve the target first**

Replace the current `write` method (lines 39-64):

```ts
  async write(vaultPath: string, content: string): Promise<void> {
    const segments = vaultPath.split("/").slice(0, -1);
    for (let i = 1; i <= segments.length; i++) {
      const partial = segments.slice(0, i).join("/");
      let exists = false;
      try { exists = await this.adapter.exists(partial); } catch { /* treat as missing */ }
      if (!exists) {
        try { await this.adapter.mkdir(partial); } catch { /* already exists or race */ }
      }
    }
    if (this.vault) {
      const indexed = this.vault.getAbstractFileByPath(vaultPath);
      if (indexed) {
        await this.vault.modify(indexed, content);
      } else {
        try {
          await this.vault.create(vaultPath, content);
        } catch {
          // Obsidian doesn't index hidden dirs (.config) — vault.create() throws if file exists on disk
          await this.adapter.write(vaultPath, content);
        }
      }
    } else {
      await this.adapter.write(vaultPath, content);
    }
  }
```

with (the only behavioral change is the first line plus using `target` everywhere `vaultPath` was used as the write destination):

```ts
  async write(vaultPath: string, content: string): Promise<void> {
    // Overwrite an existing file in its on-disk normalization form instead of
    // creating a duplicate in the caller's form. New files keep vaultPath as-is.
    const target = await this.resolveOnDiskPath(vaultPath);
    const segments = target.split("/").slice(0, -1);
    for (let i = 1; i <= segments.length; i++) {
      const partial = segments.slice(0, i).join("/");
      let exists = false;
      try { exists = await this.adapter.exists(partial); } catch { /* treat as missing */ }
      if (!exists) {
        try { await this.adapter.mkdir(partial); } catch { /* already exists or race */ }
      }
    }
    if (this.vault) {
      const indexed = this.vault.getAbstractFileByPath(target);
      if (indexed) {
        await this.vault.modify(indexed, content);
      } else {
        try {
          await this.vault.create(target, content);
        } catch {
          // Obsidian doesn't index hidden dirs (.config) — vault.create() throws if file exists on disk
          await this.adapter.write(target, content);
        }
      }
    } else {
      await this.adapter.write(target, content);
    }
  }
```

- [ ] **Step 2: Run the probe — both checks must now PASS**

Run: `npx tsx /tmp/cjk-probe/probe.ts`

Expected:
```
CHECK 1 read-recovery: PASS
CHECK 2 write-guard: PASS
ALL CHECKS PASS
```
and exit code 0.

- [ ] **Step 3: Build and lint**

Run: `npm run build && npm run lint`
Expected: build succeeds; no new lint errors in `src/vault-tools.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/vault-tools.ts
git commit -m "fix(vault-tools): write-guard resolves NFC/NFD target to avoid duplicates (#14)"
```

---

## Task 4: Update documentation (iwiki)

Document normalization-tolerant read/write in the VaultTools section of the wiki. This repo uses iwiki (`docs/wiki/`), not lat — invoke the iwiki skills rather than any `lat` command.

**Files:**
- Modify: `docs/wiki/architecture.md` (VaultTools section, starting at line 36)

- [ ] **Step 1: Regenerate the affected wiki page via iwiki**

Invoke the iwiki ingest skill on the changed source:

Run (skill): `iwiki:iwiki-ingest src/vault-tools.ts`

This updates `docs/wiki/architecture.md`. Ensure the VaultTools section gains a sentence describing the behavior, equivalent to:

> `read` is normalization-tolerant: on a not-found error it retries the NFC and NFD forms of the path (`resolveOnDiskPath`) and logs one diagnostic `console.warn` per miss. `write` resolves the same way so an existing file in a different normalization form (e.g. an NFD source note synced from macOS) is overwritten in place rather than duplicated. ASCII paths are unaffected.

If the ingest skill is unavailable, edit `docs/wiki/architecture.md` by hand to add that sentence to the `## VaultTools` section (after the existing `resolveLink` paragraph).

- [ ] **Step 2: Lint the docs graph**

Run (skill): `/iwiki-lint`
Expected: no broken `[[refs]]`, no orphan or stale pages. Fix any link the change introduced.

- [ ] **Step 3: Commit**

```bash
git add docs/wiki/
git commit -m "docs(wiki): note normalization-tolerant VaultTools read/write (#14)"
```

---

## Task 5: Open the pull request

Per project CLAUDE.md, `dev/*` branches merge into `master` via PR. We are already on `dev/cjk-filename-read-design`. (Ignore the spec footer's stale "target dev" instruction.)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin dev/cjk-filename-read-design
```

- [ ] **Step 2: Open the PR against master**

```bash
gh pr create --base master --title "fix: NFC/NFD-tolerant VaultTools read & write (#14)" --body "$(cat <<'EOF'
## Summary
- Self-healing `VaultTools.read`: on a not-found error, retries NFC/NFD forms via `resolveOnDiskPath` and re-throws the original error when no form matches (caller semantics preserved).
- `diagnose` logs one compact `console.warn` per miss (filename codepoints, nfc!=nfd, per-form result, parent dirents capped at 20).
- Write-guard: `VaultTools.write` resolves the target through `resolveOnDiskPath`, overwriting an existing file in its on-disk form instead of duplicating it (protects the ingest backlink write at `ingest.ts:510`).
- Centralized in `src/vault-tools.ts` — no caller changes. ASCII paths are unaffected (normalize is identity).

Fixes #14.

## Verification
- `npm run build` and `npm run lint` clean (no new findings in `vault-tools.ts`).
- Standalone `tsx` probe: NFD file on disk → `read(NFC)` recovers it and logs the diagnostic; `write(NFC)` overwrites in place with no duplicate dirent.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Clean up the throwaway probe**

Run: `rm -rf /tmp/cjk-probe`

---

## Self-Review

**1. Spec coverage**
- §1 `resolveOnDiskPath` → Task 2 Step 2. ✓
- §2 self-healing `read` (hot path, isNotFound, re-throw original) → Task 2 Step 4. ✓
- §3 `diagnose` (codepoints, nfc!=nfd, forms, parent dirents ≤20) → Task 2 Steps 1 & 3. ✓ F-001 resolved (cap = 20 exactly).
- §4 write-guard → Task 3 Step 1. ✓
- Edge cases (non-not-found bypasses fallback; mobile `adapter.exists` works; `readAll` swallow preserved; new files keep canonical form) → covered by the re-throw-original logic and `resolveOnDiskPath` returning the input for new files. ✓
- Verification (build, lint, probe, docs) → Tasks 2-4. ✓ (`lat check` intentionally dropped — lat is not installed; iwiki substitutes per Decision 1.)
- Branch workflow → Task 5, following CLAUDE.md not the stale spec footer (Decision 2). ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows full code; every run step shows the exact command and expected output. ✓

**3. Type consistency:** `resolveOnDiskPath(vaultPath: string): Promise<string>`, `diagnose(vaultPath: string): Promise<void>` (no error param — Decision 3), `codePointsHex(name: string): string`, `isNotFound(e: unknown): boolean`. `read` calls `this.diagnose(vaultPath)` and `this.resolveOnDiskPath(vaultPath)`; `write` calls `this.resolveOnDiskPath(vaultPath)` → `target`. Probe's `FsAdapter` implements the full `VaultAdapter` interface (`read`/`write`/`append`/`list`/`exists`/`mkdir`; optional members omitted). Names match across all tasks. ✓
