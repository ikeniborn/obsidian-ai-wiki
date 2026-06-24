/**
 * Out-of-vault eval for incremental-reinit changed-source detection.
 * Exercises the REAL pure functions from src/ plus a node-fs integration that
 * replays the A2 write order (source written before pages) and asserts the
 * detector returns no changes for an un-edited vault. No Obsidian, no LLM.
 */
import { mkdtempSync, writeFileSync, statSync, utimesSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeChangedSources, capList } from "../../src/incremental-sources";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// =====================================================================
section("computeChangedSources — pure rules");

// 1: unchanged source (newer page) → not flagged (strict >)
check("1 unchanged source excluded", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 100 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }],
}).changed.length === 0);

// 2: edited source (newer than page) → flagged
check("2 edited source included", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 300 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }],
}).changed[0] === "src/a.md");

// 3: equal mtimes → NOT flagged (strict >)
check("3 equal mtime excluded (strict >)", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 200 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }],
}).changed.length === 0);

// 4: new source, no associated page → flagged (trust bias)
check("4 new source included", computeChangedSources({
  sourceFiles: [{ stem: "b", path: "src/b.md", mtime: 50 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }],
}).changed[0] === "src/b.md");

// 5: null source mtime → flagged (trust bias)
check("5 null source mtime included", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: null }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }],
}).changed[0] === "src/a.md");

// 6: null page mtime → flagged (trust bias)
check("6 null page mtime included", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 100 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: null, sources: ["a"] }],
}).changed[0] === "src/a.md");

// 7: shared page + min aggregation — A unedited vs oldest page
check("7 min aggregation, unedited shared-source excluded", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 100 }],
  wikiPages: [
    { path: "w/wiki_d_p1.md", mtime: 150, sources: ["a"] },        // a's own page
    { path: "w/wiki_d_p2.md", mtime: 500, sources: ["a", "b"] },   // shared, bumped by b later
  ],
}).changed.length === 0);  // min(150,500)=150 ; 100 > 150? no

// 8: strict subset — only the edited one of two sources
check("8 strict subset", JSON.stringify(computeChangedSources({
  sourceFiles: [
    { stem: "a", path: "src/a.md", mtime: 100 },
    { stem: "b", path: "src/b.md", mtime: 999 },
  ],
  wikiPages: [
    { path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] },
    { path: "w/wiki_d_b.md", mtime: 200, sources: ["b"] },
  ],
}).changed) === JSON.stringify(["src/b.md"]));

// =====================================================================
section("capList");
check("9 capList under cap returns all", (() => {
  const r = capList(["a", "b"], 20); return r.shown.length === 2 && r.overflow === 0;
})());
check("10 capList over cap truncates + overflow", (() => {
  const names = Array.from({ length: 25 }, (_, i) => `n${i}`);
  const r = capList(names, 20); return r.shown.length === 20 && r.overflow === 5;
})());

// =====================================================================
section("node-fs integration — A2 order contract");
(async () => {
  const dir = mkdtempSync(join(tmpdir(), "incr-reinit-"));
  try {
    const adapter: VaultAdapter = {
      read: async (p) => "", write: async () => {}, append: async () => {},
      list: async () => ({ files: [], folders: [] }), exists: async () => true,
      mkdir: async () => {},
      stat: async (p) => { try { return { mtime: statSync(join(dir, p)).mtimeMs }; } catch { return null; } },
    };
    const vt = new VaultTools(adapter, dir);

    // A2 write order: source FIRST, then page.
    const srcRel = "a.md", pageRel = "wiki_d_a.md";
    writeFileSync(join(dir, srcRel), "---\ntitle: A\n---\nbody");
    writeFileSync(join(dir, pageRel), "---\nwiki_sources:\n  - a\n---\npage");

    const srcMtime = await vt.mtime(srcRel);
    const pageMtime = await vt.mtime(pageRel);
    check("11 page mtime ≥ source mtime after A2 order", (pageMtime ?? 0) >= (srcMtime ?? 0),
      `src=${srcMtime} page=${pageMtime}`);

    const before = computeChangedSources({
      sourceFiles: [{ stem: "a", path: srcRel, mtime: srcMtime }],
      wikiPages: [{ path: pageRel, mtime: pageMtime, sources: ["a"] }],
    });
    check("12 un-edited vault → no changes", before.changed.length === 0, JSON.stringify(before));

    // Manual edit: bump source mtime well past the page.
    utimesSync(join(dir, srcRel), new Date(), new Date((pageMtime ?? 0) + 10_000));
    const editedMtime = await vt.mtime(srcRel);
    const after = computeChangedSources({
      sourceFiles: [{ stem: "a", path: srcRel, mtime: editedMtime }],
      wikiPages: [{ path: pageRel, mtime: pageMtime, sources: ["a"] }],
    });
    check("13 edited source → flagged", after.changed[0] === srcRel, JSON.stringify(after));
  } finally { rmSync(dir, { recursive: true, force: true }); }

  console.log(`\n========================================`);
  console.log(`TOTAL: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
})();
