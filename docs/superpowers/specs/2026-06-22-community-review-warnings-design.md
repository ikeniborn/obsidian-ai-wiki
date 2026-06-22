---
review:
  spec_hash: 42da2e6a0ad4af29
  last_run: 2026-06-22
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: INFO
      section: "### Fix 2 — replace the `fs` probe with a spawn probe"
      section_hash: 20a3d59b4d765303
      text: "Spawn probe adds a 5s timeout and a wrapper-.sh non-zero-exit edge case beyond the two approved tasks — intentional design detail, not scope creep."
      verdict: accepted
      verdict_at: 2026-06-22
chain:
  intent: null
---
# Community-review warning remediation: undici advisory + direct fs access

**Date:** 2026-06-22
**Branch:** `dev/community-review-warnings`
**Status:** Design approved, pending implementation plan

## Problem

The Obsidian community-plugin submission review raised two **non-blocking**
warnings that should still be addressed before publication:

1. **Direct Filesystem Access** — the plugin uses the Node.js `fs` module to
   reach the filesystem outside the Obsidian vault API. The reviewer's automated
   scanner flags any `fs` import as "can read and write any file on the system."
2. **Dependency vulnerability advisory** — `undici`
   (<https://github.com/advisories/GHSA-p88m-4jfj-68fv>).

Both are independent and fixable with surgical changes. No feature is removed.

### Source of warning 1 — the only `fs` usage

`src/settings.ts` is the **single** place that imports `fs`:

```typescript
async function checkClaudeAvailability(iclaudePath: string): Promise<void> {
  const { access, constants } = require("node:fs/promises") as typeof import("node:fs/promises");
  await access(iclaudePath, constants.X_OK);
}
```

It backs the **Test connection** button next to the Claude-CLI path setting
(`src/settings.ts` ~L404), checking that the configured binary exists and is
executable. It is read-only (`X_OK`), never writes — but the scanner flags the
import regardless. No other file in `src/` imports `fs` or `fs/promises`.

`src/claude-cli-client.ts` spawns the binary through `node:child_process`
(`spawn`). That is a **separate** native surface, already `external` in the
esbuild bundle and already gated behind explicit user consent
(`ShellConsentModal`). It is **out of scope** here — it is the core of the
Claude-CLI backend and cannot be removed without dropping that feature.

### Source of warning 2 — undici

`undici` is a direct dependency (`^6.25.0`, installed 6.25.0), **bundled** into
`dist/main.js` by esbuild. Its only use is `src/proxy.ts`, which builds a
`ProxyAgent` + `undici.fetch` wrapper for the optional custom HTTP-proxy feature
(desktop-only; returns `null` on mobile).

The advisory `GHSA-p88m-4jfj-68fv` (CVE-2026-9679, CRLF/header injection via the
cookie parser, CVSS 5.9 moderate) affects `undici < 6.27.0`. `npm audit`
additionally lists three more undici advisories in the same `<= 6.26.0` range.
The plugin does not use the affected cookie-parsing APIs (`parseSetCookie` /
`parseCookie` / `getSetCookies`), so real exploitability is negligible — but the
scanner flags by declared version.

## Goals

- Remove every `fs` / `fs/promises` import from `src/` so warning 1 disappears.
- Raise the declared `undici` version past the patched line so warning 2
  disappears.
- Keep the **Test connection** button working.
- Keep the custom-proxy feature and the Claude-CLI backend intact.

## Non-goals

- Removing or re-gating the `child_process` spawn (Claude-CLI backend).
- Dropping the custom-proxy feature / removing `undici`.
- A version bump / release — handled separately via the `publish-version` flow.

## Design

### Fix 1 — bump undici

- `package.json`: `"undici": "^6.25.0"` → `"^6.27.0"` (latest 6.x; closes
  `GHSA-p88m-4jfj-68fv` plus the three other undici advisories from `npm audit`).
- `npm install` to update `package-lock.json` to 6.27.0.
- Rebuild `dist/main.js` (undici is bundled, so the shipped artifact must carry
  the patched copy).
- No source change: `src/proxy.ts` uses only `ProxyAgent` + `fetch`, which are
  API-stable across the 6.25 → 6.27 minor bump.

### Fix 2 — replace the `fs` probe with a spawn probe

Rewrite `checkClaudeAvailability` in `src/settings.ts` to drop `fs/promises` and
instead launch the binary itself, reusing the existing path guard:

```typescript
async function checkClaudeAvailability(iclaudePath: string): Promise<void> {
  validateIclaudePath(iclaudePath); // absolute, non-empty, no ".." — from claude-cli-client.ts
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(iclaudePath, ["--version"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("timeout")); }, 5000);
    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });          // ENOENT / EACCES
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `exit ${code}`));
    });
  });
}
```

Properties:

- **No `fs` import anywhere in `src/`** → warning 1 cleared.
- `child_process` is already `external` in esbuild and already used by
  `claude-cli-client.ts`; the dynamic `await import(...)` keeps it lazy and
  desktop-scoped (the button is only rendered under
  `eff.backend === "claude-agent" && !Platform.isMobile`).
- **Consent already granted**: reaching the `claude-agent` backend goes through
  `ShellConsentModal` first, so the probe never spawns without prior consent.
- `validateIclaudePath` is reused (already exported from `claude-cli-client.ts`)
  so the probe rejects empty / relative / traversal paths before spawning.
- Error mapping: `error` event → "not found / not executable"; non-zero exit →
  stderr or `exit N`; timeout → `timeout`. The button surfaces these as the
  existing `❌ ${message}` notice.

### `--version` assumption

The probe sends `--version`. The Claude CLI supports it and exits 0. If a user
points at a custom `.sh` wrapper that does not handle `--version`, the binary
still launched (so it exists and is executable) but exits non-zero, yielding a
`❌ exit N` notice. This is acceptable "test connection" semantics — a launched
binary is a strictly stronger signal than the old `X_OK` permission check.

## Verification

- `grep -rn "node:fs\|fs/promises\|from ['\"]fs['\"]" src/` → empty.
- `npm audit` → no `undici` advisory remaining.
- `npm run lint` (mirrors the Obsidian reviewer) → clean for touched files;
  node builtins stay lazy + desktop-guarded.
- `tsc` → no **new** errors in touched files (baseline is ~135 pre-existing
  errors in untouched files; gate on new, not on a clean run).
- Manual, in a real vault after `dist` rebuild: **Test connection** with a valid
  path → `ok` notice; with a bogus path → `❌` notice; with an empty path →
  `❌` (validateIclaudePath rejects).
- Rebuild `dist/main.js`; update `docs/wiki/` via `iwiki:iwiki-ingest` for the
  touched sources (`settings.ts`, proxy/deps), then `iwiki-lint` (no broken
  `[[refs]]`, no orphan/stale pages).

## Out of scope / follow-ups

- Version bump + release notes via `publish-version`.
- The `child_process` spawn surface (Claude-CLI backend) — unchanged, remains
  consent-gated.
