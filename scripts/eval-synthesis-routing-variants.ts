#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";

import type OpenAI from "openai";

import { inspectPatchablePage } from "../src/section-patches";
import type { SynthesisPathPolicy } from "../src/phases/ingest-synthesis";
import type { SynthesisOutput } from "../src/phases/zod-schemas";
import type { EntityContextBundle, WikiSectionUnit } from "../src/ingest-context";
import type { LlmClient, RunEvent } from "../src/types";

register(new URL("../tests/md-obsidian-loader.mjs", import.meta.url));

interface VariantMetrics {
  variant: string;
  status: "observed" | "verified" | "simulated" | "rejected";
  synthesisRequests: number;
  structuredValidationRetries: number;
  structuralErrors: number;
  failedSources: number;
  invalidPathsWritten: number;
  unknownEntityKeyAccepted: number;
  pagesCreated: number;
  pagesUpdated: number;
  articleQualityScore: number;
  notes: string[];
}

const REPLAY_KEYS = [
  "chromium-flag",
  "desktop-file",
  "environment-variables",
  "obsidian",
  "pac-file-method",
  "permanent-launch-shortcut",
  "profile-file",
  "profile-method",
  "proxy-pac",
  "wrapper-script",
];

const CREATE_PATHS = new Map<string, string>([
  ["chromium-flag", "!Wiki/os-unix/methods/wiki_os-unix_chromium_flag.md"],
  ["desktop-file", "!Wiki/os-unix/configurations/wiki_os-unix_desktop_file.md"],
  ["environment-variables", "!Wiki/os-unix/configurations/wiki_os-unix_environment_variables.md"],
  ["obsidian", "!Wiki/os-unix/applications/wiki_os-unix_obsidian.md"],
  ["pac-file-method", "!Wiki/os-unix/methods/wiki_os-unix_pac_file_method.md"],
  ["permanent-launch-shortcut", "!Wiki/os-unix/methods/wiki_os-unix_permanent_launch_shortcut.md"],
  ["profile-file", "!Wiki/os-unix/configurations/wiki_os-unix_profile_file.md"],
  ["profile-method", "!Wiki/os-unix/methods/wiki_os-unix_profile_method.md"],
  ["proxy-pac", "!Wiki/os-unix/configurations/wiki_os-unix_proxy_pac.md"],
  ["wrapper-script", "!Wiki/os-unix/configurations/wiki_os-unix_wrapper_script.md"],
]);

const EMITTED_BAD_PATHS = new Map<string, string>([
  ["chromium-flag", "!Wiki/os-unix/methods/wiki_os-unix_chromium-flag.md"],
  ["desktop-file", "!Wiki/os-unix/configurations/wiki_os-unix_desktop-file.md"],
  ["environment-variables", "!Wiki/os-unix/configurations/wiki_os-unix_environment-variables.md"],
  ["obsidian", "!Wiki/os-unix/applications/obsidian.md"],
  ["pac-file-method", "!Wiki/os-unix/methods/wiki_os-unix_pac-file-method.md"],
  ["permanent-launch-shortcut", "!Wiki/os-unix/methods/wiki_os-unix_permanent-launch-shortcut.md"],
  ["profile-file", "!Wiki/os-unix/configurations/wiki_os-unix_profile-file.md"],
  ["profile-method", "!Wiki/os-unix/methods/wiki_os-unix_profile-method.md"],
  ["proxy-pac", "!Wiki/os-unix/configurations/proxy-pac.md"],
  ["wrapper-script", "!Wiki/os-unix/configurations/wiki_os-unix_wrapper-script.md"],
]);

const PATH_POLICY: SynthesisPathPolicy = {
  domainRoot: "!Wiki/os-unix",
  allowedSubfolders: ["methods", "configurations", "applications"],
};

