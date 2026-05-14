import { isAbsolute, join, relative, dirname } from "path-browserify";
import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas } from "./llm-utils";
import ingestTemplate from "../../prompts/ingest.md";
import { render } from "./template";
import { domainWikiFolder } from "../wiki-path";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, hasFrontmatterField } from "../utils/raw-frontmatter";

export async function* runIngest(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const filePath = args[0];
  if (!filePath) {
    yield { kind: "error", message: "ingest: file path required" };
    return;
  }

  const absSource = isAbsolute(filePath) ? filePath : join(vaultRoot, filePath);
  const sourceVaultPath = vaultTools.toVaultPath(absSource);
  if (!sourceVaultPath) {
    yield { kind: "error", message: `Source file ${filePath} is outside the vault.` };
    return;
  }

  yield { kind: "tool_use", name: "Read", input: { path: sourceVaultPath } };
  let sourceContent: string;
  try {
    sourceContent = await vaultTools.read(sourceVaultPath);
  } catch (e) {
    yield { kind: "error", message: `Cannot read ${sourceVaultPath}: ${(e as Error).message}` };
    return;
  }
  yield { kind: "tool_result", ok: true, preview: sourceContent.slice(0, 100) };

  const domain = detectDomain(absSource, domains, vaultRoot);
  if (!domain) {
    yield { kind: "error", message: "No domain found for this file. Configure domain-map." };
    return;
  }

  const absWiki = join(vaultRoot, domainWikiFolder(domain.wiki_folder));
  const wikiVaultPath = vaultTools.toVaultPath(absWiki);
  if (!wikiVaultPath) {
    yield { kind: "error", message: `Wiki folder ${domainWikiFolder(domain.wiki_folder)} is outside the vault.` };
    return;
  }

  const domainRoot = wikiVaultPath;
  const schemaRoot = wikiVaultPath.split("/").slice(0, -1).join("/");

  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, `${schemaRoot}/_wiki_schema.md`),
    tryRead(vaultTools, `${domainRoot}/_index.md`),
  ]);

  const existingPaths = await vaultTools.listFiles(wikiVaultPath);
  const existingPages = await vaultTools.readAll(existingPaths.filter((f) => !f.endsWith("_index.md")));

  yield { kind: "assistant_text", delta: `Synthesizing wiki pages for domain "${domain.id}"...\n` };

  const start = Date.now();
  const messages = buildIngestMessages(
    sourceVaultPath, sourceContent, domain, wikiVaultPath,
    existingPages, schemaContent, indexContent,
  );
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
      if (content) fullText += content;
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    fullText = resp.choices[0]?.message?.content ?? "";
  }

  if (signal.aborted) return;

  const pages = parseJsonPages(fullText);
  const written: string[] = [];
  for (const page of pages) {
    if (!page.path.startsWith(wikiVaultPath + "/")) {
      yield { kind: "tool_use", name: "Write", input: { path: page.path } };
      yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
      continue;
    }
    yield { kind: "tool_use", name: "Write", input: { path: page.path } };
    try {
      await vaultTools.write(page.path, page.content);
      written.push(page.path);
      yield { kind: "tool_result", ok: true };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    }
  }

  const resultText = buildIngestSummary(domain.id, sourceVaultPath, written, pages.length);
  yield { kind: "assistant_text", delta: resultText };

  if (written.length > 0) {
    await appendLog(vaultTools, domainRoot, sourceVaultPath, domain.id, written);
    await updateIndex(vaultTools, domainRoot, written);

    const backlinkToday = new Date().toISOString().slice(0, 10);
    const isFirstTime = !hasFrontmatterField(sourceContent, "wiki_added");
    const existingArticles = parseWikiArticlesFromFm(sourceContent);
    const writtenLinks = written.map((p) => `[[${p}]]`);
    const mergedArticles = [...new Set([...existingArticles, ...writtenLinks])];
    const updatedSource = upsertRawFrontmatter(sourceContent, {
      wiki_added: isFirstTime ? backlinkToday : undefined,
      wiki_updated: backlinkToday,
      wiki_articles: mergedArticles,
    });
    yield { kind: "tool_use", name: "Write", input: { path: sourceVaultPath } };
    try {
      await vaultTools.write(sourceVaultPath, updatedSource);
      yield { kind: "tool_result", ok: true, preview: `backlinks → ${sourceVaultPath}` };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: `backlink write failed: ${(e as Error).message}` };
    }

    const parentPath = extractParentSourcePath(absSource, vaultRoot);
    yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
  }

  yield { kind: "result", durationMs: Date.now() - start, text: resultText };
}

