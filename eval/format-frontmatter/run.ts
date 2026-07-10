/**
 * Out-of-vault eval harness for the "format frontmatter repair + progress language" branch.
 *
 * It exercises the REAL pure functions from src/ against synthetic broken-frontmatter
 * fixtures derived from the spec's reproduction cases. It does NOT touch any Obsidian
 * vault and does NOT call an LLM — it validates the deterministic, pure logic that the
 * three bugs depend on.
 *
 * Run: see docs/superpowers/evals/2026-06-18-format-frontmatter-repair-eval.md
 */
import {
  restoreSourceFrontmatter,
  recoverSourceFrontmatter,
  parseWikiArticlesFromFm,
  upsertRawFrontmatter,
  validateAndRepairSourceFrontmatter,
} from "../../src/utils/raw-frontmatter";
import { resolveLang, i18nFor } from "../../src/i18n";

const OLD_ADDED = "2026-05-01"; // a legacy creation date — must be dropped, not preserved

// ---------- tiny assert framework ----------
let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`);
  }
}
function section(t: string): void {
  console.log(`\n=== ${t} ===`);
}

// ---------- helpers that mirror the real ingest backlink block ----------
// Replicates src/phases/ingest.ts backlink-write logic verbatim (Task 3: source
// notes no longer track wiki_added/wiki_updated — only wiki_articles).
function simulateIngestBacklink(
  sourceContent: string,
  writtenPaths: string[],
  deletedStems: Set<string>,
): string {
  const normalizedSource = recoverSourceFrontmatter(sourceContent);
  const existingArticles = parseWikiArticlesFromFm(normalizedSource).filter((link) => {
    const stem = link.replace(/^\[\[/, "").replace(/\]\]$/, "");
    return !deletedStems.has(stem);
  });
  const writtenLinks = writtenPaths.map((p) => `[[${p.split("/").pop()!.replace(/\.md$/, "")}]]`);
  const mergedArticles = [...new Set([...existingArticles, ...writtenLinks])];
  const updatedSource = upsertRawFrontmatter(normalizedSource, {
    wiki_articles: mergedArticles,
  });
  return validateAndRepairSourceFrontmatter(updatedSource).content;
}

function splitFence(content: string): { fm: string; body: string; fenceCount: number } {
  const fenceCount = (content.match(/^---\s*$/gm) ?? []).length;
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!m) return { fm: "", body: content, fenceCount };
  return { fm: m[1], body: content.slice(m[0].length), fenceCount };
}
function fmValue(fm: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(fm);
  return m?.[1].trim();
}
function bodyHasWikiKey(body: string): boolean {
  return /^wiki_[\w]+:/m.test(body);
}

// =====================================================================
// BUG 1 — restoreSourceFrontmatter (preview == apply)
// =====================================================================
section("Bug 1 — restoreSourceFrontmatter");

{
  // A: original is fenced with wiki_*; the LLM output dropped wiki_* (per schema).
  const original = `---
title: Шакшука
wiki_added: ${OLD_ADDED}
wiki_updated: 2026-06-16
wiki_articles:
  - "[[Шакшука с мясом и овощами]]"
---
# Шакшука
тело`;
  const llmOut = `---
title: Шакшука
---
# Шакшука
тело (переформатировано)`;

  const restored = restoreSourceFrontmatter(original, llmOut);
  const { fm, body, fenceCount } = splitFence(restored);
  check("A1 wiki_updated dropped (source notes no longer track dates)", fmValue(fm, "wiki_updated") === undefined, restored);
  check("A2 wiki_added dropped", fmValue(fm, "wiki_added") === undefined, restored);
  check("A3 wiki_articles restored", parseWikiArticlesFromFm(restored).includes("[[Шакшука с мясом и овощами]]"), restored);
  check("A4 single frontmatter fence", fenceCount === 2, `fenceCount=${fenceCount}\n${restored}`);
  check("A5 no wiki_* left in body", !bodyHasWikiKey(body), restored);

  // B: idempotency — apply over the already-restored preview must be a no-op.
  const restoredTwice = restoreSourceFrontmatter(original, restored);
  check("B1 restore is idempotent (preview bytes == apply bytes)", restoredTwice === restored,
    `first:\n${restored}\n--- second:\n${restoredTwice}`);
}

{
  // C: original WITHOUT wiki_updated — must still normalize, must not crash.
  const original = `---
