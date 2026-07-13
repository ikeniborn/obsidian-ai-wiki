import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRerankerIntegrationEval } from "../scripts/eval-reranker-integration";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function withRerankServer(
  handler: (body: unknown, res: ServerResponse) => void | Promise<void>,
  fn: (baseUrl: string, calls: unknown[]) => Promise<void>,
): Promise<void> {
  const calls: unknown[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/rerank") {
      res.writeHead(404).end();
      return;
    }
    const body = await readJson(req);
    calls.push(body);
    await handler(body, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  try {
    await fn(`http://127.0.0.1:${address!.port}/v1`, calls);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function createFixture(): Promise<{
  root: string;
  source: string;
  outPath: string;
  evalRoot: string;
  goldPath: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "reranker-integration-eval-"));
  const source = path.join(root, "source");
  const evalRoot = path.join(root, "eval-vault");
  const outPath = path.join(root, "report.md");
  const goldPath = path.join(root, "gold.json");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "export.md"), "# Export\n\n## Scope\nЭкспорт данных через S3 и ClickHouse. Компоненты участвуют в обработке.", "utf8");
  await writeFile(path.join(source, "airflow.md"), "# Airflow\n\n## HA\nОтказоустойчивая архитектура Airflow и решения по балансировке.", "utf8");
  await writeFile(path.join(source, "integrations.md"), "# Integrations\n\n## Consumers\nИнтеграции потребителей с витринными БД и дата-мартами.", "utf8");
  await writeFile(path.join(source, "gitflame.md"), "# GitFlame\n\n## Migration\nМиграция на GitFlame и связанные архитектурные ограничения.", "utf8");
  await writeFile(path.join(source, "ownership.md"), "# Ownership\n\n## Components\nСостав архитектурных компонентов и зоны ответственности проектов.", "utf8");
  const labels: Array<[string, { path: string; grade: 1 | 2 | 3 }]> = [
    ["data-export-s3-clickhouse", { path: "export.md", grade: 3 }],
    ["airflow-ha-balancing", { path: "airflow.md", grade: 3 }],
    ["integrations-consumers-marts", { path: "integrations.md", grade: 3 }],
    ["migration-gitflame", { path: "gitflame.md", grade: 3 }],
    ["ownership-components", { path: "ownership.md", grade: 3 }],
  ];
  await writeFile(goldPath, JSON.stringify({
    version: 1,
    source: "fixture",
    queries: Object.fromEntries(labels.map(([id, label]) => [id, { relevant: [{
      path: `!Wiki/hld-jsonl-eval/pages/${label.path}`,
      sourceRelPath: label.path,
      grade: label.grade,
      rationale: "Primary fixture document for this query.",
    }] }])),
  }, null, 2), "utf8");
  return { root, source, outPath, evalRoot, goldPath };
}

