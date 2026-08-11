import type { RunEvent } from "./types";

export type RunTerminalStatus = "done" | "error" | "cancelled";

export function reduceRunStatus(
  status: RunTerminalStatus,
  event: RunEvent,
): RunTerminalStatus {
  if (status === "error") return status;
  if (event.kind === "error") return "error";
  if (event.kind === "exit" && event.code !== 0) return "error";
  if (event.kind === "file_outcome") {
    if (event.status === "skipped" || event.status === "exhausted") return "error";
    if (event.status === "stopped") return "cancelled";
  }
  return status;
}

export function finalizeRunStatus(
  status: RunTerminalStatus,
  options: { aborted: boolean; timedOut: boolean },
): RunTerminalStatus {
  if (status === "error") return status;
  if (options.timedOut) return "error";
  if (options.aborted) return "cancelled";
  return status;
}
