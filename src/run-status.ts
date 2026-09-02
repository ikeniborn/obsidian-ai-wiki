import type { RunEvent } from "./types";

export type RunTerminalStatus = "done" | "error" | "cancelled";

/**
 * A run's terminal status is not decided by the first `error` event: init can
 * fail a source, ask the user, and recover it through Retry. `provisionalError`
 * holds an error that a later `file_attempt` of state `recovered` may still
 * supersede; `status` holds what nothing can take back.
 *
 * Attribution is positional, not per-file: an `error` event carries no file, and
 * init drives its sources one at a time, so the only provisional error in flight
 * when a recovery arrives is that source's own.
 */
export interface RunStatusState {
  status: RunTerminalStatus;
  provisionalError: boolean;
}

export const INITIAL_RUN_STATUS: RunStatusState = {
  status: "done",
  provisionalError: false,
};

/** Record a failure the run cannot recover from, such as a thrown dispatch. */
export function hardRunError(state: RunStatusState): RunStatusState {
  return { ...state, status: "error" };
}

export function reduceRunStatus(
  state: RunStatusState,
  event: RunEvent,
): RunStatusState {
  if (state.status === "error") return state;
  if (event.kind === "error") return { ...state, provisionalError: true };
  if (event.kind === "exit" && event.code !== 0) return hardRunError(state);
  if (event.kind === "file_attempt" && event.state === "recovered") {
    return { ...state, provisionalError: false };
  }
  if (event.kind === "file_outcome") {
    if (event.status === "skipped" || event.status === "exhausted") {
      return hardRunError(state);
    }
    if (event.status === "stopped") return { ...state, status: "cancelled" };
  }
  return state;
}

export function finalizeRunStatus(
  state: RunStatusState,
  options: { aborted: boolean; timedOut: boolean },
): RunTerminalStatus {
  if (state.status === "error") return "error";
  if (options.timedOut) return "error";
  if (state.provisionalError) return "error";
  if (options.aborted) return "cancelled";
  return state.status;
}