title: Plain
---
# Plain
body`;
  const llmOut = `---
title: Plain
---
# Plain
reformatted`;
  let ok = true;
  let out = "";
  try { out = restoreSourceFrontmatter(original, llmOut); } catch { ok = false; }
  check("C1 no-wiki_updated original normalizes without throwing", ok && out.length > 0, out);
}

// =====================================================================
// BUG 3 — re-ingest restores source wiki_* backlinks (recoverSourceFrontmatter)
// =====================================================================
section("Bug 3 — re-ingest source backlink recovery");

const NEW_PAGE = "ОКСАНА/Питание/Wiki/Завтрак.md";
const NEW_LINK = "[[Завтрак]]";
const EXISTING_LINK = "[[Шакшука с мясом и овощами]]";

{
  // D: fully unfenced, scalar only, duplicate wiki_updated (spec §"Concrete reproduction").
  const src = `wiki_added: ${OLD_ADDED}
wiki_updated: 2026-06-16
wiki_updated: 2026-06-16
# Шакшука с мясом и овощами
текст рецепта`;
  const out = simulateIngestBacklink(src, [NEW_PAGE], new Set());
  const { fm, body, fenceCount } = splitFence(out);
  check("D1 wiki_added dropped", fmValue(fm, "wiki_added") === undefined, out);
  check("D2 wiki_updated dropped", fmValue(fm, "wiki_updated") === undefined, out);
  check("D3 single valid fence (duplicate deduped)", fenceCount === 2, `fenceCount=${fenceCount}\n${out}`);
  check("D4 new backlink present", parseWikiArticlesFromFm(out).includes(NEW_LINK), out);
  check("D5 no orphan wiki_* in body", !bodyHasWikiKey(body), out);
}

{
  // E: fully unfenced but wiki_articles is a BLOCK LIST (the shape upsertRawFrontmatter writes).
  const src = `wiki_added: ${OLD_ADDED}
wiki_updated: 2026-06-16
wiki_articles:
  - "${EXISTING_LINK}"
# Шакшука с мясом и овощами
текст рецепта`;
  const out = simulateIngestBacklink(src, [NEW_PAGE], new Set());
  const { fm, body, fenceCount } = splitFence(out);
  const arts = parseWikiArticlesFromFm(out);
  check("E1 wiki_added dropped", fmValue(fm, "wiki_added") === undefined, out);
  check("E2 existing block-list backlink recovered (union)", arts.includes(EXISTING_LINK), `articles=${JSON.stringify(arts)}\n${out}`);
  check("E3 new backlink present", arts.includes(NEW_LINK), out);
  check("E4 single valid fence", fenceCount === 2, `fenceCount=${fenceCount}\n${out}`);
  check("E5 no stranded wiki_* / list items in body", !bodyHasWikiKey(body) && !/^\s*-\s*\[\[/m.test(body), `body:\n${body}`);
}

{
  // F: valid leading fence (title only) with wiki_* stranded in the BODY — the real
  //    on-disk artifact the old upsertRawFrontmatter produced (spec §Root cause).
  const src = `---
title: Шакшука
---
wiki_added: ${OLD_ADDED}
wiki_updated: 2026-06-16
wiki_articles:
  - "${EXISTING_LINK}"
# Шакшука с мясом и овощами
текст рецепта`;
  const out = simulateIngestBacklink(src, [NEW_PAGE], new Set());
  const { fm, body } = splitFence(out);
  const arts = parseWikiArticlesFromFm(out);
  check("F1 wiki_added dropped", fmValue(fm, "wiki_added") === undefined, out);
  check("F2 existing backlink recovered (union)", arts.includes(EXISTING_LINK), `articles=${JSON.stringify(arts)}\n${out}`);
  check("F3 no orphan wiki_* left in body", !bodyHasWikiKey(body), `body:\n${body}`);
}

{
  // G: POSITIVE CONTROL — already valid fenced source (normal re-ingest case).
  const src = `---
title: Шакшука
wiki_added: ${OLD_ADDED}
wiki_updated: 2026-06-16
wiki_articles:
  - "${EXISTING_LINK}"
