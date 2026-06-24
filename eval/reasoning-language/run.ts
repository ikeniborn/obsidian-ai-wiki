/**
 * Out-of-vault eval for the reasoning/answer language directives (spec Part B).
 *
 * Exercises the REAL pure functions from src/ — no Obsidian vault, no LLM.
 * Locks the contract the vision path (Part C) reuses: the shared reasoning
 * directive text, the strengthened answer directive, and the reasoning-language
 * resolver fallback chain.
 *
 * Run: see docs/superpowers/evals/2026-06-24-reasoning-language-eval.md
 */
import { reasoningDirective, langInstruction } from "../../src/phases/llm-utils";
import { resolveReasoningLang } from "../../src/i18n";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

function setLocale(l: string): void {
  (globalThis as { __MOMENT_LOCALE__?: string }).__MOMENT_LOCALE__ = l;
}

// =====================================================================
section("reasoningDirective — language correctness");
// =====================================================================
check("R1 en names English", /English/.test(reasoningDirective("en")), reasoningDirective("en"));
check("R2 ru names Russian", /Russian/.test(reasoningDirective("ru")), reasoningDirective("ru"));
check("R3 es names Spanish", /Spanish/.test(reasoningDirective("es")), reasoningDirective("es"));

section("reasoningDirective — anti-drift + JSON clause");
check("R4 carries the section heading", reasoningDirective("en").includes("## Reasoning language"), reasoningDirective("en"));
check("R5 forbids switching language", /do not switch/i.test(reasoningDirective("en")), reasoningDirective("en"));
check("R6 governs the JSON reasoning field", /json/i.test(reasoningDirective("en")) && /reasoning.{0,3}field/i.test(reasoningDirective("en")), reasoningDirective("en"));

section("langInstruction — strengthened answer directive");
check("L1 en names English + no-switch", /English/.test(langInstruction("en")) && /do not switch/i.test(langInstruction("en")), langInstruction("en"));
check("L2 ru names Russian + no-switch", /Russian/.test(langInstruction("ru")) && /do not switch/i.test(langInstruction("ru")), langInstruction("ru"));
check("L3 es names Spanish + no-switch", /Spanish/.test(langInstruction("es")) && /do not switch/i.test(langInstruction("es")), langInstruction("es"));

section("resolveReasoningLang — fallback chain vision relies on");
check("RL1 explicit reasoning wins over output", resolveReasoningLang("en", "ru") === "en");
check("RL2 auto chains to output language", resolveReasoningLang("auto", "ru") === "ru");
setLocale("es-ES");
check("RL3 auto + auto output chains to UI locale", resolveReasoningLang("auto", "auto") === "es");
setLocale("en");
check("RL4 undefined defaults to en", resolveReasoningLang(undefined, "ru") === "en");

console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
