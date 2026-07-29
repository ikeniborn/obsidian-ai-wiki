import assert from "node:assert/strict";
import test from "node:test";

import type { EntityContextBundle } from "../src/ingest-context";
import {
  assignSynthesisEvidenceLedger,
  extractSynthesisEvidenceLedger,
  findMissingSynthesisEvidence,
  reconcileSynthesisEvidence,
  type SynthesisEvidenceLedgerItem,
} from "../src/phases/synthesis-evidence-ledger";

function bundle(entityKey: string, startLine: number, endLine: number): EntityContextBundle {
  return {
    entityKey,
    evidence: {
      entityKey,
      packetIds: [`packet-${entityKey}`],
      facts: [`fact-${entityKey}`],
      exactSourceRanges: [{ startLine, endLine }],
      exactSource: [{ startLine, endLine, text: `source-${entityKey}` }],
      links: [],
    },
    units: [],
    replaceAuthorities: [],
    estimatedInputTokens: 1,
  };
}

function item(id: string, startLine: number, endLine: number): SynthesisEvidenceLedgerItem {
  return {
    id,
    kind: "code",
    startLine,
    endLine,
    markdown: "```bash\nsudo safe\n```",
    coverageUnits: ["sudo safe"],
  };
}

test("ledger extracts complete fenced segments and body URLs with source-global ranges", () => {
  const source = [
    "---",
    "resource: https://frontmatter.invalid/hidden",
    "---",
    "# Source",
    "```bash",
    "sudo one",
    "",
    "sudo two " + "\\",
    "  --flag",
    "```",
    "Read [docs](https://source.example/docs).",
    "~~~ini",
    "key=value",
    "~~~",
  ].join("\r\n");

  const ledger = extractSynthesisEvidenceLedger(source);

  assert.deepEqual(ledger.map(({ kind, startLine, endLine, coverageUnits }) => ({
    kind, startLine, endLine, coverageUnits,
  })), [
    { kind: "code", startLine: 6, endLine: 6, coverageUnits: ["sudo one"] },
    { kind: "code", startLine: 8, endLine: 9, coverageUnits: ["sudo two " + "\\", "--flag"] },
    { kind: "url", startLine: 11, endLine: 11, coverageUnits: ["https://source.example/docs"] },
    { kind: "code", startLine: 13, endLine: 13, coverageUnits: ["key=value"] },
  ]);
  assert.doesNotMatch(JSON.stringify(ledger), /frontmatter\.invalid/);
  assert.match(ledger[0].markdown, /^```bash\nsudo one\n```$/);
  assert.match(ledger[3].markdown, /^~~~ini\nkey=value\n~~~$/);
});

test("ledger extracts fences nested under Markdown containers", () => {
  const source = [
    "1. Install the package:",
    "",
    "    ```bash",
    "    sudo nested --flag",
    "    ```",
    "",
    "> Example:",
    "> ~~~ini",
    "> key=value",
    "> ~~~",
  ].join("\n");

  const ledger = extractSynthesisEvidenceLedger(source);

  assert.deepEqual(ledger.map(({ kind, startLine, endLine, coverageUnits }) => ({
    kind, startLine, endLine, coverageUnits,
  })), [
    { kind: "code", startLine: 4, endLine: 4, coverageUnits: ["sudo nested --flag"] },
    { kind: "code", startLine: 9, endLine: 9, coverageUnits: ["key=value"] },
  ]);
});

test("ledger extracts syntax-signalled unfenced technical lines without capturing prose", () => {
  const source = [
    "# Install nvm",
    "curl -o- https://example.test/install.sh | bash",
    "",
    "# Activate shell",
    "source ~/.bashrc",
    "",
    "# Install runtime",
    "nvm install 20",
    "nvm use 20",
    "",
    "HTTP_PROXY=http://proxy.test:8080",
    "Ubuntu 24.04 LTS is installed and up to date.",
    "- npm install -g prose-example",
    "> sudo ignored-in-quote",
    "| command | description |",
  ].join("\n");

  const ledger = extractSynthesisEvidenceLedger(source);
  const code = ledger.filter((entry) => entry.kind === "code");

  assert.deepEqual(code.map((entry) => entry.coverageUnits), [
    ["curl -o- https://example.test/install.sh | bash"],
    ["source ~/.bashrc"],
    ["nvm install 20", "nvm use 20"],
    ["HTTP_PROXY=http://proxy.test:8080"],
  ]);
  assert.ok(code.every((entry) => entry.markdown.startsWith("```text\n")));
  assert.doesNotMatch(JSON.stringify(code), /Ubuntu 24\.04|prose-example|ignored-in-quote|description/);
  assert.equal(ledger.filter((entry) => entry.kind === "url").length, 0);
});

test("ledger rejects reserved field-frame markers in source technical content", () => {
  assert.throws(
    () => extractSynthesisEvidenceLedger("```text\n<<<END_CONTENT>>>\n```"),
    /reserved protocol marker/i,
  );
});

test("ledger assignment uses greatest range overlap and source-primary fallback", () => {
  const ledger = [item("overlap", 9, 10), item("unclaimed", 20, 20)];
  const assigned = assignSynthesisEvidenceLedger(
    ledger,
    [bundle("primary", 1, 5), bundle("target", 8, 12)],
    new Set(["primary"]),
  );

  assert.deepEqual(assigned.get("target")?.map((entry) => entry.id), ["overlap"]);
  assert.deepEqual(assigned.get("primary")?.map((entry) => entry.id), ["unclaimed"]);
});