---
# Шакшука с мясом и овощами
текст рецепта`;
  const out = simulateIngestBacklink(src, [NEW_PAGE], new Set());
  const { fm, body, fenceCount } = splitFence(out);
  const arts = parseWikiArticlesFromFm(out);
  check("G1 wiki_added dropped", fmValue(fm, "wiki_added") === undefined, out);
  check("G2 existing backlink kept", arts.includes(EXISTING_LINK), out);
  check("G3 new backlink merged", arts.includes(NEW_LINK), out);
  check("G4 single valid fence", fenceCount === 2, `fenceCount=${fenceCount}\n${out}`);
  check("G5 no wiki_* in body", !bodyHasWikiKey(body), out);
}

{
  // H: recoverSourceFrontmatter is idempotent — recover(recover(x)) == recover(x)
  //    across all broken shapes.
  const shapes = [
    `wiki_added: ${OLD_ADDED}\nwiki_updated: 2026-06-16\nwiki_updated: 2026-06-16\n# T\nx`,
    `wiki_added: ${OLD_ADDED}\nwiki_articles:\n  - "${EXISTING_LINK}"\n# T\nx`,
    `---\ntitle: T\n---\nwiki_added: ${OLD_ADDED}\nwiki_articles:\n  - "${EXISTING_LINK}"\n# T\nx`,
  ];
  let allIdem = true;
  shapes.forEach((s, idx) => {
    const once = recoverSourceFrontmatter(s);
    const twice = recoverSourceFrontmatter(once);
    if (once !== twice) { allIdem = false; console.log(`        shape ${idx} not idempotent:\n${once}\n---\n${twice}`); }
  });
  check("H1 recoverSourceFrontmatter is idempotent", allIdem);
}

{
  // I: a genuinely frontmatter-less page is returned unchanged.
  const src = `# Just a heading\n\nsome prose without any frontmatter`;
  check("I1 frontmatter-less page unchanged", recoverSourceFrontmatter(src) === src);
}

{
  // J: prose whose first line looks like a frontmatter key but carries NO wiki_* field
  //    must NOT be lifted into a fabricated fence.
  const src = `updated: see the appendix below\n\nThe rest of the article continues here.`;
  check("J1 frontmatter-like prose (no wiki_*) unchanged", recoverSourceFrontmatter(src) === src,
    recoverSourceFrontmatter(src));
}

// =====================================================================
// BUG 2 — progress language resolution
// =====================================================================
section("Bug 2 — progress language");

function setLocale(l: string): void {
  (globalThis as { __MOMENT_LOCALE__?: string }).__MOMENT_LOCALE__ = l;
}

check("P1 explicit en → en", resolveLang("en") === "en");
check("P2 explicit ru → ru", resolveLang("ru") === "ru");
check("P3 explicit es → es", resolveLang("es") === "es");

setLocale("ru-RU");
check("P4 auto + ru-RU locale → ru", resolveLang("auto") === "ru");
setLocale("es-419");
check("P5 auto + es-419 locale → es", resolveLang("auto") === "es");
setLocale("en-GB");
check("P6 auto + en-GB locale → en", resolveLang("auto") === "en");
setLocale("");
check("P7 auto + empty locale → en", resolveLang("auto") === "en");
setLocale("de");
check("P8 auto + unsupported (de) → en", resolveLang("auto") === "en");
setLocale("ru");
check("P9 undefined + ru locale → ru", resolveLang(undefined) === "ru");

const en = i18nFor("en").formatProgress;
const ru = i18nFor("ru").formatProgress;
const es = i18nFor("es").formatProgress;
check("P10 en bundle analysing is English", en.analysing("x").startsWith("Analysing"));
check("P11 ru bundle analysing is Russian", ru.analysing("x").startsWith("Анализ"));
check("P12 es bundle analysing is Spanish", es.analysing("x").startsWith("Analizando"));
check("P13 en truncationHintEnv is English", /raise the limit/.test(en.truncationHintEnv));
check("P14 ru sentinelInvalidAfterRetry is Russian", /sentinel/i.test(ru.sentinelInvalidAfterRetry) && /невалидный/.test(ru.sentinelInvalidAfterRetry));

// ---------- summary ----------
console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
}
