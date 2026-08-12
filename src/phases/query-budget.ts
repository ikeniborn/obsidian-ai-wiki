import type OpenAI from "openai";
import { tokenizeLexical } from "../lexical-retrieval";
import {
  packContextUnits,
  type ContextUnit,
} from "../prompt-budget";
import {
  renderContextChunks,
  type SelectedChunk,
} from "../page-similarity";
import type {
  ChatMessage,
  LlmCallOptions,
} from "../types";
import { buildChatParams } from "./llm-utils";

interface PackedMessages {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  estimatedInputTokens: number;
  contextUnits: number;
}

export interface PackedQueryChunks extends PackedMessages {
  selected: SelectedChunk[];
  omitted: SelectedChunk[];
}

export interface PackQueryChunksArgs {
  question: string;
  systemPrompt: QuerySystemPrompt;
  chunks: SelectedChunk[];
  inputBudgetTokens: number;
  opts: LlmCallOptions;
}

export type QuerySystemPrompt =
  | string
  | ((selectedChunks: readonly SelectedChunk[]) => string);

export interface PackedChatHistory extends PackedMessages {
  selected: ChatMessage[];
  omitted: ChatMessage[];
  contextIncluded: boolean;
  selectedOptionalUnitIds: string[];
}

export interface PackChatHistoryArgs {
  systemPrompt: string;
  context: string;
  history: ChatMessage[];
  inputBudgetTokens: number;
  opts: LlmCallOptions;
  allowedOptionalUnitIds?: readonly string[];
}

interface ChatHistoryUnit {
  id: string;
  start: number;
  messages: ChatMessage[];
}

function preparedMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const params = buildChatParams(
    "__prompt_budget__",
    messages,
    { ...opts, inputBudgetTokens: undefined },
  );
  return params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
}

function chunkUnitId(chunk: SelectedChunk): string {
  const sourceOrder = chunk.source === "seed" ? "0" : "1";
  return [
    "chunk",
    sourceOrder,
    chunk.source,
    chunk.path,
    String(chunk.ordinal).padStart(10, "0"),
    chunk.articleId,
    chunk.heading,
  ].join(":");
}

function chunkFacets(chunk: SelectedChunk): Set<string> {
  return tokenizeLexical(`${chunk.heading}\n${chunk.body}`);
}

export function selectQueryContextChunks(
  rankedChunks: readonly SelectedChunk[],
  contextLimit: number,
  question = "",
): SelectedChunk[] {
  if (!Number.isSafeInteger(contextLimit) || contextLimit <= 0) return [];
  const limit = Math.min(contextLimit, rankedChunks.length);
  const siblingSlots = Math.floor(limit / 3);
  const anchorLimit = limit - siblingSlots;
  const selectedIndexes = new Set<number>();
  const anchorArticleIds = new Set<string>();

  for (let index = 0; index < rankedChunks.length && anchorArticleIds.size < anchorLimit; index += 1) {
    const articleId = rankedChunks[index].articleId;
    if (anchorArticleIds.has(articleId)) continue;
    anchorArticleIds.add(articleId);
    selectedIndexes.add(index);
  }

  const orderedIndexes = [...selectedIndexes].sort((left, right) => left - right);

  let facetSlots = 0;
  for (const facet of tokenizeLexical(question)) {
    if (selectedIndexes.size >= limit || facetSlots >= siblingSlots) break;
    const covered = orderedIndexes.some((index) => chunkFacets(rankedChunks[index]).has(facet));
    if (covered) continue;
    const index = rankedChunks.findIndex((chunk, idx) =>
      !selectedIndexes.has(idx) && chunkFacets(chunk).has(facet));
    if (index < 0) continue;
    selectedIndexes.add(index);
    orderedIndexes.push(index);
    facetSlots += 1;
  }

  for (let index = 0; index < rankedChunks.length; index += 1) {
    if (selectedIndexes.size >= limit) break;
    if (selectedIndexes.has(index) || !anchorArticleIds.has(rankedChunks[index].articleId)) continue;
    selectedIndexes.add(index);
    orderedIndexes.push(index);
  }
  for (let index = 0; index < rankedChunks.length && selectedIndexes.size < limit; index += 1) {
    if (selectedIndexes.has(index)) continue;
    selectedIndexes.add(index);
    orderedIndexes.push(index);
  }

  return orderedIndexes.map((index) => rankedChunks[index]);
}

