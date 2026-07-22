import type { DeleteStateCommitEvent, RunEvent } from "./types";

interface DeleteStateDispatch {
  persist(): Promise<{ journalHash: string }>;
  log(event: RunEvent): Promise<void>;
  append(event: RunEvent): void;
}

export async function processDeleteStateCommitForDispatch(
  event: DeleteStateCommitEvent,
  dispatch: DeleteStateDispatch,
): Promise<{ ok: true } | { ok: false; error: Extract<RunEvent, { kind: "error" }> }> {
  try {
    const receipt = await dispatch.persist();
    event.receiptHash = receipt.journalHash;
  } catch (error) {
    const failure = {
      kind: "error" as const,
      message: `Delete state publication failed: ${(error as Error).message}`,
    };
    await dispatch.log(failure);
    dispatch.append(failure);
    return { ok: false, error: failure };
  }
  await dispatch.log(event);
  dispatch.append(event);
  return { ok: true };
}
