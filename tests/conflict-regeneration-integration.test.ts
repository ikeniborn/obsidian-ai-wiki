import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { register } from "node:module";
import test from "node:test";

import OpenAI from "openai";

import type { DomainEntry } from "../src/domain";
import type { PageSimilarityService } from "../src/page-similarity";
import type { IngestOutcome, LlmClient, RunEvent } from "../src/types";
import type { VaultAdapter } from "../src/vault-tools";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { runIngest } = await import("../src/phases/ingest");
const { inspectPatchablePage } = await import("../src/section-patches");
const { VaultTools } = await import("../src/vault-tools");

const SOURCE_PATH = "src/conflict.md";
const PAGE_PATH = "!Wiki/demo/concept/wiki_demo_alpha.md";

class MemoryAdapter implements VaultAdapter {
  readonly writes: string[] = [];

  constructor(readonly files: Map<string, string>) {}

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
    this.writes.push(path);
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }

  async exists(path: string): Promise<boolean> {
    return path === "" || this.files.has(path)
      || [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
  }

  async mkdir(): Promise<void> {}

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path ? `${path}/` : "";
    const files: string[] = [];
    const folders = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const remainder = file.slice(prefix.length);
      const slash = remainder.indexOf("/");
      if (slash < 0) files.push(file);
      else folders.add(`${prefix}${remainder.slice(0, slash)}`);
    }
    return { files, folders: [...folders] };
  }
}

function domain(): DomainEntry {
  return {
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    source_paths: ["src"],
    pageNameVersion: 1,
    entity_types: [{
      type: "concept",
      description: "A concept.",
      extraction_cues: ["Alpha"],
      wiki_subfolder: "concept",
    }],
  };
}

async function drain(
  generator: AsyncGenerator<RunEvent, IngestOutcome>,
): Promise<{ events: RunEvent[]; outcome: IngestOutcome }> {
  const events: RunEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { events, outcome: next.value };
    events.push(next.value);
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function promptText(body: Record<string, unknown>): string {
  const messages = body.messages as Array<{ content?: unknown }>;
  return messages.map((message) => typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content)).join("\n");
}

