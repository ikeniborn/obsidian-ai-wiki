import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  runNativeRequestRetryEval,
} from "../scripts/eval-native-request-retry";

const SCRIPT_PATH = fileURLToPath(
  new URL("../scripts/eval-native-request-retry.ts", import.meta.url),
);
const CONNECTION_TIMEOUT_MS = 15_000;
const DELAY_MS = CONNECTION_TIMEOUT_MS + 100;

async function withRetryServer<T>(
  handler: (baseUrl: string, requests: unknown[]) => Promise<T>,
): Promise<T> {
  const requests: unknown[] = [];
  let attempts = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      attempts++;
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (attempts === 1) {
        response.writeHead(502, {
          "content-type": "application/json",
          "retry-after-ms": "0",
        });
        response.end(JSON.stringify({ error: { message: "temporary", type: "server_error" } }));
        return;
      }
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "chatcmpl-eval",
          object: "chat.completion",
          created: 0,
          model: "test-model",
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                reasoning: "SECRET_RESPONSE_CONTENT",
                actions: [{ action: "create", target: "synthetic-page" }],
                skips: [],
              }),
            },
          }],
        }));
      }, DELAY_MS);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    return await handler(`http://127.0.0.1:${address.port}/v1`, requests);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
}

test("eval imports every production native request seam and has no bypass transport", async () => {
  const source = await readFile(SCRIPT_PATH, "utf8");
  assert.match(source, /createNativeOpenAiClient/);
  assert.match(source, /createNativeOpenAiFetch/);
  assert.match(source, /classifyNativeRetry/);
  assert.match(source, /executeNativeLlmRequest/);
  assert.match(source, /runStructuredWithRetry/);
  assert.match(source, /empty `actions` and `skips` arrays/);
  assert.doesNotMatch(source, /new\s+OpenAI\s*\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});

test("failed eval exposes classifier metadata without provider body", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native retry failure "));
  const keyPath = path.join(root, "api.txt");
  const outPath = path.join(root, "evidence.json");
  await writeFile(keyPath, "SECRET_API_KEY\n", { mode: 0o600 });
  const server = createServer((_request, response) => {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "SECRET_PROVIDER_BODY" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await assert.rejects(
      runNativeRequestRetryEval({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "test-model",
        apiKeyFile: keyPath,
        out: outPath,
      }),
      (error: Error & { diagnostic?: unknown }) => {
        assert.deepEqual(error.diagnostic, {
          errorClass: "permanent_http",
          status: 400,
        });
        assert.doesNotMatch(String(error), /SECRET_API_KEY|SECRET_PROVIDER_BODY/);
        return true;
      },
    );
    const persisted = await readFile(outPath, "utf8");
    assert.doesNotMatch(persisted, /SECRET_API_KEY|SECRET_PROVIDER_BODY/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("production path retries 502 and completes a delayed response beyond 15 seconds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native retry eval "));
  const keyPath = path.join(root, "api.txt");
  const outPath = path.join(root, "evidence.json");
  await writeFile(keyPath, "SECRET_API_KEY\n", { mode: 0o600 });
  try {
    await withRetryServer(async (baseUrl, requests) => {
      const evidence = await runNativeRequestRetryEval({
        baseUrl,
        model: "test-model",
        apiKeyFile: keyPath,
        out: outPath,
      });

      assert.equal(requests.length, 2);
      const request = requests[1] as Record<string, unknown>;
      assert.equal(request.stream, false);
      assert.equal(
        ((request.response_format as Record<string, unknown>).json_schema as Record<string, unknown>).strict,
        false,
      );
      const schema = ((request.response_format as Record<string, unknown>).json_schema as Record<string, unknown>).schema as {
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: boolean;
        $schema: string;
      };
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, ["reasoning", "actions", "skips"]);
      assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
      assert.deepEqual(Object.keys(schema.properties), ["reasoning", "actions", "skips"]);

      assert.equal(evidence.endpointPath, "/v1/chat/completions");
      assert.equal(evidence.model, "test-model");
      assert.equal(evidence.httpStatus, 200);
      assert.equal(evidence.completed, true);
      assert.equal(evidence.connectionTimeoutMs, CONNECTION_TIMEOUT_MS);
      assert.equal(evidence.idleTimeoutMs, 300_000);
      assert.equal(evidence.exceededConnectionTimeoutMs, true);
      assert.ok(evidence.durationMs >= CONNECTION_TIMEOUT_MS);
      assert.equal(evidence.transport, "direct");
      assert.equal(evidence.attempts, 2);
      assert.deepEqual(
        evidence.retryEvents.map((event) => event.kind),
        ["transport_retry_scheduled", "transport_retry_recovered"],
      );
      assert.match(evidence.logicalRequestId, /^eval-/);
      assert.equal(evidence.lifecycleIds.length, 2);
      assert.notEqual(evidence.lifecycleIds[0], evidence.lifecycleIds[1]);

      const persisted = await readFile(outPath, "utf8");
      assert.deepEqual(JSON.parse(persisted), evidence);
      assert.doesNotMatch(
        persisted,
        /SECRET_API_KEY|SECRET_RESPONSE_CONTENT|authorization|apiKey|messages|prompt|content/i,
      );
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
