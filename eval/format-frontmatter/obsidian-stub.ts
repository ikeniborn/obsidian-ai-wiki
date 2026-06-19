// Minimal `obsidian` stub for the out-of-vault eval harness.
// i18n.ts only uses `moment.locale()`. We let the harness control the
// returned UI locale via a global so resolveLang's `auto` fallback
// can be exercised deterministically.
export const moment = {
  locale(): string {
    return (globalThis as { __MOMENT_LOCALE__?: string }).__MOMENT_LOCALE__ ?? "en";
  },
};