export function packQueryChunks(args: PackQueryChunksArgs): PackedQueryChunks {
  const questionId = "query:current-question";
  const chunksByUnitId = new Map<string, SelectedChunk>();
  const units: ContextUnit[] = [{
    id: questionId,
    source: "source",
    text: args.question,
    required: true,
    priority: Number.POSITIVE_INFINITY,
  }];

  args.chunks.forEach((chunk, index) => {
    const id = chunkUnitId(chunk);
    chunksByUnitId.set(id, chunk);
    units.push({
      id,
      source: "wiki",
      text: renderContextChunks([chunk]),
      required: false,
      priority: args.chunks.length - index,
    });
  });

  const renderSystemPrompt = (selectedChunks: readonly SelectedChunk[]): string =>
    typeof args.systemPrompt === "function"
      ? args.systemPrompt(selectedChunks)
      : args.systemPrompt;
  const fixedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: renderSystemPrompt([]) },
  ];
  const packed = packContextUnits({
    inputBudgetTokens: args.inputBudgetTokens,
    fixedMessages,
    opts: args.opts,
    units,
    render: (selectedUnits, opts) => {
      const questionSelected = selectedUnits.some((unit) => unit.id === questionId);
      const selectedChunks = selectedUnits
        .map((unit) => chunksByUnitId.get(unit.id))
        .filter((chunk): chunk is SelectedChunk => chunk !== undefined);
      const context = renderContextChunks(selectedChunks);
      const userContent = context
        ? `Question: ${args.question}\n\nWiki pages:\n${context}`
        : `Question: ${args.question}\n\nWiki pages:`;
      return preparedMessages([
        { role: "system", content: renderSystemPrompt(selectedChunks) },
        ...(questionSelected
          ? [{ role: "user" as const, content: userContent }]
          : []),
      ], opts);
    },
  });

  return {
    messages: packed.messages,
    selected: packed.selected
      .map((unit) => chunksByUnitId.get(unit.id))
      .filter((chunk): chunk is SelectedChunk => chunk !== undefined),
    omitted: packed.omitted
      .map((unit) => chunksByUnitId.get(unit.id))
      .filter((chunk): chunk is SelectedChunk => chunk !== undefined),
    estimatedInputTokens: packed.estimatedInputTokens,
    contextUnits: packed.selected.length,
  };
}

function buildOlderHistoryUnits(
  history: ChatMessage[],
  currentUserIndex: number,
): ChatHistoryUnit[] {
  const units: ChatHistoryUnit[] = [];
  let index = 0;
  while (index < currentUserIndex) {
    const first = history[index];
    const second = history[index + 1];
    const pairLength = first.role === "user"
      && second?.role === "assistant"
      && index + 1 < currentUserIndex
      ? 2
      : 1;
    units.push({
      id: `chat:history:${String(index).padStart(10, "0")}`,
      start: index,
      messages: history.slice(index, index + pairLength),
    });
    index += pairLength;
  }
  return units;
}

export function packChatHistory(args: PackChatHistoryArgs): PackedChatHistory {
  let currentUserIndex = -1;
  for (let index = args.history.length - 1; index >= 0; index--) {
    if (args.history[index].role === "user") {
      currentUserIndex = index;
      break;
    }
  }
  if (currentUserIndex < 0) throw new Error("Chat history requires a current user message");

  const currentId = "chat:current-user";
  const contextId = "chat:prior-context";
  const historyUnits = buildOlderHistoryUnits(args.history, currentUserIndex);
  const units: ContextUnit[] = [
    {
      id: currentId,
      source: "source",
      text: args.history[currentUserIndex].content,
      required: true,
      priority: Number.POSITIVE_INFINITY,
    },
    ...historyUnits.map((unit) => ({
      id: unit.id,
      source: "source" as const,
      text: unit.messages.map((message) => `${message.role}: ${message.content}`).join("\n"),
      required: false,
      priority: 1_000_000 + unit.start,
    })),
  ];

  if (args.context) {
    units.push({
      id: contextId,
      source: "wiki",
      text: args.context,
      required: false,
      priority: 0,
    });
  }

  const fixedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: args.systemPrompt },
  ];
  const allowedOptionalUnitIds = args.allowedOptionalUnitIds === undefined
    ? undefined
    : new Set(args.allowedOptionalUnitIds);
  const packed = packContextUnits({
    inputBudgetTokens: args.inputBudgetTokens,
    fixedMessages,
    opts: args.opts,
    units: allowedOptionalUnitIds === undefined
      ? units
      : units.filter((unit) => unit.required || allowedOptionalUnitIds.has(unit.id)),
    render: (selectedUnits, opts) => {
      const selectedIds = new Set(selectedUnits.map((unit) => unit.id));
      const selectedHistory = historyUnits
        .filter((unit) => selectedIds.has(unit.id))
        .sort((left, right) => left.start - right.start)
        .flatMap((unit) => unit.messages);
      const contextMessages: OpenAI.Chat.ChatCompletionMessageParam[] =
        args.context && selectedIds.has(contextId)
          ? [{ role: "system", content: `Prior operation context:\n${args.context}` }]
          : [];
      const currentMessages: OpenAI.Chat.ChatCompletionMessageParam[] =
        selectedIds.has(currentId)
          ? [args.history[currentUserIndex]]
          : [];
      return preparedMessages([
        ...fixedMessages,
        ...contextMessages,
        ...selectedHistory,
        ...currentMessages,
      ], opts);
    },
  });

  const selectedIds = new Set(packed.selected.map((unit) => unit.id));
  const selected = historyUnits
    .filter((unit) => selectedIds.has(unit.id))
    .flatMap((unit) => unit.messages);
  selected.push(args.history[currentUserIndex]);
  const omitted = historyUnits
    .filter((unit) => !selectedIds.has(unit.id))
    .flatMap((unit) => unit.messages);

  return {
    messages: packed.messages,
    selected,
    omitted,
    contextIncluded: selectedIds.has(contextId),
    selectedOptionalUnitIds: packed.selected
      .filter((unit) => !unit.required)
      .map((unit) => unit.id),
    estimatedInputTokens: packed.estimatedInputTokens,
    contextUnits: packed.selected.length,
  };
}