function buildIngestSummary(domainId: string, sourcePath: string, written: string[], total: number): string {
  const src = sourcePath.split("/").pop() ?? sourcePath;
  if (written.length === 0) {
    return `Источник «${src}» обработан — новых или изменённых страниц нет.`;
  }
  const skipped = total - written.length;
  const lines = [`Источник «${src}» → домен «${domainId}»: записано ${written.length} стр.${skipped > 0 ? `, ошибок ${skipped}` : ""}`];
  for (const p of written) {
    lines.push(`  • ${p.split("/").pop()}`);
  }
  return lines.join("\n");
}

export function detectDomain(absFilePath: string, domains: DomainEntry[], vaultRoot: string): DomainEntry | null {
  for (const d of domains) {
    const matched = d.source_paths?.some((sp) => {
      const abs = isAbsolute(sp) ? sp : join(vaultRoot, sp);
      return absFilePath.startsWith(abs);
    });
    if (matched) return d;
  }
  return domains[0] ?? null;
}

export function parseJsonPages(text: string): Array<{ path: string; content: string }> {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr: unknown = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return (arr as unknown[]).filter(
      (x): x is { path: string; content: string } =>
        x !== null &&
        typeof x === "object" &&
        typeof x.path === "string" &&
        typeof x.content === "string",
    );
  } catch {
    return [];
  }
}

async function appendLog(
  vaultTools: VaultTools,
  wikiRoot: string,
  sourcePath: string,
  domainId: string,
  written: string[],
): Promise<void> {
  const logPath = `${wikiRoot}/_log.md`;
  const today = new Date().toISOString().slice(0, 10);
  const entry = `\n## ${today} — ingest — ${domainId}\n- Источник: ${sourcePath}\n- Страниц: ${written.map((p) => `\n  - ${p}`).join("")}\n`;
  try {
    const existing = await tryRead(vaultTools, logPath);
    await vaultTools.write(logPath, existing + entry);
  } catch { /* не критично */ }
}

async function updateIndex(vaultTools: VaultTools, wikiRoot: string, written: string[]): Promise<void> {
  const indexPath = `${wikiRoot}/_index.md`;
  try {
    const existing = await tryRead(vaultTools, indexPath);
    const newLinks = written.map((p) => {
      const name = p.split("/").pop()?.replace(/\.md$/, "") ?? p;
      return `- [[${name}]]`;
    }).join("\n");
    const updated = existing
      ? existing + "\n" + newLinks
      : `# Wiki Index\n\n${newLinks}`;
    await vaultTools.write(indexPath, updated);
  } catch { /* не критично */ }
}

async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}

export function extractParentSourcePath(
  absSource: string,
  vaultRoot: string,
): string {
  const parentAbs = dirname(absSource);
  // Clamp: не выходить выше vault root
  const normedVault = vaultRoot.endsWith("/") ? vaultRoot : vaultRoot + "/";
  const clamped = (parentAbs + "/").startsWith(normedVault) ? parentAbs : vaultRoot;
  const rel = relative(vaultRoot, clamped);
  return (rel || ".") + "/";
}

function buildEntityTypesBlock(domain: DomainEntry): string {
  if (!domain.entity_types?.length) return "";
  return domain.entity_types.map((et) => [
    `### Тип: ${et.type}`,
    `Описание: ${et.description}`,
    `Ключевые слова: ${et.extraction_cues.join(", ")}`,
    et.min_mentions_for_page != null ? `Мин. упоминаний для страницы: ${et.min_mentions_for_page}` : "",
    et.wiki_subfolder ? `Подпапка в wiki: ${et.wiki_subfolder}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
}

function buildIngestMessages(
  sourcePath: string,
  sourceContent: string,
  domain: DomainEntry,
  wikiVaultPath: string,
  existingPages: Map<string, string>,
  schemaContent: string,
  indexContent: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const existing = existingPages.size > 0
    ? [...existingPages.entries()].map(([p, c]) => `${p}:\n${c.slice(0, 400)}`).join("\n\n")
    : "Нет.";

  const today = new Date().toISOString().slice(0, 10);
  const entityTypesBlock = buildEntityTypesBlock(domain);
  const langNotes = domain.language_notes ? `Языковые правила: ${domain.language_notes}` : "";

  const systemContent = render(ingestTemplate, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock || "(не заданы)",
    lang_notes: langNotes,
    wiki_path: wikiVaultPath,
    today,
    schema_block: schemaContent ? `КОНВЕНЦИИ (_wiki_schema.md):\n${schemaContent.slice(0, 2000)}` : "",
    source_path: sourcePath,
  });

  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `Домен: ${domain.id} (${domain.name})`,
        `Wiki-папка: ${wikiVaultPath}`,
        ``,
        `Источник: ${sourcePath}`,
        sourceContent.slice(0, 8000),
        ``,
        `Существующие wiki-страницы:\n${existing}`,
        indexContent ? `\nИндекс wiki (_index.md):\n${indexContent.slice(0, 2000)}` : "",
      ].filter(Boolean).join("\n"),
    },
  ];
}
