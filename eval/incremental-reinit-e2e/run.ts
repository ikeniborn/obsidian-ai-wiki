/**
 * End-to-end-ish eval for the incremental re-init MECHANISM, on real test
 * articles in a real temporary vault — no Obsidian, no LLM.
 *
 * It creates source notes + wiki pages on disk (written in the A2 order: source
 * first, then its page) and drives the REAL implemented functions exactly the
 * way controller.computeIncrementalPlan composes them at runtime:
 *
 *     walk files → VaultTools.mtime (real fs stat) → parseWikiSources
 *                → computeChangedSources  ⇒  the changed set
 *
 * The only piece replaced vs production is Obsidian's vault walker
 * (collectMdInPaths); everything that DECIDES which sources are re-ingested is
 * the production code. File timestamps are set explicitly with utimes so each
 * scenario is deterministic (no ms-resolution flakiness), except scenario S2
 * which uses real consecutive writes to prove the A2 write-order invariant.
 */
import {
  mkdtempSync, mkdirSync, writeFileSync, statSync, utimesSync, rmSync, readFileSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { computeChangedSources } from "../../src/incremental-sources";
import { parseWikiSources } from "../../src/utils/vault-walk";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

/** A node-fs adapter shaped like the slice of Obsidian's DataAdapter that VaultTools.mtime needs. */
function fsAdapter(root: string): VaultAdapter {
  return {
    read: async (p) => readFileSync(join(root, p), "utf8"),
    write: async () => {}, append: async () => {},
    list: async () => ({ files: [], folders: [] }), exists: async () => true,
    mkdir: async () => {},
    stat: async (p) => { try { return { mtime: statSync(join(root, p)).mtimeMs }; } catch { return null; } },
  };
}

function writeFile(root: string, rel: string, content: string, mtimeMs?: number): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  if (mtimeMs !== undefined) { const d = new Date(mtimeMs); utimesSync(abs, d, d); }
}

const sourceArticle = (title: string): string => `---\ntitle: ${title}\n---\n\n# ${title}\n\nBody of ${title}.\n`;
const wikiPage = (stems: string[]): string =>
  `---\nwiki_sources:\n${stems.map((s) => `  - ${s}`).join("\n")}\n---\n\nWiki page for ${stems.join(", ")}.\n`;

/**
 * Reproduce computeIncrementalPlan's core composition against a real fs vault.
 * `sources` = relative source paths; `wikis` = relative wiki-page paths.
 */