async function synthesisModule(): Promise<{
  mergeSynthesisBatchOutputs: (outputs: readonly SynthesisOutput[]) => SynthesisOutput;
  synthesizeEntityBatch: (input: Parameters<typeof import("../src/phases/ingest-synthesis").synthesizeEntityBatch>[0]) => Promise<SynthesisOutput>;
}> {
  const module = await import("../src/phases/ingest-synthesis");
  return {
    mergeSynthesisBatchOutputs: module.mergeSynthesisBatchOutputs,
    synthesizeEntityBatch: module.synthesizeEntityBatch,
  };
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function streamOutput(text: string): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return (async function* () {
    yield {
      id: "variant",
      object: "chat.completion.chunk",
      created: 0,
      model: "variant",
      choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }],
    } as OpenAI.Chat.ChatCompletionChunk;
    yield {
      id: "usage",
      object: "chat.completion.chunk",
      created: 0,
      model: "variant",
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    } as OpenAI.Chat.ChatCompletionChunk;
  })();
}

function bundle(entityKey: string): EntityContextBundle {
  const target = CREATE_PATHS.get(entityKey) ?? `!Wiki/os-unix/configurations/wiki_os-unix_${entityKey.replace(/-/g, "_")}.md`;
  const unit: WikiSectionUnit = {
    id: `${target}::Facts`,
    source: "wiki",
    text: `## Facts\n${entityKey} evidence\n`,
    required: false,
    priority: 1,
    pageId: entityKey,
    path: target,
    heading: "## Facts",
    sectionHash: "",
    score: 1,
    sourceOrdinal: 0,
    duplicatePaths: [target],
  };
  return {
    entityKey,
    evidence: {
      entityKey,
      entityType: entityKey === "obsidian" ? "application" : entityKey.includes("file") || entityKey.includes("proxy") || entityKey.includes("wrapper") ? "configuration" : "method",
      packetIds: [`p-${entityKey}`],
      facts: [`${entityKey} fact`],
      exactSourceRanges: [{ startLine: 1, endLine: 1 }],
      exactSource: [{ startLine: 1, endLine: 1, text: `${entityKey} source` }],
      links: [],
    },
    units: [unit],
    replaceAuthorities: [],
    estimatedInputTokens: 8,
  };
}

function keysInPrompt(params: Record<string, unknown>): string[] {
  const text = JSON.stringify(params.messages);
  return REPLAY_KEYS.filter((key) => text.includes(`entity-${key}`));
}

function createAction(entityKey: string): Record<string, unknown> {
  return {
    kind: "create",
    entityKey,
    path: EMITTED_BAD_PATHS.get(entityKey) ?? CREATE_PATHS.get(entityKey),
    annotation: `${entityKey} page`,
    content: [
      "---",
      `type: ${bundle(entityKey).evidence.entityType}`,
      `description: ${entityKey} page.`,
      "resource: [ОС/Unix/AltLinux/Настройка прокси.md]",
      "---",
      `# ${entityKey}`,
      "",
      "## Facts",
      `${entityKey} fact.`,
      "",
      "## Sources",
      "- [[ОС/Unix/AltLinux/Настройка прокси]]",
      "",
    ].join("\n"),
  };
}

function mockLlm(options: { unknownOnFullBatch: boolean }, calls: Record<string, unknown>[]): LlmClient {
  return {
    chat: {
      completions: {
        create: async (params: unknown) => {
          const record = params as Record<string, unknown>;
          calls.push(record);
          const keys = keysInPrompt(record);
          if (options.unknownOnFullBatch && keys.length === REPLAY_KEYS.length) {
            return streamOutput(JSON.stringify({
              reasoning: "hallucinated key on large batch",
              actions: [{
                kind: "create",
                entityKey: "entity-obsidian",
                path: "!Wiki/os-unix/applications/wiki_os-unix_entity_obsidian.md",
                annotation: "Bad key",
                content: "# Bad key\n",
              }],
              skips: [],
            }));
          }
          return streamOutput(JSON.stringify({
            reasoning: `create ${keys.join(", ")}`,
            actions: keys.map(createAction),
            skips: [],
          }));
        },
      },
    },
  } as unknown as LlmClient;
}

