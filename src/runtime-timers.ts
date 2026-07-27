declare const global: {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
} | undefined;

export type RuntimeTimer = ReturnType<typeof setTimeout>;

function runtimeTimerHost(): {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
} {
  if (typeof global !== "undefined") return global;
  return window;
}

export function scheduleRuntimeTimeout(callback: () => void, delayMs: number): RuntimeTimer {
  return runtimeTimerHost().setTimeout(callback, delayMs);
}

export function cancelRuntimeTimeout(timer: RuntimeTimer): void {
  runtimeTimerHost().clearTimeout(timer);
}
