import type {
  LlmLifecycleAction,
  LlmLifecycleDiagnostics,
  LlmLifecyclePhase,
  RunEvent,
} from "./types";

export type { LlmLifecycleAction, LlmLifecycleDiagnostics, LlmLifecyclePhase };

export interface LlmLifecycleLabels {
  phases: Record<LlmLifecyclePhase, string>;
  actions: Record<LlmLifecycleAction, string>;
}

export interface LlmLifecycleCall {
  action: LlmLifecycleAction;
  phase: LlmLifecyclePhase;
  progressPhase: (typeof ORDERED_PHASES)[number];
  atMs: number;
}

export interface LlmLifecycleState {
  calls: Record<string, LlmLifecycleCall>;
}

export type LlmLifecycleEvent = Extract<RunEvent, { kind: "llm_lifecycle" }>;
export type LlmLifecycleScaleState = "current" | "completed" | "failed" | "pending";
export type LlmLifecycleScaleKey =
  | "preparing"
  | "sent"
  | "waiting"
  | "producing"
  | "validating"
  | "applying"
  | "terminal";

export interface LlmLifecycleScale {
  action: string;
  items: Array<{
    key: LlmLifecycleScaleKey;
    text: string;
    state: LlmLifecycleScaleState;
  }>;
}

const ORDERED_PHASES = [
  "preparing",
  "sent",
  "waiting",
  "producing",
  "validating",
  "applying",
] as const;

const TERMINAL_PHASES = new Set<LlmLifecyclePhase>([
  "completed",
  "retrying",
  "failed",
  "cancelled",
]);

export function emptyLlmLifecycleState(): LlmLifecycleState {
  return { calls: {} };
}

export function isTerminalLlmLifecyclePhase(phase: LlmLifecyclePhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export function lifecycleEvent(
  id: string,
  action: LlmLifecycleAction,
  phase: LlmLifecyclePhase,
  atMs: number = Date.now(),
  diagnostics?: LlmLifecycleDiagnostics,
): LlmLifecycleEvent {
  return {
    kind: "llm_lifecycle",
    id,
    action,
    phase,
    atMs,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function reduceLlmLifecycle(
  state: LlmLifecycleState,
  event: LlmLifecycleEvent,
): LlmLifecycleState {
  const current = state.calls[event.id];
  if (!current) {
    if (event.phase !== "preparing") {
      throw new Error("Ordered lifecycle must start with preparing");
    }
    return {
      calls: {
        ...state.calls,
        [event.id]: {
          action: event.action,
          phase: event.phase,
          progressPhase: "preparing",
          atMs: event.atMs,
        },
      },
    };
  }
  if (isTerminalLlmLifecyclePhase(current.phase)) {
    throw new Error(`Cannot update terminal lifecycle "${event.id}"`);
  }
  if (current.action !== event.action) {
    throw new Error(`Lifecycle "${event.id}" must keep a stable action`);
  }
  if (event.atMs < current.atMs) {
    throw new Error(`Lifecycle "${event.id}" requires nondecreasing time`);
  }

  const currentIndex = ORDERED_PHASES.indexOf(
    current.phase as (typeof ORDERED_PHASES)[number],
  );
  const nextIndex = ORDERED_PHASES.indexOf(
    event.phase as (typeof ORDERED_PHASES)[number],
  );
  const validTerminal = isTerminalLlmLifecyclePhase(event.phase)
    && (event.phase !== "completed" || current.phase === "applying");
  if (!validTerminal && nextIndex !== currentIndex + 1) {
    throw new Error(`Ordered lifecycle transition rejected: ${current.phase} -> ${event.phase}`);
  }

  return {
    calls: {
      ...state.calls,
      [event.id]: {
        action: event.action,
        phase: event.phase,
        progressPhase: isTerminalLlmLifecyclePhase(event.phase)
          ? current.progressPhase
          : event.phase as (typeof ORDERED_PHASES)[number],
        atMs: event.atMs,
      },
    },
  };
}

export function humanLifecycleText(
  event: Pick<LlmLifecycleEvent, "action" | "phase">,
  labels: LlmLifecycleLabels,
): string {
  return `${labels.actions[event.action]} — ${labels.phases[event.phase]}`;
}

export function lifecycleScale(
  event: Pick<LlmLifecycleEvent, "action" | "phase">,
  labels: LlmLifecycleLabels,
  waitingMs?: number,
  reachedPhase?: (typeof ORDERED_PHASES)[number],
): LlmLifecycleScale {
  const terminal = isTerminalLlmLifecyclePhase(event.phase);
  const progressPhase = reachedPhase
    ?? (terminal ? "applying" : event.phase as (typeof ORDERED_PHASES)[number]);
  const activeIndex = ORDERED_PHASES.indexOf(progressPhase);
  const items: LlmLifecycleScale["items"] = ORDERED_PHASES.map((phase, index) => {
    let state: LlmLifecycleScaleState = "pending";
    if (index < activeIndex || (terminal && index === activeIndex)) state = "completed";
    else if (!terminal && index === activeIndex) state = "current";
    const duration = phase === "waiting" && waitingMs !== undefined
      ? ` · ${(waitingMs / 1000).toFixed(1)}s`
      : "";
    return { key: phase, text: `${labels.phases[phase]}${duration}`, state };
  });

  const terminalState: LlmLifecycleScaleState = event.phase === "completed"
    ? "completed"
    : event.phase === "failed" || event.phase === "cancelled"
      ? "failed"
      : event.phase === "retrying"
        ? "current"
        : "pending";
  items.push({
    key: "terminal",
    text: terminal ? labels.phases[event.phase] : labels.phases.completed,
    state: terminalState,
  });
  return { action: labels.actions[event.action], items };
}

export function shouldSuppressLegacyLlmTool(
  name: string,
  state: LlmLifecycleState,
): boolean {
  const action = name === "Evidence mapping"
    ? "extract_source_facts"
    : name === "Evidence reduction"
      ? "reduce_source_evidence"
      : null;
  if (!action) return false;
  return Object.values(state.calls).some(
    (call) => call.action === action && !isTerminalLlmLifecyclePhase(call.phase),
  );
}