test("ledger reconciliation removes unsupported code and URLs, appends missing evidence, and is idempotent", () => {
  const source = [
    "```bash",
    "sudo safe",
    "```",
    "https://source.example/docs",
  ].join("\n");
  const ledger = extractSynthesisEvidenceLedger(source);
  const existing = "# Existing\n\n```bash\nexisting command\n```\n";
  const candidate = [
    "---",
    "type: concept",
    "---",
    "# Article",
    "",
    "## Examples",
    "",
    "```bash",
    "existing command",
    "sudo invented",
    "```",
    "",
    "Read [bad](https://invented.example/docs).",
    "",
    "## Sources",
    "",
    "- [[Source]]",
  ].join("\n");

  const reconciled = reconcileSynthesisEvidence(candidate, existing, ledger, "ru");

  assert.equal(reconciled.removedUnits, 2);
  assert.equal(reconciled.appendedItems, 2);
  assert.doesNotMatch(reconciled.content, /sudo invented|invented\.example/);
  assert.match(reconciled.content, /existing command/);
  assert.match(reconciled.content, /## Точные технические данные/);
  assert.match(reconciled.content, /sudo safe/);
  assert.match(reconciled.content, /https:\/\/source\.example\/docs/);
  assert.ok(reconciled.content.indexOf("sudo safe") < reconciled.content.indexOf("## Sources"));
  assert.deepEqual(findMissingSynthesisEvidence(ledger, [reconciled.content]), []);

  const repeated = reconcileSynthesisEvidence(reconciled.content, existing, ledger, "ru");
  assert.equal(repeated.content, reconciled.content);
  assert.equal(repeated.removedUnits, 0);
  assert.equal(repeated.appendedItems, 0);
});

test("reconcileSynthesisEvidence carries over an earlier source's evidence block dropped by a rewrite", () => {
  const existing = [
    "# Article",
    "",
    "## Examples",
    "",
    "prior content",
    "",
    "## Точные технические данные",
    "",
    "```bash",
    "sudo earlier-command",
    "```",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
  ].join("\n");
  const candidate = [
    "---",
    "type: concept",
    "---",
    "# Article",
    "",
    "## Examples",
    "",
    "rewritten content with no mention of the earlier command",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
    "- [[Source B]]",
  ].join("\n");

  const reconciled = reconcileSynthesisEvidence(candidate, existing, [], "ru");

  assert.equal(reconciled.appendedItems, 1);
  assert.match(reconciled.content, /sudo earlier-command/);
  assert.ok(reconciled.content.indexOf("sudo earlier-command") < reconciled.content.indexOf("## Sources"));
});

test("reconcileSynthesisEvidence does not duplicate a carried-over item on repeated reconciliation", () => {
  const existing = [
    "# Article",
    "",
    "## Точные технические данные",
    "",
    "```bash",
    "sudo earlier-command",
    "```",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
  ].join("\n");
  const candidate = [
    "# Article",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
    "- [[Source B]]",
  ].join("\n");

  const reconciled = reconcileSynthesisEvidence(candidate, existing, [], "ru");
  const repeated = reconcileSynthesisEvidence(reconciled.content, existing, [], "ru");

  assert.equal(reconciled.appendedItems, 1);
  assert.equal(repeated.appendedItems, 0);
  assert.equal(repeated.content, reconciled.content);
  assert.equal((reconciled.content.match(/sudo earlier-command/g) ?? []).length, 1);
});

test("findMissingSynthesisEvidence tolerates a trailing shell line continuation", () => {
  const ledger = extractSynthesisEvidenceLedger([
    "```bash",
    "systemctl daemon-reload && \\",
    "```",
  ].join("\n"));

  assert.equal(findMissingSynthesisEvidence(ledger, ["systemctl daemon-reload"]).length, 0);
  assert.equal(findMissingSynthesisEvidence(ledger, ["systemctl daemon-reload && \\"]).length, 0);
  assert.equal(findMissingSynthesisEvidence(ledger, ["unrelated content"]).length, 1);
});

test("ledger reconciliation preserves an allowed existing URL while removing a new unsupported URL", () => {
  const existing = "## External links\n- [Existing](https://existing.example)\n";
  const draft = [
    "## External links",
    "- [Existing](https://existing.example)",
    "- [Invented](https://invented.example)",
    "",
  ].join("\n");

  const result = reconcileSynthesisEvidence(draft, existing, [], "en");

  assert.match(result.content, /\[Existing]\(https:\/\/existing\.example\)/);
  assert.doesNotMatch(result.content, /invented\.example/);
  assert.equal(result.removedUnits, 1);
});

test("ledger coverage requires a multi-line code segment to remain contiguous and ordered", () => {
  const ledger = extractSynthesisEvidenceLedger([
    "```bash",
    "first-command --one",
    "second-command --two",
    "```",
  ].join("\n"));

  assert.equal(findMissingSynthesisEvidence(ledger, [
    "first-command --one\nUnrelated prose.\nsecond-command --two",
  ]).length, 1);
  assert.equal(findMissingSynthesisEvidence(ledger, [
    "first-command --one\nsecond-command --two",
  ]).length, 0);
});
