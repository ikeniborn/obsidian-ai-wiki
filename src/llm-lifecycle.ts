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

export interface LlmLifecycleDomNode {
  empty(): void;
  createDiv(arg?: string | { cls?: string; text?: string }): LlmLifecycleDomNode;
  createSpan(arg?: string | { cls?: string; text?: string }): LlmLifecycleDomNode;
  setText(text: string): void;
}

export interface LlmLifecycleTimerScheduler<Handle> {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): Handle;
  clearTimeout(handle: Handle): void;
}

interface WaitingTimer<Handle> {
  startedAt: number;
  elapsedMs: number;
  handle: Handle | null;
}

export interface ReasoningRenderState<Block, Handle> {
  block: Block | null;
  buffer: string;
  rafHandle: Handle | null;
}

export interface ToolRenderFrame<Step> {
  step: Step | null;
  startedAt: number;
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

export function renderLifecycleScale(
  root: LlmLifecycleDomNode,
  scale: LlmLifecycleScale,
): void {
  root.empty();
  root.createDiv({ cls: "ai-wiki-llm-action", text: scale.action });
  const phases = root.createDiv("ai-wiki-llm-phases");
  for (const item of scale.items) {
    const phase = phases.createDiv(
      `ai-wiki-llm-phase ai-wiki-llm-phase--${item.state}`,
    );
    phase.createSpan({ cls: "ai-wiki-llm-phase-marker", text: "•" });
    phase.createSpan({ cls: "ai-wiki-llm-phase-text", text: item.text });
  }
}

export class LlmLifecycleWaitingTimers<Handle> {
  private readonly timers = new Map<string, WaitingTimer<Handle>>();

  constructor(
    private readonly scheduler: LlmLifecycleTimerScheduler<Handle>,
    private readonly onTick: (id: string) => void = () => {},
    private readonly tickMs = 100,
  ) {}

  start(id: string): void {
    const previous = this.timers.get(id);
    if (previous?.handle !== null && previous?.handle !== undefined) {
      this.scheduler.clearTimeout(previous.handle);
    }
    this.timers.set(id, {
      startedAt: this.scheduler.now(),
      elapsedMs: 0,
      handle: null,
    });
    this.schedule(id);
  }

  stop(id: string): void {
    const timer = this.timers.get(id);
    if (!timer || timer.handle === null) return;
    timer.elapsedMs = this.scheduler.now() - timer.startedAt;
    this.scheduler.clearTimeout(timer.handle);
    timer.handle = null;
  }

  elapsedMs(id: string): number | undefined {
    const timer = this.timers.get(id);
    if (!timer) return undefined;
    return timer.handle === null
      ? timer.elapsedMs
      : this.scheduler.now() - timer.startedAt;
  }

  activeCount(): number {
    let count = 0;
    for (const timer of this.timers.values()) {
      if (timer.handle !== null) count++;
    }
    return count;
  }

  clearAll(): void {
    for (const timer of this.timers.values()) {
      if (timer.handle !== null) this.scheduler.clearTimeout(timer.handle);
    }
    this.timers.clear();
  }

  private schedule(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    timer.handle = this.scheduler.setTimeout(() => {
      const current = this.timers.get(id);
      if (!current || current.handle === null) return;
      current.elapsedMs = this.scheduler.now() - current.startedAt;
      this.onTick(id);
      this.schedule(id);
    }, this.tickMs);
  }
}

export function resetReasoningForLifecycle<Block, Handle>(
  event: Pick<LlmLifecycleEvent, "phase">,
  state: ReasoningRenderState<Block, Handle>,
  cancelAnimationFrame: (handle: Handle) => void,
  flushPending: (block: Block, buffer: string) => void,
): ReasoningRenderState<Block, Handle> {
  if (event.phase !== "preparing") return state;
  if (state.rafHandle !== null) {
    if (state.block !== null) flushPending(state.block, state.buffer);
    cancelAnimationFrame(state.rafHandle);
  }
  return { block: null, buffer: "", rafHandle: null };
}

export function pushToolRenderFrame<Step>(
  frames: readonly ToolRenderFrame<Step>[],
  frame: ToolRenderFrame<Step>,
): ToolRenderFrame<Step>[] {
  return [...frames, frame];
}

export function popToolRenderFrame<Step>(
  frames: readonly ToolRenderFrame<Step>[],
): { frames: ToolRenderFrame<Step>[]; frame: ToolRenderFrame<Step> | undefined } {
  return {
    frames: frames.slice(0, -1),
    frame: frames.at(-1),
  };
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
