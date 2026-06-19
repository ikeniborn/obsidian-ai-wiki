/**
 * Out-of-vault eval harness for the "format vision sentinel-marker sweep" branch.
 *
 * Exercises the REAL pure functions from src/phases/format-utils.ts against
 * synthetic LLM-output fixtures derived from the spec's reproduction case. It does
 * NOT touch an Obsidian vault and does NOT call an LLM — it validates the
 * deterministic parse/sweep logic the fix depends on.
 *
 * Run: see docs/superpowers/evals/2026-06-19-format-sentinel-sweep-eval.md
 */
import {
  parseSentinelOutput,
  stripSentinelMarkers,
} from "../../src/phases/format-utils";

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

// =====================================================================
// Component 1 — parseSentinelOutput is order-robust
// =====================================================================
section("Component 1 — parseSentinelOutput");

{
  // PARSE-1 (the spec's named reproduction): a stray <<<END>>> emitted BEFORE
  // <<<VISION_COUNT>>>. The old code (formattedEnd = visionIdx) swallowed it into
  // the formatted body; the fix slices up to the earliest trailing marker.
  const malformed = [
    "<<<REPORT>>>",
    "ok",
    "<<<FORMATTED>>>",
    "# Title",
    "body content",
    "<<<END>>>",
    "<<<VISION_COUNT>>>",
    "2",
    "<<<EMBEDS>>>",
    "![[a.png]] | ![[b.png]]",
  ].join("\n");
  const r = parseSentinelOutput(malformed, true);
  check("parse-1 result not null", r !== null);
  check("parse-1 formatted has no <<<END>>>", r !== null && !r.formatted.includes("<<<END>>>"), r?.formatted);
  check("parse-1 formatted body intact", r?.formatted === "# Title\nbody content", JSON.stringify(r?.formatted));
}

{
  // PARSE-2 positive control: well-formed vision output (FORMATTED < VISION_COUNT
  // < EMBEDS < END). Must parse identically before and after the fix.
  const normal = [
    "<<<REPORT>>>",
    "ok",
    "<<<FORMATTED>>>",
    "# Title",
    "body content",
    "<<<VISION_COUNT>>>",
    "2",
    "<<<EMBEDS>>>",
    "![[a.png]] | ![[b.png]]",
    "<<<END>>>",
  ].join("\n");
  const r = parseSentinelOutput(normal, true);
  check("parse-2 formatted body", r?.formatted === "# Title\nbody content", JSON.stringify(r?.formatted));
  check("parse-2 visionCount", r?.visionCount === 2, String(r?.visionCount));
  check("parse-2 embeds", JSON.stringify(r?.embeds) === JSON.stringify(["![[a.png]]", "![[b.png]]"]), JSON.stringify(r?.embeds));
  check("parse-2 not truncated", r?.truncated === false, String(r?.truncated));
}

{
  // PARSE-3 positive control: truncated vision output (no <<<END>>> at all) still
  // sets truncated = true and slices the body up to <<<VISION_COUNT>>>.
  const truncated = [
    "<<<REPORT>>>",
    "ok",
    "<<<FORMATTED>>>",
    "# Title",
    "partial",
    "<<<VISION_COUNT>>>",
    "1",
    "<<<EMBEDS>>>",
    "![[a.png]]",
  ].join("\n");
  const r = parseSentinelOutput(truncated, true);
  check("parse-3 truncated flag", r?.truncated === true, String(r?.truncated));
  check("parse-3 formatted body", r?.formatted === "# Title\npartial", JSON.stringify(r?.formatted));
}

// ---------- summary ----------
console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
}
