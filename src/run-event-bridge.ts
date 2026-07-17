import type { RunEvent } from "./types";

export class RunEventBridge {
  private readonly queue: RunEvent[] = [];
  private wake: (() => void) | undefined;

  push(event: RunEvent): void {
    this.queue.push(event);
    this.wake?.();
    this.wake = undefined;
  }

  async *forward<T>(work: Promise<T>): AsyncGenerator<RunEvent, T> {
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

    while (settlement === undefined || this.queue.length > 0) {
      const event = this.queue.shift();
      if (event !== undefined) {
        yield event;
        continue;
      }
      if (settlement !== undefined) break;
      await new Promise<void>((resolve) => { this.wake = resolve; });
    }
    if (!settlement) throw new Error("event bridge settled without a result");
    if (!settlement.ok) throw settlement.error;
    return settlement.value;
  }
}