async function detect(root: string, sources: string[], wikis: string[]): Promise<string[]> {
  const vt = new VaultTools(fsAdapter(root), root);
  const sourceFiles = [];
  for (const path of sources) {
    sourceFiles.push({ stem: basename(path).replace(/\.md$/, ""), path, mtime: await vt.mtime(path) });
  }
  const wikiPages = [];
  for (const path of wikis) {
    const content = await vt.read(path).catch(() => "");
    wikiPages.push({ path, mtime: await vt.mtime(path), sources: parseWikiSources(content) });
  }
  return computeChangedSources({ sourceFiles, wikiPages }).changed;
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "incr-e2e-"));
  try {
    // ---- Build a 3-source domain, A2 order (page mtime = source mtime + 1s). ----
    const T0 = 1_700_000_000_000;
    const srcOf = (s: string) => `notes/${s}.md`;
    const pageOf = (s: string) => `wiki/wiki_d_${s}.md`;
    const stems = ["alpha", "beta", "gamma"];
    for (let i = 0; i < stems.length; i++) {
      const s = stems[i];
      const srcMtime = T0 + i * 100;              // each source a bit apart
      writeFile(dir, srcOf(s), sourceArticle(s), srcMtime);
      writeFile(dir, pageOf(s), wikiPage([s]), srcMtime + 1000);   // A2: page strictly newer
    }
    const allSources = stems.map(srcOf);
    const allWikis = stems.map(pageOf);

    section("S1 — fresh vault right after ingest → nothing flagged (A2 invariant)");
    {
      const changed = await detect(dir, allSources, allWikis);
      check("S1 no changed sources right after ingest", changed.length === 0, JSON.stringify(changed));
    }

    section("S2 — real consecutive A2 writes: page mtime >= source mtime");
    {
      const vt = new VaultTools(fsAdapter(dir), dir);
      writeFile(dir, srcOf("delta"), sourceArticle("delta"));   // real write, no utimes
      writeFile(dir, pageOf("delta"), wikiPage(["delta"]));     // written after → page >= source
      const sm = await vt.mtime(srcOf("delta"));
      const pm = await vt.mtime(pageOf("delta"));
      check("S2 page mtime >= source mtime after A2 write order", (pm ?? 0) >= (sm ?? 0), `src=${sm} page=${pm}`);
      // and the freshly-written delta is NOT flagged
      const changed = await detect(dir, [srcOf("delta")], [pageOf("delta")]);
      check("S2 freshly-ingested delta not flagged", changed.length === 0, JSON.stringify(changed));
    }

    section("S3 — edit exactly one source → only it is flagged");
    {
      // Bump alpha's source mtime well past its page (simulates a manual edit after ingest).
      const alphaPageMtime = statSync(join(dir, pageOf("alpha"))).mtimeMs;
      const edited = new Date(alphaPageMtime + 10_000);
      utimesSync(join(dir, srcOf("alpha")), edited, edited);

      const changed = await detect(dir, allSources, allWikis);
      check("S3 edited alpha flagged", changed.includes(srcOf("alpha")), JSON.stringify(changed));
      check("S3 unedited beta NOT flagged", !changed.includes(srcOf("beta")), JSON.stringify(changed));
      check("S3 unedited gamma NOT flagged", !changed.includes(srcOf("gamma")), JSON.stringify(changed));
      check("S3 exactly one source flagged", changed.length === 1, JSON.stringify(changed));
    }

    section("S4 — brand-new source with no wiki page → flagged (trust bias)");
    {
      // Reset alpha so only the new source differs from a clean post-ingest state.
      const alphaPageMtime = statSync(join(dir, pageOf("alpha"))).mtimeMs;
      const reset = new Date(alphaPageMtime - 500);
      utimesSync(join(dir, srcOf("alpha")), reset, reset);

      writeFile(dir, srcOf("omega"), sourceArticle("omega"), T0 + 5000);   // NEW source, no page yet
      const sources = [...allSources, srcOf("omega")];
      const changed = await detect(dir, sources, allWikis);
      check("S4 new omega (no page) flagged", changed.includes(srcOf("omega")), JSON.stringify(changed));
      check("S4 only the new source flagged", changed.length === 1, JSON.stringify(changed));
    }

    section("S5 — parseWikiSources extracts the structural mapping from a real page");
    {
      const content = readFileSync(join(dir, pageOf("alpha")), "utf8");
      const parsed = parseWikiSources(content);
      check("S5 parseWikiSources(alpha page) === ['alpha']", JSON.stringify(parsed) === JSON.stringify(["alpha"]));
    }

    section("S6 — shared page + min aggregation: unedited shared source stays excluded");
    {
      // Two sources (epsilon, zeta) where epsilon has its own page, plus a shared
      // page bumped later by zeta's edit. epsilon is unedited → must stay excluded
      // because min(its pages) is still newer than epsilon's source.
      const eMtime = T0 + 6000;
      writeFile(dir, srcOf("epsilon"), sourceArticle("epsilon"), eMtime);
      writeFile(dir, "wiki/wiki_d_epsilon.md", wikiPage(["epsilon"]), eMtime + 1000);
      writeFile(dir, "wiki/wiki_d_shared.md", wikiPage(["epsilon", "zeta"]), eMtime + 50_000); // bumped by zeta later

      const changed = await detect(
        dir,
        [srcOf("epsilon")],
        ["wiki/wiki_d_epsilon.md", "wiki/wiki_d_shared.md"],
      );
      check("S6 unedited epsilon excluded under min aggregation", changed.length === 0, JSON.stringify(changed));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n========================================`);
  console.log(`TOTAL: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
}

void main();
