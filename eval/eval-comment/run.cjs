"use strict";

// src/eval-log.ts
function evalLogPath(pluginDir) {
  return `${pluginDir}/eval.jsonl`;
}
async function readEvalRecord(adapter, pluginDir, runId) {
  const path = evalLogPath(pluginDir);
  try {
    if (!await adapter.exists(path)) return void 0;
    const content = await adapter.read(path);
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec2;
      try {
        rec2 = JSON.parse(raw);
      } catch {
        continue;
      }
      if (rec2.runId !== runId) continue;
      return { ratings: rec2.ratings ?? {}, comment: rec2.comment ?? "" };
    }
    return void 0;
  } catch {
    return void 0;
  }
}
async function updateEvalComment(adapter, pluginDir, runId, comment) {
  const path = evalLogPath(pluginDir);
  try {
    if (!await adapter.exists(path)) return void 0;
    const content = await adapter.read(path);
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec2;
      try {
        rec2 = JSON.parse(raw);
      } catch {
        continue;
      }
      if (rec2.runId !== runId) continue;
      rec2.comment = comment;
      lines[i] = JSON.stringify(rec2);
      await adapter.write(path, lines.join("\n"));
      return comment;
    }
    return void 0;
  } catch {
    return void 0;
  }
}

// eval/eval-comment/run.ts
var pass = 0;
var fail = 0;
var failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `
        \u2192 ${detail}` : ""}`);
  }
}
function section(t) {
  console.log(`
=== ${t} ===`);
}
function memAdapter(seed = {}) {
  const files = new Map(Object.entries(seed));
  return {
    read: async (p) => files.get(p) ?? "",
    write: async (p, d) => {
      files.set(p, d);
    },
    append: async (p, d) => {
      files.set(p, (files.get(p) ?? "") + d);
    },
    exists: async (p) => files.has(p)
  };
}
var DIR = "/plugin";
var PATH = `${DIR}/eval.jsonl`;
function rec(partial) {
  return JSON.stringify({
    runId: "r1",
    ts: "t",
    operation: "query",
    model: "m",
    llmErrors: [],
    ruleFirings: {},
    ratings: {},
    ...partial
  });
}
section("readEvalRecord");
{
  const log = rec({ runId: "r1", ratings: { answer: "up" }, comment: "good" }) + "\n" + rec({ runId: "r2", ratings: { answer: "down" } }) + "\n";
  const ad = memAdapter({ [PATH]: log });
  void (async () => {
    const a = await readEvalRecord(ad, DIR, "r1");
    check("returns ratings+comment for runId", a?.ratings.answer === "up" && a?.comment === "good", JSON.stringify(a));
    const b = await readEvalRecord(ad, DIR, "r2");
    check("defaults comment to empty string", b?.comment === "" && b?.ratings.answer === "down", JSON.stringify(b));
    const c = await readEvalRecord(ad, DIR, "missing");
    check("undefined on miss", c === void 0);
    const d = await readEvalRecord(memAdapter(), DIR, "r1");
    check("undefined when file absent", d === void 0);
    section("updateEvalComment");
    const saved = await updateEvalComment(ad, DIR, "r1", "edited");
    check("returns persisted comment", saved === "edited", String(saved));
    const reread = await readEvalRecord(ad, DIR, "r1");
    check("comment persisted in place", reread?.comment === "edited" && reread?.ratings.answer === "up", JSON.stringify(reread));
    const r2still = await readEvalRecord(ad, DIR, "r2");
    check("other record untouched", r2still?.ratings.answer === "down" && r2still?.comment === "", JSON.stringify(r2still));
    const none = await updateEvalComment(ad, DIR, "nope", "x");
    check("undefined when runId absent", none === void 0);
    console.log(`
${fail === 0 ? "OK" : "FAILED"} \u2014 ${pass} passed, ${fail} failed`);
    if (fail > 0) {
      console.log(failures.join("\n"));
      process.exit(1);
    }
  })();
}
