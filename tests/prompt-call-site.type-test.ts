import type { RunEvent, StructuredCallSite } from "../src/types";
import type {
  PackContextUnitsArgs,
  PromptBudgetMetadata,
  RunWithContextRepackArgs,
} from "../src/prompt-budget";

type AssertAssignable<T, U extends T> = U;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Value extends true> = Value;

type PlannedCallSites = AssertAssignable<
  StructuredCallSite,
  | "init.bootstrap-map"
  | "ingest.evidence-map"
  | "ingest.evidence-reduce"
  | "ingest.synthesize"
  | "lint.batch"
  | "lint-chat.patch"
  | "format.segment"
  | "vision.analysis"
>;

// @ts-expect-error Unknown values must not be accepted as call sites.
type UnknownCallSite = AssertAssignable<StructuredCallSite, "secret-bearing.call-site">;

type BudgetEventCallSite = Extract<RunEvent, { kind: "prompt_budget" }>["callSite"];
type MetadataUsesSharedCallSite = Assert<Equal<PromptBudgetMetadata["callSite"], StructuredCallSite>>;
type RunnerUsesSharedCallSite = Assert<Equal<
  RunWithContextRepackArgs<unknown, unknown>["callSite"],
  StructuredCallSite
>>;
type EventUsesSharedCallSite = Assert<Equal<BudgetEventCallSite, StructuredCallSite>>;

declare const renderUnits: Parameters<PackContextUnitsArgs["render"]>[0];
// @ts-expect-error Renderers receive a readonly context-unit list.
renderUnits.push({
  id: "mutated",
  source: "source",
  text: "mutated",
  required: false,
  priority: 0,
  estimatedTokens: 0,
});

export type {
  EventUsesSharedCallSite,
  MetadataUsesSharedCallSite,
  PlannedCallSites,
  RunnerUsesSharedCallSite,
  UnknownCallSite,
};
