import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas, extractUsage, parseStructured } from "./llm-utils";
import { type SeedsResponse } from "./schemas";
import queryTemplate from "../../prompts/query.md";
import { render } from "./template";
import { domainWikiFolder } from "../wiki-path";
import { pageId, buildWikiGraph, bfsExpand } from "../wiki-graph";

const META_FILES = ["_index.md", "_log.md", "_wiki_schema.md", "_format_schema.md"];

export async function* runQuery(
  args: string[],
  save: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  graphDepth: number = 1,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const question = args[0]?.trim();
  if (!question) {
    yield { kind: "error", message: "query: question required" };
    return;
  }

  const domain = domains[0];
  if (!domain) {
    yield { kind: "error", message: "No domain configured. Add a domain in settings." };
    return;
  }

  if (!domain.wiki_folder || domain.wiki_folder.includes("..")) {
    yield { kind: "error", message: `Wiki folder ${domain.wiki_folder} is outside the vault.` };
    return;
  }
  const wikiVaultPath = domainWikiFolder(domain.wiki_folder);
  const schemaRoot = wikiVaultPath.split("/").slice(0, -1).join("/");

  yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
  const allFiles = await vaultTools.listFiles(wikiVaultPath);
  const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
  yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };

  const [indexContent, schemaContent] = await Promise.all([
    tryRead(vaultTools, `${wikiVaultPath}/_index.md`),
    tryRead(vaultTools, `${schemaRoot}/_wiki_schema.md`),
  ]);

  const pages = await vaultTools.readAll(files);

  const start = Date.now();
  let outputTokens = 0;

  // Graph-filtered context
  const graph = buildWikiGraph(pages);
  const allPageIds = [...pages.keys()].map(pageId);
  let seeds = keywordSeeds(question, pages);
  if (seeds.length === 0) {
    const seedRes = await llmSelectSeeds(question, indexContent, allPageIds, llm, model, opts, signal);
    seeds = seedRes.seeds;
    outputTokens += seedRes.outputTokens;
  }
  if (signal.aborted) return;
  if (seeds.length === 0) {
    seeds = allPageIds;
  }
  const seedSet = new Set(seeds);
  const selectedIds = bfsExpand(seeds, graph, graphDepth);
  const contextBlock = buildContextBlock(pages, seedSet, selectedIds);

  const entityTypesBlock = buildEntityTypesBlock(domain);

  const systemPrompt = render(queryTemplate, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock,
    schema_block: schemaContent ? `\nКонвенции (_wiki_schema.md):\n${schemaContent}` : "",
    index_block: indexContent ? `\nВики-индекс (_index.md):\n${indexContent}` : "",
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Вопрос: ${question}\n\nWiki-страницы:\n${contextBlock}` },
  ];

  const params = buildChatParams(model, messages, opts, true);
  let answer = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { answer += content; yield { kind: "assistant_text", delta: content }; }
      if (tok !== undefined) outputTokens += tok;
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    answer = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    if (tok !== undefined) outputTokens += tok;
    if (answer) yield { kind: "assistant_text", delta: answer };
  }

  if (signal.aborted) return;

  if (save && answer) {
    const slug = question.slice(0, 40).replace(/[^a-zA-Z0-9а-яёА-ЯЁ\s]/g, "").trim().replace(/\s+/g, "-");
    const savePath = `${wikiVaultPath}/Q-${slug}.md`;
    const today = new Date().toISOString().slice(0, 10);
    const pageContent = [
      `---`,
      `wiki_sources: []`,
      `wiki_updated: ${today}`,
      `wiki_status: mature`,
      `tags: []`,
      `---`,
      ``,
      `# ${question}`,
      ``,
      answer,
    ].join("\n");
    yield { kind: "tool_use", name: "Write", input: { path: savePath } };
    try {
      await vaultTools.write(savePath, pageContent);
      yield { kind: "tool_result", ok: true };
      yield { kind: "result", durationMs: Date.now() - start, text: `Создана страница: ${savePath}\n\n${answer}`, outputTokens: outputTokens || undefined };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
      yield { kind: "result", durationMs: Date.now() - start, text: answer, outputTokens: outputTokens || undefined };
    }
  } else {
    yield { kind: "result", durationMs: Date.now() - start, text: answer, outputTokens: outputTokens || undefined };
  }
}

async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}

function keywordSeeds(question: string, pages: Map<string, string>): string[] {
  const words = question.split(/\W+/).filter((w) => w.length > 3).map((w) => w.toLowerCase());
  if (words.length === 0) return [];
  const seeds: string[] = [];
  for (const path of pages.keys()) {
    const id = pageId(path);
    if (words.some((w) => id.toLowerCase().includes(w))) {
      seeds.push(id);
    }
  }
  return seeds;
}

async function llmSelectSeeds(
  question: string,
  indexContent: string,
  allPageIds: string[],
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ seeds: string[]; outputTokens: number }> {
  const prompt = [
    `Question: "${question}"`,
    `Available wiki pages: ${allPageIds.join(", ")}`,
    indexContent ? `\nIndex:\n${indexContent}` : "",
    `\nReturn JSON only: {"seeds": ["PageA", "PageB"]} — most relevant page names (bare names, no path, no .md).`,
  ].filter(Boolean).join("\n");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: prompt },
  ];
  const params = buildChatParams(model, messages, opts);

  try {
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    const text = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp) ?? 0;
    const parsed = parseStructured(text) as SeedsResponse;
    const seeds = Array.isArray(parsed.seeds) ? parsed.seeds.filter((s): s is string => typeof s === "string") : [];
    return { seeds, outputTokens: tok };
  } catch {
    return { seeds: [], outputTokens: 0 };
  }
}

function buildContextBlock(
  pages: Map<string, string>,
  seeds: Set<string>,
  selectedIds: Set<string>,
): string {
  const seedPages: [string, string][] = [];
  const bfsPages: [string, string][] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    if (!selectedIds.has(id)) continue;
    if (seeds.has(id)) seedPages.push([path, content]);
    else bfsPages.push([path, content]);
  }
  const ordered = [...seedPages, ...bfsPages];
  let block = "";
  for (const [p, c] of ordered) {
    block += `--- ${p} ---\n${c}\n\n`;
  }
  return block;
}

function buildEntityTypesBlock(domain: DomainEntry): string {
  if (!domain.entity_types?.length) return "";
  const types = domain.entity_types
    .map((et) => `  - ${et.type}: ${et.description}`)
    .join("\n");
  const notes = domain.language_notes ? `\nЯзыковые правила: ${domain.language_notes}` : "";
  return `Типы сущностей домена «${domain.name}»:\n${types}${notes}`;
}
