export const moment = {
  locale(): string {
    return (globalThis as { __MOMENT_LOCALE__?: string }).__MOMENT_LOCALE__ ?? "en";
  },
};
