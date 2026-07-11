import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildHldQueries, classifyAggregateVerdict, runHldEval } from "../scripts/eval-jsonl-domain-storage";
import { parseWikiIndexJsonl, isChunkIndexRecord, isPageIndexRecord } from "../src/wiki-index-jsonl";

test("HLD eval defines five fixed query themes", () => {
  assert.equal(buildHldQueries().length, 5);
});

test("aggregate verdict cannot be accepted without baseline", () => {
  assert.equal(classifyAggregateVerdict({ baselineAvailable: false, regressions: [], formatWorked: true }), "needs_tuning");
});

test("HLD eval builds isolated JSONL domain and runs five live retrieval queries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jsonl-hld-eval-"));
  try {
    const source = path.join(root, "source");
    const evalRoot = path.join(root, "eval-vault");
    const out = path.join(root, "report.md");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "export.md"), "# Export\n\n## Scope\nЭкспорт данных через S3 и ClickHouse. Компоненты участвуют в обработке.", "utf8");
    await writeFile(path.join(source, "airflow.md"), "# Airflow\n\n## HA\nОтказоустойчивая архитектура Airflow и решения по балансировке.", "utf8");
    await writeFile(path.join(source, "integrations.md"), "# Integrations\n\n## Consumers\nИнтеграции потребителей с витринными БД и дата-мартами.", "utf8");
    await writeFile(path.join(source, "gitflame.md"), "# GitFlame\n\n## Migration\nМиграция на GitFlame и связанные архитектурные ограничения.", "utf8");
    await writeFile(path.join(source, "ownership.md"), "# Ownership\n\n## Components\nСостав архитектурных компонентов и зоны ответственности проектов.", "utf8");

    const result = await runHldEval({ source, outPath: out, evalRoot });

    assert.equal(result.verdict, "accepted");
    assert.equal(result.queries.length, 5);
    assert.equal(result.queries.every((query) => query.status === "accepted"), true);
    assert.equal(result.markdownFiles, 5);

    const report = await readFile(out, "utf8");
    assert.match(report, /Aggregate verdict: `accepted`/);
    assert.doesNotMatch(report, /Status: blocked/);

    const index = parseWikiIndexJsonl(await readFile(result.indexPath, "utf8"), result.indexPath);
    assert.equal(index.filter(isPageIndexRecord).length, 5);
    assert.ok(index.filter(isChunkIndexRecord).length >= 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
