/**
 * Out-of-vault eval for probeClaudeBinary (src/claude-cli-client.ts). Spawns a
 * REAL binary (the running Node executable) — no vault, no Obsidian, no LLM.
 *
 * Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/claude-probe/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --alias:obsidian=./eval/claude-probe/obsidian-stub.ts \
 *     --outfile=eval/claude-probe/run.cjs
 *   node eval/claude-probe/run.cjs
 */
// Expose `window` so window.setTimeout/clearTimeout calls in probeClaudeBinary
// resolve correctly under Node (where `window` is undefined by default).
// In Obsidian/Electron `window` is already the global object, so this is a no-op there.
(global as typeof global & { window?: unknown }).window ??= global;

import { probeClaudeBinary } from "../../src/claude-cli-client";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        -> ${detail}` : ""}`); }
}
async function resolves(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return true; } catch { return false; }
}
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

async function main(): Promise<void> {
  console.log("=== probeClaudeBinary ===");
  // process.execPath is an absolute path to the Node binary, which supports
  // `--version` and exits 0 — stands in for a healthy Claude CLI binary.
  check("valid binary resolves", await resolves(() => probeClaudeBinary(process.execPath)));
  check("missing binary rejects", await rejects(() => probeClaudeBinary("/nonexistent/zzz-claude-binary")));
  check("relative path rejects", await rejects(() => probeClaudeBinary("relative/claude")));
  check("empty path rejects", await rejects(() => probeClaudeBinary("")));
  check("traversal path rejects", await rejects(() => probeClaudeBinary("/opt/../etc/claude")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log("FAILURES:\n  " + failures.join("\n  ")); process.exit(1); }
}
main();
