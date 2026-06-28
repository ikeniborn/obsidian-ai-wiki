#!/usr/bin/env node
// Dev-mode quality + telemetry report over eval.jsonl (human 👍/👎 labels).
//
// Usage:
//   tsx scripts/eval.ts [--log <eval.jsonl>]
//   default --log: .obsidian/plugins/ai-wiki/eval.jsonl under the current vault,
//   or pass an absolute path.
import { readFile } from "node:fs/promises";

type Rating = "up" | "down" | null;
interface Rec {
  operation: string;
  promptVersion?: string;
  visionPromptVersion?: string;
  vision?: "on" | "off";
  rating: Rating;
  recognitionRating?: Rating;
  ratings?: Record<string, Rating>;
  comment?: string;
  llmErrors?: { kind: string }[];
  ruleFirings?: Record<string, number>;
}

const PRIMARY_AXIS: Record<string, string> = {
  query: "answer", chat: "answer", format: "formatting", ingest: "page",
  init: "coverage", lint: "fix", "lint-chat": "fix", delete: "rebuild",
};

function resolveSignal(r: Rec, recognition = false): Rating {
  const axis = recognition ? "recognition" : PRIMARY_AXIS[r.operation];
  const m = r.ratings;
  if (m && axis && (m[axis] === "up" || m[axis] === "down")) return m[axis];
  const scalar = recognition ? r.recognitionRating : r.rating;
  return scalar === "up" || scalar === "down" ? scalar : null;
}

function parseLog(text: string): Rec[] {
  const out: Rec[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const r = JSON.parse(s) as Rec;
      // keep human-labelled lines (per-axis ratings map OR legacy scalar); skip judge lines
      if (r && typeof r.operation === "string" && ("rating" in r || "ratings" in r)) {
        r.rating = resolveSignal(r, false);            // normalize for the report fns
        r.recognitionRating = resolveSignal(r, true);
        out.push(r);
      }
    } catch { /* skip malformed */ }
  }
  return out;
}

function upRate(recs: Rec[], field: "rating" | "recognitionRating"): string {
  const labeled = recs.filter((r) => r[field] === "up" || r[field] === "down");
  if (labeled.length === 0) return "n/a (0 labels)";
  const up = labeled.filter((r) => r[field] === "up").length;
  return `${((up / labeled.length) * 100).toFixed(0)}% 👍 (${up}/${labeled.length})`;
}

function byPrompt(recs: Rec[], field: "rating" | "recognitionRating", key: "promptVersion" | "visionPromptVersion"): string[] {
  const groups = new Map<string, Rec[]>();
  for (const r of recs) {
    const k = r[key] ?? "—";
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return [...groups.entries()].map(([k, g]) => `    ${key}=${k}: ${upRate(g, field)}`);
}

function main(args: string[]): void {
  const logFlag = args.indexOf("--log");
  const logPath = logFlag !== -1 ? args[logFlag + 1] : ".obsidian/plugins/ai-wiki/eval.jsonl";

  void (async () => {
    const recs = parseLog(await readFile(logPath, "utf8"));
    const qc = recs.filter((r) => r.operation === "query" || r.operation === "chat" || r.operation === "lint-chat");
    const fmt = recs.filter((r) => r.operation === "format");
    const fmtOn = fmt.filter((r) => r.vision === "on");
    const fmtOff = fmt.filter((r) => r.vision === "off");

    const lines: string[] = [];
    lines.push(`eval.jsonl — ${recs.length} records (${logPath})`);
    const withComment = recs.filter((r) => (r.comment ?? "").trim().length > 0).length;
    lines.push(`comments: ${withComment}/${recs.length} records`);
    lines.push("");
    lines.push(`Answer quality (query/chat): ${upRate(qc, "rating")}`);
    lines.push(...byPrompt(qc, "rating", "promptVersion"));
    lines.push("");
    lines.push(`Format quality — vision OFF: ${upRate(fmtOff, "rating")}`);
    lines.push(...byPrompt(fmtOff, "rating", "promptVersion"));
    lines.push(`Format quality — vision ON:  ${upRate(fmtOn, "rating")}`);
    lines.push(...byPrompt(fmtOn, "rating", "promptVersion"));
    lines.push(`Recognition quality (vision ON): ${upRate(fmtOn, "recognitionRating")}`);
    lines.push(...byPrompt(fmtOn, "recognitionRating", "visionPromptVersion"));
    lines.push("");

    // Telemetry report: error rate + rule firings per promptVersion.
    lines.push("Telemetry (per promptVersion):");
    const groups = new Map<string, Rec[]>();
    for (const r of recs) {
      const k = `${r.operation}/${r.promptVersion ?? "—"}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    }
    for (const [k, g] of groups) {
      const errs = g.reduce((n, r) => n + (r.llmErrors?.length ?? 0), 0);
      const firings: Record<string, number> = {};
      for (const r of g) for (const [rid, c] of Object.entries(r.ruleFirings ?? {})) firings[rid] = (firings[rid] ?? 0) + c;
      const fireStr = Object.entries(firings).map(([rid, c]) => `${rid}=${c}`).join(", ") || "none";
      lines.push(`  ${k}: ${g.length} runs, ${errs} llmErrors, firings: ${fireStr}`);
    }

    console.log(lines.join("\n"));
  })().catch((err) => {
    console.error(`[eval] ${(err as Error).message}`);
    process.exit(1);
  });
}

main(process.argv.slice(2));
