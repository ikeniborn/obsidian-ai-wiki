import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient, RunRequest } from "../types";
import type { VaultTools } from "../vault-tools";
import { runStructuredWithRetry } from "./structured-output";
import { runWithContextRepack, PromptBudgetExceededError } from "../prompt-budget";
import { applyPagePatch, inspectPatchablePage, type PatchPage, type ReplaceSectionAuthority } from "../section-patches";
import { LintChatPatchSchema } from "./zod-schemas";
import type { LintChatPatchResponse } from "./zod-schemas";
import lintChatTemplate from "../../prompts/lint-chat.md";
import wikiSchemaTemplate from "../../templates/_wiki_schema.md";
import { render } from "./template";
import { wikiSections } from "./llm-utils";
import { resolveLang } from "../i18n";
import { domainWikiFolder, isWikiPagePath } from "../wiki-path";
import { pageIndexRecordFromMarkdown } from "../wiki-index";
import { upsertPageIndex } from "../wiki-index-store";
import { ensureDomainConfig } from "../domain-config";
import { promptVersionOf } from "../prompt-version";

interface ParsedChatFinding {
  path: string;
  heading: string;
  severity: string;
  rule: string;
  text: string;
}

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((word) => word.length >= 3));
}

function lexicalScore(needle: string, haystack: string): number {
  const left = words(needle);
  const right = words(haystack);
  let score = 0;
  for (const word of left) if (right.has(word)) score++;
  return score;
}

function parseLintFindings(report: string): ParsedChatFinding[] {
  const findings: ParsedChatFinding[] = [];
  const re = /^-\s*\[(info|warning|error)\]\s+([^:]+?\.md)\s+::\s+(.+?)\s+::\s+(.+?)\s+::\s+(.+)$/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(report)) !== null) {
    findings.push({
      severity: match[1],
      path: match[2].trim(),
      heading: match[3].trim(),
      rule: match[4].trim(),
      text: match[5].trim(),
    });
  }
  return findings;
}

function compactLintReportForPaths(report: string, paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const selected = new Set(paths);
  const findings = parseLintFindings(report).filter((finding) => selected.has(finding.path));
  if (findings.length === 0) return "";
  return findings.map((finding) =>
    `- [${finding.severity}] ${finding.path} :: ${finding.heading} :: ${finding.rule} :: ${finding.text}`
  ).join("\n");
}

