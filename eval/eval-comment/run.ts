/**
 * Out-of-vault eval for the eval-log read/comment helpers. Exercises the REAL
 * pure functions from src/eval-log.ts against an in-memory VaultAdapter. No
 * vault, no LLM.
 *
 * Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/eval-comment/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --outfile=eval/eval-comment/run.cjs
 *   node eval/eval-comment/run.cjs
 */
import { readEvalRecord, updateEvalComment, type EvalRecord } from "../../src/eval-log";
import type { VaultAdapter } from "../../src/vault-tools";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// Minimal in-memory adapter (only the methods the helpers touch).
function memAdapter(seed: Record<string, string> = {}): VaultAdapter {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    read: async (p: string) => files.get(p) ?? "",
    write: async (p: string, d: string) => { files.set(p, d); },
    append: async (p: string, d: string) => { files.set(p, (files.get(p) ?? "") + d); },
    exists: async (p: string) => files.has(p),
  } as VaultAdapter;
}

const DIR = "/plugin";
const PATH = `${DIR}/eval.jsonl`;
function rec(partial: Partial<EvalRecord>): string {
  return JSON.stringify({ runId: "r1", ts: "t", operation: "query", model: "m",
    llmErrors: [], ruleFirings: {}, ratings: {}, ...partial });
}

section("readEvalRecord");
{
  const log = rec({ runId: "r1", ratings: { answer: "up" }, comment: "good" }) + "\n" +
              rec({ runId: "r2", ratings: { answer: "down" } }) + "\n";
  const ad = memAdapter({ [PATH]: log });
  void (async () => {
    const a = await readEvalRecord(ad, DIR, "r1");
    check("returns ratings+comment for runId", a?.ratings.answer === "up" && a?.comment === "good", JSON.stringify(a));
    const b = await readEvalRecord(ad, DIR, "r2");
    check("defaults comment to empty string", b?.comment === "" && b?.ratings.answer === "down", JSON.stringify(b));
    const c = await readEvalRecord(ad, DIR, "missing");
    check("undefined on miss", c === undefined);
    const d = await readEvalRecord(memAdapter(), DIR, "r1");
    check("undefined when file absent", d === undefined);

    section("updateEvalComment");
    const saved = await updateEvalComment(ad, DIR, "r1", "edited");
    check("returns persisted comment", saved === "edited", String(saved));
    const reread = await readEvalRecord(ad, DIR, "r1");
    check("comment persisted in place", reread?.comment === "edited" && reread?.ratings.answer === "up", JSON.stringify(reread));
    const r2still = await readEvalRecord(ad, DIR, "r2");
    check("other record untouched", r2still?.ratings.answer === "down" && r2still?.comment === "", JSON.stringify(r2still));
    const none = await updateEvalComment(ad, DIR, "nope", "x");
    check("undefined when runId absent", none === undefined);

    console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
    if (fail > 0) { console.log(failures.join("\n")); process.exit(1); }
  })();
}
