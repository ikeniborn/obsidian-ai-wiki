import type OpenAI from "openai";
import type { DomainEntry } from "../domain-map";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas } from "./llm-utils";
import schemaTemplate from "../../templates/_schema.md";
import initTemplate from "../../prompts/init.md";
import { render } from "./template";

export async function* runInit(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  repoRoot: string,
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const domainId = args[0];
  const dryRun = args.includes("--dry-run");

  if (!domainId) {
    yield { kind: "error", message: "init: domain id required" };
    return;
  }

  const existing = domains.find((d) => d.id === domainId);
  if (existing?.entity_types?.length) {
    yield { kind: "error", message: `Domain "${domainId}" already initialised. Use Lint to update entity_types.` };
    return;
  }

  yield { kind: "assistant_text", delta: `Bootstrapping domain "${domainId}"...\n` };

  const wikiRootGuess = `!Wiki`;

  await ensureRootFiles(vaultTools, wikiRootGuess);

  const start = Date.now();

  const allFiles = await vaultTools.listFiles("");
  const sampleFiles = allFiles.slice(0, 5);
  const samples = await vaultTools.readAll(sampleFiles);
  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, `${wikiRootGuess}/_schema.md`),
    tryRead(vaultTools, `${wikiRootGuess}/_index.md`),
  ]);

  const systemContent = render(initTemplate, {
    domain_id: domainId,
    vault_name: vaultName,
    schema_block: schemaContent ? `\nКонвенции вики (_schema.md):\n${schemaContent.slice(0, 1500)}` : "",
    index_block: indexContent ? `\nСуществующая структура (_index.md):\n${indexContent.slice(0, 1000)}` : "",
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `Domain ID: ${domainId}`,
        `Vault name: ${vaultName}`,
        "",
        `Примеры файлов vault:`,
        [...samples.entries()].map(([p, c]) => `${p}:\n${c.slice(0, 400)}`).join("\n\n"),
      ].join("\n"),
    },
  ];

  const params = buildChatParams(model, messages, opts);
  let fullText = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { fullText += content; yield { kind: "assistant_text", delta: content }; }
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    if (fullText) yield { kind: "assistant_text", delta: fullText };
  }

  if (signal.aborted) return;

  let entry: DomainEntry;
  try {
    const match = fullText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found in LLM response");
    entry = JSON.parse(match[0]) as DomainEntry;
    if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
  } catch (e) {
    yield { kind: "error", message: `Failed to parse domain entry: ${(e as Error).message}` };
    return;
  }

  if (dryRun) {
    yield {
      kind: "result",
      durationMs: Date.now() - start,
      text: `Dry run — domain entry:\n\`\`\`json\n${JSON.stringify(entry, null, 2)}\n\`\`\``,
    };
    return;
  }

  yield { kind: "tool_use", name: existing ? "UpdateDomain" : "SaveDomain", input: { id: entry.id } };
  if (existing) {
    yield { kind: "domain_updated", domainId: entry.id, patch: { entity_types: entry.entity_types, language_notes: entry.language_notes } };
  } else {
    yield { kind: "domain_created", entry };
  }
  yield { kind: "tool_result", ok: true };

  await appendLog(vaultTools, wikiRootGuess, domainId);

  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised. Edit entity_types in plugin settings to refine extraction.`,
  };
}

async function appendLog(vaultTools: VaultTools, wikiRoot: string, domainId: string): Promise<void> {
  const logPath = `${wikiRoot}/_log.md`;
  const today = new Date().toISOString().slice(0, 10);
  const entry = `\n## ${today} — init — ${domainId}\n- Домен создан\n`;
  try {
    const existing = await tryRead(vaultTools, logPath);
    await vaultTools.write(logPath, existing + entry);
  } catch { /* не критично */ }
}

async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}

async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const schema = `${wikiRoot}/_schema.md`;
  const index  = `${wikiRoot}/_index.md`;
  const log    = `${wikiRoot}/_log.md`;

  try {
    if (!(await vaultTools.exists(schema))) await vaultTools.write(schema, schemaTemplate);
    if (!(await vaultTools.exists(index)))  await vaultTools.write(index, "# Wiki Index\n");
    if (!(await vaultTools.exists(log)))    await vaultTools.write(log, "# Wiki Log\n");
  } catch { /* не блокируем init */ }
}