async function runSynthesisVariant(args: {
  variant: string;
  batchSize: number;
  createPaths: boolean;
  unknownOnFullBatch: boolean;
}): Promise<VariantMetrics> {
  const { mergeSynthesisBatchOutputs, synthesizeEntityBatch } = await synthesisModule();
  const events: RunEvent[] = [];
  const calls: Record<string, unknown>[] = [];
  const outputs: SynthesisOutput[] = [];
  const llm = mockLlm({ unknownOnFullBatch: args.unknownOnFullBatch }, calls);
  const bundles = REPLAY_KEYS.map(bundle);
  for (let index = 0; index < bundles.length; index += args.batchSize) {
    outputs.push(await synthesizeEntityBatch({
      bundles: bundles.slice(index, index + args.batchSize),
      existingPaths: new Set(),
      existingPageHashes: new Map(),
      existingPageDescriptions: [],
      createPathsByEntityKey: args.createPaths ? CREATE_PATHS : undefined,
      tagRegistryUnits: [],
      pathPolicy: PATH_POLICY,
      domainContract: "Domain: os-unix",
      schemaContract: "schema",
      pathContract: "canonical wiki path",
      llm,
      model: "variant",
      policy: { inputBudgetTokens: 100_000, outputBudgetTokens: 2_000, compression: "balanced" },
      opts: { structuredRetries: 0 },
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    }));
  }
  const output = mergeSynthesisBatchOutputs(outputs);
  const paths = output.actions.map((action) => action.path);
  return {
    variant: args.variant,
    status: "verified",
    synthesisRequests: calls.length,
    structuredValidationRetries: events.filter((event) => event.kind === "structured_validation_retry").length,
    structuralErrors: events.filter((event) => event.kind === "structural_error").length,
    failedSources: 0,
    invalidPathsWritten: paths.filter((candidate) => !CREATE_PATHS.has(REPLAY_KEYS.find((key) => candidate.endsWith(`${key}.md`)) ?? "") && ![...CREATE_PATHS.values()].includes(candidate)).length,
    unknownEntityKeyAccepted: output.actions.some((action) => action.entityKey === "entity-obsidian") ? 1 : 0,
    pagesCreated: output.actions.length,
    pagesUpdated: 0,
    articleQualityScore: qualityScore(output.actions.map((action) => "content" in action ? action.content : "")),
    notes: [
      args.createPaths ? "create paths are server-owned" : "model owns create paths",
      `batchSize=${args.batchSize}`,
      args.unknownOnFullBatch ? "large batch mock emits unknown entity key" : "no unknown-key mock",
    ],
  };
}

function qualityScore(contents: readonly string[]): number {
  if (contents.length === 0) return 0;
  let score = 0;
  for (const content of contents) {
    if (/^---\n[\s\S]*?\n---/m.test(content)) score += 1;
    if (/^type:/m.test(content)) score += 1;
    if (/^description:/m.test(content)) score += 1;
    if (/^resource:/m.test(content)) score += 1;
    if (/^## Sources$/m.test(content)) score += 1;
    if (inspectPatchablePage(content).sections.length > 0) score += 1;
  }
  return Number((score / (contents.length * 6)).toFixed(3));
}

async function parseBaseline(vault: string, session: string): Promise<VariantMetrics> {
  const text = await readFile(path.join(vault, ".obsidian/plugins/ai-wiki/agent.jsonl"), "utf8");
  const events = text.trim().split(/\n/).flatMap((line) => {
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed) || parsed.session !== session || !isRecord(parsed.event)) return [];
      return [parsed.event];
    } catch {
      return [];
    }
  });
  const result = events.findLast((event) => event.kind === "result");
  const osUnixRoot = path.join(vault, "!Wiki/os-unix");
  const files = await readdir(osUnixRoot, { recursive: true });
  const pages = files.filter((file) => typeof file === "string" && file.endsWith(".md")) as string[];
  const contents = await Promise.all(pages.map((file) => readFile(path.join(osUnixRoot, file), "utf8")));
  return {
    variant: "baseline-captured-replay",
    status: "observed",
    synthesisRequests: events.filter((event) => event.kind === "llm_request_fingerprint" && event.callSite === "ingest.synthesize").length,
    structuredValidationRetries: events.filter((event) => event.kind === "structured_validation_retry").length,
    structuralErrors: events.filter((event) => event.kind === "structural_error").length,
    failedSources: isRecord(result) && result.text === "" ? 1 : 0,
    invalidPathsWritten: pages.filter((file) => !/^[^/]+\/wiki_os-unix_[a-z0-9_]+\.md$/.test(file)).length,
    unknownEntityKeyAccepted: 0,
    pagesCreated: pages.length,
    pagesUpdated: 0,
    articleQualityScore: qualityScore(contents),
    notes: ["captured from existing replay vault logs"],
  };
}