test("reranker integration eval calls /rerank and records reranked order", async () => {
  await withRerankServer(async (body, res) => {
    const payload = body as { model: string; query: string; documents: string[] };
    assert.equal(payload.model, "mock-reranker");
    assert.equal(typeof payload.query, "string");
    assert.ok(payload.documents.length <= 4);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      results: payload.documents.map((_, index) => ({
        index,
        score: index + 1,
      })),
    }));
  }, async (baseUrl, calls) => {
    const fixture = await createFixture();
    try {
      const result = await runRerankerIntegrationEval({
        ...fixture,
        baseUrl,
        model: "mock-reranker",
        apiKey: "test-secret-key",
        rerankerTopN: 4,
        contextTopN: 2,
        timeoutMs: 800,
      });

      assert.equal(calls.length, 5);
      assert.notEqual(result.verdict, "blocked");
      assert.equal(result.queries.every((query) => query.candidatesSent <= 4), true);
      assert.equal(result.queries.every((query) => query.rerankedTop.length <= 2), true);
      assert.equal(calls.every((call) => (call as { documents: string[] }).documents.length <= 4), true);
      const report = await readFile(fixture.outPath, "utf8");
      assert.match(report, /Reranker Integration HLD Eval/);
      assert.match(report, /Verdict:/);
      assert.match(report, /full-rerank/);
      assert.match(report, /guarded-alpha-0\.25/);
      assert.match(report, /Best variant:/);
      assert.match(report, /Reranked top:/);
      assert.doesNotMatch(report, /test-secret-key/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

test("reranker integration eval bases final verdict on best guarded variant", async () => {
  await withRerankServer(async (body, res) => {
    const payload = body as { documents: string[] };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      results: payload.documents.map((_, index) => ({
        index,
        score: payload.documents.length - index,
      })),
    }));
  }, async (baseUrl) => {
    const fixture = await createFixture();
    try {
      const result = await runRerankerIntegrationEval({
        ...fixture,
        baseUrl,
        model: "mock-reranker",
        rerankerTopN: 4,
        contextTopN: 2,
      });

      assert.ok(result.variants.some((variant) => variant.id === "full-rerank"));
      assert.ok(result.variants.some((variant) => variant.id === "guarded-alpha-0.25-cap-1"));
      assert.match(result.bestVariantId, /^guarded-alpha-/);
      assert.equal(result.verdict, result.variants.find((variant) => variant.id === result.bestVariantId)?.verdict);
      const report = await readFile(fixture.outPath, "utf8");
      assert.match(report, /## Variants/);
      assert.match(report, /Best variant: `guarded-alpha-/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

test("reranker integration eval blocks when endpoint or model is missing", async () => {
  const fixture = await createFixture();
  try {
    const missingModel = await runRerankerIntegrationEval({
      ...fixture,
      baseUrl: "http://127.0.0.1:1/v1",
      model: "",
    });
    const missingEndpoint = await runRerankerIntegrationEval({
      ...fixture,
      outPath: path.join(fixture.root, "missing-endpoint-report.md"),
      baseUrl: "",
      model: "mock-reranker",
    });

    assert.equal(missingModel.verdict, "blocked");
    assert.equal(missingModel.blockedReason, "missing baseUrl or model");
    assert.equal(missingEndpoint.verdict, "blocked");
    assert.equal(missingEndpoint.blockedReason, "missing baseUrl or model");
    const report = await readFile(fixture.outPath, "utf8");
    assert.match(report, /missing baseUrl or model/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("reranker integration eval redacts endpoint secrets in the report", async () => {
  const fixture = await createFixture();
  try {
    const result = await runRerankerIntegrationEval({
      ...fixture,
      baseUrl: "https://user:pass@example.test/v1?api_key=url-secret",
      model: "",
    });

    assert.equal(result.verdict, "blocked");
    const report = await readFile(fixture.outPath, "utf8");
    assert.doesNotMatch(report, /url-secret/);
    assert.doesNotMatch(report, /user:pass/);
    assert.match(report, /api_key=<redacted>/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("reranker integration eval blocks malformed rerank responses", async () => {
  await withRerankServer(async (_body, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({}));
  }, async (baseUrl) => {
    const fixture = await createFixture();
    try {
      const result = await runRerankerIntegrationEval({
        ...fixture,
        baseUrl,
        model: "mock-reranker",
        rerankerTopN: 4,
        contextTopN: 2,
      });

      assert.notEqual(result.verdict, "accepted");
      assert.equal(result.verdict, "blocked");
      assert.equal(result.queries.some((query) => query.fallbackReason === "malformed-response"), true);
      assert.match(result.blockedReason ?? "", /malformed-response/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

test("rerankerTopN bounds endpoint documents and contextTopN bounds final output", async () => {
  await withRerankServer(async (body, res) => {
    const payload = body as { documents: string[] };
    assert.ok(payload.documents.length <= 1);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      results: payload.documents.map((_, index) => ({ index, relevance_score: 1 })),
    }));
  }, async (baseUrl, calls) => {
    const fixture = await createFixture();
    try {
      const result = await runRerankerIntegrationEval({
        ...fixture,
        baseUrl,
        model: "mock-reranker",
        rerankerTopN: 1,
        contextTopN: 1,
      });

      assert.equal(calls.length, 5);
      assert.equal(result.queries.every((query) => query.candidatesSent <= 1), true);
      assert.equal(result.queries.every((query) => query.rerankedTop.length <= 1), true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