function explicitReferencedPaths(text: string, files: readonly string[]): Set<string> {
  const refs = new Set<string>();
  for (const match of text.matchAll(/!?Wiki\/[^\s)\]}]+?\.md/g)) {
    const normalized = match[0].replace(/^[[(]*/, "");
    const found = files.find((file) => file === normalized || file.endsWith(`/${normalized.split("/").pop()}`));
    if (found) refs.add(found);
  }
  for (const match of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const stem = match[1].split("/").pop()!;
    const found = files.find((file) => file.endsWith(`/${stem}.md`));
    if (found) refs.add(found);
  }
  const lowered = text.toLowerCase();
  for (const file of files) {
    const stem = file.split("/").pop()!.replace(/\.md$/, "").toLowerCase();
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`).test(lowered)) refs.add(file);
  }
  return refs;
}

interface SelectedChatPages {
  paths: string[];
  explicit: boolean;
}

function selectReferencedPages(
  files: readonly string[],
  report: string,
  instruction: string,
): SelectedChatPages {
  const explicit = explicitReferencedPaths(instruction, files);
  if (explicit.size > 0) return { paths: [...explicit].sort(), explicit: true };
  const findings = parseLintFindings(report);
  const ranked = findings
    .map((finding) => ({
      path: finding.path,
      score: lexicalScore(instruction, `${finding.heading} ${finding.rule} ${finding.text}`),
    }))
    .filter((entry) => files.includes(entry.path))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  if (ranked.length === 0 || ranked[0].score <= 0) return { paths: [], explicit: false };
  const bestScore = ranked[0].score;
  return {
    paths: [...new Set(ranked.filter((entry) => entry.score === bestScore).slice(0, 4).map((entry) => entry.path))],
    explicit: false,
  };
}

function pageAuthorities(path: string, content: string): ReplaceSectionAuthority[] {
  return inspectPatchablePage(content).sections.map((section) => ({
    path,
    heading: section.heading,
    sectionOrdinal: section.ordinal,
    sectionHash: section.hash,
    exactSection: section.span,
  }));
}

function renderPatchablePages(pages: ReadonlyMap<string, string>): string {
  return JSON.stringify([...pages.entries()].map(([path, content]) => {
    const inspected = inspectPatchablePage(content);
    return {
      path,
      expectedPageHash: inspected.pageHash,
      sections: inspected.sections.map((section) => ({
        heading: section.heading,
        ordinal: section.ordinal,
        hash: section.hash,
        markdown: section.span,
      })),
    };
  }), null, 2);
}

function compactOlderPairs(messages: NonNullable<RunRequest["chatMessages"]>): OpenAI.Chat.ChatCompletionMessageParam[] {
  const older = messages.slice(0, -1);
  const pairs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  for (let index = 0; index < older.length; index += 2) {
    const first = older[index];
    const second = older[index + 1];
    if (!first) continue;
    pairs.push({ role: first.role, content: first.content });
    if (second) pairs.push({ role: second.role, content: second.content });
  }
  return pairs;
}

function buildLintChatMessagesWithinBudget(
  systemContent: string,
  olderPairs: readonly OpenAI.Chat.ChatCompletionMessageParam[],
  newestUser: string,
  effectiveInputBudget: number,
): { messages: OpenAI.Chat.ChatCompletionMessageParam[]; estimatedInputTokens: number; contextUnits: number } {
  for (let keep = olderPairs.length; keep >= 0; keep -= 2) {
    const keptPairs = olderPairs.slice(Math.max(0, olderPairs.length - keep));
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
      ...keptPairs,
      { role: "user", content: newestUser },
    ];
    const estimatedInputTokens = new TextEncoder().encode(JSON.stringify(messages)).byteLength;
    if (estimatedInputTokens <= effectiveInputBudget) {
      return {
        messages,
        estimatedInputTokens,
        contextUnits: keptPairs.length + 1,
      };
    }
  }
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    { role: "user", content: newestUser },
  ];
  return {
    messages,
    estimatedInputTokens: new TextEncoder().encode(JSON.stringify(messages)).byteLength,
    contextUnits: 1,
  };
}

function estimateLintChatFixedRequest(
  systemContent: string,
  newestUser: string,
): number {
  return new TextEncoder().encode(JSON.stringify([
    { role: "system", content: systemContent },
    { role: "user", content: newestUser },
  ])).byteLength;
}

export async function* runLintFixChat(
  req: RunRequest,
  vaultTools: VaultTools,
  _vaultRoot: string,
  domain: DomainEntry | undefined,
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): AsyncGenerator<RunEvent> {
  const start = Date.now();

  if (!domain) {
    yield { kind: "error", message: "lint-chat requires a domain" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }

  const wikiVaultPath = domainWikiFolder(domain.wiki_folder);

  // 1. Load domain pages (Glob emitted immediately — before any async I/O)
  yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**` } };
  await ensureDomainConfig(vaultTools, wikiVaultPath);
  const schemaContent = render(wikiSchemaTemplate, { section_conventions: wikiSections(resolveLang(opts.outputLanguage)) });
  const allFiles = await vaultTools.listFiles(wikiVaultPath);
  const files = allFiles.filter(isWikiPagePath);
  yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };

  const chatMessages = req.chatMessages ?? [];
  const lastMessage = chatMessages.at(-1);
  if (lastMessage?.role !== "user" || lastMessage.content.trim().length === 0) {
    yield { kind: "error", message: "lint-chat requires a newest user instruction" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  const lastUser = lastMessage;

  const selected = selectReferencedPages(files, req.context ?? "", lastUser.content);
  const selectedPaths = [...selected.paths];
  yield { kind: "tool_use", name: "Read", input: { files: String(selectedPaths.length) } };
  const pages = await vaultTools.readAll(selectedPaths);
  yield { kind: "tool_result", ok: true, preview: `loaded ${pages.size} referenced page(s)` };

  // 2. Build messages
  const renderSystem = (activePages: ReadonlyMap<string, string>, includeSchema: boolean): string => render(lintChatTemplate, {
      domain_name: domain.name,
      lint_report: compactLintReportForPaths(req.context ?? "", [...activePages.keys()]),
      pages_block: renderPatchablePages(activePages),
      schema_block: includeSchema && schemaContent ? `\nConventions (_wiki_schema.md):\n${schemaContent}` : "",
    });
  let activePaths = selectedPaths;
  let activePages = new Map([...pages].filter(([path]) => activePaths.includes(path)));
  let includeSchema = true;
  let systemContent = renderSystem(activePages, includeSchema);
  while (
    estimateLintChatFixedRequest(systemContent, lastUser.content) > (opts.inputBudgetTokens ?? 16_384)
    && activePaths.length > 0
    && !selected.explicit
  ) {
    activePaths = activePaths.slice(0, -1);
    activePages = new Map([...pages].filter(([path]) => activePaths.includes(path)));
    systemContent = renderSystem(activePages, includeSchema);
  }
  if (selected.paths.length > 0 && !selected.explicit && activePaths.length === 0) {
    yield { kind: "error", message: "lint-chat: selected referenced page context exceeds input budget" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  if (selected.paths.length > 0 && activePages.size === 0) {
    yield { kind: "error", message: "lint-chat: selected referenced page context is unavailable" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  if (estimateLintChatFixedRequest(systemContent, lastUser.content) > (opts.inputBudgetTokens ?? 16_384) && includeSchema) {
    includeSchema = false;
    systemContent = renderSystem(activePages, includeSchema);
  }
  if (estimateLintChatFixedRequest(systemContent, lastUser.content) > (opts.inputBudgetTokens ?? 16_384)) {
    yield { kind: "error", message: "lint-chat: selected referenced page context exceeds input budget" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }

  const olderPairs = compactOlderPairs(chatMessages);

  // 3. Structured LLM call
  yield { kind: "tool_use", name: "Applying fixes", input: { pages: String(pages.size) } };
  const pwtEvents: RunEvent[] = [];
  let result: { value: LintChatPatchResponse; outputTokens: number };
  try {
    result = await runWithContextRepack({
      callSite: "lint-chat.patch",
      configuredInputBudget: opts.inputBudgetTokens ?? 16_384,
      outputBudget: opts.maxTokens,
      compressionProfile: opts.semanticCompression?.profile ?? "balanced",
      build: (effectiveInputBudget) => {
        const packed = buildLintChatMessagesWithinBudget(
          systemContent,
          olderPairs,
          lastUser.content,
          effectiveInputBudget,
        );
        const { messages, estimatedInputTokens } = packed;
        if (estimatedInputTokens > effectiveInputBudget) {
          throw new PromptBudgetExceededError(effectiveInputBudget, estimatedInputTokens, selectedPaths);
        }
        return {
          value: messages,
          estimatedInputTokens,
          contextUnits: activePages.size + packed.contextUnits,
        };
      },
      execute: async (messages) => {
        const r = await runStructuredWithRetry({
          llm,
          model,
          baseMessages: messages,
          opts: { ...opts, jsonMode: false, inputBudgetTokens: opts.inputBudgetTokens ?? 16_384 },
          profile: { kind: "json-zod", schema: LintChatPatchSchema },
          maxRetries: opts.structuredRetries ?? 1,
          callSite: "lint-chat.patch",
          signal,
          onEvent: (ev) => pwtEvents.push(ev),
        });
        return { value: r.value, outputTokens: r.outputTokens, inputTokens: r.inputTokens };
      },
      onEvent: (ev) => pwtEvents.push(ev),
    });
    yield { kind: "tool_result", ok: true, preview: `${result.value.patches?.length ?? 0} patch(es)` };
  } catch (e) {
    yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    for (const ev of pwtEvents) yield ev;
    yield { kind: "error", message: `lint-chat: ${(e as Error).message}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  for (const ev of pwtEvents) yield ev;

  const parsed = result.value;

  // 4. Apply section patches only
  const authorities = new Map<string, ReplaceSectionAuthority[]>();
  for (const [path, content] of activePages) authorities.set(path, pageAuthorities(path, content));
  const writtenPaths: string[] = [];
  for (const patch of parsed.patches ?? []) {
    yield { kind: "tool_use", name: "Update", input: { path: patch.path } };
    const current = activePages.get(patch.path);
    if (!activePaths.includes(patch.path) || current === undefined) {
      yield { kind: "tool_result", ok: false, preview: `Blocked: path was not selected (${patch.path})` };
      continue;
    }
    try {
      const applied = applyPagePatch(current, patch as unknown as PatchPage, authorities.get(patch.path) ?? []);
      if (!applied.ok) {
        yield { kind: "tool_result", ok: false, preview: applied.reason };
        continue;
      }
      await vaultTools.write(patch.path, applied.content);
      activePages.set(patch.path, applied.content);
      writtenPaths.push(patch.path);
      yield { kind: "tool_result", ok: true };
      await upsertPageIndex(
        vaultTools,
        wikiVaultPath,
        pageIndexRecordFromMarkdown(wikiVaultPath, patch.path, applied.content),
      );
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
      continue;
    }
  }

  // 5. Emit result
  yield {
    kind: "eval_meta",
    fields: {
      articles: writtenPaths,
      instruction: lastUser.content,
      promptVersion: promptVersionOf(lintChatTemplate),
    },
  };
  yield { kind: "result", durationMs: Date.now() - start, text: parsed.summary, outputTokens: result.outputTokens || undefined };
}