function simulatedVariants(): VariantMetrics[] {
  return [{
    variant: "pathless-create-actions",
    status: "simulated",
    synthesisRequests: 1,
    structuredValidationRetries: 0,
    structuralErrors: 0,
    failedSources: 0,
    invalidPathsWritten: 0,
    unknownEntityKeyAccepted: 0,
    pagesCreated: REPLAY_KEYS.length,
    pagesUpdated: 0,
    articleQualityScore: 1,
    notes: [
      "requires schema migration: create action omits path",
      "best retry profile, higher implementation risk than server-owned path injection",
    ],
  }, {
    variant: "pre-synthesis-key-type-gate",
    status: "simulated",
    synthesisRequests: 3,
    structuredValidationRetries: 1,
    structuralErrors: 0,
    failedSources: 0,
    invalidPathsWritten: 0,
    unknownEntityKeyAccepted: 0,
    pagesCreated: REPLAY_KEYS.length,
    pagesUpdated: 0,
    articleQualityScore: 1,
    notes: [
      "does not catch entity-obsidian when hallucinated inside synthesis",
      "useful as additional guard for bad evidence packets, not sufficient as main fix",
    ],
  }, {
    variant: "reduced-output-budget-profile",
    status: "simulated",
    synthesisRequests: 5,
    structuredValidationRetries: 0,
    structuralErrors: 0,
    failedSources: 0,
    invalidPathsWritten: 0,
    unknownEntityKeyAccepted: 0,
    pagesCreated: REPLAY_KEYS.length,
    pagesUpdated: 0,
    articleQualityScore: 0.85,
    notes: [
      "addresses empty-output/max-token risk for later high-token source",
      "may reduce article completeness; needs live model eval before selection",
    ],
  }];
}

function score(metrics: VariantMetrics): number {
  return (
    metrics.failedSources * 100
    + metrics.structuredValidationRetries * 10
    + metrics.structuralErrors * 15
    + metrics.invalidPathsWritten * 50
    + metrics.unknownEntityKeyAccepted * 100
    + metrics.synthesisRequests
    - metrics.articleQualityScore * 10
  );
}

async function main(args: string[]): Promise<void> {
  const vault = argumentValue(args, "--vault") ?? "/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run";
  const session = argumentValue(args, "--session") ?? "1784747412210";
  const outDir = argumentValue(args, "--out-dir") ?? "docs/loen/synthesis-routing-quality/evidence";
  await mkdir(outDir, { recursive: true });

  const variants: VariantMetrics[] = [
    await parseBaseline(vault, session),
    await runSynthesisVariant({
      variant: "server-owned-create-paths-batch10",
      batchSize: 10,
      createPaths: true,
      unknownOnFullBatch: true,
    }),
    await runSynthesisVariant({
      variant: "server-owned-create-paths-batch2",
      batchSize: 2,
      createPaths: true,
      unknownOnFullBatch: true,
    }),
    ...simulatedVariants(),
  ];
  const ranked = variants
    .map((metrics) => ({ ...metrics, score: score(metrics) }))
    .sort((left, right) => left.score - right.score);
  const summary = {
    vault,
    session,
    generatedAt: new Date().toISOString(),
    variants,
    ranked,
    selected: ranked.find((variant) => variant.status === "verified")?.variant,
    selectionReason: "Choose best verified production-code variant; simulated variants require additional implementation/live eval.",
  };
  for (const variant of variants) {
    await writeFile(
      path.join(outDir, `variant-${variant.variant}.json`),
      `${JSON.stringify({ ...variant, score: score(variant) }, null, 2)}\n`,
      "utf8",
    );
  }
  await writeFile(path.join(outDir, "variant-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`[eval-synthesis-routing-variants] ${(error as Error).message}`);
  process.exit(1);
});
