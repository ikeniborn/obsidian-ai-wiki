import type { RunEvent } from "./types";

export class RunEventBridge {
  private readonly queue: RunEvent[] = [];
  private cursor = 0;
  private wake: (() => void) | undefined;
  private closed = false;
  private forwarding = false;

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

    let completed = false;
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
      if (!settlement.ok) throw settlement.error;
      completed = true;
      return settlement.value;
    } finally {
      this.closed = !completed;
      this.queue.length = 0;
      this.cursor = 0;
      this.wake = undefined;
      this.forwarding = false;
      if (!completed) onCancel?.();
    }
  }
}