function writeCompletion(
  response: ServerResponse,
  body: Record<string, unknown>,
  content: string,
): void {
  if (body.stream === true) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({
      id: "fixture-stream",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture",
      choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })}\n\n`);
    response.end("data: [DONE]\n\n");
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    id: "fixture-json",
    object: "chat.completion",
    created: 0,
    model: "fixture",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }));
}

test("runIngest repairs a stale patch against fresh authority through the OpenAI HTTP transport", async () => {
  const pageA = [
    "---",
    "type: concept",
    "description: Alpha page.",
    "resource: [old-source]",
    "---",
    "# Alpha",
    "",
    "## Facts",
    "Authority A fact.",
    "",
    "## Notes",
    "Original note.",
    "",
  ].join("\n");
  const pageB = pageA
    .replace("Authority A fact.", "Concurrent authority B fact.")
    .replace("Original note.", "Concurrent B note must remain untouched.");
  const inspectedA = inspectPatchablePage(pageA);
  const inspectedB = inspectPatchablePage(pageB);
  const factsA = inspectedA.sections.find((section) => section.heading === "## Facts");
  const factsB = inspectedB.sections.find((section) => section.heading === "## Facts");
  assert.ok(factsA && factsB);

  const adapter = new MemoryAdapter(new Map([
    [SOURCE_PATH, "Alpha receives a new source-backed fact."],
    [PAGE_PATH, pageA],
  ]));
  const requests: Record<string, unknown>[] = [];
  let mapperRequests = 0;
  let synthesisRequests = 0;
  let regenerationRequests = 0;
  const serverErrors: unknown[] = [];
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/chat/completions");
    const body = await readJson(request);
    requests.push(body);
    const prompt = promptText(body);
    let content: string;
    if (prompt.includes("CHUNK_ID ")) {
      mapperRequests += 1;
      assert.equal(body.stream, false);
      const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
      assert.ok(chunkId);
      content = JSON.stringify({
        packets: [{
          id: `packet-${chunkId}`,
          chunkId,
          entityKey: "alpha",
          entityType: "concept",
          facts: ["Alpha receives a new source-backed fact."],
          exactSourceRanges: [{ startLine: 1, endLine: 1 }],
          links: [],
          sourceAnchor: `${SOURCE_PATH}:1`,
        }],
        noEvidence: [],
      });
    } else if (prompt.includes("Entity bundle: entity-alpha")) {
      synthesisRequests += 1;
      assert.equal(body.stream, false);
      assert.match(prompt, new RegExp(inspectedA.pageHash));
      assert.match(prompt, new RegExp(factsA.hash));
      adapter.files.set(PAGE_PATH, pageB);
      content = JSON.stringify({
        reasoning: "Patch authority A.",
        actions: [{
          kind: "patch",
          entityKey: "alpha",
          path: PAGE_PATH,
          expectedPageHash: inspectedA.pageHash,
          sections: [{
            operation: "replace",
            heading: "## Facts",
            expectedSectionOrdinal: factsA.ordinal,
            expectedSectionHash: factsA.hash,
            content: "STALE_A_PATCH",
          }],
        }],
        skips: [],
        entity_types_delta: [],
      });
    } else if (prompt.includes("Regenerate exactly one guarded patch")) {
      regenerationRequests += 1;
      assert.equal(body.stream, false);
      assert.match(prompt, new RegExp(inspectedB.pageHash));
      assert.match(prompt, new RegExp(factsB.hash));
      if (regenerationRequests === 1) {
        content = [
          "<<<REASONING>>>",
          "The patch frame is intentionally missing.",
          "<<<END_REASONING>>>",
        ].join("\n");
      } else {
        assert.equal(regenerationRequests, 2);
        assert.match(prompt, /missing an action frame/);
        content = [
          "<<<REASONING>>>",
          "Regenerate against authority B.",
          "<<<PATCH>>>",
          "entityKey: alpha",
          `path: ${PAGE_PATH}`,
          `expectedPageHash: ${inspectedB.pageHash}`,
          "<<<SECTION>>>",
          "operation: replace",
          "heading: ## Facts",
          `expectedSectionOrdinal: ${factsB.ordinal}`,
          `expectedSectionHash: ${factsB.hash}`,
          "<<<CONTENT>>>",
          "ACCEPTED_B_PATCH",
          "<<<END_SECTION>>>",
          "<<<END_PATCH>>>",
          "<<<END>>>",
        ].join("\n");
      }
    } else {
      throw new Error(`Unexpected fixture request: ${prompt.slice(0, 160)}`);
    }
    writeCompletion(response, body, content);
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      serverErrors.push(error);
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new OpenAI({
    apiKey: "test",
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    maxRetries: 0,
  });
  const similarity = {
    config: { mode: "jaccard", topK: 5 },
    loadCache: async () => {},
    selectByEntities: async (entities: Array<{ name: string; type?: string }>) => ({
      results: new Map(entities.map((entity) => [
        `${entity.name}::${entity.type ?? ""}`,
        [PAGE_PATH],
      ])),
      allFailed: false,
    }),
    refreshCache: async () => ({ updated: 0, failed: 0 }),
  } as unknown as PageSimilarityService;

  try {
    const { outcome } = await drain(runIngest(
      [SOURCE_PATH],
      new VaultTools(adapter, "/vault"),
      client as unknown as LlmClient,
      "fixture",
      [domain()],
      "/vault",
      new AbortController().signal,
      { inputBudgetTokens: 20_000, maxTokens: 1_000, structuredRetries: 0 },
      similarity,
    ));

    assert.deepEqual(serverErrors, []);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.equal(mapperRequests, 1);
    assert.equal(synthesisRequests, 1);
    assert.equal(regenerationRequests, 2);
    const finalPage = adapter.files.get(PAGE_PATH) ?? "";
    assert.match(finalPage, /ACCEPTED_B_PATCH/);
    assert.doesNotMatch(finalPage, /STALE_A_PATCH/);
    assert.match(finalPage, /Concurrent B note must remain untouched\./);
    assert.equal(requests.length, 4);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
