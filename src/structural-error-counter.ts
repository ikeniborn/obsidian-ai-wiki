export interface StructuralErrorStats {
  failed: number;
  retried: number;
  ok: number;
}

class Counter {
  private stats: StructuralErrorStats = { failed: 0, retried: 0, ok: 0 };
  private listeners = new Set<(s: StructuralErrorStats) => void>();

  record(succeeded: boolean | null, retryAttempt: number): void {
    if (succeeded === null) return;
    if (!succeeded) this.stats.failed++;
    else if (retryAttempt > 0) this.stats.retried++;
    else this.stats.ok++;
    const snap: StructuralErrorStats = { ...this.stats };
    for (const fn of this.listeners) fn(snap);
  }

  subscribe(fn: (s: StructuralErrorStats) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  get(): StructuralErrorStats {
    return { ...this.stats };
  }

  reset(): void {
    this.stats = { failed: 0, retried: 0, ok: 0 };
  }
}

export const structuralErrorCounter = new Counter();
