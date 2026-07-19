import type { RunEvent } from "./types";

export class RunEventBridge {
  private readonly queue: RunEvent[] = [];
  private cursor = 0;
  private wake: (() => void) | undefined;
  private closed = false;
  private forwarding = false;
  private abandoned = false;

  push(event: RunEvent): void {
    if (this.closed) return;
    this.queue.push(event);
    this.wake?.();
    this.wake = undefined;
  }

  async *forward<T>(
    work: Promise<T>,
    onCancel?: () => void,
  ): AsyncGenerator<RunEvent, T> {
    if (this.abandoned) throw new Error("event bridge was abandoned");
    if (this.forwarding) throw new Error("event bridge already forwarding");
    this.forwarding = true;
    this.closed = false;
    this.cursor = 0;
    let settlement:
      | { ok: true; value: T }
      | { ok: false; error: unknown }
      | undefined;
    void work.then(
      (value) => {
        settlement = { ok: true, value };
        this.wake?.();
        this.wake = undefined;
      },
      (error: unknown) => {
        settlement = { ok: false, error };
        this.wake?.();
        this.wake = undefined;
      },
    );

    let drained = false;
    try {
      while (settlement === undefined || this.cursor < this.queue.length) {
        if (this.cursor < this.queue.length) {
          yield this.queue[this.cursor++];
          continue;
        }
        if (settlement !== undefined) break;
        await new Promise<void>((resolve) => { this.wake = resolve; });
      }
      if (!settlement) throw new Error("event bridge settled without a result");
      drained = true;
      if (!settlement.ok) {
        if (settlement.error === undefined) {
          throw new Error("Live event work rejected without an error value");
        }
        throw settlement.error instanceof Error
          ? settlement.error
          : new Error(String(settlement.error));
      }
      return settlement.value;
    } finally {
      if (!drained) this.abandoned = true;
      this.closed = this.abandoned;
      this.queue.length = 0;
      this.cursor = 0;
      this.wake = undefined;
      this.forwarding = false;
      if (!drained) onCancel?.();
    }
  }

  async *forwardAbortable<T>(
    callerSignal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>,
  ): AsyncGenerator<RunEvent, T> {
    if (this.abandoned) throw new Error("event bridge was abandoned");
    const controller = new AbortController();
    const abortProvider = (): void => controller.abort();
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener("abort", abortProvider, { once: true });
    }
    const operation = Promise.resolve().then(() => work(controller.signal));
    try {
      return yield* this.forward(operation, abortProvider);
    } finally {
      callerSignal.removeEventListener("abort", abortProvider);
    }
  }
}
