// Minimal `obsidian` stub for the out-of-vault eval harness.
// i18n.ts only uses `moment.locale()`. The harness drives the returned UI
// locale via a global so resolveLang's `auto` fallback is testable.
export const moment = {
  locale(): string {
    return (globalThis as { __MOMENT_LOCALE__?: string }).__MOMENT_LOCALE__ ?? "en";
  },
};
